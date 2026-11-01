// Сквозная проверка заказов: npm run build && npm test
// Поднимает tools/dev-server.mjs с пустой базой и заглушкой Telegram и проходит весь путь заказа.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8823 + (process.pid % 100); // свой порт: 8799 бывает занят другими локальными сервисами
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
// Отметка времени для tgCalls: лог заглушки — с точностью до миллисекунды, пауза отделяет сообщения прошлого шага
const mark = async () => { await new Promise((r) => setTimeout(r, 3)); return Date.now(); };
const update = (u) => fetch(`${BASE}/__tg/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: upd++, ...u }) });
const groupMsg = (text, from = STAFF) => update({ message: { message_id: upd, date: 0, chat: { id: GROUP, type: 'supergroup', title: 'Buddy' }, from, text } });
const privateMsg = (text, from = CLIENT) => update({ message: { message_id: upd, date: 0, chat: { id: from.id, type: 'private' }, from, text } });
// Диагностика целиком — по ключу из /diag; без ключа /api/tg/info отдаёт только числа и флаги
const diag = async () => {
  const t0 = await mark();
  await groupMsg('/diag');
  const msg = (await tgCalls(t0)).find((c) => /api\/tg\/info\?key=/.test(c.body.text || ''));
  return (await api('/api/tg/info?key=' + msg.body.text.match(/api\/tg\/info\?key=([\w-]+)/)[1])).body;
};
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
  // Та же модель меню, что у сервера (документ из панели владельца, при первом запуске — из data/menu.json)
  model = R.buildModel((await api('/api/menu')).body.tables);
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
  assert.match(msg.body.text, /\+998 90 123 45 67/);
  assert.match(msg.body.text, /сдача с 200 000/);
  assert.deepEqual(msg.body.reply_markup.inline_keyboard.map((r) => r.length), [2, 2, 1, 1], "кнопки «принять» сеткой 2×2, «отменить», «позвонить»");
  // «Позвонить клиенту»: страница сайта сразу открывает набор номера; телефона в ссылке нет
  const callUrl = msg.body.reply_markup.inline_keyboard[3][0].url;
  assert.match(callUrl, new RegExp(`/c/${order.token}$`));
  const callRes = await fetch(BASE + new URL(callUrl).pathname);
  assert.equal(callRes.status, 200);
  const callHtml = await callRes.text();
  assert.match(callHtml, /url=tel:\+998901234567/);
  assert.match(callHtml, /href="tel:\+998901234567"/);
  assert.equal((await fetch(BASE + '/c/no-such-order-token')).status, 404);
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
  let t0 = await mark();
  await tick();
  assert.ok(!(await tgCalls(t0)).some((c) => /Оцените/.test(c.body.text || '')), 'рано');
  await sql('UPDATE orders SET done_at = ? WHERE id = ?', Date.now() - 50 * 60000, order.number);
  t0 = await mark();
  await tick();
  const ask = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && c.body.chat_id === CLIENT.id && /Оцените/.test(c.body.text));
  assert.ok(ask, 'просьба об оценке');
  assert.equal(ask.body.disable_notification, true);
  assert.equal(ask.body.reply_markup.inline_keyboard[0].length, 5);
  t0 = await mark();
  await tick();
  assert.ok(!(await tgCalls(t0)).some((c) => /Оцените/.test(c.body.text || '')), 'второй раз не просим');

  // 2 звезды: администратору — оповещение; покупателю — причины, «Написать» и ссылки на карты
  t0 = await mark();
  await press(`rt:${order.number}:2`, 77, CLIENT.id, CLIENT);
  let calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id == GROUP && /Низкая оценка/.test(c.body.text)), 'группа: низкая оценка');
  const btns = calls.find((c) => c.method === 'editMessageText' && c.body.chat_id === CLIENT.id).body.reply_markup.inline_keyboard.flat();
  assert.ok(btns.some((b) => b.callback_data === `rr:${order.number}:cold`));
  assert.equal(btns.filter((b) => /\/r\/(google|yandex|2gis)$/.test(b.url || '')).length, sites.length, 'карты — при любой оценке');
  // Чужой не может оценить чужой заказ
  t0 = await mark();
  await press(`rt:${order.number}:1`, 77, 999, { id: 999, first_name: 'X', is_bot: false });
  assert.ok(!(await tgCalls(t0)).some((c) => c.method === 'editMessageText'));

  // Причина и комментарий дописываются в то же сообщение группы
  t0 = await mark();
  await press(`rr:${order.number}:cold`, 77, CLIENT.id, CLIENT);
  await press(`rw:${order.number}`, 77, CLIENT.id, CLIENT);
  await privateMsg('Курьер опоздал на <b>20</b> минут');
  calls = await tgCalls(t0);
  const edits = calls.filter((c) => c.method === 'editMessageText' && c.body.chat_id == GROUP);
  assert.ok(edits.some((c) => /Остыло/.test(c.body.text)), 'причина');
  assert.ok(edits.some((c) => /опоздал на &lt;b&gt;20/.test(c.body.text)), 'комментарий, HTML экранирован');

  // С сайта: оценку можно поднять — в группе «изменил оценку»; страница заказа отдаёт оценку и площадки
  t0 = await mark();
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

test('сторож бота: сброшенный вебхук ставит сам, при сбоях доставки — тревога в группу', async () => {
  const sql = (q, ...args) => fetch(BASE + '/__sql', { method: 'POST', body: JSON.stringify({ sql: q, args }) });
  const hook = (h) => fetch(BASE + '/__tg/hook', { method: 'POST', body: JSON.stringify(h) });
  const tick = async () => { await sql("DELETE FROM kv WHERE k IN ('tick_at', 'wh_at')"); await api('/api/tick', { method: 'POST' }); };
  // Вебхук кто-то сбросил — восстанавливаем молча
  await hook({ url: '', pending_update_count: 0 });
  let t0 = await mark();
  await tick();
  let calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'setWebhook' && c.body.url === 'https://buddycoffee.uz/api/tg'), 'вебхук восстановлен');
  assert.ok(!calls.some((c) => c.method === 'sendMessage' && /не получает/.test(c.body.text || '')), 'без тревоги');
  const pub = (await api('/api/tg/info')).body;
  assert.equal(pub.has_bot_problem, true);
  assert.equal(pub.bot_problem, undefined, 'тексты проблем без ключа не показываем');
  assert.equal((await api('/api/tg/info?key=wrong')).body.bot_problem, undefined);
  assert.match((await diag()).bot_problem, /восстановлен/);
  // Вебхук на месте, но Telegram не может доставить сообщения — тревога в группу, один раз
  await hook({ url: 'https://buddycoffee.uz/api/tg', pending_update_count: 5, last_error_date: Math.floor(Date.now() / 1000), last_error_message: 'Wrong response from the webhook: 500' });
  t0 = await mark();
  await tick();
  calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id == GROUP && /не получает сообщения/.test(c.body.text)), 'тревога');
  t0 = await mark();
  await tick();
  assert.ok(!(await tgCalls(t0)).some((c) => /не получает/.test(c.body.text || '')), 'не чаще раза в 6 часов');
  await hook({ url: 'https://buddycoffee.uz/api/tg', pending_update_count: 0 });
});

test('ошибки браузера: пишутся без повторов, видны в диагностике, чужой сайт не может слать', async () => {
  const send = (body, headers = {}) => fetch(BASE + '/api/log', { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (iPhone)', ...headers }, body: JSON.stringify(body) });
  const err = { m: 'TypeError: x is undefined', s: '/assets/cart.js', l: 42, p: '/', tg: true };
  assert.equal((await send(err)).status, 204);
  assert.equal((await send(err)).status, 204);
  assert.equal((await send({ m: 'evil' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(BASE + '/api/log', { method: 'POST', body: 'not json' })).status, 204);
  assert.equal(typeof (await api('/api/tg/info')).body.client_errors, 'number', 'без ключа — только количество');
  const list = (await diag()).client_errors;
  assert.equal(list.filter((x) => /x is undefined/.test(x)).length, 1, 'без повторов');
  assert.match(list[0], /iPhone · Telegram · \/ · TypeError: x is undefined \(\/assets\/cart\.js:42\)/);
  assert.ok(!list.some((x) => /evil/.test(x)));
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

test('/stop: блюдо сразу «нет в наличии» на сайте и в заказе, второе нажатие возвращает', async () => {
  let t0 = await mark();
  await groupMsg('/stop');
  const menu = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && /Стоп-лист/.test(c.body.text || ''));
  assert.ok(menu, 'список блюд кнопками');
  assert.ok(menu.body.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'sl:hotdog-klassik'));
  t0 = await mark();
  await press('sl:hotdog-klassik', 900);
  assert.deepEqual((await api('/api/state')).body.stop, ['hotdog-klassik']);
  assert.ok((await tgCalls(t0)).some((c) => c.method === 'editMessageText' && /нет в наличии:.*Классический|нет в наличии:.*Klassik/i.test(c.body.text)));
  // Заказ с этим блюдом не принимается, даже если сайт не успел обновиться
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '90 765 43 21' })) });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.keys, ['hotdog-klassik']);
  await press('sl:hotdog-klassik', 900);
  assert.deepEqual((await api('/api/state')).body.stop, []);
});

test('/rush: сроки на сайте и кнопки «принять» сдвигаются, выключается кнопкой', async () => {
  let t0 = await mark();
  await groupMsg('/rush');
  const msg = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && /Час пик/.test(c.body.text || ''));
  assert.deepEqual(msg.body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['rush:15', 'rush:30']);
  await press('rush:15', 901);
  const st = (await api('/api/state')).body.rush;
  assert.equal(st.add, 15);
  assert.ok(st.until > Date.now() + 2.9 * 3600000);
  t0 = await mark();
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '90 765 43 22', type: 'pickup', address: null, geo: null })) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await fetch(BASE + '/__idle');
  const card = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && c.body.chat_id == GROUP && /НОВЫЙ ЗАКАЗ/.test(c.body.text));
  assert.deepEqual(card.body.reply_markup.inline_keyboard.slice(0, 2).flat().map((b) => b.callback_data.split(':')[2]), ['25', '30', '35', '45'], 'самовывоз +15');
  await press(`a:${r.body.number}:35`, 902);
  assert.equal((await api('/api/orders/' + r.body.token)).body.status, 'accepted', 'сдвинутый срок принимается');
  await press('rush:0', 901);
  assert.equal((await api('/api/state')).body.rush, null);
  await press(`x:${r.body.number}:other`, 902);
});

test('воронка: события сайта по одному счётчику, видна в /stats', async () => {
  const ev = (e, headers = {}) => fetch(BASE + '/api/ev', { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: JSON.stringify({ e }) });
  for (const e of ['view', 'view', 'view', 'cart', 'checkout', 'hack']) assert.equal((await ev(e)).status, 204);
  assert.equal((await ev('view', { origin: 'https://evil.example' })).status, 403);
  const t0 = await mark();
  await groupMsg('/stats');
  const st = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && /Сегодня/.test(c.body.text));
  assert.match(st.body.text, /Воронка: 3 открыли меню → 1 в корзине → 1 оформляли → \d+ заказов/);
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
  const url = msg.body.text.match(/https:\/\/buddycoffee\.uz\/(api\/sheet\/customers\.csv\?key=[\w-]+)/)[1];
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

test('/forget: данные клиента удаляются по его просьбе, активный заказ не трогаем; /privacy в боте', async () => {
  const sql = async (q, ...args) => (await (await fetch(BASE + '/__sql', { method: 'POST', body: JSON.stringify({ sql: q, args }) })).json()).rows;
  const make = async () => (await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ phone: '93 555 44 33', name: 'Забудь Меня' })) })).body;
  const done = await make();
  const live = await make();
  await sql("UPDATE orders SET status = 'delivered' WHERE token = ?", done.token);
  let t0 = await mark();
  await groupMsg('/forget');
  assert.ok((await tgCalls(t0)).some((c) => /\/forget \+998 90 123 45 67/.test(c.body.text || '')), 'без номера — подсказка');
  t0 = await mark();
  await groupMsg('/forget +998 93 555 44 33');
  const reply = (await tgCalls(t0)).find((c) => /🗑/.test(c.body.text || ''));
  assert.ok(reply, 'ответ об удалении');
  assert.match(reply.body.text, /: 1\.[\s\S]*: 1 /, 'одна карточка обезличена, один активный заказ');
  const [gone, kept] = await Promise.all([done, live].map((o) => sql('SELECT name, phone, phone_hash, address, anonymized FROM orders WHERE token = ?', o.token).then((r) => r[0])));
  assert.deepEqual(gone, { name: null, phone: null, phone_hash: null, address: null, anonymized: 1 });
  assert.equal(kept.name, 'Забудь Меня', 'активный заказ ещё везут');
  assert.equal((await sql("SELECT COUNT(*) AS n FROM customers WHERE phone = '998935554433'"))[0].n, 0, 'карточки в базе нет');
  t0 = await mark();
  await groupMsg('/forget @nobody_here');
  assert.ok((await tgCalls(t0)).some((c) => /🤷/.test(c.body.text || '')));
  // Кнопка «Политика конфиденциальности» в профиле бота шлёт /privacy
  t0 = await mark();
  await privateMsg('/privacy');
  assert.ok((await tgCalls(t0)).some((c) => /\/privacy#(uz|ru)/.test(c.body.text || '')));
  // Страница политики собрана: значения из «Настроек» подставлены
  const page = await (await fetch(BASE + '/privacy')).text();
  assert.ok(!/\{\{\w+\}\}/.test(page) && /href="tel:\+998/.test(page));
});

/* ---------- панель владельца (/admin, server/admin.js) ---------- */

const OWNER = { id: 501, first_name: 'Suxrob', language_code: 'ru' };
const WORKER = { id: 502, first_name: 'Kassir', is_bot: false };
const STRANGER = { id: 503, first_name: 'Begona', is_bot: false };
// initData, подписанная токеном бота заглушки (как Telegram подписывает Mini App)
function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q1', user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('123456:dev-token').digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
const adm = (p, user, body) => api(p, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: 'tma ' + initData(user) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const member = (id, status) => fetch(BASE + '/__tg/member', { method: 'POST', body: JSON.stringify({ user_id: id, status }) });
const siteModel = async () => R.buildModel((await api('/api/menu')).body.tables);

test('панель: вход только по подписи Telegram; посторонним — нет; /admin в боте', async () => {
  await member(STRANGER.id, 'member');
  await member(WORKER.id, 'member');
  assert.equal((await api('/api/admin/state')).status, 401, 'без подписи');
  const forged = initData(OWNER).replace(/hash=\w+/, 'hash=' + '0'.repeat(64));
  assert.equal((await api('/api/admin/state', { headers: { authorization: 'tma ' + forged } })).status, 401, 'поддельная подпись');
  assert.equal((await adm('/api/admin/state', STRANGER)).status, 403, 'не администратор группы');
  const st = await adm('/api/admin/state', OWNER);
  assert.equal(st.status, 200);
  assert.equal(st.body.me.role, 'owner');
  assert.ok(st.body.doc.items.length > 10 && st.body.doc.items[0].variants.length);
  let t0 = await mark();
  await privateMsg('/admin', OWNER);
  assert.ok((await tgCalls(t0)).some((c) => c.body.chat_id === OWNER.id && JSON.stringify(c.body.reply_markup || {}).includes('admin?tg=1')), 'кнопка панели');
  t0 = await mark();
  await privateMsg('/admin', STRANGER);
  assert.ok(!(await tgCalls(t0)).some((c) => JSON.stringify(c.body.reply_markup || {}).includes('admin?tg=1')), 'постороннему — без кнопки');
});

test('панель: сотрудник по приглашению — только стоп-лист и час пик, владелец его убирает', async () => {
  const inv = await adm('/api/admin/staff/invite', OWNER, {});
  const token = inv.body.link.match(/start=staff_(\w+)/)[1];
  let t0 = await mark();
  await privateMsg('/start staff_' + token, WORKER);
  const calls = await tgCalls(t0);
  assert.ok(calls.some((c) => c.body.chat_id === WORKER.id && JSON.stringify(c.body.reply_markup || {}).includes('admin?tg=1')), 'сотруднику — кнопка панели');
  assert.ok(calls.some((c) => String(c.body.chat_id) === String(GROUP) && /👤/.test(c.body.text || '')), 'группе сообщили о новом сотруднике');
  t0 = await mark();
  await privateMsg('/start staff_' + token, STRANGER);
  assert.ok(!(await tgCalls(t0)).some((c) => JSON.stringify(c.body.reply_markup || {}).includes('admin?tg=1')), 'ссылка одноразовая');

  const st = await adm('/api/admin/state', WORKER);
  assert.equal(st.body.me.role, 'staff');
  assert.equal(st.body.doc.items[0].variants, undefined, 'цен сотрудник не видит');
  const key = st.body.doc.items[0].key;
  const on = await adm('/api/admin/stop', WORKER, { key, on: true });
  assert.ok(on.body.live.stop[key]);
  assert.ok((await api('/api/state')).body.stop.includes(key), 'сайт видит «нет сегодня»');
  await adm('/api/admin/stop', WORKER, { key, on: false });
  assert.equal((await adm('/api/admin/rush', WORKER, { add: 15 })).body.live.rush.add, 15);
  await adm('/api/admin/rush', WORKER, { add: 0 });
  assert.equal((await adm('/api/admin/item', WORKER, { uz: 'X' })).status, 403, 'меню сотруднику не править');
  assert.equal((await adm('/api/admin/settings', WORKER, { values: {} })).status, 403);

  const list = await adm('/api/admin/staff', OWNER);
  assert.ok(list.body.staff.some((x) => x.id === WORKER.id) && list.body.owners.length);
  await adm('/api/admin/staff/remove', OWNER, { id: WORKER.id });
  assert.equal((await adm('/api/admin/state', WORKER)).status, 403, 'убранный сотрудник больше не входит');
});

test('панель: раздел «Пицца» и блюдо с двумя размерами — на сайте и в заказе; проверки; отмена', async () => {
  const cat = await adm('/api/admin/cat', OWNER, { uz: 'Pitsa', ru: 'Пицца', icon: '🍕' });
  assert.equal(cat.status, 200, JSON.stringify(cat.body));
  const pizza = cat.body.doc.cats.find((c) => c.ru === 'Пицца');
  assert.equal(pizza.id, 'pitsa');
  const bad = (b) => adm('/api/admin/item', OWNER, b).then((r) => r.status);
  assert.equal(await bad({ cat: pizza.id, ru: 'Без цены', variants: [{ price: 'abc' }] }), 400);
  assert.equal(await bad({ cat: 'nope', ru: 'Без раздела', variants: [{ price: 1000 }] }), 400);
  assert.equal(await bad({ cat: pizza.id, variants: [{ price: 1000 }] }), 400, 'без названия');
  assert.equal(await bad({ cat: pizza.id, ru: 'Два размера', variants: [{ price: 1000 }, { price: 2000 }] }), 400, 'размеры без подписей');

  const it = await adm('/api/admin/item', OWNER, {
    cat: pizza.id, uz: 'Margarita', ru: 'Маргарита', badge: 'новинка', desc_ru: 'Томаты, моцарелла, базилик',
    variants: [{ size_uz: '25 sm', size_ru: '25 см', price: '55 000', weight: '450 g' }, { size_uz: '30 sm', size_ru: '30 см', price: 75000, old: 80000, weight: '650 g' }]
  });
  assert.equal(it.status, 200, JSON.stringify(it.body));
  const item = it.body.doc.items.find((x) => x.ru === 'Маргарита');
  assert.equal(item.key, 'pitsa-margarita');
  let m = (await siteModel()).items.find((x) => x.key === item.key);
  assert.deepEqual(m.prices, [55000, 75000]);
  assert.equal(m.old[1], 80000);
  assert.equal(m.badge, 'new');
  assert.ok((await siteModel()).cats.some((c) => c.id === 'pitsa'), 'раздел на сайте');

  // Заказать новое блюдо можно сразу
  const order = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody({ items: [{ key: item.key, size: 1, qty: 1, note: '', price: 75000 }], total: 75000 })) });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  // Переименование ключ не меняет; устаревшая версия формы — 409
  const ren = await adm('/api/admin/item', OWNER, { ...item, ru: 'Пицца Маргарита' });
  assert.equal(ren.status, 200);
  assert.equal(ren.body.doc.items.find((x) => x.key === item.key).ru, 'Пицца Маргарита');
  assert.equal((await adm('/api/admin/item', OWNER, { ...item, ru: 'Старая форма' })).status, 409);

  // Отмена переименования из журнала
  const h = await adm('/api/admin/history', OWNER);
  const renamed = h.body.items.find((x) => x.kind === 'item' && x.title === 'Пицца Маргарита');
  const undo = await adm('/api/admin/undo', OWNER, { id: renamed.id });
  assert.equal(undo.status, 200);
  assert.equal(undo.body.doc.items.find((x) => x.key === item.key).ru, 'Маргарита');

  // «Нет надолго» и обратно
  const cur = undo.body.doc.items.find((x) => x.key === item.key);
  await adm('/api/admin/item/avail', OWNER, { key: item.key, avail: false });
  assert.equal((await siteModel()).items.find((x) => x.key === item.key).avail, false);
  await adm('/api/admin/item/avail', OWNER, { key: item.key, avail: true });

  // Порядок разделов: «Пицца» первой
  const ids = undo.body.doc.cats.map((c) => c.id);
  const ord = await adm('/api/admin/order', OWNER, { kind: 'cats', keys: ['pitsa', ...ids.filter((x) => x !== 'pitsa')] });
  assert.equal(ord.body.doc.cats[0].id, 'pitsa');
  assert.equal((await siteModel()).cats[0].id, 'pitsa');

  // Раздел с блюдами не удалить; после удаления блюда — можно
  assert.equal((await adm('/api/admin/cat/delete', OWNER, { id: 'pitsa' })).status, 409);
  const fresh = (await adm('/api/admin/state', OWNER)).body.doc.items.find((x) => x.key === item.key);
  assert.equal((await adm('/api/admin/item/delete', OWNER, { key: item.key, rev: fresh.rev })).status, 200);
  assert.equal((await adm('/api/admin/cat/delete', OWNER, { id: 'pitsa' })).status, 200);
  assert.ok(!(await siteModel()).items.some((x) => x.key === item.key));
  assert.ok(cur);
});

test('панель: информация о кафе, описание бота, приём заказов, «Сегодня закрыты», особые часы', async () => {
  const badPhone = await adm('/api/admin/settings', OWNER, { values: { 'телефон': 'позвоните', 'wifi_пароль': 'x' } });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.error, 'setting:телефон');
  assert.equal((await adm('/api/admin/settings', OWNER, { values: { instagram: 'javascript:alert(1)' } })).status, 400, 'только https-ссылки');
  let t0 = await mark();
  const ok = await adm('/api/admin/settings', OWNER, { values: {
    'часы_работы': { uz: '08:00–23:00', ru: '08:00–23:00' }, 'wifi_пароль': 'coffee2027', 'координаты': '39.0537, 66.8488',
    'описание_бота': { uz: 'Buddy Coffee: menyu va yetkazib berish', ru: 'Buddy Coffee: меню и доставка' }
  } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  let s = (await siteModel()).settings;
  assert.equal(s['wifi_пароль'].ru, 'coffee2027');
  assert.equal(s['координаты'].uz, '39.053700, 66.848800');
  assert.ok((await tgCalls(t0)).some((c) => c.method === 'setMyShortDescription' && /меню и доставка/.test(c.body.short_description || '')), 'описание бота обновлено в Telegram');

  // Пауза приёма заказов
  await adm('/api/admin/paused', OWNER, { on: true });
  assert.equal((await api('/api/state')).body.accepting, false);
  await adm('/api/admin/paused', OWNER, { on: false });
  assert.equal((await api('/api/state')).body.accepting, true);

  // «Сегодня закрыты» — заказать нельзя, на сайте объявление; потом открываемся
  const closed = await adm('/api/admin/closed', OWNER, { on: true });
  assert.equal(closed.body.live.closed, true);
  assert.equal((await api('/api/state')).body.accepting, false);
  assert.match((await siteModel()).settings['объявление'].ru, /закрыты/);
  const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(orderBody()) });
  assert.equal(r.status, 503);
  await adm('/api/admin/closed', OWNER, { on: false });
  assert.equal((await api('/api/state')).body.accepting, true);

  // Особые часы на сегодня и объявление до даты
  const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const sch = await adm('/api/admin/schedule', OWNER, { noticeUntil: today, special: [{ date: today, uz: '10:00–18:00', ru: '10:00–18:00' }] });
  assert.equal(sch.status, 200, JSON.stringify(sch.body));
  assert.equal((await siteModel()).settings['часы_работы'].ru, 'Сегодня: 10:00–18:00');
  assert.equal((await adm('/api/admin/schedule', OWNER, { noticeUntil: '2020-01-01' })).status, 400, 'дата в прошлом');
  await adm('/api/admin/schedule', OWNER, { noticeUntil: '', special: [] });
  assert.equal((await siteModel()).settings['часы_работы'].ru, '08:00–23:00');
});

test('панель: «Блюдо дня», массовое изменение цен с предпросмотром и отменой одной кнопкой', async () => {
  const st = (await adm('/api/admin/state', OWNER)).body;
  const cat = st.doc.cats.find((c) => st.doc.items.filter((x) => x.cat === c.id).length >= 2);
  const items = st.doc.items.filter((x) => x.cat === cat.id);
  const day = await adm('/api/admin/promo', OWNER, { day: items[1].key });
  assert.equal(day.status, 200);
  let m = await siteModel();
  assert.equal(m.items.find((x) => x.key === items[1].key).badge, 'day');
  assert.equal(m.items.filter((x) => x.cat === cat.id)[0].key, items[1].key, 'первым в разделе');
  await adm('/api/admin/promo', OWNER, { day: null });

  const preview = await adm('/api/admin/bulk', OWNER, { cats: [cat.id], mode: 'percent', value: 10, round: 1000 });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.items.length, items.length);
  const p0 = preview.body.items[0];
  assert.equal(p0.after[0], Math.round(p0.before[0] * 1.1 / 1000) * 1000);
  assert.deepEqual((await siteModel()).items.find((x) => x.key === p0.key).prices, p0.before, 'предпросмотр ничего не меняет');
  const applied = await adm('/api/admin/bulk', OWNER, { cats: [cat.id], mode: 'percent', value: 10, round: 1000, apply: true });
  assert.equal(applied.status, 200);
  assert.deepEqual((await siteModel()).items.find((x) => x.key === p0.key).prices, p0.after);
  const undone = await adm('/api/admin/undo', OWNER, { id: applied.body.change });
  assert.equal(undone.status, 200);
  assert.deepEqual((await siteModel()).items.find((x) => x.key === p0.key).prices, p0.before, 'одна отмена возвращает все цены');
});

test('панель: фото — загрузка, проверка формата, отдача с кэшем на год', async () => {
  const jpeg = (n) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)])], { type: 'image/jpeg' });
  const send = (sq, l) => {
    const fd = new FormData();
    fd.append('sq', sq, 'sq.jpg');
    fd.append('l', l, 'l.jpg');
    return fetch(BASE + '/api/admin/photo', { method: 'POST', headers: { authorization: 'tma ' + initData(OWNER) }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };
  assert.equal((await send(new Blob(['<svg/>'], { type: 'image/svg+xml' }), jpeg(10))).status, 400, 'только JPEG/WebP');
  const up = await send(jpeg(100), jpeg(200));
  assert.equal(up.status, 200);
  assert.match(up.body.img, /^up_[a-f0-9]{16}$/);
  const res = await fetch(`${BASE}/api/photo/${up.body.img.slice(3)}/l`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal((await res.arrayBuffer()).byteLength, 204);

  const st = (await adm('/api/admin/state', OWNER)).body;
  const it = st.doc.items[0];
  const saved = await adm('/api/admin/item', OWNER, { ...it, img: up.body.img });
  assert.equal(saved.status, 200);
  const html = R.createView(await siteModel(), 'uz').menuHTML();
  assert.ok(html.includes(`/api/photo/${up.body.img.slice(3)}/sq`), 'на сайте — фото из панели');
  await adm('/api/admin/undo', OWNER, { id: saved.body.change });
});

test('панель: рассылка — пробное себе, затем подписчикам; статистика', async () => {
  let t0 = await mark();
  const draft = await adm('/api/admin/broadcast/test', OWNER, { text: 'Скидка 20% на пиццу <только сегодня>!' });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const test0 = (await tgCalls(t0)).find((c) => c.method === 'sendMessage' && c.body.chat_id === OWNER.id);
  assert.ok(test0 && test0.body.text.includes('&lt;только сегодня&gt;'), 'пробное — автору, текст экранирован');
  assert.ok(draft.body.counts.all >= 1);
  t0 = await mark();
  const sent = await adm('/api/admin/broadcast/send', OWNER, { id: draft.body.id, audience: 'all' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const copies = (await tgCalls(t0)).filter((c) => c.method === 'copyMessage' && c.body.from_chat_id === OWNER.id);
  assert.ok(copies.length >= 1, 'подписчикам — копия пробного сообщения');
  assert.equal((await adm('/api/admin/broadcast/send', OWNER, { id: draft.body.id, audience: 'all' })).status, 409, 'дважды не отправить');

  const stats = await adm('/api/admin/stats?period=month', OWNER);
  assert.equal(stats.status, 200);
  assert.ok(stats.body.n >= 1 && 'revenue' in stats.body && 'prev' in stats.body && stats.body.funnel);
});
