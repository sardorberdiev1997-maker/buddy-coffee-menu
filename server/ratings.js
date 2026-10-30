// Оценка заказа и просьба об отзыве — как у сервисов доставки:
// • просим не у двери, а через 45 минут после доставки (успели поесть): одно тихое сообщение,
//   одному человеку не чаще раза в сутки, давние заказы не трогаем;
// • сначала своя оценка 1–5. Низкая (1–3) сразу уходит администратору с причиной и комментарием —
//   шанс извиниться и исправить, пока гость не ушёл к конкурентам;
// • ссылки на Google, Яндекс и 2ГИС видят все, при любой оценке: звать на карты только довольных
//   запрещают правила Google («selectively solicit positive reviews»), вознаграждение за отзыв — тоже;
// • те же оценка, причины и ссылки — на странице заказа на сайте (для тех, кто не в Telegram).
import { callButton } from './call.js';
import { getKV, orderById, orderByToken, parseOrder, setKV } from './db.js';
import { loadModel, OC, R, setting } from './menu.js';
import { C, T } from './texts.js';
import { groupChat, groupLang, tg } from './tg.js';
import { DAY, h, HOUR, MIN, SITE } from './util.js';

const ASK_AFTER = 45 * MIN;
const ASK_UNTIL = DAY;           // заказ старше суток — уже не спрашиваем (например, cron стоял)
const ASK_GAP = 20 * HOUR;       // одному человеку — не чаще раза в сутки
const RATE_FOR = 7 * DAY;        // оценить или изменить оценку можно неделю после выполнения
const WRITE_FOR = 30 * MIN;      // ждём текст комментария после кнопки «Написать»
export const LOW = 3;            // 1–3 — низкая оценка
const SITES = [['google', 'отзыв_google', 'Google', 'Google'], ['yandex', 'отзыв_yandex', 'Yandex', 'Яндекс'], ['2gis', 'отзыв_2gis', '2GIS', '2ГИС']];

// Площадки, для которых в «Настройках» есть ссылка (кнопки ведут на короткие ссылки /r/…)
export const reviewSites = (model) => SITES.filter(([, key]) => R.safeUrl(setting(model, key, 'ru'))).map(([k]) => k);
const siteButtons = (sites, L) => sites.map((k) => {
  const s = SITES.find((x) => x[0] === k);
  return { text: '⭐ ' + s[L === 'ru' ? 3 : 2], url: `${SITE}r/${k}` };
});

export const canRate = (o, now = Date.now()) => OC.DONE.includes(o.status) && !!o.done_at && now - o.done_at < RATE_FOR;
export const ratingOf = (env, id) => env.DB.prepare('SELECT * FROM ratings WHERE order_id = ?').bind(id).first();
export const publicRating = (r) => (r && r.stars ? { stars: r.stars, reason: r.reason || null, comment: !!r.comment } : null);

// Сохранить оценку, причину или комментарий (что пришло). Низкая оценка — сообщение в группу
export async function saveRating(env, o, { stars, reason, comment, source }) {
  const prev = await ratingOf(env, o.id);
  const s = stars || (prev && prev.stars);
  if (!s) return null; // причина без оценки не имеет смысла
  const why = reason && OC.RATE_REASONS[reason] ? reason : null;
  const text = comment ? String(comment).trim().slice(0, 500) : null;
  await env.DB.prepare(`INSERT INTO ratings (order_id, stars, reason, comment, source, rated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET stars = excluded.stars, reason = COALESCE(excluded.reason, reason),
        comment = COALESCE(excluded.comment, comment), source = excluded.source, rated_at = excluded.rated_at`)
    .bind(o.id, s, why, text || null, source, Date.now()).run();
  const r = await ratingOf(env, o.id);
  await alertGroup(env, o, r);
  return r;
}

// Низкая оценка — администратору (ответом на сообщение заказа). Дальше то же сообщение дополняется
// причиной и комментарием; если гость поднял оценку — так и пишем
async function alertGroup(env, o, r) {
  if (r.stars > LOW && !r.alert_msg) return;
  const group = await groupChat(env);
  if (!group) return;
  const L = await groupLang(env);
  const text = T[L].rateAlert({
    n: o.id, stars: r.stars, raised: r.stars > LOW,
    reason: r.reason ? OC.RATE_REASONS[r.reason][L] : '', comment: r.comment ? h(r.comment) : '',
    who: [o.name && h(o.name), o.phone && OC.fmtPhone(o.phone)].filter(Boolean).join(' · ')
  });
  const reply_markup = callButton(o, L) && !(r.stars > LOW) ? { inline_keyboard: [callButton(o, L)] } : undefined;
  if (r.alert_msg) {
    await tg(env, 'editMessageText', { chat_id: group, message_id: r.alert_msg, text, parse_mode: 'HTML', reply_markup });
    return;
  }
  const sent = await tg(env, 'sendMessage', {
    chat_id: group, text, parse_mode: 'HTML', reply_markup,
    reply_parameters: o.group_msg && String(o.group_chat) === String(group) ? { message_id: o.group_msg, allow_sending_without_reply: true } : undefined
  });
  if (sent.ok) await env.DB.prepare('UPDATE ratings SET alert_msg = ? WHERE order_id = ?').bind(sent.result.message_id, o.id).run();
}

