// Проверка логики без сети: зона доставки, телефоны, периоды сводок, подпись Mini App, тексты отчётов.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import { applyPatches, change, Conflict, docFromTables, getContent, history, tablesFromDoc, undoChange } from '../../server/content.js';
import { ensureSchema, getKV, SCHEMA, setKV } from '../../server/db.js';
import { loadModel, OC, R } from '../../server/menu.js';
import { watchBot } from '../../server/health.js';
import { reportText } from '../../server/stats.js';
import { tick } from '../../server/tick.js';
import { LIMIT, metered } from '../../server/budget.js';
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

test('сводки в 00:00: в группу сама уходит только месячная, по одному разу, с сравнением', async () => {
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
    assert.deepEqual(r1.reports, ['month'], 'дневные, недельные и прочие владелец отключил 18.11.2026');
    const r2 = await tick(env, midnight + 120000);
    assert.deepEqual(r2.reports, [], 'второй раз не отправляет');
    assert.equal((await tick(env, Date.UTC(2026, 11, 2) - TZ_OFFSET + 60000)).reports.length, 0, 'обычная полночь — без сводки');
    const monthly = sent.find((x) => /Итоги месяца/.test(x.body.text));
    assert.ok(monthly);
    assert.ok(!sent.some((x) => /Итоги (дня|недели|квартала|года)/.test(x.body.text || '')), 'других сводок в группе нет');
    assert.equal(monthly.body.disable_notification, true, 'сводки приходят без звука');
    // Текст за день по-прежнему собирается — его показывает /stats
    const daily = { body: { text: await reportText(env, 'ru', 'day', day, day + DAY) } };
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

test('сроки хранения панели: журнал — год, фото без ссылок — 30 дней', async () => {
  const env = { DB: memoryD1() };
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  const now = Date.now();
  const id = (n) => String(n).padStart(16, 'a');
  await env.DB.prepare('INSERT INTO content (id, doc, version, updated_at) VALUES (1, ?, 1, ?)')
    .bind(JSON.stringify({ cats: [], items: [{ id: 'x', img: 'up_' + id(1) }] }), now).run();
  const photo = (n, days) => env.DB.prepare("INSERT INTO photos (id, created_at, type, sq, l) VALUES (?, ?, 'image/webp', x'00', x'00')")
    .bind(id(n), now - days * DAY).run();
  const log = (days, patches) => env.DB.prepare("INSERT INTO changes (at, kind, patches) VALUES (?, 'item', ?)").bind(now - days * DAY, patches).run();
  await photo(1, 400); // в меню
  await photo(2, 400); // только в журнале за год — нужно для отмены
  await photo(3, 400); // нигде
  await photo(4, 5); // нигде, но свежее
  await photo(5, 400); // только в журнале старше года
  await log(10, JSON.stringify([{ before: { img: 'up_' + id(2) } }]));
  await log(500, JSON.stringify([{ before: { img: 'up_' + id(5) } }]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }));
  try {
    const r = await tick(env, now);
    assert.equal(r.photosRemoved, 2);
    assert.deepEqual((await env.DB.prepare('SELECT id FROM photos ORDER BY id').all()).results.map((x) => x.id), [id(1), id(2), id(4)]);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first()).n, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('сторож бота: прошедшая проблема не считается текущей, но остаётся для разбора', async () => {
  const env = { DB: memoryD1(), BOT_TOKEN: 'x:y' };
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  await setKV(env, 'wh_problem', '2026-11-03T06:00:00.000Z getWebhookInfo: timeout');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { url: 'https://buddycoffee.uz/api/tg', pending_update_count: 0 } }));
  try {
    assert.equal(await watchBot(env, Date.now()), 'ok');
    assert.equal(await getKV(env, 'wh_problem'), null);
    assert.match(await getKV(env, 'wh_last'), /timeout/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('тексты ошибок для логов и диагностики — без секретов', () => {
  assert.equal(redact('fetch https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage failed'),
    'fetch https://api.telegram.org/bot<token>/sendMessage failed');
  assert.equal(redact('GET /api/tg/info?key=abc123&x=1'), 'GET /api/tg/info?key=<…>&x=1');
  assert.equal(redact('/order?t=tok_en-1 /api/tg/info?key=K'), '/order?t=<…> /api/tg/info?key=<…>');
  assert.equal(redact(null), '');
});

/* ---------- панель владельца: контент в D1 ---------- */

const backup = JSON.parse(readFileSync(new URL('../../data/menu.json', import.meta.url), 'utf8'));
const sheetTables = { menu: backup['Меню'], categories: backup['Категории'], settings: backup['Настройки'] };
const contentEnv = () => ({
  DB: memoryD1(), BOT_TOKEN: 'x:y',
  ASSETS: { fetch: async () => new Response(JSON.stringify(backup)) }
});

test('панель: переезд меню из таблицы без потерь — сайт видит то же самое', () => {
  const before = R.buildModel(sheetTables);
  const doc = docFromTables(sheetTables);
  const after = R.buildModel(tablesFromDoc(doc, Date.UTC(2026, 10, 1)));
  assert.deepEqual(after, before);
  assert.ok(doc.items.length > 10 && doc.cats.length > 3 && doc.settings['телефон']);
});

test('панель: правка, журнал, отмена и защита от затирания чужой правки', async () => {
  const env = contentEnv();
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))); // ensureSchema помнит первую базу процесса
  const c0 = await getContent(env);
  assert.equal(c0.version, 1, 'документ создан из data/menu.json');
  const first = c0.doc.items[0];
  const by = { id: 1, name: 'Сухроб' };
  const editPrice = (price, rev) => change(env, by, (doc) => {
    const it = doc.items.find((x) => x.key === first.key);
    if (it.rev !== rev) throw new Conflict();
    const after = { ...it, variants: it.variants.map((v, i) => (i ? v : { ...v, price })), rev: Date.now() };
    return { kind: 'item', title: it.ru, patches: [{ path: 'items', key: it.key, before: it, after }] };
  });
  const r1 = await editPrice(99000, first.rev);
  assert.equal(r1.version, 2);
  assert.equal((await loadModel(env)).items.find((x) => x.key === first.key).prices[0], 99000, 'сайт видит новую цену');
  await assert.rejects(editPrice(1000, first.rev), (e) => e.code === 'conflict', 'правка по устаревшей версии блюда — 409');
  // Отмена возвращает цену; повторная — нельзя
  await undoChange(env, by, r1.id);
  assert.equal((await getContent(env)).doc.items[0].variants[0].price, first.variants[0].price);
  await assert.rejects(undoChange(env, by, r1.id), (e) => e.code === 'already');
  const h = await history(env);
  assert.equal(h.length, 2);
  assert.ok(h[1].undone_at && h[0].kind === 'undo');
  // Отменить старую правку, если после неё то же блюдо меняли, нельзя
  const cur = (await getContent(env)).doc.items[0];
  const r2 = await editPrice(50000, cur.rev);
  const cur2 = (await getContent(env)).doc.items[0];
  await editPrice(60000, cur2.rev);
  await assert.rejects(undoChange(env, by, r2.id), (e) => e.code === 'changed_later');
});

test('панель: удалённое блюдо возвращается на своё место', () => {
  const doc = docFromTables(sheetTables);
  const it = doc.items[3];
  const patches = [{ path: 'items', key: it.key, pos: 3, before: it, after: null }];
  applyPatches(doc, patches);
  assert.ok(!doc.items.some((x) => x.key === it.key));
  applyPatches(doc, patches, 'before');
  assert.equal(doc.items[3].key, it.key);
});

test('панель: расписание, «Сегодня закрыты», «Блюдо дня» и старая цена', () => {
  const doc = docFromTables(sheetTables);
  const noon = Date.UTC(2026, 11, 31, 7); // 31.12.2026 12:00 Ташкент
  const settings = (t) => R.buildModel(tablesFromDoc(doc, t)).settings;
  doc.settings['объявление'] = { uz: 'Aksiya', ru: 'Акция' };
  doc.schedule.noticeUntil = '2026-12-30';
  assert.equal(settings(noon)['объявление'].ru, '', 'объявление с истёкшей датой не показывается');
  doc.schedule.noticeUntil = '2026-12-31';
  assert.equal(settings(noon)['объявление'].ru, 'Акция');
  doc.schedule.special = [{ date: '2026-12-31', uz: '10:00–18:00', ru: '10:00–18:00', closed: false }];
  assert.equal(settings(noon)['часы_работы'].ru, 'Сегодня: 10:00–18:00', 'особые часы на дату');
  doc.schedule.closedUntil = noon + 3600000;
  const closed = R.buildModel(tablesFromDoc(doc, noon));
  assert.equal(OC.config(closed).enabled, false, 'закрыты — заказать нельзя');
  assert.match(closed.settings['объявление'].ru, /закрыты/);
  assert.notEqual(OC.config(R.buildModel(tablesFromDoc(doc, noon + 2 * 3600000))).enabled, false, 'потом снова можно');

  const target = doc.items.find((x, i) => i > 0 && x.cat === doc.items[0].cat) || doc.items[1];
  doc.promo.day = { key: target.key, date: '2026-12-31' };
  target.variants[0].old = target.variants[0].price + 5000;
  const m = R.buildModel(tablesFromDoc(doc, noon));
  const day = m.items.find((x) => x.key === target.key);
  assert.equal(day.badge, 'day');
  assert.equal(m.items.filter((x) => x.cat === day.cat)[0].key, day.key, 'блюдо дня — первым в разделе');
  const html = R.createView(m, 'ru').menuHTML();
  assert.match(html, /class="price__old"/, 'старая цена зачёркнута');
  assert.equal(R.buildModel(tablesFromDoc(doc, noon + 86400000)).items.find((x) => x.key === target.key).badge, target.badge && R.buildModel(sheetTables).items.find((x) => x.key === target.key).badge, 'на следующий день — обычная метка');
});

test('тяжёлая минута укладывается в лимиты бесплатного Cloudflare (50 запросов к D1 и 50 наружу), остальное — следующими минутами', async () => {
  // Отдельный счётчик поверх базы — проверяем сам расход, а не то, что насчитал server/budget.js
  const raw = memoryD1();
  const use = { db: 0, net: 0 };
  const st = (x) => ({ sql: x.sql, inner: x, bind: (...a) => st(x.bind(...a)), first: (c) => { use.db++; return x.first(c); }, all: () => { use.db++; return x.all(); }, run: () => { use.db++; return x.run(); } });
  const env = { DB: { prepare: (q) => st(raw.prepare(q)), batch: (l) => { use.db++; return raw.batch(l.map((x) => x.inner || x)); } }, BOT_TOKEN: 'x:y' };
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))); // ensureSchema помнит первую базу процесса
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    use.net++;
    const method = String(url).split('/').pop();
    const body = JSON.parse(init.body);
    sent.push({ method, body });
    if (method === 'copyMessage' && body.chat_id % 3 === 0) return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
    const result = method === 'getWebhookInfo' ? { url: 'https://buddycoffee.uz/api/tg', pending_update_count: 0 } : { message_id: sent.length, chat: { id: body.chat_id } };
    return new Response(JSON.stringify({ ok: true, result }));
  };
  try {
    const midnight = Date.UTC(2026, 11, 1) - TZ_OFFSET; // 01.12.2026 00:00 — сводка за месяц и ночная чистка
    await env.DB.prepare("INSERT INTO kv (k, v) VALUES ('group', '-100500')").run();
    for (let i = 1; i <= 30; i++) {
      await env.DB.prepare('INSERT INTO customers (tg_chat, lang, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(1000 + i, i % 2 ? 'uz' : 'ru', midnight - DAY, midnight - DAY).run();
    }
    await env.DB.prepare("INSERT INTO broadcasts (src_chat, src_msg, ctl_msg, audience, status, created_at, total) VALUES (-100500, 7, 8, 'all', 'sending', ?, 30)").bind(midnight - 60000).run();
    for (let i = 1; i <= 10; i++) { // доставлены 50 минут назад — пора просить оценку
      const t = midnight - 50 * 60000;
      await env.DB.prepare(`INSERT INTO orders (token, created_at, updated_at, status, type, items, total, done_at, tg_chat)
        VALUES (?, ?, ?, 'delivered', 'delivery', '[]', 50000, ?, ?)`).bind('h' + i, t - 1800000, t, t, 2000 + i).run();
    }

    let now = midnight + 60000;
    for (let minute = 0; minute < 8; minute++, now += 60000) {
      use.db = 0; use.net = 0;
      await tick(metered(env), now);
      assert.ok(use.db <= LIMIT && use.net <= LIMIT, `минута ${minute + 1}: D1 ${use.db}, наружу ${use.net}`);
    }
    const b = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = 1').first();
    assert.equal(b.status, 'done', 'рассылка дошла до конца');
    assert.equal(b.sent + b.failed, 30);
    assert.equal(b.failed, 10, 'заблокировавшие бота отмечены');
    assert.equal(sent.filter((x) => x.method === 'copyMessage').length, 30, 'никому не отправлено дважды');
    assert.equal(sent.filter((x) => /Итоги месяца|Oy yakuni/.test(x.body.text || '')).length, 1, 'сводка за месяц — ровно одна');
    assert.equal(sent.filter((x) => x.method === 'sendMessage' && x.body.chat_id > 2000 && x.body.chat_id <= 2010).length, 10, 'всех попросили оценить, по разу');
    assert.ok(await getKV(env, 'cleanup:' + new Date(midnight + 60000 + 5 * 3600000).toISOString().slice(0, 10)) || (await env.DB.prepare("SELECT 1 FROM kv WHERE k LIKE 'cleanup:%'").first()), 'ночная чистка прошла');
  } finally {
    globalThis.fetch = realFetch;
  }
});
