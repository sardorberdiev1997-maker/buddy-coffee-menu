// Серверная часть сайта (Cloudflare Pages, advanced mode: сборка кладёт её в dist/_worker.js).
// Обрабатывает /api/*, короткие ссылки /r/* и звонок клиенту /c/* (см. dist/_routes.json), остальное отдаёт статика Pages.
//
// Нужно в настройках проекта Pages:
//   DB         — привязка базы D1 (Settings → Bindings → D1 database)
//   BOT_TOKEN  — секрет: токен бота от @BotFather (Settings → Variables and Secrets, тип Secret)
import { handleUpdate, setupBot } from './bot.js';
import { customersCsv } from './customers.js';
import { ensureSchema, getKV, setKV } from './db.js';
import { loadModel, R, setting } from './menu.js';
import { accepting, cancelBySelf, createOrder, publicOrder } from './orders.js';
import { checkWebhook, groupChat, groupLang, tg, webhookSecret } from './tg.js';
import { callPage } from './call.js';
import { rushState, stopList } from './live.js';
import { countEvent } from './stats.js';
import { clientErrors, logClientError } from './health.js';
import { rateBySite } from './ratings.js';
import { tick } from './tick.js';
import { fail, json, safeEqual, SITE } from './util.js';

// Старый адрес buddy.cheking.uz оставлен: открытые до переезда страницы ещё могут слать запросы
const ORIGINS = ['https://buddycoffee.uz', 'https://www.buddycoffee.uz', 'https://buddy.cheking.uz', 'https://buddy-coffee-menu.pages.dev'];
const OLD_HOST = 'buddy.cheking.uz';

// Запросы, меняющие данные, — только с нашего сайта (или без Origin: Telegram, cron)
function sameOrigin(request) {
  const o = request.headers.get('origin');
  return !o || ORIGINS.includes(o) || o.endsWith('.buddy-coffee-menu.pages.dev') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '/api/state' && method === 'GET') {
    const [model, stop, rush] = await Promise.all([loadModel(env, { ctx }), stopList(env), rushState(env)]);
    return json({ accepting: await accepting(env, model), stop: Object.keys(stop), rush: rush ? { add: rush.add, until: rush.until } : null }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/api/orders' && method === 'POST') {
    if (!sameOrigin(request)) return fail('forbidden', 403);
    return createOrder(request, env, ctx);
  }

  let m = path.match(/^\/api\/orders\/([\w-]{10,40})$/);
  if (m && method === 'GET') {
    const o = await publicOrder(env, m[1]);
    return o ? json(o) : fail('not_found', 404);
  }

  m = path.match(/^\/api\/orders\/([\w-]{10,40})\/rate$/);
  if (m && method === 'POST') {
    if (!sameOrigin(request)) return fail('forbidden', 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail('bad_request', 400);
    const r = await rateBySite(env, m[1], body);
    return r.rating ? json({ rating: r.rating }) : fail(r.error, r.status);
  }

  m = path.match(/^\/api\/orders\/([\w-]{10,40})\/cancel$/);
  if (m && method === 'POST') {
    if (!sameOrigin(request)) return fail('forbidden', 403);
    return cancelBySelf(env, m[1]);
  }

  if (path === '/api/tg' && method === 'POST') {
    if (!(await checkWebhook(request, env))) return fail('forbidden', 403);
    const update = await request.json().catch(() => null);
    // Ошибку обработки запоминаем — её видно на /api/tg/info (Telegram получает 200 и не повторяет)
    if (update) ctx.waitUntil(handleUpdate(env, update).catch((e) => {
      console.error('update', e);
      return setKV(env, 'last_exception', `${new Date().toISOString()} ${(e && e.stack) || e}`.slice(0, 600));
    }));
    return json({ ok: true });
  }

  // Настройка бота: вебхук, команды, кнопка «Menyu». Повторный вызов ничего не ломает
  if (path === '/api/tg/setup') {
    if (!env.BOT_TOKEN) return fail('no_token', 503, { hint: 'Добавьте секрет BOT_TOKEN в настройках проекта Cloudflare Pages' });
    const last = parseInt((await getKV(env, 'setup_at')) || '0', 10);
    if (Date.now() - last < 30 * 1000) return fail('rate', 429);
    await setKV(env, 'setup_at', Date.now());
    // Окно для /bind — только при первой установке. Потом группу меняют через /unbind в старой группе
    // (это может только её администратор), иначе чужой мог бы открыть окно и перехватить заказы
    if (await groupChat(env)) await setKV(env, 'ever_bound', 1);
    else if (!(await getKV(env, 'ever_bound'))) await setKV(env, 'bind_open_at', Date.now());
    return json(await setupBot(env, await webhookSecret(env)));
  }

  // Диагностика бота: доставляет ли Telegram сообщения (без секретов)
  if (path === '/api/tg/info' && method === 'GET') {
    if (!env.BOT_TOKEN) return fail('no_token', 503);
    const r = await tg(env, 'getWebhookInfo', {});
    const w = r.ok ? r.result : {};
    return json({
      ok: !!r.ok, url: w.url, pending: w.pending_update_count, last_error: w.last_error_message || null,
      last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
      group: (await getKV(env, 'group')) ? 'bound' : 'not bound',
      setup_open: Date.now() - parseInt((await getKV(env, 'bind_open_at')) || '0', 10) < 30 * 60 * 1000, // открыто ли окно /bind
      last_tick: new Date(parseInt((await getKV(env, 'tick_at')) || '0', 10)).toISOString(),
      last_exception: await getKV(env, 'last_exception'),
      last_skip: await getKV(env, 'last_skip'),
      // Автоматика: какие сводки ушли в группу и насколько свежее меню из таблицы в кэше сервера
      reports: (await env.DB.prepare("SELECT k, v FROM kv WHERE k LIKE 'report:%' ORDER BY CAST(v AS INTEGER) DESC LIMIT 6").all())
        .results.map((x) => `${x.k.slice(7)} → ${new Date(parseInt(x.v, 10)).toISOString()}`),
      menu_cache_age_s: await env.DB.prepare("SELECT json_extract(v, '$.at') AS at FROM kv WHERE k = 'menu_cache'").first()
        .then((x) => (x && x.at ? Math.round((Date.now() - x.at) / 1000) : null)),
      rating_requests: await env.DB.prepare('SELECT COUNT(*) AS n FROM ratings WHERE asked_at > 0').first().then((x) => (x ? x.n : 0)),
      // Сторож бота (server/health.js) и последние ошибки в браузерах посетителей
      bot_problem: await getKV(env, 'wh_problem'),
      client_errors: await clientErrors(env)
    });
  }

  // Вкладка «Клиенты» в Google Таблице: =IMPORTDATA("…/api/sheet/customers.csv?key=…"). Ключ выдаёт /sheet в группе кафе
  if (path === '/api/sheet/customers.csv' && method === 'GET') {
    const key = await getKV(env, 'sheet_key');
    if (!key || !safeEqual(url.searchParams.get('key'), key)) return fail('forbidden', 403);
    return new Response(await customersCsv(env, await groupLang(env)), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
    });
  }

  if (path === '/api/tick') return json(await tick(env));

  // Воронка для /stats: открыли меню → корзина → оформление (счётчики по дням, без данных о людях)
  if (path === '/api/ev' && method === 'POST') {
    if (!sameOrigin(request)) return fail('forbidden', 403);
    await countEvent(env, await request.text().catch(() => ''));
    return new Response(null, { status: 204 });
  }

  // Ошибки JavaScript в браузерах посетителей (assets/boot.js) — без личных данных
  if (path === '/api/log' && method === 'POST') {
    if (!sameOrigin(request)) return fail('forbidden', 403);
    await logClientError(env, await request.text().catch(() => ''), request.headers.get('user-agent') || '');
    return new Response(null, { status: 204 });
  }

  return fail('not_found', 404);
}

