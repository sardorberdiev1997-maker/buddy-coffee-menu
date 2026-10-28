// Серверная часть сайта (Cloudflare Pages, advanced mode: сборка кладёт её в dist/_worker.js).
// Обрабатывает только /api/* (см. dist/_routes.json), остальное отдаёт статика Pages.
//
// Нужно в настройках проекта Pages:
//   DB         — привязка базы D1 (Settings → Bindings → D1 database)
//   BOT_TOKEN  — секрет: токен бота от @BotFather (Settings → Variables and Secrets, тип Secret)
import { handleUpdate, setupBot } from './bot.js';
import { ensureSchema, getKV, setKV } from './db.js';
import { loadModel } from './menu.js';
import { accepting, cancelBySelf, createOrder, publicOrder } from './orders.js';
import { checkWebhook, tg, webhookSecret } from './tg.js';
import { tick } from './tick.js';
import { fail, json } from './util.js';

const ORIGINS = ['https://buddy.cheking.uz', 'https://buddy-coffee-menu.pages.dev'];

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
    return json({ accepting: await accepting(env, await loadModel(env)) }, 200, { 'cache-control': 'no-store' });
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
      setup_open: Date.now() - parseInt((await getKV(env, 'setup_at')) || '0', 10) < 30 * 60 * 1000,
      last_tick: new Date(parseInt((await getKV(env, 'tick_at')) || '0', 10)).toISOString(),
      last_exception: await getKV(env, 'last_exception'),
      last_skip: await getKV(env, 'last_skip')
    });
  }

  if (path === '/api/tick') return json(await tick(env));

  return fail('not_found', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
