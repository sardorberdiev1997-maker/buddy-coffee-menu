// Контент сайта в D1: меню, разделы, настройки, расписание и акции. Правит владелец в панели (/admin, server/admin.js).
// Сайт, бот, сборка и резервная копия получают его в прежнем формате таблиц (assets/render.js → buildModel):
// GET /api/menu → { generated, version, tables }. До панели меню жило в Google Таблице: 01.11.2026 перенесено сюда,
// таблица удалена; если база когда-нибудь окажется пустой — документ создаётся из data/menu.json.
//
// Документ (одна строка таблицы content, version растёт с каждой правкой — оптимистичная блокировка):
//   cats:     [{ id, uz, ru, icon, pairs, rev }]                       — порядок = порядок на сайте
//   items:    [{ key, cat, uz, ru, desc_uz, desc_ru, img, badge, avail, weight, pairs, kcal, protein, fat, carbs,
//                allergens, variants: [{ size_uz, size_ru, price, old, weight }], rev }]
//   settings: { ключ: { uz, ru } }                                       — как вкладка «Настройки»
//   schedule: { noticeUntil: 'YYYY-MM-DD', special: [{ date, uz, ru, closed }], closedUntil: мс }
//   promo:    { day: { key, date } | null }                              — «Блюдо дня»
import '../assets/config.js';
import '../assets/render.js';
import { dayKey, SITE } from './util.js';

const CFG = globalThis.MENU_CONFIG;
const R = globalThis.MenuRender;

const MENU_HEAD = ['ключ', 'категория', 'название_uz', 'название_ru', 'описание_uz', 'описание_ru', 'цена', 'старая_цена',
  'размеры_uz', 'размеры_ru', 'фото', 'метка', 'в_наличии', 'вес', 'с_этим_берут', 'ккал', 'белки', 'жиры', 'углеводы', 'аллергены'];
const CAT_HEAD = ['id', 'название_uz', 'название_ru', 'иконка', 'с_этим_берут'];
const SET_HEAD = ['ключ', 'значение_uz', 'значение_ru'];

const NOT_AVAILABLE = /^(нет|no|false|0|-|yo[‘'ʻ’`]?q)$/i;
const split = (s) => String(s || '').split('/').map((x) => x.trim()).filter(Boolean);
const toInt = (s) => parseInt(String(s || '').replace(/[.,]\d{1,2}$/, '').replace(/\D/g, ''), 10) || 0;
const head = (h) => String(h || '').replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, '_');

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const keys = rows[0].map(head);
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c == null ? '' : c).trim()))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, String(r[i] == null ? '' : r[i]).trim()])));
}

/* ---------- таблицы → документ (переезд; восстановление из data/menu.json) ---------- */

export function docFromTables(tables, now = Date.now()) {
  const keys = R.buildModel(tables).items.map((it) => it.key); // ключи блюд как сейчас — корзины и стоп-лист не сломаются
  const items = rowsToObjects(tables.menu).filter((r) => r['название_uz'] || r['название_ru']).map((r, i) => {
    const prices = split(r['цена']).map(toInt);
    const n = Math.max(prices.length, 1);
    const su = split(r['размеры_uz']), sr = split(r['размеры_ru']), ws = split(r['вес']);
    const perVariant = n > 1 && ws.length === n;
    return {
      key: keys[i], cat: r['категория'] || 'other', uz: r['название_uz'] || '', ru: r['название_ru'] || '',
      desc_uz: r['описание_uz'] || '', desc_ru: r['описание_ru'] || '', img: r['фото'] || '', badge: r['метка'] || '',
      avail: !NOT_AVAILABLE.test(r['в_наличии'] || ''), weight: perVariant || n === 1 ? '' : r['вес'] || '',
      pairs: r['с_этим_берут'] || '', kcal: r['ккал'] || '', protein: r['белки'] || '', fat: r['жиры'] || '',
      carbs: r['углеводы'] || '', allergens: r['аллергены'] || '',
      variants: Array.from({ length: n }, (_, j) => ({
        size_uz: su[j] || '', size_ru: sr[j] || '', price: prices[j] || 0, old: 0,
        weight: perVariant ? ws[j] : n === 1 && j === 0 ? r['вес'] || '' : ''
      })),
      rev: now
    };
  });
  const cats = rowsToObjects(tables.categories).filter((c) => c.id)
    .map((c) => ({ id: c.id, uz: c['название_uz'] || '', ru: c['название_ru'] || '', icon: c['иконка'] || '', pairs: c['с_этим_берут'] || '', rev: now }));
  const settings = {};
  rowsToObjects(tables.settings).forEach((s) => { if (s['ключ']) settings[s['ключ'].toLowerCase()] = { uz: s['значение_uz'] || '', ru: s['значение_ru'] || '' }; });
  return { cats, items, settings, schedule: { noticeUntil: '', special: [], closedUntil: 0 }, promo: { day: null } };
}

/* ---------- документ → таблицы для сайта, с расписанием и акциями на момент now ---------- */

