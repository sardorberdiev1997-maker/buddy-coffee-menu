// Проверка логики без сети: зона доставки, телефоны, периоды сводок, подпись Mini App, тексты отчётов.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { ensureSchema, SCHEMA } from '../../server/db.js';
import { OC } from '../../server/menu.js';
import { reportText } from '../../server/stats.js';
import { tick } from '../../server/tick.js';
import { verifyInitData } from '../../server/tg.js';
import { DAY, periodStart, prevPeriod, redact, TZ_OFFSET } from '../../server/util.js';

// Мини-D1 в памяти
function memoryD1() {
  const db = new DatabaseSync(':memory:');
  const plain = (r) => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    sql,
    bind: (...a) => stmt(sql, a),
    first: async (col) => { const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { const out = []; for (const s of list) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return out; }
  };
}

test('зона доставки: Шахрисабз — да, Китаб и Карши — нет', () => {
  assert.equal(OC.inZone(39.053768, 66.848886), true); // кафе, Фусункор 70
  assert.equal(OC.inZone(39.0578, 66.8343), true); // центр города
  assert.equal(OC.inZone(39.2155, 66.837), false); // Китаб
  assert.equal(OC.inZone(38.86, 65.79), false); // Карши
  assert.equal(OC.inZone(NaN, 66.8), false);
});

test('телефоны Узбекистана', () => {
  assert.equal(OC.normPhone('+998 90 123-45-67'), '998901234567');
  assert.equal(OC.normPhone('90 123 45 67'), '998901234567');
  assert.equal(OC.normPhone('(33) 1234567'), '998331234567');
  assert.equal(OC.normPhone('12 345 67 89'), '');
  assert.equal(OC.normPhone('90 123 45'), '');
  assert.equal(OC.fmtPhone('998901234567'), '+998 90 123 45 67');
});

test('периоды по Ташкенту (UTC+5): неделя с понедельника, кварталы', () => {
  // 2026-10-28 03:00 по Ташкенту — это 27.10 22:00 UTC
  const now = Date.UTC(2026, 9, 27, 22, 0);
  assert.equal(periodStart('day', now), Date.UTC(2026, 9, 28) - TZ_OFFSET);
  assert.equal(periodStart('week', now), Date.UTC(2026, 9, 26) - TZ_OFFSET); // понедельник 26.10
  assert.equal(periodStart('month', now), Date.UTC(2026, 9, 1) - TZ_OFFSET);
  assert.equal(periodStart('quarter', now), Date.UTC(2026, 9, 1) - TZ_OFFSET);
  assert.equal(periodStart('year', now), Date.UTC(2026, 0, 1) - TZ_OFFSET);
  assert.deepEqual(prevPeriod('quarter', Date.UTC(2026, 0, 1) - TZ_OFFSET), [Date.UTC(2025, 9, 1) - TZ_OFFSET, Date.UTC(2026, 0, 1) - TZ_OFFSET]);
  assert.deepEqual(prevPeriod('day', Date.UTC(2026, 2, 1) - TZ_OFFSET), [Date.UTC(2026, 1, 28) - TZ_OFFSET, Date.UTC(2026, 2, 1) - TZ_OFFSET]);
});

test('подпись Mini App (initData) проверяется по токену бота и годна сутки', async () => {
  const token = '123456:ABC';
  const user = JSON.stringify({ id: 42, first_name: 'Aziz' });
  const sign = (ageMs) => {
    const fields = { auth_date: String(Math.floor((Date.now() - ageMs) / 1000)), query_id: 'AAH', user };
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
  };
  const good = sign(0);
  assert.equal((await verifyInitData({ BOT_TOKEN: token }, good)).id, 42);
  assert.equal(await verifyInitData({ BOT_TOKEN: 'other:token' }, good), null);
  assert.equal(await verifyInitData({ BOT_TOKEN: token }, good.replace('Aziz', 'Hack')), null);
  assert.equal((await verifyInitData({ BOT_TOKEN: token }, sign(23 * 3600 * 1000))).id, 42, 'свёрнутое на 23 часа');
  assert.equal(await verifyInitData({ BOT_TOKEN: token }, sign(DAY + 3600 * 1000)), null, 'старше суток');
  assert.equal(await verifyInitData({ BOT_TOKEN: token }, sign(-3600 * 1000)), null, 'из будущего');
});

