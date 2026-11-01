// Панель владельца (Telegram Mini App /admin, docs/admin-panel.md): вход по подписи Telegram, роли, правка меню
// и настроек, фото, расписание, акции, массовые цены, стоп-лист и час пик, сотрудники, рассылка, статистика, журнал.
// Права: владелец — администратор группы заказов (как для команд в группе); сотрудник — по приглашению,
// только «нет в наличии» и час пик. Правки контента идут через change() (server/content.js): журнал и отмена.
import { promoKeyboard, sendBatch } from './broadcast.js';
import { change, Conflict, getContent, history, scheduleNow, undoChange } from './content.js';
import { audienceCounts, clientCard, clientList, customersXlsx, forgetCustomerById, setClientNote } from './customers.js';
import { getKV, setKV } from './db.js';
import { nextMorning, rushState, setRush, setStop, stopList } from './live.js';
import { R } from './menu.js';
import { collect } from './stats.js';
import { T } from './texts.js';
import { groupChat, tg, tgUpload, verifyInitData } from './tg.js';
import { DAY, dayKey, ddmm, fail, h, HOUR, json, periodStart, prevPeriod, randomToken, SITE } from './util.js';

const BOT = (globalThis.MENU_CONFIG && globalThis.MENU_CONFIG.bot) || '';
const INVITE_FOR = 48 * HOUR;

/* ---------- кто открыл панель ---------- */

// Роль кэшируем на минуту: getChatMember на каждый запрос — лишняя задержка
const roles = new Map();

async function roleOf(env, userId) {
  const hit = roles.get(userId);
  if (hit && hit.db === env.DB && Date.now() - hit.at < 60 * 1000) return hit.role;
  let role = null;
  const group = await groupChat(env);
  if (group) {
    const r = await tg(env, 'getChatMember', { chat_id: group, user_id: userId });
    if (r.ok && ['creator', 'administrator'].includes(r.result.status)) role = 'owner';
  }
  if (!role && (await env.DB.prepare('SELECT 1 AS x FROM staff WHERE tg_id = ?').bind(userId).first())) role = 'staff';
  roles.set(userId, { role, at: Date.now(), db: env.DB });
  return role;
}

// Заголовок Authorization: tma <initData> — так принято для Mini Apps; подпись проверяет verifyInitData
async function whoIs(env, request) {
  const m = (request.headers.get('authorization') || '').match(/^tma (.+)$/);
  const u = m && (await verifyInitData(env, m[1]));
  if (!u || !u.id) return null;
  const role = await roleOf(env, u.id);
  if (!role) return { id: u.id, role: null };
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : String(u.id));
  return { id: u.id, name, username: u.username || '', lang: /^ru/i.test(u.language_code || '') ? 'ru' : 'uz', role };
}

/* ---------- проверка входных данных ---------- */

