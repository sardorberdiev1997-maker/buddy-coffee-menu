// Меню на сервере: те же данные и тот же разбор, что на сайте (assets/render.js).
// Цены и наличие при заказе проверяются здесь, а не верятся браузеру.
import '../assets/config.js';
import '../assets/order.js';
import '../assets/render.js';

export const R = globalThis.MenuRender;
export const OC = globalThis.OrderCore;
const CFG = globalThis.MENU_CONFIG;
const TTL = 60 * 1000;

let memo = null;

async function fetchCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
  if (!res.ok) throw new Error('sheet HTTP ' + res.status);
  return R.parseCSV(await res.text());
}

async function fromSheet() {
  const [menu, categories, settings] = await Promise.all([CFG.gids.menu, CFG.gids.categories, CFG.gids.settings].map(fetchCSV));
  const tables = { menu, categories, settings };
  if (!R.validTables(tables)) throw new Error('unexpected sheet structure');
  return tables;
}

async function fromAssets(env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/data/menu.json', 'https://buddy.cheking.uz')));
  const data = await res.json();
  return { menu: data[CFG.tabs.menu], categories: data[CFG.tabs.categories], settings: data[CFG.tabs.settings] };
}

// fresh: true — мимо кэша (перед отказом «цены изменились» перепроверяем таблицу)
export async function loadModel(env, { fresh } = {}) {
  if (!fresh && memo && Date.now() - memo.at < TTL) return memo.model;
  let tables;
  try {
    tables = await fromSheet();
  } catch (e) {
    console.warn('menu: sheet unavailable, using data/menu.json:', e.message);
    if (memo) { memo.at = Date.now(); return memo.model; } // старые данные ещё минуту, не дёргаем таблицу на каждый запрос
    tables = await fromAssets(env);
  }
  const model = R.buildModel(tables);
  memo = { at: Date.now(), model };
  return model;
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
