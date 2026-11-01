// Меню на сервере: те же данные и тот же разбор, что на сайте (assets/render.js).
// Цены и наличие при заказе проверяются здесь, а не верятся браузеру.
// Источник — документ в D1 (server/content.js), который правит владелец в панели.
import '../assets/config.js';
import '../assets/order.js';
import '../assets/render.js';
import { getContent, scheduleNow, tablesFromDoc } from './content.js';
import { dayKey } from './util.js';

export const R = globalThis.MenuRender;
export const OC = globalThis.OrderCore;

// Модель зависит от версии документа, дня (расписание, «Блюдо дня») и того, закрыто ли кафе сейчас
let memo = null;

export async function loadModel(env) {
  const c = await getContent(env);
  const now = Date.now();
  const key = `${c.version}|${dayKey(now)}|${scheduleNow(c.doc, now).closed}`;
  if (!memo || memo.key !== key || memo.env !== env.DB) memo = { key, env: env.DB, model: R.buildModel(tablesFromDoc(c.doc, now)) };
  return memo.model;
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
