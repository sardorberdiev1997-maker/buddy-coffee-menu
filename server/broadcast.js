// Рассылка акций, скидок и поздравлений подписчикам бота.
// Как принято в Telegram: администратор пишет сообщение в группе кафе и отвечает на него /broadcast,
// бот показывает аудитории и число получателей, можно отправить себе на пробу, затем — подтверждение.
// Отправка порциями (лимиты Telegram и Cloudflare): сразу первая порция, остальное — каждую минуту из /api/tick.
// В каждом сообщении — кнопки «Открыть меню» и «Отписаться от акций».
import { audienceCounts, audienceSQL } from './customers.js';
import { C, T } from './texts.js';
import { groupLang, tg } from './tg.js';
import { SITE } from './util.js';

const BATCH = 25;

const cb = (text, data) => ({ text, callback_data: data });

function promoKeyboard(lang) {
  const X = C[lang === 'ru' ? 'ru' : 'uz'];
  return { inline_keyboard: [[{ text: X.menuBtn, web_app: { url: `${SITE}?tg=1&lang=${lang === 'ru' ? 'ru' : 'uz'}` } }], [cb(X.unsub, 'unsub')]] };
}

export async function startDraft(env, chat, replyTo, by) {
  const now = Date.now();
  const r = await env.DB.prepare('INSERT INTO broadcasts (src_chat, src_msg, created_by, created_at) VALUES (?, ?, ?, ?)')
    .bind(chat.id, replyTo.message_id, by, now).run();
  const id = r.meta.last_row_id;
  const L = await groupLang(env);
  const counts = await audienceCounts(env);
  const sent = await tg(env, 'sendMessage', {
    chat_id: chat.id, text: T[L].bcChoose(id, counts), parse_mode: 'HTML',
    reply_parameters: { message_id: replyTo.message_id, allow_sending_without_reply: true },
    reply_markup: chooseKeyboard(L, id, counts)
  });
  if (sent.ok) await env.DB.prepare('UPDATE broadcasts SET ctl_msg = ? WHERE id = ?').bind(sent.result.message_id, id).run();
}

function chooseKeyboard(L, id, n) {
  const X = T[L];
  return {
    inline_keyboard: [
      [cb(`${X.bcAll} (${n.all})`, `bc:${id}:aud:all`)],
      [cb(`${X.bcActive} (${n.active})`, `bc:${id}:aud:active`), cb(`${X.bcSleep} (${n.sleep})`, `bc:${id}:aud:sleep`)],
      [cb(X.bcTest, `bc:${id}:test`), cb(X.bcCancel, `bc:${id}:cancel`)]
    ]
  };
}

async function edit(env, b, text, keyboard) {
  if (!b.ctl_msg) return;
  await tg(env, 'editMessageText', { chat_id: b.src_chat, message_id: b.ctl_msg, text, parse_mode: 'HTML', reply_markup: keyboard || { inline_keyboard: [] } });
}