const CLOSED = {
  notice: { uz: 'Bugun yopiqmiz. Ertaga sizni kutamiz!', ru: 'Сегодня мы закрыты. Ждём вас завтра!' },
  hours: { uz: 'Bugun yopiq', ru: 'Сегодня закрыто' },
  today: { uz: 'Bugun', ru: 'Сегодня' }
};

// Действует ли сейчас что-то из расписания (для бота и /api/state)
export function scheduleNow(doc, now = Date.now()) {
  const s = doc.schedule || {};
  const today = dayKey(now);
  const special = (s.special || []).find((x) => x.date === today) || null;
  return {
    today,
    special,
    closed: (s.closedUntil || 0) > now || !!(special && special.closed),
    noticeOff: !!(s.noticeUntil && today > s.noticeUntil)
  };
}

export function tablesFromDoc(doc, now = Date.now()) {
  const st = scheduleNow(doc, now);
  const dayKeyItem = doc.promo && doc.promo.day && doc.promo.day.date === st.today ? doc.promo.day.key : '';
  const join = (list) => list.join(' / ');
  const items = doc.items.slice();
  // «Блюдо дня» — первым в своём разделе
  const di = items.findIndex((it) => it.key === dayKeyItem);
  if (di > 0) {
    const [it] = items.splice(di, 1);
    const first = items.findIndex((x) => x.cat === it.cat);
    items.splice(first < 0 ? 0 : first, 0, it);
  }
  const menu = [MENU_HEAD, ...items.map((it) => {
    const v = it.variants && it.variants.length ? it.variants : [{ price: 0 }];
    const many = v.length > 1;
    const hasOld = v.some((x) => x.old > x.price);
    const weight = v.some((x) => x.weight) ? join(v.map((x) => x.weight || '')) : it.weight || '';
    return [it.key, it.cat, it.uz, it.ru, it.desc_uz, it.desc_ru, join(v.map((x) => x.price)),
      hasOld ? join(v.map((x) => (x.old > x.price ? x.old : 0))) : '',
      many ? join(v.map((x) => x.size_uz || '')) : '', many ? join(v.map((x) => x.size_ru || '')) : '',
      it.img || '', it.key === dayKeyItem ? 'блюдо дня' : it.badge || '', it.avail ? 'да' : 'нет', weight,
      it.pairs || '', it.kcal || '', it.protein || '', it.fat || '', it.carbs || '', it.allergens || ''];
  })];
  const categories = [CAT_HEAD, ...doc.cats.map((c) => [c.id, c.uz, c.ru, c.icon || '', c.pairs || ''])];
  const set = JSON.parse(JSON.stringify(doc.settings || {}));
  if (st.noticeOff) set['объявление'] = { uz: '', ru: '' };
  if (st.special && !st.special.closed) {
    set['часы_работы'] = {
      uz: `${CLOSED.today.uz}: ${st.special.uz || st.special.ru}`,
      ru: `${CLOSED.today.ru}: ${st.special.ru || st.special.uz}`
    };
  }
  if (st.closed) {
    set['объявление'] = { ...CLOSED.notice };
    set['часы_работы'] = { ...CLOSED.hours };
    set['заказы'] = { uz: 'нет', ru: 'нет' };
  }
  const settings = [SET_HEAD, ...Object.entries(set).map(([k, v]) => [k, v.uz || '', v.ru || ''])];
  return { menu, categories, settings };
}

/* ---------- хранение ---------- */

async function tablesFromAssets(env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/data/menu.json', SITE)));
  const data = await res.json();
  return { menu: data[CFG.tabs.menu], categories: data[CFG.tabs.categories], settings: data[CFG.tabs.settings] };
}

// Пустая база (новая установка): документ из запасной копии data/menu.json
async function importDoc(env) {
  const doc = docFromTables(await tablesFromAssets(env));
  await env.DB.prepare('INSERT OR IGNORE INTO content (id, doc, version, updated_at, updated_by) VALUES (1, ?, 1, ?, ?)')
    .bind(JSON.stringify(doc), Date.now(), 'import').run();
}

// Документ проверяем по версии не чаще раза в 2 с: правка в панели видна на сайте почти сразу, а D1 не читается на каждый запрос
let memo = null;

export async function getContent(env) {
  if (memo && memo.env === env.DB && Date.now() - memo.checked < 2000) return memo;
  let row = await env.DB.prepare('SELECT version, updated_at FROM content WHERE id = 1').first();
  if (!row) {
    await importDoc(env);
    row = await env.DB.prepare('SELECT version, updated_at FROM content WHERE id = 1').first();
  }
  if (!memo || memo.env !== env.DB || memo.version !== row.version) {
    const full = await env.DB.prepare('SELECT doc, version, updated_at FROM content WHERE id = 1').first();
    memo = { env: env.DB, version: full.version, updated_at: full.updated_at, doc: JSON.parse(full.doc), checked: 0 };
  }
  memo.checked = Date.now();
  return memo;
}