test('сводки в 00:00: день, неделя, месяц — по одному разу, с сравнением', async () => {
  const env = { DB: memoryD1(), BOT_TOKEN: 'x:y' };
  await ensureSchema(env);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ method: String(url).split('/').pop(), body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length, chat: { id: body.chat_id } } }));
  };
  try {
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('group', '-100500')").run();
    // Заказы 30.11.2026 (понедельник; 1.12 — начало месяца) и неделей раньше
    const day = Date.UTC(2026, 10, 30) - TZ_OFFSET;
    const add = (t, total, status, items, phone) => env.DB.prepare(`INSERT INTO orders (token, created_at, updated_at, status, type, items, total, done_at, phone_hash)
      VALUES (?, ?, ?, ?, 'delivery', ?, ?, ?, ?)`).bind('t' + Math.random(), t, t, status, JSON.stringify(items), total, t + 35 * 60000, phone).run();
    const burger = [{ uz: 'Big burger', qty: 2 }, { uz: 'Kartoshka fri', qty: 1 }];
    await add(day + 19 * 3600000, 105000, 'delivered', burger, 'p1');
    await add(day + 19.5 * 3600000, 60000, 'delivered', [{ uz: 'Lavash', qty: 1 }], 'p2');
    await add(day + 20 * 3600000, 45000, 'canceled', [{ uz: 'Big burger', qty: 1 }], 'p3');
    await add(day - 7 * DAY + 12 * 3600000, 100000, 'delivered', burger, 'p1');

    const midnight = Date.UTC(2026, 11, 1) - TZ_OFFSET; // 01.12.2026 00:00 Ташкент — вторник
    const r1 = await tick(env, midnight + 60000);
    assert.deepEqual(r1.reports, ['day', 'month']);
    const r2 = await tick(env, midnight + 120000);
    assert.deepEqual(r2.reports, [], 'второй раз не отправляет');
    const daily = sent.find((x) => /Итоги дня/.test(x.body.text));
    assert.ok(daily);
    assert.equal(daily.body.disable_notification, true, 'сводки приходят без звука');
    assert.match(daily.body.text, /165 000 сум/);
    assert.match(daily.body.text, /▲ 65% к пн 23\.11/);
    assert.match(daily.body.text, /Big burger ×2/);
    assert.match(daily.body.text, /новых 1/);
    const text = await reportText(env, 'uz', 'month', Date.UTC(2026, 10, 1) - TZ_OFFSET, midnight);
    assert.match(text, /Oy yakuni/);
    assert.match(text, /Eng yaxshi kun/);
    console.log('\n' + daily.body.text + '\n\n' + text);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('сроки хранения: имя и адрес в заказе — 90 дней, база клиентов — 3 года без активности', async () => {
  const env = { DB: memoryD1(), BOT_TOKEN: 'x:y' };
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))); // ensureSchema помнит первую базу процесса
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }));
  try {
    const now = Date.now();
    const order = (days) => env.DB.prepare(`INSERT INTO orders (token, created_at, updated_at, status, type, items, total, name, phone, phone_hash, address)
      VALUES (?, ?, ?, 'delivered', 'delivery', '[]', 1000, 'Aziz', '998901234567', 'h', 'Ipak yo‘li')`).bind('t' + days, now - days * DAY, now - days * DAY).run();
    const customer = (days) => env.DB.prepare('INSERT INTO customers (phone_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .bind('c' + days, 'Aziz', now - days * DAY, now - days * DAY).run();
    for (const d of [10, 100, 4 * 365]) await order(d);
    for (const d of [30, 4 * 365]) await customer(d);
    await tick(env, now);
    const rows = (await env.DB.prepare('SELECT name, address, phone_hash, anonymized FROM orders ORDER BY created_at DESC').all()).results;
    assert.deepEqual(rows.map((r) => [r.name, r.address, r.anonymized, r.phone_hash]),
      [['Aziz', 'Ipak yo‘li', 0, 'h'], [null, null, 1, 'h'], [null, null, 1, null]], '10 дней — как есть; 100 — обезличен; 4 года — и без хеша телефона');
    assert.deepEqual((await env.DB.prepare('SELECT phone_hash FROM customers').all()).results.map((r) => r.phone_hash), ['c30']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('тексты ошибок для логов и диагностики — без секретов', () => {
  assert.equal(redact('fetch https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage failed'),
    'fetch https://api.telegram.org/bot<token>/sendMessage failed');
  assert.equal(redact('GET /api/sheet/customers.csv?key=abc123&x=1'), 'GET /api/sheet/customers.csv?key=<…>&x=1');
  assert.equal(redact('/order?t=tok_en-1 /api/tg/info?key=K'), '/order?t=<…> /api/tg/info?key=<…>');
  assert.equal(redact(null), '');
});
