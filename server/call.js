// Звонок клиенту из группы кафе. В кнопках Telegram нельзя ссылку tel:, а номер в тексте сообщения
// нажимается не везде (Telegram Desktop, часть телефонов). Поэтому кнопка «Позвонить клиенту» ведёт
// на /c/<токен заказа>: страница сразу открывает набор номера, а если браузер не дал — крупная кнопка с номером.
// Телефон в ссылку не попадает; токен заказа и так знают только покупатель и сотрудники в группе.
import { orderByToken } from './db.js';
import { OC } from './menu.js';
import { T } from './texts.js';
import { h, SITE } from './util.js';

export const callButton = (o, L) => (o.phone && o.token ? [{ text: T[L].call, url: `${SITE}c/${o.token}` }] : null);

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

const STYLE = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFF6EA;color:#1B1612;
font:16px/1.45 system-ui,-apple-system,sans-serif;text-align:center}main{padding:24px}h1{margin:0 0 4px;font-size:22px}
p{margin:0 0 22px;color:#6F655C}a{display:inline-block;padding:16px 28px;border-radius:18px;background:#E31B23;color:#fff;
font-size:24px;font-weight:800;text-decoration:none;font-variant-numeric:tabular-nums}small{display:block;margin-top:18px;color:#6F655C}
@media (prefers-color-scheme:dark){body{background:#17120F;color:#FBF3EA}p,small{color:#B9AA9B}}`;

function page(title, body, go) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `${go ? `<meta http-equiv="refresh" content="0; url=${go}">` : ''}<title>${h(title)} · Buddy Coffee</title><style>${STYLE}</style></head>`
    + `<body><main><h1>${h(title)}</h1>${body}</main></body></html>`;
}

export async function callPage(env, token) {
  const o = await orderByToken(env, token);
  if (!o || !o.phone) {
    return new Response(page('Номер недоступен', '<p>Номер клиента уже удалён (заказу больше 90 дней) или ссылка неверна.<br>Mijoz raqami o‘chirilgan yoki havola noto‘g‘ri.</p>'), { status: 404, headers: HEADERS });
  }
  const tel = 'tel:+' + o.phone; // в базе — только цифры (OC.normPhone)
  return new Response(page(`Заказ №${o.id}`, `<p>${h(o.name || '')}</p><a href="${tel}">📞 ${OC.fmtPhone(o.phone)}</a>`
    + '<small>Если звонок не начался — нажмите на номер<br>Qo‘ng‘iroq boshlanmasa — raqamni bosing</small>', tel), { headers: HEADERS });
}
