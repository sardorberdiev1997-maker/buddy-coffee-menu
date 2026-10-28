// Вебхук Telegram: команды и кнопки в группе кафе, личные сообщения покупателей.
import { getKV, orderById, orderByToken, parseOrder, setKV } from './db.js';
import { cafeInfo, loadModel, OC } from './menu.js';
import { canUndo, linkCustomer, nextStatus, refreshGroup, setStatus, undoStatus } from './orders.js';
import { liveStats, STAT_PERIODS, statsKeyboard } from './stats.js';
import { C, T } from './texts.js';
import { groupChat, groupLang, isAdmin, tg } from './tg.js';
import { fmt, hhmm, SITE } from './util.js';

const BOT = (globalThis.MENU_CONFIG && globalThis.MENU_CONFIG.bot) || '';

export async function handleUpdate(env, u) {
  if (u.callback_query) return onCallback(env, u.callback_query);
  if (u.my_chat_member) return onMember(env, u.my_chat_member);
  const m = u.message;
  if (!m || !m.chat) return;
  // Группа стала супергруппой: заказы теперь в новом чате
  if (m.migrate_to_chat_id) {
    if (String(await groupChat(env)) === String(m.chat.id)) await setKV(env, 'group', m.migrate_to_chat_id);
    return;
  }
  if (m.chat.type === 'private') return onPrivate(env, m);
  if (m.chat.type === 'group' || m.chat.type === 'supergroup') return onGroup(env, m);
}

