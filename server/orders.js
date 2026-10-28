// Заказы: приём с сайта и Mini App, смена статусов, сообщения в группу кафе и покупателю.
import { getKV, orderById, orderByToken, parseOrder, salt, updateOrder } from './db.js';
import { OC, cafeInfo, loadModel } from './menu.js';
import { C, T } from './texts.js';
import { groupChat, groupLang, tg, verifyInitData } from './tg.js';
import { fail, fmt, h, hhmm, json, MIN, randomToken, sha256, SITE } from './util.js';

const RATE_WINDOW = 10 * MIN;
const RATE_PHONE = 4; // заказов за 10 минут с одного номера
const RATE_IP = 10; // с одного IP — больше: у мобильных операторов один адрес на многих абонентов
const UNDO_WINDOW = 15 * MIN;
// Со звуком — этапы, которые покупатель ждёт; «Готовится» и «Передан курьеру» — тихо
const LOUD = ['new', 'accepted', 'onway', 'ready', 'delivered', 'picked', 'canceled'];

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- приём заказов ---------- */

export async function accepting(env, model) {
  if (!env.BOT_TOKEN || !(await groupChat(env))) return false;
  if ((await getKV(env, 'paused')) === '1') return false;
  return OC.config(model || (await loadModel(env))).enabled;
}