// Кнопки под сообщением рассылки в группе
export async function onBroadcastButton(env, q, parts, isAdmin) {
  const answer = (text, alert) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: !!alert });
  const L = await groupLang(env);
  const X = T[L];
  const id = parseInt(parts[1], 10);
  const b = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first();
  if (!b) return answer();
  if (!(await isAdmin())) return answer(X.adminOnly, true);
  const action = parts[2];

  if (action === 'test') {
    // Пробная отправка себе: так выглядит сообщение у клиента
    const r = await tg(env, 'copyMessage', { chat_id: q.from.id, from_chat_id: b.src_chat, message_id: b.src_msg, reply_markup: promoKeyboard(L) });
    return answer(r.ok ? X.bcTestOk : X.bcTestFail, !r.ok);
  }
  if (b.status !== 'draft' && action !== 'stop') return answer(X.already);
  if (action === 'cancel') {
    await env.DB.prepare("UPDATE broadcasts SET status = 'canceled' WHERE id = ?").bind(id).run();
    await edit(env, b, X.bcCanceled(id));
    return answer();
  }
  if (action === 'back') {
    await edit(env, b, X.bcChoose(id, await audienceCounts(env)), chooseKeyboard(L, id, await audienceCounts(env)));
    return answer();
  }
  if (action === 'aud') {
    const aud = ['all', 'active', 'sleep'].includes(parts[3]) ? parts[3] : 'all';
    const n = (await audienceCounts(env))[aud];
    if (!n) return answer(X.bcEmpty, true);
    await edit(env, b, X.bcConfirm(id, X.bcAudName[aud], n), {
      inline_keyboard: [[cb(X.bcGo(n), `bc:${id}:go:${aud}`)], [cb(X.back, `bc:${id}:back`)]]
    });
    return answer();
  }
  if (action === 'go') {
    const aud = ['all', 'active', 'sleep'].includes(parts[3]) ? parts[3] : 'all';
    const n = (await audienceCounts(env))[aud];
    const ok = await env.DB.prepare("UPDATE broadcasts SET status = 'sending', audience = ?, total = ?, started_at = ? WHERE id = ? AND status = 'draft'")
      .bind(aud, n, Date.now(), id).run();
    if (!(ok.meta && ok.meta.changes)) return answer(X.already);
    await answer(X.bcStarted);
    await sendBatch(env, id);
    return;
  }
  if (action === 'stop') {
    await env.DB.prepare("UPDATE broadcasts SET status = 'stopped', done_at = ? WHERE id = ? AND status = 'sending'").bind(Date.now(), id).run();
    const fresh = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first();
    await edit(env, fresh, X.bcStopped(id, fresh.sent, fresh.total));
    return answer();
  }
  return answer();
}

// Порция рассылки: до BATCH получателей. Вызывается сразу после подтверждения и затем каждую минуту
export async function sendBatch(env, id) {
  const b = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first();
  if (!b || b.status !== 'sending') return false;
  const L = await groupLang(env);
  const X = T[L];
  const people = (await env.DB.prepare(`SELECT id, tg_chat, lang FROM customers WHERE ${audienceSQL(b.audience)} AND id > ? ORDER BY id LIMIT ${BATCH}`)
    .bind(b.cursor).all()).results;
  let sent = 0, failed = 0, cursor = b.cursor, paused = false;
  for (const p of people) {
    const r = await tg(env, 'copyMessage', { chat_id: p.tg_chat, from_chat_id: b.src_chat, message_id: b.src_msg, reply_markup: promoKeyboard(p.lang) });
    if (r.ok) sent++;
    else if (r.error_code === 429) { paused = true; break; } // Telegram просит подождать — продолжим со следующей минутой
    else {
      failed++;
      // Человек заблокировал бота или удалил аккаунт — больше не пишем
      if (r.error_code === 403 || r.error_code === 400) await env.DB.prepare('UPDATE customers SET blocked = 1 WHERE id = ?').bind(p.id).run();
    }
    cursor = p.id;
  }
  const finished = !paused && people.length < BATCH;
  await env.DB.prepare(`UPDATE broadcasts SET sent = sent + ?, failed = failed + ?, cursor = ?${finished ? ", status = 'done', done_at = ?" : ''} WHERE id = ?`)
    .bind(...(finished ? [sent, failed, cursor, Date.now(), id] : [sent, failed, cursor, id])).run();
  const fresh = await env.DB.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first();
  if (finished) await edit(env, fresh, X.bcDone(id, fresh.sent, fresh.failed));
  else await edit(env, fresh, X.bcProgress(id, fresh.sent + fresh.failed, fresh.total), { inline_keyboard: [[cb(X.bcStop, `bc:${id}:stop`)]] });
  return !finished;
}

// Из /api/tick: продолжить начатую рассылку
export async function continueBroadcasts(env) {
  const b = await env.DB.prepare("SELECT id FROM broadcasts WHERE status = 'sending' ORDER BY id LIMIT 1").first();
  if (b) await sendBatch(env, b.id);
  return b ? b.id : null;
}

// Клиент нажал «Отписаться» или отправил /stop
export async function setSubscribed(env, chatId, on) {
  await env.DB.prepare('UPDATE customers SET subscribed = ? WHERE tg_chat = ?').bind(on ? 1 : 0, chatId).run();
}