// «/stats@Buddy_coffee_bot today» → ['stats', 'today']; команды другим ботам пропускаем
function command(text) {
  const m = String(text || '').match(/^\/([a-z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  if (m[2] && BOT && m[2].toLowerCase() !== BOT.toLowerCase()) return null;
  return [m[1].toLowerCase(), (m[3] || '').trim()];
}

const send = (env, chat, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

/* ---------- группа кафе ---------- */

async function onMember(env, upd) {
  const chat = upd.chat;
  if (!['group', 'supergroup'].includes(chat.type)) return;
  const status = upd.new_chat_member && upd.new_chat_member.status;
  if (!['member', 'administrator'].includes(status)) {
    // Бота удалили из подключённой группы
    if (String(await groupChat(env)) === String(chat.id)) await setKV(env, 'group', null);
    return;
  }
  if (!(await groupChat(env))) await send(env, chat.id, T.ru.hello + '\n\n' + T.uz.hello);
}

async function onGroup(env, m) {
  const cmd = command(m.text);
  if (!cmd) return;
  const [name] = cmd;
  const chat = m.chat;
  const bound = await groupChat(env);
  const here = bound && String(bound) === String(chat.id);
  const L = here ? await groupLang(env) : 'ru';
  const X = T[L];
  const reply = (text, extra) => send(env, chat.id, text, { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true }, ...extra });
  const admin = () => isAdmin(env, chat, m.from, m.sender_chat);

  if (name === 'bind' || name === 'start') {
    if (here) return reply(X.boundAlready);
    if (bound) return reply(X.boundOther);
    if (!(await admin())) return reply(X.adminOnly);
    await setKV(env, 'group', chat.id);
    return reply(X.bound);
  }
  if (name === 'help') return reply(X.help);
  if (!here) return reply(bound ? X.boundOther : X.notBound);

  if (name === 'unbind') {
    if (!(await admin())) return reply(X.adminOnly);
    await setKV(env, 'group', null);
    return reply(X.unbound);
  }
  if (name === 'pause' || name === 'resume') {
    if (!(await admin())) return reply(X.adminOnly);
    await setKV(env, 'paused', name === 'pause' ? '1' : null);
    return reply(name === 'pause' ? X.paused : X.resumed);
  }
  if (name === 'lang') {
    if (!(await admin())) return reply(X.adminOnly);
    const next = L === 'ru' ? 'uz' : 'ru';
    await setKV(env, 'group_lang', next);
    return reply(T[next].langSet);
  }
  if (name === 'stats') {
    const p = STAT_PERIODS.includes(cmd[1]) ? cmd[1] : 'today';
    return reply(await liveStats(env, L, p), { reply_markup: statsKeyboard(L, p) });
  }
  if (name === 'orders') {
    const rows = (await env.DB.prepare("SELECT * FROM orders WHERE status NOT IN ('delivered', 'picked', 'canceled') ORDER BY id LIMIT 30").all()).results.map(parseOrder);
    if (!rows.length) return reply(X.noActive);
    // В супергруппе даём ссылку на сообщение заказа
    const link = (o) => (String(o.group_chat || '').startsWith('-100') && o.group_msg ? `https://t.me/c/${String(o.group_chat).slice(4)}/${o.group_msg}` : '');
    const lines = rows.map((o) => {
      const st = OC.STATUS[o.status];
      const label = `№${o.id}`;
      return `${st.icon} ${link(o) ? `<a href="${link(o)}">${label}</a>` : label} · ${st[L]} · ${fmt(o.total)} · ${hhmm(o.created_at)}`;
    });
    return reply(`${X.activeTitle(rows.length)}\n\n${lines.join('\n')}`);
  }
}

async function onCallback(env, q) {
  const answer = (text, alert) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: !!alert });
  const data = String(q.data || '');
  const msg = q.message;
  if (!msg) return answer();
  const [kind, idStr, arg] = data.split(':');

  // Покупатель отменяет свой заказ из личного чата
  if (kind === 'k') {
    const o = await orderById(env, parseInt(idStr, 10));
    if (!o || String(o.tg_chat) !== String(msg.chat.id)) return answer();
    const L = o.lang === 'ru' ? 'ru' : 'uz';
    if (o.status !== 'new') return answer(C[L].cancelLate, true);
    const next = await setStatus(env, o, 'canceled', { reason: 'self', by: 'client' });
    if (next && next.group_chat) {
      const GL = await groupLang(env);
      await send(env, next.group_chat, T[GL].customerCanceled(o.id), { reply_parameters: { message_id: next.group_msg, allow_sending_without_reply: true } });
    }
    return answer(next ? C[L].canceledOk : C[L].cancelLate);
  }

  // Всё остальное — только в подключённой группе
  if (String(await groupChat(env)) !== String(msg.chat.id)) return answer();
  const L = await groupLang(env);
  const X = T[L];
  const by = q.from ? [q.from.first_name, q.from.last_name].filter(Boolean).join(' ').slice(0, 40) : '';

  if (kind === 'st') {
    const p = STAT_PERIODS.includes(idStr) ? idStr : 'today';
    await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text: await liveStats(env, L, p), parse_mode: 'HTML', reply_markup: statsKeyboard(L, p)
    });
    return answer();
  }

  const o = await orderById(env, parseInt(idStr, 10));
  if (!o) return answer();
  const keep = (mode) => refreshGroup(env, o, mode);

  if (kind === 'a') {
    if (o.status !== 'new') { await keep(); return answer(X.already); }
    const eta = [10, 15, 20, 30, 45, 60, 90].includes(+arg) ? +arg : 30;
    return answer((await setStatus(env, o, 'accepted', { by, eta })) ? `✅ ${OC.STATUS.accepted[L]}` : X.already);
  }
  if (kind === 'n') {
    if (nextStatus(o) !== arg) { await keep(); return answer(X.already); }
    return answer((await setStatus(env, o, arg, { by })) ? `${OC.STATUS[arg].icon} ${OC.STATUS[arg][L]}` : X.already);
  }
  if (kind === 'c') {
    if (OC.FINAL.includes(o.status)) { await keep(); return answer(X.already); }
    await keep('cancel');
    return answer(X.cancelAsk);
  }
  if (kind === 'b') { await keep(); return answer(); }
  if (kind === 'x') {
    if (OC.FINAL.includes(o.status)) { await keep(); return answer(X.already); }
    const reason = OC.CANCEL_REASONS[arg] ? arg : 'other';
    return answer((await setStatus(env, o, 'canceled', { by, reason })) ? `❌ ${OC.STATUS.canceled[L]}` : X.already);
  }
  if (kind === 'u') {
    if (!canUndo(o)) { await keep(); return answer(X.tooLate, true); }
    return answer((await undoStatus(env, o)) ? '↩️' : X.already);
  }
  return answer();
}

/* ---------- личные сообщения покупателей ---------- */