// Короткие ссылки из QR-кодов на постерах (tools/make_qr.py): ведут на ссылку из «Настроек» таблицы,
// поэтому постер печатается один раз, а адрес страницы отзывов можно поменять в таблице
const SHORT = { google: 'отзыв_google', yandex: 'отзыв_yandex', '2gis': 'отзыв_2gis' };

async function shortLink(env, ctx, key) {
  let target = '';
  try {
    target = R.safeUrl(setting(await loadModel(env, { ctx }), SHORT[key], 'ru'));
  } catch (e) {
    console.warn('short link', key, e && e.message);
  }
  return new Response(null, { status: 302, headers: { location: target || SITE, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Переезд на buddycoffee.uz: короткие ссылки и звонки со старого адреса — постоянным перенаправлением
    // (страницы перенаправляет assets/boot.js, /api/* работает на обоих адресах, пока cron и вебхук не переключены)
    if (url.hostname === OLD_HOST && /^\/(r|c)\//.test(url.pathname)) return Response.redirect(SITE + url.pathname.slice(1) + url.search, 301);
    // «Позвонить клиенту» из группы: страница сразу открывает набор номера (server/call.js)
    const call = url.pathname.match(/^\/c\/([\w-]{10,40})\/?$/);
    if (call && env.DB) return callPage(env, call[1]).catch(() => fail('server', 500));
    const short = url.pathname.match(/^\/r\/([\w-]+)\/?$/);
    if (short && Object.hasOwn(SHORT, short[1])) return shortLink(env, ctx, short[1]);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return fail('server', 503, { detail: 'D1 binding DB is missing' });
    try {
      await ensureSchema(env);
      const res = await route(request, env, ctx);
      res.headers.set('x-content-type-options', 'nosniff');
      return res;
    } catch (e) {
      console.error('api', url.pathname, e && e.stack ? e.stack : e);
      return fail('server', 500);
    }
  }
};