export async function createOrder(request, env, ctx) {
  if (!/^application\/json/i.test(request.headers.get('content-type') || '')) return fail('bad_request', 415);
  const raw = await request.text();
  if (raw.length > 20000) return fail('bad_request', 413);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return fail('bad_request'); }
  if (!b || typeof b !== 'object') return fail('bad_request');
  if (b.website) return fail('bad_request'); // ловушка для ботов: поле скрыто от людей

  // Повторная отправка той же формы (пропала связь) — возвращаем уже созданный заказ
  const cid = clip(b.cid, 40);
  if (cid) {
    const dup = parseOrder(await env.DB.prepare('SELECT * FROM orders WHERE cid = ?').bind(cid).first());
    if (dup) return json({ token: dup.token, number: dup.id, total: dup.total });
  }

  let model = await loadModel(env);
  if (!(await accepting(env, model))) return fail('paused', 503);

  const type = b.type === 'pickup' ? 'pickup' : 'delivery';
  const lang = b.lang === 'ru' ? 'ru' : 'uz';
  const name = clip(b.name, 60);
  const phone = OC.normPhone(b.phone);
  if (!name) return fail('name', 422);
  if (!phone) return fail('phone', 422);

  let address = null;
  let geo = null;
  if (type === 'delivery') {
    const a = b.address || {};
    address = { street: clip(a.street, 160), apt: clip(a.apt, 60), landmark: clip(a.landmark, 120) };
    if (address.street.length < 3) return fail('address', 422);
    if (b.geo && Number.isFinite(+b.geo.lat) && Number.isFinite(+b.geo.lng)) {
      geo = { lat: +(+b.geo.lat).toFixed(6), lng: +(+b.geo.lng).toFixed(6), acc: Math.max(0, Math.min(99999, parseInt(b.geo.acc, 10) || 0)) };
      if (!OC.inZone(geo.lat, geo.lng)) return fail('zone', 422);
    }
  }

  const lines = (Array.isArray(b.items) ? b.items : []).slice(0, 30).map((l) => ({
    key: clip(l && l.key, 120), size: parseInt(l && l.size, 10) || 0, qty: parseInt(l && l.qty, 10) || 1, note: clip(l && l.note, 140)
  }));
  if (!lines.length) return fail('bad_request');

  // Цены — только из таблицы. Если не совпали с теми, что видел покупатель, перепроверяем свежие данные
  let p = OC.price(model, lines);
  const sameAsClient = () => !p.missing.length && p.total === +b.total &&
    p.lines.every((l, i) => !b.items[i] || +b.items[i].price === l.price);
  if (!sameAsClient()) {
    model = await loadModel(env, { fresh: true });
    p = OC.price(model, lines);
  }
  if (p.missing.length) {
    const names = p.missing.map((k) => model.items.find((x) => x.key === k)).filter(Boolean).map((it) => it[lang]);
    return fail('unavailable', 409, { keys: p.missing, names });
  }
  if (!sameAsClient()) return fail('price_changed', 409, { total: p.total });
  const cfg = OC.config(model);
  if (type === 'delivery' && p.total < cfg.min) return fail('min', 422, { min: cfg.min });

  // Защита от спама: лимит заказов за 10 минут с одного номера и с одного IP
  const s = await salt(env);
  const ipHash = await sha256('ip:' + (request.headers.get('cf-connecting-ip') || '') + s);
  const phoneHash = await sha256('ph:' + phone + s);
  const since = Date.now() - RATE_WINDOW;
  const recent = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM orders WHERE ip_hash = ? AND created_at > ?) AS ip, (SELECT COUNT(*) FROM orders WHERE phone_hash = ? AND created_at > ?) AS ph')
    .bind(ipHash, since, phoneHash, since).first();
  if (recent.ip >= RATE_IP || recent.ph >= RATE_PHONE) return fail('rate', 429);

  const user = await verifyInitData(env, b.tg);
  const now = Date.now();
  const items = p.lines.map((l) => ({
    key: l.key, uz: l.uz, ru: l.ru, size: l.size, size_uz: l.size_uz, size_ru: l.size_ru, qty: l.qty, price: l.price, sum: l.sum, note: l.note
  }));
  const token = randomToken(16);
  const change = b.payment === 'cash' && type === 'delivery' ? Math.max(0, Math.min(10000000, parseInt(b.change, 10) || 0)) : 0;
  const r = await env.DB.prepare(`INSERT INTO orders (token, cid, created_at, updated_at, status, type, lang, source, name, phone, phone_hash,
      address, lat, lng, acc, comment, payment, change_from, items, total, history, tg_user, tg_chat, ip_hash)
      VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(token, cid || null, now, now, type, lang, user ? 'tg' : 'site', name, phone, phoneHash,
      address ? JSON.stringify(address) : null, geo ? geo.lat : null, geo ? geo.lng : null, geo ? geo.acc : null,
      clip(b.comment, 300) || null, b.payment === 'card' ? 'card' : 'cash', change > p.total ? change : null,
      JSON.stringify(items), p.total, JSON.stringify([{ s: 'new', t: now }]), user ? user.id : null, user ? user.id : null, ipHash)
    .run();
  const id = r.meta.last_row_id;

  // Сообщения отправляем после ответа покупателю; если Telegram недоступен — /api/tick повторит
  ctx.waitUntil((async () => {
    const o = await orderById(env, id);
    await sendGroup(env, o);
    if (o.tg_chat) await notifyCustomer(env, o);
  })().catch((e) => console.error('notify', e)));

  return json({ token, number: id, total: p.total }, 201);
}

/* ---------- страница заказа ---------- */

export async function publicOrder(env, token) {
  const o = await orderByToken(env, token);
  if (!o) return null;
  const model = await loadModel(env);
  return {
    number: o.id,
    status: o.status,
    type: o.type,
    lang: o.lang,
    created: o.created_at,
    eta: o.eta_at,
    history: o.history.map((x) => ({ s: x.s, t: x.t })),
    items: o.items.map((x) => ({ key: x.key, uz: x.uz, ru: x.ru, size: x.size, size_uz: x.size_uz, size_ru: x.size_ru, qty: x.qty, price: x.price, sum: x.sum, note: x.note })),
    total: o.total,
    payment: o.payment,
    change: o.change_from,
    address: o.address,
    geo: o.lat != null,
    comment: o.comment,
    name: o.name,
    phone: o.phone ? OC.fmtPhone(o.phone) : '',
    cancel_reason: o.cancel_reason,
    tg: !!o.tg_chat,
    cafe: cafeInfo(model, o.lang)
  };
}

export async function cancelBySelf(env, token) {
  const o = await orderByToken(env, token);
  if (!o) return fail('not_found', 404);
  if (o.status === 'canceled') return json({ ok: true });
  if (o.status !== 'new') return fail('late', 409);
  const next = await setStatus(env, o, 'canceled', { reason: 'self', by: 'client' });
  if (!next) return fail('late', 409);
  const chat = o.group_chat || (await groupChat(env));
  if (chat) {
    const L = await groupLang(env);
    await tg(env, 'sendMessage', { chat_id: chat, text: T[L].customerCanceled(o.id), reply_parameters: o.group_msg ? { message_id: o.group_msg, allow_sending_without_reply: true } : undefined });
  }
  return json({ ok: true });
}

/* ---------- статусы ---------- */

export function nextStatus(o) {
  const flow = OC.FLOW[o.type] || OC.FLOW.delivery;
  return flow[flow.indexOf(o.status) + 1] || null;
}

export async function setStatus(env, o, next, { by, eta, reason } = {}) {
  const now = Date.now();
  const fields = { status: next, history: [...o.history, { s: next, t: now, by: by || '' }] };
  if (next === 'accepted') { fields.accepted_at = now; fields.eta_at = now + (eta || 30) * MIN; }
  if (OC.DONE.includes(next)) fields.done_at = now;
  if (next === 'canceled') { fields.cancel_reason = reason || 'other'; fields.done_at = now; }
  if (!(await updateOrder(env, o.id, o.status, fields))) return null;
  const fresh = { ...o, ...fields, updated_at: now };
  await Promise.all([refreshGroup(env, fresh), notifyCustomer(env, fresh)]);
  return fresh;
}

// «Шаг назад» — если сотрудник нажал не ту кнопку (в течение 15 минут)
export async function undoStatus(env, o) {
  const last = o.history[o.history.length - 1];
  if (o.history.length < 2 || Date.now() - last.t > UNDO_WINDOW) return null;
  const prev = o.history[o.history.length - 2].s;
  const fields = { status: prev, history: o.history.slice(0, -1) };
  if (last.s === 'accepted') { fields.accepted_at = null; fields.eta_at = null; }
  if (OC.FINAL.includes(last.s)) { fields.done_at = null; fields.cancel_reason = null; }
  if (!(await updateOrder(env, o.id, o.status, fields))) return null;
  const fresh = { ...o, ...fields };
  await Promise.all([refreshGroup(env, fresh), notifyCustomer(env, fresh, { silent: true })]);
  return fresh;
}

export const canUndo = (o) => o.history.length > 1 && Date.now() - o.history[o.history.length - 1].t <= UNDO_WINDOW;

/* ---------- сообщение в группе кафе ---------- */

function mapLinks(o, L) {
  if (o.lat != null) {
    return `🗺 <a href="https://yandex.uz/maps/?pt=${o.lng},${o.lat}&z=17&l=map">Yandex</a> · <a href="https://maps.google.com/?q=${o.lat},${o.lng}">Google</a>`;
  }
  if (o.address && o.address.street) {
    return `🔎 <a href="https://yandex.uz/maps/?text=${encodeURIComponent('Shahrisabz, ' + o.address.street)}">${T[L].map}</a>`;
  }
  return '';
}

export function groupText(o, L) {
  const X = T[L];
  const st = OC.STATUS[o.status];
  const head = o.status === 'new' ? '🆕' : st.icon; // для кафе новый заказ — «🆕», покупателю — «⏳ ждёт подтверждения»
  const out = [`${head} <b>${X.order} №${o.id}</b> · ${o.type === 'delivery' ? '🛵 ' + X.delivery : '🛍️ ' + X.pickup}`, ''];
  o.items.forEach((it) => {
    const size = it['size_' + L] ? ` <i>(${h(it['size_' + L])})</i>` : '';
    out.push(`<b>${it.qty}×</b> ${h(it.uz)}${size} — ${fmt(it.sum)}`);
    if (it.note) out.push(`      💬 <i>${h(it.note)}</i>`);
  });
  out.push('', `💰 <b>${X.total}: ${X.sum(o.total)}</b>`);
  out.push(`${o.payment === 'card' ? '💳 ' + X.card : '💵 ' + X.cash}${o.change_from ? ' · ' + X.change(o.change_from) : ''}`);
  if (o.name || o.phone) out.push(`👤 ${h(o.name || '')}${o.phone ? ' · +' + o.phone : ''}`);
  if (o.type === 'delivery' && o.address) {
    out.push(`📍 ${h(o.address.street)}${o.address.apt ? ', ' + h(o.address.apt) : ''}`);
    if (o.address.landmark) out.push(`🧭 ${X.landmark}: ${h(o.address.landmark)}`);
    const links = mapLinks(o, L);
    if (links) out.push(links);
  }
  if (o.comment) out.push(`📝 ${X.comment}: <i>${h(o.comment)}</i>`);
  out.push(`🕐 ${hhmm(o.created_at)} · ${o.source === 'tg' ? X.fromTg : X.fromSite}`);
  const steps = o.history.filter((x) => x.s !== 'new');
  if (steps.length) {
    out.push('');
    steps.forEach((x) => {
      const s = OC.STATUS[x.s];
      let line = `${s.icon} ${s[L]} ${hhmm(x.t)}${x.by && x.by !== 'client' ? X.byWhom(h(x.by)) : ''}`;
      if (x.s === 'accepted' && o.eta_at) line += ` · ⏱ ${X.etaTo(hhmm(o.eta_at))}`;
      if (x.s === 'canceled' && o.cancel_reason && OC.CANCEL_REASONS[o.cancel_reason]) line += ` — ${OC.CANCEL_REASONS[o.cancel_reason][L]}`;
      out.push(line);
    });
  }
  return out.join('\n');
}

export function groupKeyboard(o, L, mode) {
  const X = T[L];
  const cb = (text, data) => ({ text, callback_data: data });
  if (mode === 'cancel') {
    const reasons = ['stock', 'noanswer', 'client', 'busy', o.type === 'delivery' ? 'zone' : null, 'other'].filter(Boolean);
    const rows = [];
    for (let i = 0; i < reasons.length; i += 2) rows.push(reasons.slice(i, i + 2).map((r) => cb(OC.CANCEL_REASONS[r][L], `x:${o.id}:${r}`)));
    rows.push([cb(X.back, `b:${o.id}`)]);
    return { inline_keyboard: rows };
  }
  if (OC.FINAL.includes(o.status)) return { inline_keyboard: canUndo(o) ? [[cb(X.undo, `u:${o.id}`)]] : [] };
  if (o.status === 'new') {
    const mins = o.type === 'pickup' ? [10, 15, 20, 30] : [15, 30, 45, 60];
    return { inline_keyboard: [mins.map((m) => cb(X.accept(m), `a:${o.id}:${m}`)), [cb(X.cancel, `c:${o.id}`)]] };
  }
  const next = nextStatus(o);
  return { inline_keyboard: [[cb(X.next[next], `n:${o.id}:${next}`)], [cb(X.undo, `u:${o.id}`), cb(X.cancel, `c:${o.id}`)]] };
}

export async function sendGroup(env, o) {
  const chat = await groupChat(env);
  if (!chat || !o) return;
  const L = await groupLang(env);
  const r = await tg(env, 'sendMessage', {
    chat_id: chat, text: groupText(o, L), parse_mode: 'HTML', reply_markup: groupKeyboard(o, L),
    link_preview_options: { is_disabled: true }
  });
  if (!r.ok) return;
  const sentChat = r.result.chat.id;
  await env.DB.prepare('UPDATE orders SET group_chat = ?, group_msg = ? WHERE id = ?').bind(sentChat, r.result.message_id, o.id).run();
  // Точка на карте отдельным сообщением: курьер откроет навигатор одним нажатием
  if (o.lat != null) {
    await tg(env, 'sendLocation', {
      chat_id: sentChat, latitude: o.lat, longitude: o.lng, disable_notification: true,
      reply_parameters: { message_id: r.result.message_id, allow_sending_without_reply: true }
    });
  }
}

export async function refreshGroup(env, o, mode) {
  if (!o.group_msg) { await sendGroup(env, o); return; }
  const L = await groupLang(env);
  await tg(env, 'editMessageText', {
    chat_id: o.group_chat, message_id: o.group_msg, text: groupText(o, L), parse_mode: 'HTML',
    reply_markup: groupKeyboard(o, L, mode), link_preview_options: { is_disabled: true }
  });
}

/* ---------- карточка заказа у покупателя ---------- */

export function customerText(o) {
  const L = o.lang === 'ru' ? 'ru' : 'uz';
  const X = C[L];
  const st = OC.STATUS[o.status];
  const out = [X.title(o.id), '', `${st.icon} <b>${st[L]}</b>`, h(OC.UI[L].st[o.status] || '')];
  if (o.cancel_reason && OC.CANCEL_REASONS[o.cancel_reason]) out.push(`<i>${h(OC.CANCEL_REASONS[o.cancel_reason][L])}</i>`);
  if (o.eta_at && !OC.FINAL.includes(o.status)) out.push(X.eta(hhmm(o.eta_at)));
  if (o.status !== 'canceled') {
    const flow = (OC.FLOW[o.type] || OC.FLOW.delivery).slice(1);
    const at = {};
    o.history.forEach((x) => { at[x.s] = x.t; });
    const cur = flow.indexOf(o.status);
    out.push('');
    flow.forEach((s, i) => out.push(`${i < cur ? '✅' : i === cur ? '➡️' : '◻️'} ${OC.STATUS[s][L]}${at[s] && i <= cur ? ' · ' + hhmm(at[s]) : ''}`));
  }
  out.push('');
  o.items.forEach((it) => out.push(`${it.qty}× ${h(it[L] || it.uz)}${it['size_' + L] ? ' (' + h(it['size_' + L]) + ')' : ''} — ${fmt(it.sum)}`));
  out.push(`${X.total}: <b>${T[L].sum(o.total)}</b> · ${o.payment === 'card' ? X.card : X.cash}`);
  return out.join('\n');
}

export function customerKeyboard(o) {
  const L = o.lang === 'ru' ? 'ru' : 'uz';
  const rows = [[{ text: C[L].openOrder, url: `${SITE}order?t=${encodeURIComponent(o.token)}` }]];
  if (o.status === 'new') rows.push([{ text: C[L].cancel, callback_data: `k:${o.id}` }]);
  return { inline_keyboard: rows };
}

// Лучшая практика для статусов в чате: прежнюю карточку удаляем, новую присылаем вниз чата.
// Звук — только на важных этапах, остальное приходит тихо.
export async function notifyCustomer(env, o, { silent } = {}) {
  if (!o.tg_chat) return;
  if (o.tg_msg) await tg(env, 'deleteMessage', { chat_id: o.tg_chat, message_id: o.tg_msg });
  const r = await tg(env, 'sendMessage', {
    chat_id: o.tg_chat, text: customerText(o), parse_mode: 'HTML', reply_markup: customerKeyboard(o),
    disable_notification: silent || !LOUD.includes(o.status), link_preview_options: { is_disabled: true }
  });
  if (r.ok) await env.DB.prepare('UPDATE orders SET tg_msg = ? WHERE id = ?').bind(r.result.message_id, o.id).run();
  else if (r.error_code === 403 || r.error_code === 400) await env.DB.prepare('UPDATE orders SET tg_chat = NULL, tg_msg = NULL WHERE id = ?').bind(o.id).run();
}

export async function linkCustomer(env, o, chatId) {
  await env.DB.prepare('UPDATE orders SET tg_chat = ?, tg_msg = NULL WHERE id = ?').bind(chatId, o.id).run();
  if (o.tg_chat && o.tg_msg && String(o.tg_chat) !== String(chatId)) await tg(env, 'deleteMessage', { chat_id: o.tg_chat, message_id: o.tg_msg });
  await notifyCustomer(env, { ...o, tg_chat: chatId, tg_msg: null });
}