/* ---------- правки: патчи «до/после», журнал, отмена ---------- */

// Патч: { path: 'items' | 'cats' | 'settings' | 'schedule' | 'promo' | 'order:items' | 'order:cats', key, before, after, pos }
// items/cats: before/after — сущность целиком (null — её нет), pos — место в списке; settings: { uz, ru } по ключу;
// schedule/promo: объект целиком; order:* — массив ключей в нужном порядке
const ID = { items: 'key', cats: 'id' };

function applyOne(doc, p, side) {
  const val = p[side] == null ? null : JSON.parse(JSON.stringify(p[side]));
  if (p.path === 'items' || p.path === 'cats') {
    const list = doc[p.path];
    const i = list.findIndex((x) => x[ID[p.path]] === p.key);
    if (val == null) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = val;
    else list.splice(p.pos == null ? list.length : Math.min(p.pos, list.length), 0, val);
  } else if (p.path === 'settings') {
    doc.settings = doc.settings || {};
    if (val == null) delete doc.settings[p.key];
    else doc.settings[p.key] = val;
  } else if (p.path === 'schedule' || p.path === 'promo') {
    doc[p.path] = val;
  } else if (p.path === 'order:items' || p.path === 'order:cats') {
    const name = p.path.slice(6);
    const list = doc[name];
    const at = Object.fromEntries(val.map((k, i) => [k, i]));
    list.sort((a, b) => (at[a[ID[name]]] ?? 1e9) - (at[b[ID[name]]] ?? 1e9));
  }
}

export function applyPatches(doc, patches, side = 'after') {
  const list = side === 'before' ? patches.slice().reverse() : patches;
  list.forEach((p) => applyOne(doc, p, side));
  return doc;
}

// Текущее значение того, что меняет патч, — для проверки «никто не правил после» при отмене
function current(doc, p) {
  if (p.path === 'items' || p.path === 'cats') return doc[p.path].find((x) => x[ID[p.path]] === p.key) || null;
  if (p.path === 'settings') return (doc.settings || {})[p.key] || null;
  if (p.path === 'order:items' || p.path === 'order:cats') return doc[p.path.slice(6)].map((x) => x[ID[p.path.slice(6)]]);
  return doc[p.path] == null ? null : doc[p.path];
}

const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

export class Conflict extends Error {
  constructor(code = 'conflict', status = 409) { super(code); this.code = code; this.status = status; }
}

// Правка документа: mutate(doc) возвращает { kind, title, patches } (или бросает Conflict). Запись — только если
// версия не изменилась; иначе перечитываем документ и применяем ещё раз (до трёх попыток)
export async function change(env, by, mutate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    memo = null;
    const c = await getContent(env);
    const doc = JSON.parse(JSON.stringify(c.doc));
    const res = await mutate(doc, c);
    if (!res || !res.patches || !res.patches.length) return { version: c.version, doc: c.doc, id: null };
    const now = Date.now();
    applyPatches(doc, res.patches);
    const w = await env.DB.prepare('UPDATE content SET doc = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ?')
      .bind(JSON.stringify(doc), now, by ? String(by.id) : null, c.version).run();
    if (!(w.meta && w.meta.changes)) continue;
    const log = await env.DB.prepare('INSERT INTO changes (at, by_id, by_name, kind, ref, title, patches) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(now, by ? by.id : null, by ? by.name : null, res.kind, res.ref || null, res.title || '', JSON.stringify(res.patches)).run();
    memo = null;
    return { version: c.version + 1, doc, id: log.meta.last_row_id };
  }
  throw new Conflict('busy', 503);
}

// Отмена правки из журнала: возвращаем «до», если после неё эти же места никто не менял
export async function undoChange(env, by, id) {
  const row = await env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first();
  if (!row) throw new Conflict('not_found', 404);
  if (row.undone_at) throw new Conflict('already');
  const patches = JSON.parse(row.patches);
  if (!patches.length) throw new Conflict('not_undoable'); // выгрузка, удаление данных клиента — только запись в журнале
  const res = await change(env, by, (doc) => {
    if (!patches.every((p) => same(current(doc, p), p.after))) throw new Conflict('changed_later');
    return {
      kind: 'undo', ref: String(id), title: row.title,
      patches: patches.slice().reverse().map((p) => ({ path: p.path, key: p.key, pos: p.pos, before: p.after, after: p.before }))
    };
  });
  await env.DB.prepare('UPDATE changes SET undone_at = ?, undone_by = ? WHERE id = ?').bind(Date.now(), by ? by.name : null, id).run();
  return res;
}

export async function history(env, limit = 50) {
  return (await env.DB.prepare("SELECT id, at, by_name, kind, ref, title, undone_at, undone_by, patches != '[]' AS undoable FROM changes ORDER BY id DESC LIMIT ?").bind(limit).all()).results;
}

// Для тестов и /api/tg/info: сбросить кэш изолята
export function forgetContent() {
  memo = null;
}