// Оценка со страницы заказа на сайте
export async function rateBySite(env, token, body) {
  const o = await orderByToken(env, token);
  if (!o) return { status: 404, error: 'not_found' };
  if (!canRate(o)) return { status: 409, error: 'late' };
  const stars = body.stars == null ? undefined : Number(body.stars);
  if (stars !== undefined && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) return { status: 400, error: 'stars' };
  const r = await saveRating(env, o, { stars, reason: body.reason, comment: typeof body.comment === 'string' ? body.comment : '', source: 'site' });
  return r ? { rating: publicRating(r) } : { status: 400, error: 'stars' };
}

/* ---------- в Telegram ---------- */

const starsRow = (id) => [1, 2, 3, 4, 5].map((n) => ({ text: `${n} ⭐`, callback_data: `rt:${id}:${n}` }));

// Сообщение после оценки: спасибо, при низкой — причины и «Написать», и всем — ссылки на карты
function rateView(o, r, sites, L) {
  const X = C[L];
  const rows = [];
  let text;
  if (r.stars > LOW) text = X.rateHigh(r.stars, sites.length > 0);
  else if (!r.reason && !r.comment) {
    text = X.rateLow;
    const reasons = Object.keys(OC.RATE_REASONS).filter((k) => o.type === 'delivery' || k !== 'courier');
    for (let i = 0; i < reasons.length; i += 2) rows.push(reasons.slice(i, i + 2).map((k) => ({ text: OC.RATE_REASONS[k][L], callback_data: `rr:${o.id}:${k}` })));
  } else text = X.rateLowDone(sites.length > 0);
  if (r.stars <= LOW && !r.comment) rows.push([{ text: X.rateWriteBtn, callback_data: `rw:${o.id}` }]);
  if (sites.length) rows.push(siteButtons(sites, L));
  rows.push([{ text: X.rateChange, callback_data: `rc:${o.id}` }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

// Из /api/tick: попросить оценку у тех, кому доставили 45 минут – сутки назад
export async function askRatings(env, now = Date.now()) {
  const rows = (await env.DB.prepare(`SELECT o.* FROM orders o LEFT JOIN ratings r ON r.order_id = o.id
      WHERE o.status IN ('delivered', 'picked') AND o.tg_chat IS NOT NULL AND r.order_id IS NULL
        AND o.done_at <= ? AND o.done_at > ? ORDER BY o.done_at LIMIT 10`).bind(now - ASK_AFTER, now - ASK_UNTIL).all()).results.map(parseOrder);
  let asked = 0;
  for (const o of rows) {
    const recent = await env.DB.prepare(`SELECT 1 FROM ratings r JOIN orders o ON o.id = r.order_id
        WHERE o.tg_chat = ? AND r.asked_at > ? LIMIT 1`).bind(o.tg_chat, now - ASK_GAP).first();
    // Строку вставляем до отправки: параллельный tick её уже не возьмёт. asked_at = 0 — решили не спрашивать
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO ratings (order_id, asked_at, source) VALUES (?, ?, ?)').bind(o.id, recent ? 0 : now, 'tg').run();
    if (recent || !(claim.meta && claim.meta.changes)) continue;
    const L = o.lang === 'ru' ? 'ru' : 'uz';
    const res = await tg(env, 'sendMessage', {
      chat_id: o.tg_chat, text: C[L].rateAsk(o.id), parse_mode: 'HTML', disable_notification: true,
      reply_markup: { inline_keyboard: [starsRow(o.id)] }
    });
    if (res.ok) asked++;
  }
  return asked;
}

// Кнопки под просьбой об оценке: rt — звёзды, rr — причина, rw — «Написать», rc — изменить оценку
export async function onRateButton(env, q, kind, idStr, arg) {
  const answer = (text) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text });
  const msg = q.message;
  const o = await orderById(env, parseInt(idStr, 10));
  if (!o || msg.chat.type !== 'private' || String(o.tg_chat) !== String(msg.chat.id)) return answer();
  const L = o.lang === 'ru' ? 'ru' : 'uz';
  const X = C[L];
  if (!canRate(o)) return answer(X.rateLate);
  const edit = (view) => tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', ...view });

  if (kind === 'rc') {
    await edit({ text: C[L].rateAsk(o.id), reply_markup: { inline_keyboard: [starsRow(o.id)] } });
    return answer();
  }
  if (kind === 'rw') {
    if (!(await ratingOf(env, o.id))?.stars) return answer();
    await setKV(env, `fb:${msg.chat.id}`, `${o.id}:${Date.now()}`);
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: X.rateWrite, reply_markup: { force_reply: true, input_field_placeholder: X.rateWritePh } });
    return answer();
  }
  const stars = kind === 'rt' ? Math.min(5, Math.max(1, parseInt(arg, 10) || 5)) : undefined;
  const r = await saveRating(env, o, { stars, reason: kind === 'rr' ? arg : undefined, source: 'tg' });
  if (!r) return answer();
  await edit(rateView(o, r, reviewSites(await loadModel(env)), L));
  return answer(kind === 'rt' ? '⭐'.repeat(r.stars) : '🙏');
}

// Текст после «Написать» — комментарий к оценке. true — сообщение наше, дальше не разбирать
export async function takeComment(env, m) {
  const key = `fb:${m.chat.id}`;
  const wait = await getKV(env, key);
  if (!wait || !m.text) return false;
  const [id, at] = wait.split(':').map(Number);
  await setKV(env, key, null);
  if (Date.now() - at > WRITE_FOR) return false;
  const o = await orderById(env, id);
  if (!o || !canRate(o)) return false;
  await saveRating(env, o, { comment: m.text, source: 'tg' });
  const L = o.lang === 'ru' ? 'ru' : 'uz';
  await tg(env, 'sendMessage', { chat_id: m.chat.id, text: C[L].rateCommentOk });
  return true;
}