async function onPrivate(env, m) {
  const L = /^ru/i.test((m.from && m.from.language_code) || '') ? 'ru' : 'uz';
  const X = C[L];
  const menu = { inline_keyboard: [[{ text: X.menuBtn, web_app: { url: `${SITE}?tg=1&lang=${L}` } }]] };
  const cmd = command(m.text);

  if (cmd && cmd[0] === 'start' && /^o_[\w-]{10,40}$/.test(cmd[1])) {
    const o = await orderByToken(env, cmd[1].slice(2));
    if (!o) return send(env, m.chat.id, X.notFound, { reply_markup: menu });
    await send(env, m.chat.id, C[o.lang === 'ru' ? 'ru' : 'uz'].linked);
    await linkCustomer(env, o, m.chat.id);
    return;
  }
  if (cmd && cmd[0] === 'start') return send(env, m.chat.id, X.hello, { reply_markup: menu });
  if (cmd && cmd[0] === 'orders') {
    const rows = (await env.DB.prepare('SELECT * FROM orders WHERE tg_chat = ? OR tg_user = ? ORDER BY id DESC LIMIT 5').bind(m.chat.id, m.chat.id).all()).results.map(parseOrder);
    if (!rows.length) return send(env, m.chat.id, X.noOrders, { reply_markup: menu });
    const kb = rows.map((o) => [{ text: `№${o.id} · ${OC.STATUS[o.status].icon} ${OC.STATUS[o.status][L]} · ${fmt(o.total)}`, url: `${SITE}order?t=${encodeURIComponent(o.token)}` }]);
    return send(env, m.chat.id, X.myOrders, { reply_markup: { inline_keyboard: kb.concat(menu.inline_keyboard) } });
  }
  const model = await loadModel(env);
  return send(env, m.chat.id, X.help(cafeInfo(model, L).phone), { reply_markup: menu });
}

/* ---------- настройка бота: вебхук, команды, кнопка меню ---------- */

export async function setupBot(env, webhookSecretValue) {
  const results = {};
  const call = async (name, method, body) => { const r = await tg(env, method, body); results[name] = r.ok ? true : r.description; };
  await call('webhook', 'setWebhook', {
    url: `${SITE}api/tg`, secret_token: webhookSecretValue,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'], max_connections: 20
  });
  for (const lang of ['ru', 'uz', '']) {
    const L = lang || 'uz';
    const isRu = L === 'ru';
    const base = lang ? { language_code: lang } : {};
    await call(`private_${L}${lang ? '' : '_default'}`, 'setMyCommands', {
      ...base, scope: { type: 'all_private_chats' },
      commands: [
        { command: 'start', description: isRu ? 'Открыть меню и заказать' : 'Menyuni ochish va buyurtma berish' },
        { command: 'orders', description: isRu ? 'Мои заказы' : 'Buyurtmalarim' }
      ]
    });
    await call(`group_${L}${lang ? '' : '_default'}`, 'setMyCommands', {
      ...base, scope: { type: 'all_group_chats' },
      commands: [
        { command: 'stats', description: isRu ? 'Статистика продаж' : 'Savdo statistikasi' },
        { command: 'orders', description: isRu ? 'Заказы в работе' : 'Jarayondagi buyurtmalar' },
        { command: 'pause', description: isRu ? 'Остановить онлайн-заказы' : 'Onlayn buyurtmani to‘xtatish' },
        { command: 'resume', description: isRu ? 'Снова принимать заказы' : 'Buyurtmani qayta yoqish' },
        { command: 'lang', description: isRu ? 'Язык бота: рус/узб' : 'Bot tili: o‘zb/rus' },
        { command: 'help', description: isRu ? 'Все команды' : 'Barcha buyruqlar' }
      ]
    });
    await call(`desc_${L}${lang ? '' : '_default'}`, 'setMyShortDescription', {
      ...base, short_description: isRu ? 'Buddy Coffee, Шахрисабз: меню и заказ с доставкой. Круглосуточно.' : 'Buddy Coffee, Shahrisabz: menyu va yetkazib berish. Kecha-kunduz.'
    });
  }
  await call('menu_button', 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Menyu', web_app: { url: `${SITE}?tg=1` } } });
  const me = await tg(env, 'getMe', {});
  results.bot = me.ok ? me.result.username : me.description;
  results.group = (await groupChat(env)) ? 'bound' : 'not bound';
  results.paused = (await getKV(env, 'paused')) === '1';
  return results;
}
