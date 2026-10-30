// Локальная проверка сайта вместе с сервером заказов, без Cloudflare и без настоящего бота.
//   npm run build && node tools/dev-server.mjs [порт]
// Статика из dist/ с заголовками из dist/_headers, /api/* — тот же dist/_worker.js, что на Cloudflare.
// База D1 — файл SQLite в .dev/, Telegram API — заглушка: все вызовы видны на /__tg.
// Сообщение боту от «сотрудника» или «покупателя»: POST /__tg/update с телом Telegram Update.
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8790', 10);
const BOT_TOKEN = process.env.BOT_TOKEN || '123456:dev-token';
const MOCK_TG = !process.env.BOT_TOKEN;

/* ---------- D1 поверх node:sqlite ---------- */

mkdirSync(path.join(ROOT, '.dev'), { recursive: true });
const sqlite = new DatabaseSync(process.env.DEV_DB || path.join(ROOT, '.dev/orders.sqlite'));
const plain = (r) => (r ? { ...r } : null);
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sql, args); }
  async first(col) { const r = plain(sqlite.prepare(this.sql).get(...this.args)); return r && col ? r[col] : r; }
  async all() { return { success: true, results: sqlite.prepare(this.sql).all(...this.args).map(plain), meta: {} }; }
  async run() {
    const r = sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  batch: async (list) => {
    const out = [];
    for (const s of list) out.push(/^\s*(select|with)\b/i.test(s.sql) ? await s.all() : await s.run());
    return out;
  }
};

/* ---------- заглушка Telegram ---------- */

const tgLog = [];
let msgId = 1000;
let hook = { url: '', pending_update_count: 0 }; // getWebhookInfo заглушки; тест сторожа меняет через /__tg/hook
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (MOCK_TG && url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop();
    // sendDocument приходит как multipart (FormData): поля — строки, файл — имя и размер
    let body = {};
    if (init && init.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : { name: v.name, size: v.size, bytes: Buffer.from(await v.arrayBuffer()).toString('base64') };
    } else if (init && init.body) body = JSON.parse(init.body);
    tgLog.push({ method, body, at: Date.now() });
    let result = true;
    if (method === 'sendMessage' || method === 'sendLocation' || method === 'editMessageText' || method === 'copyMessage' || method === 'sendDocument') {
      result = { message_id: body.message_id || ++msgId, chat: { id: body.chat_id }, date: Math.floor(Date.now() / 1000), text: body.text };
    } else if (method === 'getChatMember') result = { status: 'creator', user: { id: body.user_id } };
    else if (method === 'getMe') result = { id: 1, is_bot: true, username: 'buddy_coffee_uz_bot' };
    else if (method === 'setWebhook') hook = { url: body.url, pending_update_count: 0 };
    else if (method === 'getWebhookInfo') result = hook;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

/* ---------- статика с заголовками _headers ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml'
};

function headerRules() {
  const rules = [];
  let cur = null;
  for (const line of readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: [] }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    if (cur && i > 0) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) file = '';
  if (file && !existsSync(file) && existsSync(file + '.html')) file += '.html';
  let status = 200;
  if (!file || !existsSync(file) || statSync(file).isDirectory() || path.basename(file).startsWith('_')) { file = path.join(DIST, '404.html'); status = 404; }
  const headers = new Headers({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  for (const r of headerRules()) {
    const re = new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(pathname)) r.headers.forEach(([k, v]) => headers.set(k, v));
  }
  return new Response(readFileSync(file), { status, headers });
}

/* ---------- сервер ---------- */

const worker = (await import(pathToFileURL(path.join(DIST, '_worker.js')).href + '?t=' + Date.now())).default;
const pending = new Set();
const ctx = { waitUntil: (p) => { pending.add(p); p.finally(() => pending.delete(p)); } };
const env = { DB, BOT_TOKEN, ASSETS: { fetch: async (req) => serveStatic(new URL(req.url || req).pathname) } };
const secret = createHmac('sha256', BOT_TOKEN).update('buddy-coffee-webhook').digest('hex').slice(0, 48);

async function toRequest(req, body) {
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  // Тесты могут представиться разными IP (на Cloudflare заголовок ставит сама платформа)
  headers.set('cf-connecting-ip', req.headers['x-test-ip'] || req.socket.remoteAddress || '127.0.0.1');
  return new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  let out;
  try {
    if (url.pathname === '/__tg') {
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      out = Response.json(tgLog.filter((x) => x.at >= since));
    } else if (url.pathname === '/__tg/hook' && req.method === 'POST') {
      hook = JSON.parse(body.toString() || '{}');
      out = Response.json({ ok: true });
    } else if (url.pathname === '/__sql' && req.method === 'POST') {
      const { sql, args = [] } = JSON.parse(body.toString() || '{}');
      sqlite.prepare(sql).run(...args);
      out = Response.json({ ok: true });
    } else if (url.pathname === '/__idle') {
      await Promise.all([...pending]);
      out = Response.json({ ok: true });
    } else if (url.pathname === '/__tg/update' && req.method === 'POST') {
      const r = await worker.fetch(new Request(`http://${req.headers.host}/api/tg`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body
      }), env, ctx);
      await Promise.all([...pending]);
      out = r;
    } else {
      out = await worker.fetch(await toRequest(req, body), env, ctx);
    }
  } catch (e) {
    console.error(e);
    out = new Response('dev-server error: ' + e.message, { status: 500 });
  }
  const headers = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`dev: http://127.0.0.1:${PORT}  (Telegram: ${MOCK_TG ? 'заглушка, журнал /__tg' : 'настоящий бот'})`);
});
