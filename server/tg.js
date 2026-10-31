// Telegram Bot API: вызовы, проверка вебхука и данных Mini App.
import { getKV, setKV } from './db.js';
import { hmac, redact, safeEqual, DAY, MIN } from './util.js';

export async function tg(env, method, body, retried) {
  if (!env.BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN is not set' };
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    return { ok: false, description: redact(e.message) };
  }
  const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
  // Группа стала супергруппой — у неё новый id: запоминаем и повторяем
  const moved = j.parameters && j.parameters.migrate_to_chat_id;
  if (!j.ok && moved && body && body.chat_id && !retried) {
    if (String(await groupChat(env)) === String(body.chat_id)) await setKV(env, 'group', moved);
    return tg(env, method, { ...body, chat_id: moved }, true);
  }
  if (!j.ok) console.warn('telegram', method, j.error_code, j.description);
  return j;
}

// Отправка файла (sendDocument): multipart/form-data
export async function tgUpload(env, method, fields, file) {
  if (!env.BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN is not set' };
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v != null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); });
  fd.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(20000) });
    const j = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
    if (!j.ok) console.warn('telegram', method, j.error_code, j.description);
    return j;
  } catch (e) {
    return { ok: false, description: redact(e.message) };
  }
}

export const groupChat = (env) => getKV(env, 'group');

export async function groupLang(env) {
  return (await getKV(env, 'group_lang')) === 'uz' ? 'uz' : 'ru';
}

// Секрет вебхука выводим из токена — отдельный секрет хранить не нужно
export async function webhookSecret(env) {
  return (await hmac(env.BOT_TOKEN, 'buddy-coffee-webhook')).slice(0, 48);
}

export async function checkWebhook(request, env) {
  if (!env.BOT_TOKEN) return false;
  return safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), await webhookSecret(env));
}

// initData из Mini App: подпись HMAC-SHA256 с ключом от токена бота (core.telegram.org/bots/webapps)
export async function verifyInitData(env, initData) {
  if (!initData || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', env.BOT_TOKEN, true);
  if (!safeEqual(await hmac(secret, check), hash)) return null;
  const auth = parseInt(p.get('auth_date'), 10) * 1000;
  // Подпись доказывает, что данные от Telegram, но не что они свежие: перехваченная строка годна, пока не истечёт.
  // Сутки — с запасом на свёрнутое Mini App; при каждом открытии Telegram выдаёт новую. Из будущего — не принимаем
  if (!auth || Date.now() - auth > DAY || auth - Date.now() > 5 * MIN) return null;
  try {
    return JSON.parse(p.get('user') || 'null');
  } catch (e) {
    return null;
  }
}

export async function isAdmin(env, chat, from, senderChat) {
  if (senderChat && senderChat.id === chat.id) return true; // анонимный администратор
  if (!from) return false;
  const r = await tg(env, 'getChatMember', { chat_id: chat.id, user_id: from.id });
  return !!(r.ok && ['creator', 'administrator'].includes(r.result.status));
}
