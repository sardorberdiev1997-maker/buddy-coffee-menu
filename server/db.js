// База заказов: Cloudflare D1 (SQLite). Таблицы создаются сами при первом запросе.
import { randomToken } from './util.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    cid TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    type TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'uz',
    source TEXT NOT NULL DEFAULT 'site',
    name TEXT,
    phone TEXT,
    phone_hash TEXT,
    address TEXT,
    lat REAL,
    lng REAL,
    acc INTEGER,
    comment TEXT,
    payment TEXT NOT NULL DEFAULT 'cash',
    change_from INTEGER,
    items TEXT NOT NULL,
    total INTEGER NOT NULL,
    eta_at INTEGER,
    accepted_at INTEGER,
    done_at INTEGER,
    cancel_reason TEXT,
    history TEXT NOT NULL DEFAULT '[]',
    tg_user INTEGER,
    tg_chat INTEGER,
    tg_msg INTEGER,
    group_chat INTEGER,
    group_msg INTEGER,
    reminded INTEGER NOT NULL DEFAULT 0,
    ip_hash TEXT,
    anonymized INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at)',
  'CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at)',
  'CREATE INDEX IF NOT EXISTS orders_ip ON orders(ip_hash, created_at)',
  'CREATE INDEX IF NOT EXISTS orders_phone ON orders(phone_hash, created_at)',
  'CREATE INDEX IF NOT EXISTS orders_tg ON orders(tg_chat, created_at)',
  'CREATE INDEX IF NOT EXISTS orders_done ON orders(done_at)',
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  // Оценки заказов (server/ratings.js). asked_at — когда бот попросил оценку (0 — решили не спрашивать)
  `CREATE TABLE IF NOT EXISTS ratings (
    order_id INTEGER PRIMARY KEY,
    stars INTEGER,
    reason TEXT,
    comment TEXT,
    source TEXT,
    asked_at INTEGER,
    rated_at INTEGER,
    alert_msg INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS ratings_rated ON ratings(rated_at)',
  // База клиентов: по телефону (заказывал) и/или по Telegram (пользуется ботом)
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    phone_hash TEXT UNIQUE,
    name TEXT,
    tg_chat INTEGER UNIQUE,
    tg_username TEXT,
    lang TEXT,
    source TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    subscribed INTEGER NOT NULL DEFAULT 1,
    blocked INTEGER NOT NULL DEFAULT 0
  )`,
  // Рассылки: сообщение из группы кафе, кому, сколько отправлено
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src_chat INTEGER NOT NULL,
    src_msg INTEGER NOT NULL,
    ctl_msg INTEGER,
    audience TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    done_at INTEGER,
    total INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    cursor INTEGER NOT NULL DEFAULT 0
  )`
];

let ready = null;

export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* ---------- настройки бота (kv) ---------- */

export async function getKV(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return row ? row.v : null;
}

export async function setKV(env, k, v) {
  if (v == null) await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
  else await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();
}

// Вставить, только если ключа ещё нет (true — вставили мы). Для «отправить сводку один раз»
// Не чаще раза в interval мс: атомарно, два параллельных вызова вдвоём не пройдут
export async function throttle(env, k, now, interval) {
  const r = await env.DB.prepare('UPDATE kv SET v = ? WHERE k = ? AND CAST(v AS INTEGER) <= ?').bind(String(now), k, now - interval).run();
  return !!(r.meta && r.meta.changes) || claimKV(env, k, now);
}

export async function claimKV(env, k, v) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)').bind(k, String(v)).run();
  return !!(r.meta && r.meta.changes);
}

export async function salt(env) {
  let s = await getKV(env, 'salt');
  if (!s) {
    await claimKV(env, 'salt', randomToken(24));
    s = await getKV(env, 'salt');
  }
  return s;
}

/* ---------- заказы ---------- */

export function parseOrder(row) {
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items || '[]'), history: JSON.parse(row.history || '[]'), address: row.address ? JSON.parse(row.address) : null };
}

export async function orderById(env, id) {
  return parseOrder(await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first());
}

export async function orderByToken(env, token) {
  return parseOrder(await env.DB.prepare('SELECT * FROM orders WHERE token = ?').bind(token).first());
}

// Обновление только если статус не успели поменять (два сотрудника нажали одновременно)
export async function updateOrder(env, id, expectStatus, fields) {
  const keys = Object.keys(fields);
  const vals = keys.map((k) => (k === 'history' || k === 'items' ? JSON.stringify(fields[k]) : fields[k]));
  const sql = `UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?${expectStatus ? ' AND status = ?' : ''}`;
  const args = [...vals, Date.now(), id];
  if (expectStatus) args.push(expectStatus);
  const r = await env.DB.prepare(sql).bind(...args).run();
  return !!(r.meta && r.meta.changes);
}
