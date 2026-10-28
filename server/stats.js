// Статистика продаж: /stats в группе и сводки в 00:00 по Ташкенту (день, неделя, месяц, квартал, год).
// Набор как в ежедневных отчётах Square/Toast: выручка, заказы, средний чек, отмены, доставка/самовывоз,
// время доставки, клиенты (новые), пиковый час, топ блюд и сравнение с прошлым периодом.
import { T } from './texts.js';
import { DAY, ddmm, h, local, periodStart, prevPeriod, TZ_OFFSET } from './util.js';

const DONE = "status IN ('delivered', 'picked')";

export async function collect(env, start, end, { bestDay } = {}) {
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const stmts = [
    q(`SELECT COUNT(*) AS n,
        SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN ${DONE} THEN total ELSE 0 END) AS revenue,
        SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
        SUM(CASE WHEN status = 'canceled' THEN total ELSE 0 END) AS lost,
        SUM(CASE WHEN type = 'delivery' AND ${DONE} THEN 1 ELSE 0 END) AS delivery,
        SUM(CASE WHEN type = 'pickup' AND ${DONE} THEN 1 ELSE 0 END) AS pickup,
        AVG(CASE WHEN status = 'delivered' THEN done_at - created_at END) AS dtime,
        COUNT(DISTINCT CASE WHEN status != 'canceled' THEN phone_hash END) AS clients
      FROM orders WHERE created_at >= ? AND created_at < ?`, start, end),
    q(`SELECT COUNT(*) AS c FROM (SELECT phone_hash, MIN(created_at) AS first FROM orders
        WHERE phone_hash IS NOT NULL AND status != 'canceled' GROUP BY phone_hash) WHERE first >= ? AND first < ?`, start, end),
    // dish, а не name: в orders есть своя колонка name (имя покупателя)
    q(`SELECT json_extract(j.value, '$.uz') AS dish, SUM(json_extract(j.value, '$.qty')) AS qty
        FROM orders, json_each(orders.items) AS j
        WHERE orders.created_at >= ? AND orders.created_at < ? AND orders.${DONE}
        GROUP BY dish ORDER BY qty DESC, dish LIMIT 5`, start, end),
    q(`SELECT ((created_at + ${TZ_OFFSET}) / 3600000) % 24 AS hour, COUNT(*) AS c FROM orders
        WHERE created_at >= ? AND created_at < ? AND status != 'canceled' GROUP BY hour ORDER BY c DESC, hour LIMIT 1`, start, end)
  ];
  if (bestDay) {
    stmts.push(q(`SELECT (created_at + ${TZ_OFFSET}) / ${DAY} AS d, SUM(total) AS s FROM orders
        WHERE created_at >= ? AND created_at < ? AND ${DONE} GROUP BY d ORDER BY s DESC LIMIT 1`, start, end));
  }
  const [main, fresh, top, peak, best] = await env.DB.batch(stmts);
  const m = main.results[0] || {};
  return {
    n: m.n || 0, done: m.done || 0, revenue: m.revenue || 0, canceled: m.canceled || 0, lost: m.lost || 0,
    delivery: m.delivery || 0, pickup: m.pickup || 0, dtime: m.dtime || 0, clients: m.clients || 0,
    fresh: (fresh.results[0] || {}).c || 0,
    top: top.results || [],
    peak: peak.results[0] || null,
    best: best && best.results[0] ? { day: best.results[0].d * DAY - TZ_OFFSET, sum: best.results[0].s } : null
  };
}

function delta(cur, prev) {
  if (!prev) return ''; // в прошлом периоде продаж не было — сравнивать не с чем
  const p = Math.round(((cur - prev) / prev) * 100);
  return p > 0 ? `▲ ${p}%` : p < 0 ? `▼ ${-p}%` : '= 0%';
}

