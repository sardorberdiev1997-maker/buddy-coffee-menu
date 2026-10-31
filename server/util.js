// Общие мелочи сервера: ответы, время по Ташкенту, хеши.

export const SITE = 'https://buddy.cheking.uz/';
export const TZ_OFFSET = 5 * 3600 * 1000; // Asia/Tashkent, UTC+5 без перехода на летнее время
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

// Экранирование для parse_mode=HTML в Telegram
export const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Тексты ошибок для логов и диагностики — без секретов (CWE-209, CWE-532): токен бота «123456:AA…»
// (в т. ч. внутри адреса api.telegram.org/bot…) и ключи/токены в параметрах ссылок
export const redact = (s) => String(s == null ? '' : s)
  .replace(/\d{6,12}:[\w-]{30,}/g, '<token>')
  .replace(/([?&](?:key|token|t|hash|secret)=)[^&\s"'<>]+/gi, '$1<…>');

export const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/* ---------- время ---------- */

// «Местная» дата: Date, у которой UTC-поля равны времени в Ташкенте
export const local = (ms) => new Date(ms + TZ_OFFSET);
export const fromLocal = (y, m, d) => Date.UTC(y, m, d) - TZ_OFFSET;
const pad = (n) => String(n).padStart(2, '0');

export function hhmm(ms) {
  const d = local(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function ddmm(ms, withYear) {
  const d = local(ms);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}${withYear ? '.' + d.getUTCFullYear() : ''}`;
}

export function dayKey(ms) {
  const d = local(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Начало текущего периода (день/неделя/месяц/квартал/год), в котором лежит момент ms
export function periodStart(kind, ms) {
  const d = local(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (kind === 'day') return fromLocal(y, m, day);
  if (kind === 'week') return fromLocal(y, m, day - ((d.getUTCDay() + 6) % 7)); // неделя с понедельника
  if (kind === 'month') return fromLocal(y, m, 1);
  if (kind === 'quarter') return fromLocal(y, m - (m % 3), 1);
  return fromLocal(y, 0, 1);
}

// Предыдущий период того же вида: [start, end)
export function prevPeriod(kind, start) {
  const d = local(start);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (kind === 'day') return [fromLocal(y, m, day - 1), start];
  if (kind === 'week') return [fromLocal(y, m, day - 7), start];
  if (kind === 'month') return [fromLocal(y, m - 1, 1), start];
  if (kind === 'quarter') return [fromLocal(y, m - 3, 1), start];
  return [fromLocal(y - 1, 0, 1), start];
}

/* ---------- хеши и случайные строки ---------- */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export async function hmac(key, msg, raw) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return raw ? sig : hex(sig);
}

export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Сравнение строк за постоянное время (секрет вебхука)
export function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
