// Меню на сервере: те же данные и тот же разбор, что на сайте (assets/render.js).
// Цены и наличие при заказе проверяются здесь, а не верятся браузеру.
import '../assets/config.js';
import '../assets/order.js';
import '../assets/render.js';
import { getKV, setKV } from './db.js';

export const R = globalThis.MenuRender;
export const OC = globalThis.OrderCore;
const CFG = globalThis.MENU_CONFIG;
const TTL = 60 * 1000;

let memo = null;

async function fetchCSV(key) {
  const res = await fetch(R.sheetCsvUrl(CFG, key), { signal: AbortSignal.timeout(8000), redirect: 'follow' });
  if (!res.ok) throw new Error('sheet HTTP ' + res.status);
  return R.parseCSV(await res.text());
}

async function fromSheet() {
  const [menu, categories, settings] = await Promise.all(['menu', 'categories', 'settings'].map(fetchCSV));
  const tables = { menu, categories, settings };
  if (!R.validTables(tables)) throw new Error('unexpected sheet structure');
  return tables;
}

async function fromAssets(env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/data/menu.json', 'https://buddy.cheking.uz')));
  const data = await res.json();
  return { menu: data[CFG.tabs.menu], categories: data[CFG.tabs.categories], settings: data[CFG.tabs.settings] };
}

// Кэш в два уровня: память изолята и D1. Изоляты Cloudflare живут недолго, и без D1 холодный старт
// ждал бы Google Таблицу ~2 с. Устаревшее меню отдаём сразу, а таблицу перечитываем в фоне (ctx.waitUntil);
// /api/tick обновляет кэш каждую минуту, поэтому покупатели почти всегда получают свежие данные без ожидания.
let refreshing = null;

async function refresh(env) {
  let tables;
  try {
    tables = await fromSheet();
    await setKV(env, 'menu_cache', JSON.stringify({ at: Date.now(), tables })).catch(() => {});
  } catch (e) {
    console.warn('menu: sheet unavailable, using cached or data/menu.json:', e.message);
    if (memo) { memo.at = Date.now(); return memo.model; } // старые данные ещё минуту, не дёргаем таблицу на каждый запрос
    tables = await fromAssets(env);
  }
  memo = { at: Date.now(), model: R.buildModel(tables) };
  return memo.model;
}

// fresh: true — мимо кэша (перед отказом «цены изменились» перепроверяем таблицу)
export async function loadModel(env, { fresh, ctx } = {}) {
  if (fresh) return memo && Date.now() - memo.at < 15 * 1000 ? memo.model : refresh(env);
  if (memo && Date.now() - memo.at < TTL) return memo.model;
  const saved = await getKV(env, 'menu_cache').then(JSON.parse).catch(() => null);
  if (saved && saved.tables && (!memo || saved.at > memo.at)) memo = { at: saved.at, model: R.buildModel(saved.tables) };
  if (memo && Date.now() - memo.at < TTL) return memo.model;
  if (memo && ctx) {
    refreshing = refreshing || refresh(env).finally(() => { refreshing = null; });
    ctx.waitUntil(refreshing);
    return memo.model;
  }
  return refresh(env);
}

export function setting(model, key, lang) {
  const s = model.settings[key];
  return s ? (s[lang] || s.uz || s.ru || '') : '';
}

export function cafeInfo(model, lang) {
  return {
    phone: setting(model, 'телефон', lang),
    address: setting(model, 'адрес', lang),
    map: R.safeUrl(setting(model, 'ссылка_на_карту', lang)) || ''
  };
}