export function statsText(L, title, sub, s, cmp) {
  const X = T[L];
  const out = [`📊 <b>${title}</b>${sub ? ' · ' + sub : ''}`, ''];
  if (!s.n) {
    out.push(X.noOrders);
    if (cmp && cmp.s.revenue) out.push(`(${cmp.label}: ${X.sum(cmp.s.revenue)})`);
    return out.join('\n');
  }
  const d = cmp ? delta(s.revenue, cmp.s.revenue) : '';
  out.push(`💰 ${X.revenue}: <b>${X.sum(s.revenue)}</b>${d ? `  ${X.vs(d, cmp.label)}` : ''}`);
  const active = s.n - s.done - s.canceled;
  const parts = [X.doneN(s.done)];
  if (s.canceled) parts.push(X.canceledN(s.canceled));
  if (active > 0) parts.push(X.activeN(active));
  out.push(`🧾 ${X.orders}: <b>${s.n}</b> (${parts.join(' · ')})`);
  if (s.done) {
    out.push(`🛵 ${X.delivery} ${s.delivery} · 🛍️ ${X.pickup} ${s.pickup}`);
    out.push(`🧮 ${X.avg}: ${X.sum(s.revenue / s.done)}`);
  }
  if (s.dtime) out.push(`⏱ ${X.deliveryTime}: ${Math.round(s.dtime / 60000)} ${X.min}`);
  if (s.clients) out.push(`👥 ${X.clients}: ${s.clients}${s.fresh ? ` (${X.newClients(s.fresh)})` : ''}`);
  if (s.peak && s.peak.c > 1) out.push(`🕖 ${X.peak}: ${String(s.peak.hour).padStart(2, '0')}:00–${String((s.peak.hour + 1) % 24).padStart(2, '0')}:00 (${X.ordersShort(s.peak.c)})`);
  if (s.canceled) out.push(`❌ ${X.canceledN(s.canceled)}: ${X.sum(s.lost)} ${X.lost}`);
  if (s.best) out.push(`📅 ${X.bestDay}: ${X.weekday(local(s.best.day).getUTCDay())} ${ddmm(s.best.day)} — ${X.sum(s.best.sum)}`);
  if (s.top.length) out.push(`🏆 ${X.top}: ${s.top.map((x) => `${h(x.dish)} ×${x.qty}`).join(', ')}`);
  return out.join('\n');
}

/* ---------- /stats: текущие периоды «на сейчас» ---------- */

export const STAT_PERIODS = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'];

export async function liveStats(env, L, period, now = Date.now()) {
  const X = T[L];
  const today = periodStart('day', now);
  let start, end = now, sub = '';
  if (period === 'yesterday') { [start, end] = prevPeriod('day', today); sub = `${X.weekday(local(start).getUTCDay())}, ${ddmm(start)}`; }
  else if (period === 'week') { start = periodStart('week', now); sub = `${ddmm(start)} – ${ddmm(now)}`; }
  else if (period === 'month') { start = periodStart('month', now); sub = `${X.month(local(start).getUTCMonth())} ${local(start).getUTCFullYear()}`; }
  else if (period === 'quarter') { start = periodStart('quarter', now); sub = X.quarterN(Math.floor(local(start).getUTCMonth() / 3) + 1, local(start).getUTCFullYear()); }
  else if (period === 'year') { start = periodStart('year', now); sub = String(local(start).getUTCFullYear()); }
  else { period = 'today'; start = today; sub = `${X.weekday(local(now).getUTCDay())}, ${ddmm(now)}`; }
  const s = await collect(env, start, end, { bestDay: !['today', 'yesterday'].includes(period) });
  return statsText(L, X.statsTitle[period], sub, s);
}

export function statsKeyboard(L, active) {
  const X = T[L];
  const btn = (p) => ({ text: (p === active ? '• ' : '') + X.statBtn[p], callback_data: `st:${p}` });
  return { inline_keyboard: [STAT_PERIODS.slice(0, 3).map(btn), STAT_PERIODS.slice(3).map(btn)] };
}

/* ---------- сводки за прошедший период ---------- */

export async function reportText(env, L, kind, start, end) {
  const X = T[L];
  const s = await collect(env, start, end, { bestDay: kind !== 'day' });
  const d = local(start);
  let sub, cmp;
  if (kind === 'day') {
    sub = `${X.weekdayFull(d.getUTCDay())}, ${ddmm(start, true)}`;
    // День сравниваем с тем же днём недели неделю назад — так принято в общепите
    const prev = await collect(env, start - 7 * DAY, end - 7 * DAY);
    cmp = { s: prev, label: `${X.weekday(d.getUTCDay())} ${ddmm(start - 7 * DAY)}` };
  } else {
    if (kind === 'week') sub = `${ddmm(start)} – ${ddmm(end - 1, true)}`;
    else if (kind === 'month') sub = `${X.month(d.getUTCMonth())} ${d.getUTCFullYear()}`;
    else if (kind === 'quarter') sub = X.quarterN(Math.floor(d.getUTCMonth() / 3) + 1, d.getUTCFullYear());
    else sub = String(d.getUTCFullYear());
    const [ps, pe] = prevPeriod(kind, start);
    cmp = { s: await collect(env, ps, pe), label: X.prevLabel[kind] };
  }
  return statsText(L, X.reportTitle[kind], sub, s, cmp);
}
