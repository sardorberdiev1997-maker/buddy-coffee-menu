// Здоровье системы: сторож бота и ошибки браузеров посетителей. Всё видно на /api/tg/info.
import { setupBot } from './bot.js';
import { claimKV, setKV, throttle } from './db.js';
import { T } from './texts.js';
import { groupChat, groupLang, tg, webhookSecret } from './tg.js';
import { DAY, h, HOUR, MIN, redact, sha256, SITE } from './util.js';

/* ---------- сторож бота (из /api/tick раз в 10 минут) ---------- */

// Если Telegram перестал доставлять боту сообщения — вебхук сброшен (токен подключили к другой программе)
// или наш адрес отвечает ошибками, — заказы в группу ещё приходят, но кнопки и команды молчат.
// Сброшенный вебхук ставим заново сами; если не помогло — пишем в группу, не чаще раза в 6 часов.
export async function watchBot(env, now = Date.now()) {
  if (!(await throttle(env, 'wh_at', now, 10 * MIN))) return null;
  const r = await tg(env, 'getWebhookInfo', {});
  if (!r.ok) {
    await setKV(env, 'wh_problem', `${new Date(now).toISOString()} getWebhookInfo: ${redact(r.description)}`);
    return 'api';
  }
  const w = r.result || {};
  const want = `${SITE}api/tg`;
  const stuck = (w.pending_update_count || 0) > 0 && w.last_error_date && now - w.last_error_date * 1000 < 15 * MIN;
  if (w.url === want && !stuck) return 'ok';

  let problem = w.url !== want ? `адрес вебхука «${w.url || 'пусто'}»` : `Telegram не может доставить сообщения: ${w.last_error_message || '?'}`;
  if (w.url !== want) {
    const fix = await setupBot(env, await webhookSecret(env));
    problem += fix.webhook === true ? ' — восстановлен' : ` — восстановить не удалось: ${fix.webhook}`;
    await setKV(env, 'wh_problem', `${new Date(now).toISOString()} ${redact(problem)}`);
    if (fix.webhook === true) return 'repaired';
  } else await setKV(env, 'wh_problem', `${new Date(now).toISOString()} ${redact(problem)}`);

  const group = await groupChat(env);
  if (group && (await throttle(env, 'wh_alert', now, 6 * HOUR))) {
    const L = await groupLang(env);
    await tg(env, 'sendMessage', { chat_id: group, text: T[L].botAlert(h(problem), `${SITE}api/tg/info`), parse_mode: 'HTML' });
  }
  return 'alert';
}

/* ---------- ошибки в браузерах посетителей (assets/boot.js → /api/log) ---------- */

const ERR_PER_HOUR = 30; // больше в час не пишем — защита базы от мусора

// Одна запись на одинаковую ошибку в час; без личных данных: текст ошибки, файл, страница и тип устройства
export async function logClientError(env, raw, ua) {
  let b;
  try {
    b = JSON.parse(String(raw).slice(0, 3000));
  } catch (e) {
    return;
  }
  const m = redact((b && b.m) || '').slice(0, 300);
  if (!m) return;
  const hour = new Date().toISOString().slice(0, 13);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM kv WHERE k >= ? AND k < ?').bind(`err:${hour}:`, `err:${hour};`).first();
  if (n && n.n >= ERR_PER_HOUR) return;
  const src = String(b.s || '').slice(0, 120);
  const dev = (String(ua).match(/iPhone|iPad|Android|Windows|Macintosh|Linux/) || ['?'])[0] + (b.tg ? ' · Telegram' : '');
  const key = `err:${hour}:${(await sha256(m + '|' + src)).slice(0, 12)}`;
  await claimKV(env, key, JSON.stringify({ t: Date.now(), m, src, line: parseInt(b.l, 10) || 0, page: String(b.p || '').slice(0, 60), dev }));
}

export async function clientErrors(env, limit = 10) {
  const rows = (await env.DB.prepare("SELECT v FROM kv WHERE k >= 'err:' AND k < 'err;' ORDER BY k DESC LIMIT ?").bind(limit).all()).results;
  return rows.map(({ v }) => {
    try {
      const e = JSON.parse(v);
      return `${new Date(e.t).toISOString().slice(0, 16)} · ${e.dev} · ${e.page} · ${e.m}${e.src ? ` (${e.src}:${e.line})` : ''}`;
    } catch (err) {
      return String(v).slice(0, 200);
    }
  });
}

// Из ежедневной чистки: ошибки старше недели не храним
export const cleanClientErrors = (env, now) =>
  env.DB.prepare("DELETE FROM kv WHERE k >= 'err:' AND k < ?").bind(`err:${new Date(now - 7 * DAY).toISOString().slice(0, 13)}`).run();
