// Сквозная проверка заказов: npm run build && npm test
// Поднимает tools/dev-server.mjs с пустой базой и заглушкой Telegram и проходит весь путь заказа.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const GROUP = -1001234567890;
const STAFF = { id: 111, first_name: 'Ali', is_bot: false };
const CLIENT = { id: 222, first_name: 'Aziz', is_bot: false, language_code: 'ru' };

await import('../../assets/config.js');
await import('../../assets/order.js');
await import('../../assets/render.js');
const R = globalThis.MenuRender;

let server, tmp, model;
let upd = 1;

const api = async (p, opts = {}) => {
  const ip = '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
  const res = await fetch(BASE + p, { ...opts, headers: { 'content-type': 'application/json', 'x-test-ip': ip, ...(opts.headers || {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tgCalls = async (since) => (await fetch(`${BASE}/__tg?since=${since}`)).json();
const update = (u) => fetch(`${BASE}/__tg/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: upd++, ...u }) });
const groupMsg = (text, from = STAFF) => update({ message: { message_id: upd, date: 0, chat: { id: GROUP, type: 'supergroup', title: 'Buddy' }, from, text } });
const privateMsg = (text, from = CLIENT) => update({ message: { message_id: upd, date: 0, chat: { id: from.id, type: 'private' }, from, text } });
const press = (data, msgId, chat = GROUP, from = STAFF) => update({ callback_query: { id: 'q' + upd, from, data, message: { message_id: msgId, chat: { id: chat, type: chat < 0 ? 'supergroup' : 'private' } } } });

function orderBody(over = {}) {
  const pick = (k) => model.items.find((x) => x.key === k);
  const lines = [{ key: 'burger-big-burger', size: 0, qty: 1, note: 'без лука' }, { key: 'hotdog-klassik', size: 1, qty: 2, note: '' }];
  const items = lines.map((l) => ({ ...l, price: pick(l.key).prices[l.size] }));
  return {
    cid: 'c' + Math.random().toString(36).slice(2), lang: 'ru', type: 'delivery', name: 'Тест', phone: '90 123 45 67',
    address: { street: 'Ipak yo‘li, 12', apt: 'кв 5', landmark: 'школа №3' }, geo: { lat: 39.0578, lng: 66.8343, acc: 20 },
    payment: 'cash', change: 200000, comment: 'позвоните заранее', items, total: items.reduce((s, i) => s + i.price * i.qty, 0), ...over
  };
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'buddy-'));
  server = spawn(process.execPath, ['--no-warnings', 'tools/dev-server.mjs', String(PORT)], {
    cwd: ROOT, env: { ...process.env, DEV_DB: path.join(tmp, 'db.sqlite'), BOT_TOKEN: '' }, stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve) => server.stdout.once('data', resolve));
  // Та же модель меню, что увидит сервер (живая таблица)
  const get = async (key) => R.parseCSV(await (await fetch(R.sheetCsvUrl(globalThis.MENU_CONFIG, key))).text());
  model = R.buildModel({ menu: await get('menu'), categories: await get('categories'), settings: await get('settings') });
});

after(() => {
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
});

test('без подключённой группы заказы не принимаются', async () => {
  assert.equal((await api('/api/state')).body.accepting, false);
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody()) });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'paused');
});

test('/bind подключает группу только после /api/tg/setup', async () => {
  let t0 = Date.now();
  await groupMsg('/bind');
  assert.ok((await tgCalls(t0)).some((c) => /закрыто/.test(c.body.text || '')), 'без setup — отказ');
  assert.equal((await api('/api/tg/setup')).status, 200);
  t0 = Date.now();
  await groupMsg('/bind@buddy_coffee_uz_bot');
  const calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'sendMessage' && /подключена/.test(c.body.text)));
  assert.equal((await api('/api/state')).body.accepting, true);
});

test('ошибки формы: телефон, адрес, минимум, зона, цены, отсутствие, бот-ловушка', async () => {
  const bad = async (over, code, status) => {
    const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody(over)) });
    assert.equal(r.body.error, code, JSON.stringify(r.body));
    if (status) assert.equal(r.status, status);
    return r;
  };
  await bad({ phone: '12345' }, 'phone', 422);
  await bad({ address: { street: 'a' } }, 'address', 422);
  await bad({ geo: { lat: 39.2155, lng: 66.837 } }, 'zone', 422); // Китаб — за пределами Шахрисабза
  const cheap = model.items.find((x) => x.key === 'ichimlik-espresso');
  await bad({ items: [{ key: cheap.key, size: 0, qty: 1, price: cheap.prices[0] }], total: cheap.prices[0] }, 'min', 422);
  const b = orderBody();
  b.items[0].price -= 1000;
  b.total -= 1000;
  await bad(b, 'price_changed', 409);
  const out = model.items.find((x) => !x.avail);
  if (out) await bad({ items: [{ key: out.key, size: 0, qty: 1, price: out.prices[0] }], total: 100000 }, 'unavailable', 409);
  await bad({ website: 'spam' }, 'bad_request', 400);
  const r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(orderBody()) });
  assert.equal(r.status, 415);
  const x = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify(orderBody()) });
  assert.equal(x.status, 403);
});

let order;

test('заказ с доставкой: создаётся, приходит в группу с кнопками и точкой на карте', async () => {
  const t0 = Date.now();
  const body = orderBody();
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.token && r.body.number);
  order = r.body;
  // Повтор той же формы (пропала связь) не создаёт второй заказ
  const again = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(again.body.number, order.number);
  await fetch(BASE + '/__idle');
  const calls = await tgCalls(t0);
  const msg = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id == GROUP);
  assert.ok(msg, 'сообщение в группу');
  assert.match(msg.body.text, new RegExp(`НОВЫЙ ЗАКАЗ №${order.number}`));
  assert.match(msg.body.text, /без лука/);
  assert.match(msg.body.text, /\+998901234567/);
  assert.match(msg.body.text, /сдача с 200 000/);
  assert.deepEqual(msg.body.reply_markup.inline_keyboard.map((r) => r.length), [2, 2, 1], "кнопки «принять» сеткой 2×2 и «отменить»");
  assert.ok(calls.some((c) => c.method === 'sendLocation'), 'точка на карте');
  const pub = await api('/api/orders/' + order.token);
  assert.equal(pub.body.status, 'new');
  assert.equal(pub.body.total, body.total);
  assert.equal(pub.body.phone, '+998 90 123 45 67');
});

test('покупатель подписывается на статус в Telegram', async () => {
  const t0 = Date.now();
  await privateMsg('/start o_' + order.token);
  const calls = await tgCalls(t0);
  const card = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === CLIENT.id && /заказ №/i.test(c.body.text));
  assert.ok(card);
  assert.equal(card.body.reply_markup.inline_keyboard.length, 2, 'кнопки «Открыть заказ» и «Отменить»');
  assert.equal((await api('/api/orders/' + order.token)).body.tg, true);
});

test('статусы доставки: принят → готовится → у курьера → в пути → доставлен; шаг назад', async () => {
  const mid = 1; // сервер находит заказ по номеру в кнопке, id сообщения не важен
  const steps = [['a', '30', 'accepted'], ['n', 'cooking', 'cooking'], ['n', 'courier', 'courier'], ['n', 'onway', 'onway'], ['n', 'delivered', 'delivered']];
  for (const [kind, arg, status] of steps) {
    const t0 = Date.now();
    await press(`${kind}:${order.number}:${arg}`, mid);
    const pub = await api('/api/orders/' + order.token);
    assert.equal(pub.body.status, status);
    const calls = await tgCalls(t0);
    assert.ok(calls.some((c) => c.method === 'editMessageText' && c.body.chat_id == GROUP), 'группа: сообщение обновлено ' + status);
    const del = calls.find((c) => c.method === 'deleteMessage' && c.body.chat_id === CLIENT.id);
    const sent = calls.find((c) => c.method === 'sendMessage' && c.body.chat_id === CLIENT.id);
    assert.ok(del && sent, 'покупатель: прежняя карточка удалена, новая прислана ' + status);
    assert.equal(sent.body.disable_notification, ['cooking', 'courier'].includes(status), 'звук ' + status);
    if (status === 'accepted') assert.ok(pub.body.eta > Date.now() + 25 * 60000);
  }
  // Повторное нажатие не меняет статус
  await press(`n:${order.number}:delivered`, mid);
  assert.equal((await api('/api/orders/' + order.token)).body.status, 'delivered');
  // Шаг назад
  await press(`u:${order.number}`, mid);
  assert.equal((await api('/api/orders/' + order.token)).body.status, 'onway');
  await press(`n:${order.number}:delivered`, mid);
  assert.equal((await api('/api/orders/' + order.token)).body.status, 'delivered');
});

test('оценка: просьба через 45 минут, низкая — администратору, ссылки на карты при любой оценке', async () => {
  const sql = (q, ...args) => fetch(BASE + '/__sql', { method: 'POST', body: JSON.stringify({ sql: q, args }) });
  const tick = async () => { await sql("DELETE FROM kv WHERE k = 'tick_at'"); await api('/api/tick', { method: 'POST' }); };
  const sites = ['google', 'yandex', '2gis'].filter((k) => { const v = model.settings['отзыв_' + k]; return v && R.safeUrl(v.ru || v.uz); });
  // Доставлен 10 минут назад — рано; 50 минут — просим одним тихим сообщением
  await sql('UPDATE orders SET done_at = ? WHERE id = ?', Date.now() - 10 * 60000, order.number);
  let t0 = Date.now();
  await tick();
  assert.ok(!(await tgCalls(t0)).some((c) => /Оцените/.test(c.body.text || '')), 'рано');
  await sql('UPDATE orders SET done_at = ? WHERE id = ?', Date.now() - 50 * 60000, order.number);
  t0 = Date.now();
  await tick();
  const ask = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && c.body.chat_id === CLIENT.id && /Оцените/.test(c.body.text));
  assert.ok(ask, 'просьба об оценке');
  assert.equal(ask.body.disable_notification, true);
  assert.equal(ask.body.reply_markup.inline_keyboard[0].length, 5);
  t0 = Date.now();
  await tick();
  assert.ok(!(await tgCalls(t0)).some((c) => /Оцените/.test(c.body.text || '')), 'второй раз не просим');

  // 2 звезды: администратору — оповещение; покупателю — причины, «Написать» и ссылки на карты
  t0 = Date.now();
  await press(`rt:${order.number}:2`, 77, CLIENT.id, CLIENT);
  let calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id == GROUP && /Низкая оценка/.test(c.body.text)), 'группа: низкая оценка');
  const btns = calls.find((c) => c.method === 'editMessageText' && c.body.chat_id === CLIENT.id).body.reply_markup.inline_keyboard.flat();
  assert.ok(btns.some((b) => b.callback_data === `rr:${order.number}:cold`));
  assert.equal(btns.filter((b) => /\/r\/(google|yandex|2gis)$/.test(b.url || '')).length, sites.length, 'карты — при любой оценке');
  // Чужой не может оценить чужой заказ
  t0 = Date.now();
  await press(`rt:${order.number}:1`, 77, 999, { id: 999, first_name: 'X', is_bot: false });
  assert.ok(!(await tgCalls(t0)).some((c) => c.method === 'editMessageText'));

  // Причина и комментарий дописываются в то же сообщение группы
  t0 = Date.now();
  await press(`rr:${order.number}:cold`, 77, CLIENT.id, CLIENT);
  await press(`rw:${order.number}`, 77, CLIENT.id, CLIENT);
  await privateMsg('Курьер опоздал на <b>20</b> минут');
  calls = await tgCalls(t0);
  const edits = calls.filter((c) => c.method === 'editMessageText' && c.body.chat_id == GROUP);
  assert.ok(edits.some((c) => /Остыло/.test(c.body.text)), 'причина');
  assert.ok(edits.some((c) => /опоздал на &lt;b&gt;20/.test(c.body.text)), 'комментарий, HTML экранирован');

  // С сайта: оценку можно поднять — в группе «изменил оценку»; страница заказа отдаёт оценку и площадки
  t0 = Date.now();
  assert.equal((await api(`/api/orders/${order.token}/rate`, { method: 'POST', body: JSON.stringify({ stars: 5 }) })).status, 200);
  assert.ok((await tgCalls(t0)).some((c) => c.method === 'editMessageText' && c.body.chat_id == GROUP && /изменил оценку/.test(c.body.text)));
  const pub = (await api('/api/orders/' + order.token)).body;
  assert.equal(pub.rating.stars, 5);
  assert.equal(pub.can_rate, true);
  assert.deepEqual(pub.review, sites);
  assert.equal((await api(`/api/orders/${order.token}/rate`, { method: 'POST', body: JSON.stringify({ stars: 9 }) })).status, 400);
  assert.equal((await api(`/api/orders/${order.token}/rate`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ stars: 1 }) })).status, 403);

  // Неделя прошла — оценить уже нельзя
  await sql('UPDATE orders SET done_at = ? WHERE id = ?', Date.now() - 8 * 24 * 3600000, order.number);
  assert.equal((await api(`/api/orders/${order.token}/rate`, { method: 'POST', body: JSON.stringify({ stars: 4 }) })).status, 409);
  await sql('UPDATE orders SET done_at = ? WHERE id = ?', Date.now() - 50 * 60000, order.number);
});

test('самовывоз без минимальной суммы; отмена кафе с причиной', async () => {
  const cheap = model.items.find((x) => x.key === 'ichimlik-americano');
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ type: 'pickup', address: null, geo: null, items: [{ key: cheap.key, size: 0, qty: 1, price: cheap.prices[0] }], total: cheap.prices[0] })) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await fetch(BASE + '/__idle');
  await press(`c:${r.body.number}`, 1);
  await press(`x:${r.body.number}:stock`, 1);
  const pub = await api('/api/orders/' + r.body.token);
  assert.equal(pub.body.status, 'canceled');
  assert.equal(pub.body.cancel_reason, 'stock');
});

test('покупатель отменяет сам, пока заказ новый; после принятия — нельзя', async () => {
  const a = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '93 111 22 33' })) });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  await fetch(BASE + '/__idle');
  assert.equal((await api(`/api/orders/${a.body.token}/cancel`, { method: 'POST' })).status, 200);
  assert.equal((await api('/api/orders/' + a.body.token)).body.cancel_reason, 'self');
  const b = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '93 111 22 34' })) });
  await fetch(BASE + '/__idle');
  await press(`a:${b.body.number}:45`, 1);
  const late = await api(`/api/orders/${b.body.token}/cancel`, { method: 'POST' });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'late');
});

test('/pause и /resume', async () => {
  await groupMsg('/pause');
  assert.equal((await api('/api/state')).body.accepting, false);
  assert.equal((await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '94 000 00 01' })) })).body.error, 'paused');
  await groupMsg('/resume');
  assert.equal((await api('/api/state')).body.accepting, true);
});

test('ограничение частоты: не больше 4 заказов за 10 минут с одного номера', async () => {
  let last;
  for (let i = 0; i < 5; i++) last = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '97 555 55 55' })) });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'rate');
});

test('/stats, /orders и /lang', async () => {
  let t0 = Date.now();
  await groupMsg('/stats');
  let calls = await tgCalls(t0);
  const st = calls.find((c) => c.method === 'sendMessage' && /Сегодня/.test(c.body.text));
  assert.ok(st, 'статистика');
  assert.match(st.body.text, /Выручка/);
  assert.match(st.body.text, /Big burger ×/);
  assert.equal(st.body.reply_markup.inline_keyboard.flat().length, 6);
  t0 = Date.now();
  await press('st:month', 5000);
  calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'editMessageText' && /Этот месяц/.test(c.body.text)));
  t0 = Date.now();
  await groupMsg('/orders');
  calls = await tgCalls(t0);
  assert.ok(calls.some((c) => /Заказы в работе/.test(c.body.text || '')));
  t0 = Date.now();
  await groupMsg('/lang');
  await groupMsg('/stats');
  calls = await tgCalls(t0);
  assert.ok(calls.some((c) => /Bugun/.test(c.body.text || '')), 'узбекский');
  await groupMsg('/lang');
});

test('Mini App: неверная подпись initData игнорируется, заказ всё равно принимается', async () => {
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '99 888 77 66', tg: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=bad' })) });
  assert.equal(r.status, 201);
});

test('/api/tick без повторов; чужой вебхук отклоняется', async () => {
  const a = await api('/api/tick', { method: 'POST' });
  assert.equal(a.status, 200);
  const b = await api('/api/tick', { method: 'POST' });
  assert.equal(b.body.skipped, true);
  const r = await fetch(BASE + '/api/tg', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.equal((await api('/api/orders/AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
});

test('база клиентов: заказы и подписчики бота попадают в базу, /clients присылает Excel', async () => {
  // Новый подписчик бота без заказов
  await privateMsg('/start', { id: 333, first_name: 'Bobur', username: 'bobur_uz', is_bot: false, language_code: 'uz' });
  const t0 = Date.now();
  await groupMsg('/clients');
  const doc = (await tgCalls(t0)).find((c) => c.method === 'sendDocument');
  assert.ok(doc, 'файл отправлен');
  assert.match(doc.body.document.name, /\.xlsx$/);
  assert.match(doc.body.caption, /База клиентов/);
  // Файл — настоящий xlsx: zip с листами
  const bytes = Buffer.from(doc.body.document.bytes, 'base64');
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const text = bytes.toString('utf8');
  assert.match(text, /\+998 90 123 45 67/);
  assert.match(text, /@bobur_uz/);
  assert.match(text, /Итоги/);
});

test('рассылка: ответ /broadcast → аудитория → подтверждение → copyMessage подписчикам; отписка', async () => {
  // без ответа на сообщение — подсказка
  let t0 = Date.now();
  await groupMsg('/broadcast');
  assert.ok((await tgCalls(t0)).some((c) => /Как сделать рассылку/.test(c.body.text || '')));
  // ответом на сообщение группы
  t0 = Date.now();
  await update({ message: { message_id: 777, date: 0, chat: { id: GROUP, type: 'supergroup' }, from: STAFF, text: '/broadcast', reply_to_message: { message_id: 555, date: 0, chat: { id: GROUP, type: 'supergroup' }, from: STAFF, text: 'Скидка 20% на бургеры!' } } });
  const ctl = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && /Рассылка №/.test(c.body.text));
  assert.ok(ctl, 'сообщение выбора аудитории');
  const id = ctl.body.text.match(/Рассылка №(\d+)/)[1];
  assert.match(ctl.body.text, /Всем подписчикам: <b>2<\/b>/);
  // пробное себе
  t0 = Date.now();
  await press(`bc:${id}:test`, 1);
  assert.ok((await tgCalls(t0)).some((c) => c.method === 'copyMessage' && c.body.chat_id === STAFF.id));
  // выбор «всем» → подтверждение → отправка
  await press(`bc:${id}:aud:all`, 1);
  t0 = Date.now();
  await press(`bc:${id}:go:all`, 1);
  const copies = (await tgCalls(t0)).filter((c) => c.method === 'copyMessage');
  assert.equal(copies.length, 2, 'двум подписчикам');
  assert.ok(copies.every((c) => c.body.from_chat_id == GROUP && c.body.message_id === 555));
  assert.ok(copies[0].body.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'unsub'));
  assert.ok((await tgCalls(t0)).some((c) => c.method === 'editMessageText' && /завершена/.test(c.body.text)));
  // повторное «отправить» не дублирует
  t0 = Date.now();
  await press(`bc:${id}:go:all`, 1);
  assert.equal((await tgCalls(t0)).filter((c) => c.method === 'copyMessage').length, 0);
  // отписка клиента
  await press('unsub', 1, CLIENT.id, CLIENT);
  t0 = Date.now();
  await update({ message: { message_id: 778, date: 0, chat: { id: GROUP, type: 'supergroup' }, from: STAFF, text: '/broadcast', reply_to_message: { message_id: 556, date: 0, chat: { id: GROUP, type: 'supergroup' }, from: STAFF, text: 'Ещё акция' } } });
  assert.match((await tgCalls(t0)).find((c) => /Рассылка №/.test(c.body.text || '')).body.text, /Всем подписчикам: <b>1<\/b>/);
});

test('вкладка «Клиенты»: /sheet выдаёт формулу, CSV только с верным ключом', async () => {
  const t0 = Date.now();
  await groupMsg('/sheet');
  const msg = (await tgCalls(t0)).find((c) => /IMPORTDATA/.test(c.body.text || ''));
  assert.ok(msg);
  const url = msg.body.text.match(/https:\/\/buddy\.cheking\.uz\/(api\/sheet\/customers\.csv\?key=[\w-]+)/)[1];
  const ok = await fetch(`${BASE}/${url}`);
  assert.equal(ok.status, 200);
  const csv = await ok.text();
  assert.match(csv.split('\r\n')[0], /^№,Имя,Телефон/);
  assert.match(csv, /\+998 90 123 45 67/);
  assert.equal((await fetch(`${BASE}/api/sheet/customers.csv?key=wrong`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/sheet/customers.csv`)).status, 403);
});

test('короткие ссылки QR с постеров ведут на отзывы из «Настроек»', async () => {
  for (const [key, host] of [['google', 'google.'], ['yandex', 'yandex.'], ['2gis', '2gis.']]) {
    const r = await fetch(`${BASE}/r/${key}`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.ok(r.headers.get('location').includes(host), r.headers.get('location'));
  }
  assert.equal((await fetch(`${BASE}/r/unknown`, { redirect: 'manual' })).status, 404);
});
