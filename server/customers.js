// База клиентов: кто заказывал (по телефону) и кто пользуется ботом (по Telegram).
// Показатели как в CRM: заказы, сумма, средний чек, давность, любимое блюдо, сегмент.
import { OC } from './menu.js';
import { DAY, ddmm } from './util.js';
import { xlsx } from './xlsx.js';

const DONE = "status IN ('delivered', 'picked')";
const SEGMENT_DAYS = { active: 30, lost: 90 };

const fullName = (u) => [u && u.first_name, u && u.last_name].filter(Boolean).join(' ').slice(0, 80) || null;

// Любое сообщение боту в личке: человек попадает в базу как подписчик бота
export async function touchBotUser(env, from, chatId) {
  if (!from || from.is_bot) return;
  const now = Date.now();
  const lang = /^ru/i.test(from.language_code || '') ? 'ru' : 'uz';
  const r = await env.DB.prepare('UPDATE customers SET tg_username = ?, last_seen = ?, name = COALESCE(name, ?), blocked = 0 WHERE tg_chat = ?')
    .bind(from.username || null, now, fullName(from), chatId).run();
  if (!(r.meta && r.meta.changes)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO customers (tg_chat, tg_username, name, lang, source, created_at, last_seen)
      VALUES (?, ?, ?, ?, 'bot', ?, ?)`).bind(chatId, from.username || null, fullName(from), lang, now, now).run();
  }
}

// После заказа: клиент по номеру телефона; если заказ из Telegram — привязываем и чат
export async function upsertFromOrder(env, { phone, phoneHash, name, lang, source, tgChat, tgUsername }) {
  const now = Date.now();
  let row = await env.DB.prepare('SELECT id FROM customers WHERE phone_hash = ?').bind(phoneHash).first();
  if (tgChat) row = await mergeChat(env, row, phoneHash, tgChat);
  if (row) {
    await env.DB.prepare(`UPDATE customers SET name = ?, phone = ?, lang = ?, last_seen = ?,
        tg_chat = COALESCE(?, tg_chat), tg_username = COALESCE(?, tg_username) WHERE id = ?`)
      .bind(name, phone, lang, now, tgChat || null, tgUsername || null, row.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO customers (phone, phone_hash, name, lang, source, tg_chat, tg_username, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(phone, phoneHash, name, lang, source, tgChat || null, tgUsername || null, now, now).run();
  }
}

// Покупатель подписался на статус заказа в боте: связываем чат с его номером
export async function attachChat(env, phoneHash, chatId, from) {
  if (!phoneHash) return;
  const row = await mergeChat(env, await env.DB.prepare('SELECT id FROM customers WHERE phone_hash = ?').bind(phoneHash).first(), phoneHash, chatId);
  if (row) {
    await env.DB.prepare('UPDATE customers SET tg_chat = ?, tg_username = COALESCE(?, tg_username), last_seen = ? WHERE id = ?')
      .bind(chatId, (from && from.username) || null, Date.now(), row.id).run();
  }
}

// Чат уже записан отдельной строкой «подписчик бота» — переносим его в строку с телефоном
async function mergeChat(env, row, phoneHash, chatId) {
  const chatRow = await env.DB.prepare('SELECT id, phone_hash, subscribed FROM customers WHERE tg_chat = ?').bind(chatId).first();
  if (!chatRow || (row && chatRow.id === row.id)) return row;
  if (!row && !chatRow.phone_hash) {
    await env.DB.prepare('UPDATE customers SET phone_hash = ? WHERE id = ?').bind(phoneHash, chatRow.id).run();
    return { id: chatRow.id };
  }
  if (!chatRow.phone_hash) {
    // Отписку, если человек отписался как подписчик бота, сохраняем
    if (row && !chatRow.subscribed) await env.DB.prepare('UPDATE customers SET subscribed = 0 WHERE id = ?').bind(row.id).run();
    await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(chatRow.id).run();
  } else {
    await env.DB.prepare('UPDATE customers SET tg_chat = NULL WHERE id = ?').bind(chatRow.id).run();
  }
  return row;
}

/* ---------- аудитории рассылки ---------- */

// Подписаны на акции и доступны в Telegram; «активные» — покупали за 30 дней, «уснувшие» — покупали раньше, но не за 30 дней
export function audienceSQL(audience, now = Date.now()) {
  const base = 'subscribed = 1 AND blocked = 0 AND tg_chat IS NOT NULL';
  const since = now - SEGMENT_DAYS.active * DAY;
  const recent = `phone_hash IN (SELECT phone_hash FROM orders WHERE ${DONE} AND created_at >= ${since})`;
  if (audience === 'active') return `${base} AND ${recent}`;
  if (audience === 'sleep') return `${base} AND phone_hash IS NOT NULL AND NOT ${recent} AND phone_hash IN (SELECT phone_hash FROM orders WHERE ${DONE})`;
  return base;
}

export async function audienceCounts(env) {
  const now = Date.now();
  const q = (a) => env.DB.prepare(`SELECT COUNT(*) AS n FROM customers WHERE ${audienceSQL(a, now)}`);
  const [all, active, sleep] = await env.DB.batch([q('all'), q('active'), q('sleep')]);
  return { all: all.results[0].n, active: active.results[0].n, sleep: sleep.results[0].n };
}

/* ---------- выгрузка в Excel ---------- */

const H = {
  ru: {
    sheet: 'Клиенты', summary: 'Итоги',
    cols: ['№', 'Имя', 'Телефон', 'Telegram', 'Язык', 'Откуда', 'В базе с', 'Первый заказ', 'Последний заказ', 'Дней без заказа',
      'Заказов', 'Сумма покупок, сум', 'Средний чек, сум', 'Отмен', 'Доставка / самовывоз', 'Любимое блюдо', 'Сегмент', 'Акции в Telegram'],
    src: { site: 'сайт', tg: 'Mini App', bot: 'бот' },
    seg: { vip: 'VIP', regular: 'Постоянный', new: 'Новый', sleep: 'Уснувший (30+ дн.)', lost: 'Ушедший (90+ дн.)', none: 'Без покупок' },
    subs: { on: 'подписан', off: 'отписался', blocked: 'заблокировал бота', none: '— (нет Telegram)' },
    yes: 'да',
    sumRows: [['Показатель', 'Значение'], ['Клиентов в базе'], ['Покупали хотя бы раз'], ['Доступны для рассылки в Telegram'], ['Сумма покупок всех клиентов, сум'], ['Средний чек, сум'], ['Повторные клиенты (2+ заказа)']],
    segTitle: 'Сегмент', segCount: 'Клиентов',
    note: 'Сегменты: VIP — 10+ заказов или 1 000 000+ сум; Постоянный — 3+ заказа; Новый — 1–2 заказа; Уснувший — нет заказов 30–90 дней; Ушедший — нет заказов больше 90 дней.'
  },
  uz: {
    sheet: 'Mijozlar', summary: 'Yakun',
    cols: ['№', 'Ism', 'Telefon', 'Telegram', 'Til', 'Qayerdan', 'Bazada', 'Birinchi buyurtma', 'Oxirgi buyurtma', 'Buyurtmasiz kunlar',
      'Buyurtmalar', 'Xaridlar summasi, so‘m', 'O‘rtacha chek, so‘m', 'Bekor', 'Yetkazish / olib ketish', 'Sevimli taom', 'Segment', 'Telegram aksiyalar'],
    src: { site: 'sayt', tg: 'Mini App', bot: 'bot' },
    seg: { vip: 'VIP', regular: 'Doimiy', new: 'Yangi', sleep: 'Uxlab qolgan (30+ kun)', lost: 'Ketgan (90+ kun)', none: 'Xaridsiz' },
    subs: { on: 'obuna', off: 'obunadan chiqqan', blocked: 'botni bloklagan', none: '— (Telegram yo‘q)' },
    yes: 'ha',
    sumRows: [['Ko‘rsatkich', 'Qiymat'], ['Bazadagi mijozlar'], ['Kamida bir marta xarid qilgan'], ['Telegram orqali xabar yuborish mumkin'], ['Barcha xaridlar summasi, so‘m'], ['O‘rtacha chek, so‘m'], ['Qayta xaridorlar (2+ buyurtma)']],
    segTitle: 'Segment', segCount: 'Mijozlar',
    note: 'Segmentlar: VIP — 10+ buyurtma yoki 1 000 000+ so‘m; Doimiy — 3+ buyurtma; Yangi — 1–2 buyurtma; Uxlab qolgan — 30–90 kun buyurtma yo‘q; Ketgan — 90 kundan ortiq.'
  }
};

function segment(c, now) {
  if (!c.done) return 'none';
  const days = (now - c.last_at) / DAY;
  if (days > SEGMENT_DAYS.lost) return 'lost';
  if (days > SEGMENT_DAYS.active) return 'sleep';
  if (c.done >= 10 || c.spent >= 1000000) return 'vip';
  if (c.done >= 3) return 'regular';
  return 'new';
}

async function buildRows(env, L, now) {
  const X = H[L] || H.ru;
  const [main, dishes] = await env.DB.batch([
    env.DB.prepare(`SELECT c.*,
        SUM(CASE WHEN o.${DONE} THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN o.${DONE} THEN o.total ELSE 0 END) AS spent,
        SUM(CASE WHEN o.status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
        SUM(CASE WHEN o.${DONE} AND o.type = 'delivery' THEN 1 ELSE 0 END) AS deliveries,
        MIN(CASE WHEN o.${DONE} THEN o.created_at END) AS first_at,
        MAX(CASE WHEN o.${DONE} THEN o.created_at END) AS last_at
      FROM customers c LEFT JOIN orders o ON c.phone_hash IS NOT NULL AND o.phone_hash = c.phone_hash
      GROUP BY c.id ORDER BY c.id`),
    env.DB.prepare(`SELECT o.phone_hash AS ph, json_extract(j.value, '$.uz') AS dish, SUM(json_extract(j.value, '$.qty')) AS qty
      FROM orders o, json_each(o.items) AS j WHERE o.${DONE} AND o.phone_hash IS NOT NULL GROUP BY ph, dish`)
  ]);
  const fav = {};
  dishes.results.forEach((d) => { if (!fav[d.ph] || d.qty > fav[d.ph].qty) fav[d.ph] = d; });

  const date = (ms) => (ms ? ddmm(ms, true) : '');
  const rows = [X.cols];
  const segCount = {};
  let buyers = 0, reachable = 0, spentAll = 0, doneAll = 0, repeat = 0;
  for (const c of main.results) {
    const seg = segment(c, now);
    segCount[seg] = (segCount[seg] || 0) + 1;
    if (c.done) { buyers++; spentAll += c.spent; doneAll += c.done; }
    if (c.done >= 2) repeat++;
    const subs = !c.tg_chat ? 'none' : c.blocked ? 'blocked' : c.subscribed ? 'on' : 'off';
    if (subs === 'on') reachable++;
    rows.push([
      c.id,
      c.name || '',
      c.phone ? OC.fmtPhone(c.phone) : '',
      c.tg_username ? '@' + c.tg_username : c.tg_chat ? X.yes : '',
      c.lang === 'ru' ? 'RU' : 'UZ',
      X.src[c.source] || c.source || '',
      date(c.created_at),
      date(c.first_at),
      date(c.last_at),
      c.last_at ? Math.floor((now - c.last_at) / DAY) : '',
      c.done || 0,
      c.spent || 0,
      c.done ? Math.round(c.spent / c.done) : 0,
      c.canceled || 0,
      c.done ? `${c.deliveries} / ${c.done - c.deliveries}` : '',
      (fav[c.phone_hash] && fav[c.phone_hash].dish) || '',
      X.seg[seg],
      X.subs[subs]
    ]);
  }
  const values = [main.results.length, buyers, reachable, spentAll, doneAll ? Math.round(spentAll / doneAll) : 0, repeat];
  const summary = X.sumRows.map((r, i) => (i === 0 ? r : [r[0], values[i - 1]]));
  summary.push([], [X.segTitle, X.segCount]);
  ['vip', 'regular', 'new', 'sleep', 'lost', 'none'].forEach((k) => summary.push([X.seg[k], segCount[k] || 0]));
  summary.push([], [X.note]);
  return { X, rows, summary, count: main.results.length };
}

export async function customersXlsx(env, L, now = Date.now()) {
  const { X, rows, summary, count } = await buildRows(env, L, now);
  return {
    count,
    bytes: xlsx([
      { name: X.sheet, filter: true, widths: [6, 22, 18, 16, 6, 10, 12, 14, 15, 10, 9, 16, 14, 7, 12, 20, 20, 20], rows },
      { name: X.summary, widths: [40, 18], rows: summary }
    ])
  };
}

// Для вкладки «Клиенты» в Google Таблице (=IMPORTDATA): те же строки в CSV
export async function customersCsv(env, L, now = Date.now()) {
  const { rows } = await buildRows(env, L, now);
  const cell = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