const bad = (code) => new Conflict(code, 400);
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, min, max) => {
  const n = Math.round(Number(String(v == null ? '' : v).replace(/[\s,]/g, '')));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
const url = (v) => {
  const s = str(v, 300);
  if (!s) return '';
  const u = R.safeUrl(s);
  if (!/^https:\/\//.test(u)) throw bad('url');
  return u;
};
const UPLOADED = /^up_[a-f0-9]{16}$/;
const BADGES = ['', 'хит', 'новинка', 'острое', 'советуем'];

// Блюдо из формы панели. prev — прежняя версия (фото из папки img и ссылки, которые уже были, оставляем как есть)
function cleanItem(b, doc, prev) {
  const uz = str(b.uz, 80), ru = str(b.ru, 80);
  if (!uz && !ru) throw bad('name');
  const cat = str(b.cat, 60);
  if (!doc.cats.some((c) => c.id === cat)) throw bad('cat');
  const variants = (Array.isArray(b.variants) ? b.variants : []).slice(0, 6).map((v) => {
    const price = int(v && v.price, 100, 10000000);
    if (price == null) throw bad('price');
    const old = int(v.old, 0, 10000000) || 0;
    return { size_uz: str(v.size_uz, 30), size_ru: str(v.size_ru, 30), price, old: old > price ? old : 0, weight: str(v.weight, 20) };
  });
  if (!variants.length) throw bad('price');
  if (variants.length > 1 && variants.some((v) => !v.size_uz && !v.size_ru)) throw bad('size');
  let img = str(b.img, 300);
  if (img && img !== (prev && prev.img) && !UPLOADED.test(img)) img = url(img);
  const badge = BADGES.includes(str(b.badge, 20).toLowerCase()) ? str(b.badge, 20).toLowerCase() : '';
  return {
    cat, uz, ru, desc_uz: str(b.desc_uz, 300), desc_ru: str(b.desc_ru, 300), img, badge,
    avail: b.avail !== false, weight: variants.some((v) => v.weight) ? '' : str(b.weight, 40),
    pairs: str(b.pairs, 200), kcal: str(b.kcal, 40), protein: str(b.protein, 40), fat: str(b.fat, 40),
    carbs: str(b.carbs, 40), allergens: str(b.allergens, 200), variants
  };
}

// Новый ключ, не совпадающий с уже занятыми. Сравниваем как сайт (assets/render.js): без регистра —
// раздел «Pitsa» из таблицы и новый «pitsa» сайт счёл бы одним
const uniq = (list, base, field) => {
  const taken = new Set(list.map((x) => slug(x[field])));
  let k = base || 'x', n = 2;
  while (taken.has(k)) k = `${base}-${n++}`;
  return k;
};

// Ключи вкладки «Настройки», которые владелец меняет в панели. mono — одно значение для обоих языков
const SETTINGS = {
  'слоган': { max: 120 }, 'подзаголовок': { max: 120 }, 'объявление': { max: 200 }, 'адрес': { max: 200 },
  'часы_работы': { max: 100 }, 'оплата': { max: 120 }, 'доставка': { max: 150 }, 'продавец': { max: 200 },
  'примечание_к_фото': { max: 200 }, 'описание_бота': { max: 120 },
  'телефон': { mono: true, check: (v) => (!v || /^\+?[\d\s()-]{7,20}$/.test(v) ? v : null) },
  'ссылка_на_карту': { mono: true, url: true }, 'instagram': { mono: true, url: true }, 'telegram': { mono: true, url: true },
  'отзыв_google': { mono: true, url: true }, 'отзыв_yandex': { mono: true, url: true },
  'wifi_сеть': { mono: true, max: 60 }, 'wifi_пароль': { mono: true, max: 60 },
  'координаты': {
    mono: true,
    check: (v) => {
      if (!v) return '';
      const m = v.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
      return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? `${(+m[1]).toFixed(6)}, ${(+m[2]).toFixed(6)}` : null;
    }
  },
  'мин_заказ': { mono: true, check: (v) => (!v ? '' : int(v, 0, 10000000) == null ? null : String(int(v, 0, 10000000))) },
  'время_доставки': { mono: true, check: (v) => (!v || /^\d{1,3}\s*[–-]\s*\d{1,3}$/.test(v) ? v.replace(/\s*-\s*/, '–') : null) },
  'время_самовывоза': { mono: true, check: (v) => (!v || /^\d{1,3}\s*[–-]\s*\d{1,3}$/.test(v) ? v.replace(/\s*-\s*/, '–') : null) },
  'заказы': { mono: true, check: (v) => (/^(да|нет)$/.test(v) ? v : null) }
};

function cleanSetting(key, v) {
  const rule = SETTINGS[key];
  if (!rule) throw bad('setting');
  const one = (x) => {
    let s = str(x, rule.max || 300);
    if (rule.url) s = url(s);
    if (rule.check) {
      s = rule.check(s);
      if (s == null) throw new Conflict('setting:' + key, 400);
    }
    return s;
  };
  if (rule.mono) {
    const s = one(v && typeof v === 'object' ? v.uz || v.ru : v);
    return { uz: s, ru: s };
  }
  return { uz: one(v && v.uz), ru: one(v && v.ru) };
}

/* ---------- ответы ---------- */

async function state(env, me) {
  const c = await getContent(env);
  const [stop, rush] = await Promise.all([stopList(env), rushState(env)]);
  const doc = me.role === 'owner' ? c.doc : {
    cats: c.doc.cats.map(({ id, uz, ru, icon }) => ({ id, uz, ru, icon })),
    items: c.doc.items.map(({ key, cat, uz, ru, img, avail }) => ({ key, cat, uz, ru, img, avail }))
  };
  return {
    me: { id: me.id, name: me.name, role: me.role, lang: me.lang },
    version: c.version, doc,
    live: {
      stop: Object.fromEntries(Object.entries(stop).map(([k, v]) => [k, v.until])),
      rush: rush ? { add: rush.add, until: rush.until } : null,
      paused: (await getKV(env, 'paused')) === '1',
      closed: scheduleNow(c.doc).closed,
      group: !!(await groupChat(env))
    },
    bot: BOT, site: SITE
  };
}

const changed = async (env, me, res) => json({ ...(await state(env, me)), change: res.id });

async function body(request, max = 60000) {
  const raw = await request.text();
  if (raw.length > max) throw bad('too_big');
  try {
    const b = JSON.parse(raw || '{}');
    if (b && typeof b === 'object') return b;
  } catch (e) { /* ниже — ошибка */ }
  throw bad('bad_json');
}

/* ---------- маршруты /api/admin/* ---------- */

export async function adminRoute(request, env, path, method, sameOrigin) {
  if (method !== 'GET' && !sameOrigin(request)) return fail('forbidden', 403);
  const me = await whoIs(env, request);
  if (!me) return fail('unauthorized', 401);
  if (!me.role) return fail('forbidden', 403, { id: me.id });
  const owner = me.role === 'owner';
  const by = { id: me.id, name: me.name };
  const action = path.slice('/api/admin/'.length);

  try {
    if (action === 'state' && method === 'GET') return json(await state(env, me));

    // --- оперативное: можно и сотрудникам ---
    if (action === 'stop' && method === 'POST') {
      const b = await body(request);
      const key = str(b.key, 120);
      const { doc } = await getContent(env);
      if (!doc.items.some((x) => x.key === key)) throw bad('item');
      await setStop(env, key, !!b.on, me.name);
      return json(await state(env, me));
    }
    if (action === 'rush' && method === 'POST') {
      const b = await body(request);
      await setRush(env, [15, 30].includes(+b.add) ? +b.add : 0, me.name);
      return json(await state(env, me));
    }

    if (!owner) return fail('forbidden', 403);

    // --- блюда ---
    if (action === 'item' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const i = b.key ? doc.items.findIndex((x) => x.key === b.key) : -1;
        if (b.key && i < 0) throw new Conflict('gone', 409);
        const prev = i >= 0 ? doc.items[i] : null;
        if (prev && b.rev !== prev.rev) throw new Conflict();
        const item = cleanItem(b, doc, prev);
        item.key = prev ? prev.key : uniq(doc.items, slug(item.cat + '-' + (item.uz || item.ru)), 'key');
        item.rev = Date.now();
        // Новое блюдо — в конец своего раздела
        let pos = null;
        if (!prev) {
          const last = doc.items.map((x) => x.cat).lastIndexOf(item.cat);
          pos = last < 0 ? doc.items.length : last + 1;
        }
        return { kind: 'item', ref: item.key, title: item.ru || item.uz, patches: [{ path: 'items', key: item.key, pos, before: prev, after: item }] };
      });
      return changed(env, me, res);
    }
    if (action === 'item/delete' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const i = doc.items.findIndex((x) => x.key === b.key);
        if (i < 0) throw new Conflict('gone', 409);
        const prev = doc.items[i];
        if (b.rev !== prev.rev) throw new Conflict();
        const patches = [{ path: 'items', key: prev.key, pos: i, before: prev, after: null }];
        if (doc.promo && doc.promo.day && doc.promo.day.key === prev.key) patches.push({ path: 'promo', before: doc.promo, after: { ...doc.promo, day: null } });
        return { kind: 'item_delete', ref: prev.key, title: prev.ru || prev.uz, patches };
      });
      return changed(env, me, res);
    }
    // Наличие «нет надолго» (avail) — отдельной кнопкой, без открытия формы
    if (action === 'item/avail' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const prev = doc.items.find((x) => x.key === b.key);
        if (!prev) throw new Conflict('gone', 409);
        if (prev.avail === !!b.avail) return null;
        return { kind: 'item_avail', ref: prev.key, title: prev.ru || prev.uz, patches: [{ path: 'items', key: prev.key, before: prev, after: { ...prev, avail: !!b.avail, rev: Date.now() } }] };
      });
      return changed(env, me, res);
    }
    if (action === 'order' && method === 'POST') {
      const b = await body(request);
      const kind = b.kind === 'cats' ? 'cats' : 'items';
      const field = kind === 'cats' ? 'id' : 'key';
      const res = await change(env, by, (doc) => {
        const now = doc[kind].map((x) => x[field]);
        const want = (Array.isArray(b.keys) ? b.keys : []).map(String);
        if (want.length !== now.length || want.some((k) => !now.includes(k))) throw new Conflict();
        if (want.join('\n') === now.join('\n')) return null;
        return { kind: 'order_' + kind, title: '', patches: [{ path: 'order:' + kind, before: now, after: want }] };
      });
      return changed(env, me, res);
    }

    // --- разделы ---
    if (action === 'cat' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const i = b.id ? doc.cats.findIndex((x) => x.id === b.id) : -1;
        if (b.id && i < 0) throw new Conflict('gone', 409);
        const prev = i >= 0 ? doc.cats[i] : null;
        if (prev && b.rev !== prev.rev) throw new Conflict();
        const uz = str(b.uz, 40), ru = str(b.ru, 40);
        if (!uz && !ru) throw bad('name');
        const cat = { id: prev ? prev.id : uniq(doc.cats, slug(uz || ru) || 'bolim', 'id'), uz, ru, icon: str(b.icon, 8), pairs: str(b.pairs, 200), rev: Date.now() };
        return { kind: 'cat', ref: cat.id, title: cat.ru || cat.uz, patches: [{ path: 'cats', key: cat.id, before: prev, after: cat }] };
      });
      return changed(env, me, res);
    }
    if (action === 'cat/delete' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const i = doc.cats.findIndex((x) => x.id === b.id);
        if (i < 0) throw new Conflict('gone', 409);
        if (doc.items.some((x) => x.cat === b.id)) throw new Conflict('not_empty', 409);
        const prev = doc.cats[i];
        return { kind: 'cat_delete', ref: prev.id, title: prev.ru || prev.uz, patches: [{ path: 'cats', key: prev.id, pos: i, before: prev, after: null }] };
      });
      return changed(env, me, res);
    }

    // --- информация о кафе и настройки заказов ---
    if (action === 'settings' && method === 'POST') {
      const b = await body(request);
      const values = b.values && typeof b.values === 'object' ? b.values : {};
      let botDesc = false;
      const res = await change(env, by, (doc) => {
        const patches = [];
        for (const [key, v] of Object.entries(values)) {
          const next = cleanSetting(key, v);
          const prev = (doc.settings || {})[key] || null;
          if (prev && prev.uz === next.uz && prev.ru === next.ru) continue;
          if (!prev && !next.uz && !next.ru) continue;
          if (key === 'описание_бота') botDesc = true;
          patches.push({ path: 'settings', key, before: prev, after: next });
        }
        return { kind: 'settings', title: patches.map((p) => p.key).join(', '), patches };
      });
      if (botDesc) await applyBotDescription(env, (await getContent(env)).doc);
      return changed(env, me, res);
    }
    if (action === 'paused' && method === 'POST') {
      const b = await body(request);
      await setKV(env, 'paused', b.on ? '1' : null);
      return json(await state(env, me));
    }

    // --- расписание: объявление до даты, особые часы, «Сегодня закрыты» ---
    if (action === 'schedule' && method === 'POST') {
      const b = await body(request);
      const today = dayKey(Date.now());
      const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
      const res = await change(env, by, (doc) => {
        const prev = doc.schedule || { noticeUntil: '', special: [], closedUntil: 0 };
        const special = (Array.isArray(b.special) ? b.special : []).slice(0, 30)
          .map((s) => ({ date: date(s.date), uz: str(s.uz, 60), ru: str(s.ru, 60), closed: !!s.closed }))
          .filter((s) => s.date && s.date >= dayKey(Date.now() - DAY) && (s.closed || s.uz || s.ru))
          .sort((a, c) => (a.date < c.date ? -1 : 1));
        const next = { ...prev, noticeUntil: date(b.noticeUntil), special };
        if (next.noticeUntil && next.noticeUntil < today) throw bad('date');
        if (JSON.stringify(next) === JSON.stringify(prev)) return null;
        return { kind: 'schedule', title: '', patches: [{ path: 'schedule', before: prev, after: next }] };
      });
      return changed(env, me, res);
    }
    if (action === 'closed' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const prev = doc.schedule || { noticeUntil: '', special: [], closedUntil: 0 };
        const next = { ...prev, closedUntil: b.on ? nextMorning(Date.now()) : 0 };
        // «Открыться» снимает и особый день «закрыто» на сегодня
        if (!b.on) next.special = (prev.special || []).filter((s) => !(s.closed && s.date === dayKey(Date.now())));
        return { kind: b.on ? 'closed' : 'opened', title: '', patches: [{ path: 'schedule', before: prev, after: next }] };
      });
      return changed(env, me, res);
    }

    // --- акции: «Блюдо дня» (старая цена — в форме блюда) ---
    if (action === 'promo' && method === 'POST') {
      const b = await body(request);
      const res = await change(env, by, (doc) => {
        const prev = doc.promo || { day: null };
        let day = null;
        if (b.day) {
          const it = doc.items.find((x) => x.key === b.day);
          if (!it) throw new Conflict('gone', 409);
          day = { key: it.key, date: dayKey(Date.now()) };
        }
        if (JSON.stringify(prev.day) === JSON.stringify(day)) return null;
        const it = day && doc.items.find((x) => x.key === day.key);
        return { kind: 'promo_day', title: it ? it.ru || it.uz : '', patches: [{ path: 'promo', before: prev, after: { ...prev, day } }] };
      });
      return changed(env, me, res);
    }

    // --- массовое изменение цен: сначала предпросмотр, потом apply ---
    if (action === 'bulk' && method === 'POST') {
      const b = await body(request);
      const value = Number(b.value);
      const step = [1, 100, 500, 1000].includes(+b.round) ? +b.round : 500;
      if (!Number.isFinite(value) || value === 0 || (b.mode === 'percent' ? Math.abs(value) > 90 : Math.abs(value) > 1000000)) throw bad('value');
      const cats = Array.isArray(b.cats) && b.cats.length ? b.cats.map(String) : null;
      const calc = (p) => Math.max(100, Math.round((b.mode === 'percent' ? p * (1 + value / 100) : p + value) / step) * step);
      const plan = (doc) => doc.items.filter((it) => !cats || cats.includes(it.cat)).map((it) => {
        const after = { ...it, variants: it.variants.map((v) => ({ ...v, price: calc(v.price), old: v.old && v.old > calc(v.price) ? v.old : 0 })), rev: Date.now() };
        return { it, after };
      }).filter(({ it, after }) => after.variants.some((v, i) => v.price !== it.variants[i].price));
      if (!b.apply) {
        const { doc } = await getContent(env);
        return json({ items: plan(doc).map(({ it, after }) => ({ key: it.key, uz: it.uz, ru: it.ru, before: it.variants.map((v) => v.price), after: after.variants.map((v) => v.price) })) });
      }
      const res = await change(env, by, (doc) => {
        const list = plan(doc);
        if (!list.length) return null;
        const sign = value > 0 ? '+' : '';
        return {
          kind: 'bulk', title: `${sign}${value}${b.mode === 'percent' ? '%' : ''} · ${list.length}`,
          patches: list.map(({ it, after }) => ({ path: 'items', key: it.key, before: it, after }))
        };
      });
      return changed(env, me, res);
    }

    // --- журнал и отмена ---
    if (action === 'history' && method === 'GET') return json({ items: await history(env) });
    if (action === 'undo' && method === 'POST') {
      const b = await body(request);
      const res = await undoChange(env, by, int(b.id, 1, 1e12));
      return changed(env, me, res);
    }

    // --- фото: квадрат и 4:3, сжаты в браузере ---
    if (action === 'photo' && method === 'POST') return savePhoto(request, env, me);

    // --- сотрудники ---
    if (action === 'staff' && method === 'GET') return json(await staffList(env));
    if (action === 'staff/invite' && method === 'POST') {
      const token = randomToken(12).replace(/[^A-Za-z0-9]/g, '');
      await setKV(env, `invite:${token}`, JSON.stringify({ by: me.name, until: Date.now() + INVITE_FOR }));
      return json({ link: `https://t.me/${BOT}?start=staff_${token}`, until: Date.now() + INVITE_FOR });
    }
    if (action === 'staff/remove' && method === 'POST') {
      const b = await body(request);
      await env.DB.prepare('DELETE FROM staff WHERE tg_id = ?').bind(int(b.id, 1, 1e15)).run();
      roles.delete(int(b.id, 1, 1e15));
      return json(await staffList(env));
    }

    // --- рассылка: пробное сообщение себе → отправка всем ---
    if (action === 'broadcast' && method === 'GET') return json(await broadcasts(env));
    if (action === 'broadcast/test' && method === 'POST') return broadcastTest(request, env, me);
    if (action === 'broadcast/send' && method === 'POST') {
      const b = await body(request);
      const aud = ['all', 'active', 'sleep'].includes(b.audience) ? b.audience : 'all';
      const id = int(b.id, 1, 1e12);
      const n = (await audienceCounts(env))[aud];
      if (!n) throw new Conflict('empty', 409);
      const ok = await env.DB.prepare("UPDATE broadcasts SET status = 'sending', audience = ?, total = ?, started_at = ? WHERE id = ? AND status = 'draft' AND created_by = ?")
        .bind(aud, n, Date.now(), id, me.name).run();
      if (!(ok.meta && ok.meta.changes)) throw new Conflict('already', 409);
      await sendBatch(env, id);
      return json(await broadcasts(env));
    }
    if (action === 'broadcast/stop' && method === 'POST') {
      const b = await body(request);
      await env.DB.prepare("UPDATE broadcasts SET status = 'stopped', done_at = ? WHERE id = ? AND status = 'sending'").bind(Date.now(), int(b.id, 1, 1e12)).run();
      return json(await broadcasts(env));
    }

    // --- клиенты (CRM): только владельцы; личные данные не уходят в журнал ---
    if (action === 'clients' && method === 'GET') {
      const p = new URL(request.url).searchParams;
      return json(await clientList(env, { q: str(p.get('q'), 60), seg: str(p.get('seg'), 10) || 'all', sort: str(p.get('sort'), 10) || 'last', offset: p.get('offset') }));
    }
    if (action === 'client' && method === 'GET') {
      const card = await clientCard(env, int(new URL(request.url).searchParams.get('id'), 1, 1e12));
      return card ? json(card) : fail('gone', 404);
    }
    if (action === 'client/note' && method === 'POST') {
      const b = await body(request);
      const note = String(b.note == null ? '' : b.note).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
      if (!(await setClientNote(env, int(b.id, 1, 1e12), note, me.name))) throw new Conflict('gone', 404);
      return json(await clientCard(env, int(b.id, 1, 1e12)));
    }
    if (action === 'client/forget' && method === 'POST') {
      const b = await body(request);
      const id = int(b.id, 1, 1e12);
      const r = await forgetCustomerById(env, id);
      if (!r) throw new Conflict('gone', 404);
      await audit(env, by, 'client_forget', `№${id}`);
      return json(r);
    }
    if (action === 'clients/export' && method === 'POST') {
      const { count, bytes } = await customersXlsx(env, me.lang);
      if (!count) throw new Conflict('empty', 409);
      const d = ddmm(Date.now(), true);
      const r = await tgUpload(env, 'sendDocument', { chat_id: me.id, caption: T[me.lang].clientsCaption(count, d) },
        { field: 'document', bytes, name: `buddy-coffee-clients-${d}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      if (!r.ok) throw new Conflict('test_failed', 502);
      await audit(env, by, 'client_export', String(count));
      return json({ count });
    }

    // --- статистика ---
    if (action === 'stats' && method === 'GET') {
      const period = new URL(request.url).searchParams.get('period') || 'today';
      return json(await stats(env, period));
    }
  } catch (e) {
    if (e instanceof Conflict) return fail(e.code, e.status);
    throw e;
  }
  return fail('not_found', 404);
}

// Запись в журнал действий без отмены (выгрузка базы клиентов, удаление по просьбе): кто и когда
const audit = (env, by, kind, title) => env.DB.prepare("INSERT INTO changes (at, by_id, by_name, kind, title, patches) VALUES (?, ?, ?, ?, ?, '[]')")
  .bind(Date.now(), by.id, by.name, kind, title).run();

/* ---------- фото ---------- */

const MAGIC = {
  'image/webp': (b) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
};

async function savePhoto(request, env, me) {
  if (Number(request.headers.get('content-length') || 0) > 2 * 1024 * 1024) return fail('too_big', 413);
  let form;
  try { form = await request.formData(); } catch (e) { return fail('bad_request', 400); }
  const parts = {};
  for (const name of ['sq', 'l']) {
    const f = form.get(name);
    if (!f || typeof f === 'string') return fail('bad_request', 400);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = Object.keys(MAGIC).find((t) => MAGIC[t](bytes));
    if (!type || bytes.length > (name === 'sq' ? 400 : 900) * 1024) return fail('bad_image', 400);
    parts[name] = { bytes, type };
  }
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO photos (id, created_at, by_id, type, sq, l) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, Date.now(), me.id, parts.l.type, parts.sq.bytes, parts.l.bytes).run();
  return json({ img: 'up_' + id });
}

// GET /api/photo/<id>/<sq|l> — для сайта, бота и рассылки. id новый при каждой загрузке → кэш на год
export async function servePhoto(env, id, size) {
  const row = await env.DB.prepare(`SELECT type, ${size === 'l' ? 'l' : 'sq'} AS data FROM photos WHERE id = ?`).bind(id).first();
  if (!row) return fail('not_found', 404);
  const bytes = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
  return new Response(bytes, { headers: { 'content-type': row.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}

/* ---------- сотрудники ---------- */

async function staffList(env) {
  const staff = (await env.DB.prepare('SELECT tg_id AS id, name, username, added_by, added_at FROM staff ORDER BY added_at').all()).results;
  const group = await groupChat(env);
  const r = group ? await tg(env, 'getChatAdministrators', { chat_id: group }) : { ok: false };
  const owners = r.ok ? r.result.filter((m) => !m.user.is_bot).map((m) => ({
    id: m.user.id, name: [m.user.first_name, m.user.last_name].filter(Boolean).join(' '), username: m.user.username || ''
  })) : [];
  return { owners, staff };
}

// /start staff_<токен> в личке бота (server/bot.js): приглашение одноразовое, 48 часов
export async function acceptInvite(env, token, from) {
  if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return null;
  // Гасим атомарно: два человека с одной ссылкой одновременно не пройдут
  const row = await env.DB.prepare('DELETE FROM kv WHERE k = ? RETURNING v').bind(`invite:${token}`).first();
  if (!row) return null;
  const inv = JSON.parse(row.v);
  if (!inv || inv.until < Date.now()) return null;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.id);
  await env.DB.prepare('INSERT INTO staff (tg_id, name, username, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username')
    .bind(from.id, name, from.username || null, inv.by, Date.now()).run();
  roles.delete(from.id);
  return { name, by: inv.by };
}

// Для /admin в личке: можно ли показать кнопку панели
export async function panelRole(env, userId) {
  return roleOf(env, userId);
}

/* ---------- рассылка ---------- */

async function broadcastTest(request, env, me) {
  const b = await body(request);
  const text = String(b.text == null ? '' : b.text).replace(/\r/g, '').trim();
  const img = UPLOADED.test(String(b.img || '')) ? String(b.img) : '';
  if (!text && !img) throw bad('empty');
  if (text.length > (img ? 1000 : 4000)) throw bad('too_long');
  const markup = promoKeyboard(me.lang);
  const r = img
    ? await tg(env, 'sendPhoto', { chat_id: me.id, photo: `${SITE}api/photo/${img.slice(3)}/l`, caption: h(text), parse_mode: 'HTML', reply_markup: markup })
    : await tg(env, 'sendMessage', { chat_id: me.id, text: h(text), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup });
  if (!r.ok) throw new Conflict('test_failed', 502);
  const ins = await env.DB.prepare("INSERT INTO broadcasts (src_chat, src_msg, created_by, created_at, status) VALUES (?, ?, ?, ?, 'draft')")
    .bind(me.id, r.result.message_id, me.name, Date.now()).run();
  return json({ id: ins.meta.last_row_id, counts: await audienceCounts(env), list: (await broadcasts(env)).list });
}

async function broadcasts(env) {
  const list = (await env.DB.prepare('SELECT id, status, audience, created_by, created_at, total, sent, failed FROM broadcasts ORDER BY id DESC LIMIT 5').all()).results;
  return { list, counts: await audienceCounts(env) };
}

/* ---------- статистика ---------- */

async function stats(env, period, now = Date.now()) {
  if (!['today', 'yesterday', 'week', 'month'].includes(period)) period = 'today';
  const kind = period === 'week' || period === 'month' ? period : 'day';
  let start = periodStart(kind, now), end = now;
  if (period === 'yesterday') [start, end] = prevPeriod('day', start);
  // Сравнение с тем же отрезком предыдущего периода: сегодня до 15:00 — со вчера до 15:00
  const [ps] = prevPeriod(kind, start);
  const [cur, before] = await Promise.all([collect(env, start, end), collect(env, ps, ps + (end - start))]);
  return { period, start, end, ...cur, prev: { revenue: before.revenue, done: before.done } };
}

/* ---------- описание бота ---------- */

const DEFAULT_DESC = {
  ru: 'Buddy Coffee, Шахрисабз: меню и заказ с доставкой. Круглосуточно.',
  uz: 'Buddy Coffee, Shahrisabz: menyu va yetkazib berish. Kecha-kunduz.'
};

export function botDescription(doc, lang) {
  const s = (doc.settings || {})['описание_бота'];
  return (s && (s[lang] || s.uz || s.ru)) || DEFAULT_DESC[lang];
}

export async function applyBotDescription(env, doc) {
  for (const lang of ['ru', 'uz', '']) {
    const L = lang || 'uz';
    await tg(env, 'setMyShortDescription', { ...(lang ? { language_code: lang } : {}), short_description: botDescription(doc, L).slice(0, 120) });
  }
}

export const _test = { cleanItem, cleanSetting, roles };
