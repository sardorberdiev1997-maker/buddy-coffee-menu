// Оперативные переключатели из группы кафе — без Google Таблицы, в два нажатия:
//   /stop — стоп-лист: закончилось блюдо → нажали кнопку, и оно сразу «нет в наличии» на сайте и в Mini App.
//          Само возвращается в 06:00 по Ташкенту (утром продукты обычно привозят). Убрать надолго — «в_наличии: нет» в таблице.
//   /rush — «час пик»: сроки на сайте +15 или +30 минут и предупреждение покупателю, кнопки «принять» в группе
//          сдвигаются на столько же. Выключается сам через 3 часа, чтобы не забыли.
// Хранятся в D1 (kv), сайт получает их в /api/state, сервер учитывает стоп-лист при приёме заказа.
import { getKV, setKV } from './db.js';
import { T } from './texts.js';
import { tg } from './tg.js';
import { DAY, h, HOUR, hhmm, TZ_OFFSET } from './util.js';

export const RUSH_FOR = 3 * HOUR;
const MORNING = 6 * HOUR; // 06:00 по Ташкенту

const parse = (raw, fallback) => {
  try {
    return JSON.parse(raw) || fallback;
  } catch (e) {
    return fallback;
  }
};

// Ближайшие 06:00 по Ташкенту
export function nextMorning(now) {
  const day = Math.floor((now + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;
  return day + MORNING > now ? day + MORNING : day + DAY + MORNING;
}

/* ---------- стоп-лист ---------- */

// { key: { until, by } } — только действующие
export async function stopList(env, now = Date.now()) {
  const all = parse(await getKV(env, 'stoplist'), {});
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v && v.until > now));
}

// Модель меню с учётом стоп-листа (копия: закэшированную модель не трогаем)
export const withStop = (model, stop) => (Object.keys(stop).length
  ? { ...model, items: model.items.map((it) => (stop[it.key] ? { ...it, avail: false } : it)) }
  : model);

export async function toggleStop(env, key, by, now = Date.now()) {
  const all = await stopList(env, now);
  if (all[key]) delete all[key];
  else all[key] = { until: nextMorning(now), by };
  await setKV(env, 'stoplist', JSON.stringify(all));
  return all;
}

// Сообщение со списком блюд: 🚫 — сейчас нет. Только то, что есть в таблице (остальное и так скрыто)
export function stopView(model, stop, L) {
  const X = T[L];
  const items = model.items.filter((it) => it.avail && it.prices.length);
  const off = items.filter((it) => stop[it.key]);
  const text = off.length
    ? X.stopOn(off.map((it) => h(it[L] || it.uz)), hhmm(Math.min(...off.map((it) => stop[it.key].until))))
    : X.stopEmpty;
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2).map((it) => ({ text: `${stop[it.key] ? '🚫 ' : ''}${it[L] || it.uz}`, callback_data: `sl:${it.key}`.slice(0, 64) })));
  }
  rows.push([{ text: X.stopDone, callback_data: 'sl_done' }]);
  return { text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };
}

/* ---------- час пик ---------- */

export async function rushState(env, now = Date.now()) {
  const r = parse(await getKV(env, 'rush'), null);
  return r && r.until > now ? r : null;
}

export async function setRush(env, add, by, now = Date.now()) {
  await setKV(env, 'rush', add ? JSON.stringify({ add, until: now + RUSH_FOR, by }) : null);
  return add ? { add, until: now + RUSH_FOR, by } : null;
}

export function rushView(rush, L) {
  const X = T[L];
  const btn = (add) => ({ text: `${rush && rush.add === add ? '✅ ' : ''}+${add} ${X.min}`, callback_data: `rush:${add}` });
  const rows = [[btn(15), btn(30)]];
  if (rush) rows.push([{ text: X.rushOff, callback_data: 'rush:0' }]);
  return { text: rush ? X.rushOn(rush.add, hhmm(rush.until)) : X.rushIdle, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };
}

/* ---------- кнопки в группе: sl:<блюдо>, sl_done, rush:<минуты> ---------- */

export async function onLiveButton(env, q, data, model, L, by) {
  const msg = q.message;
  const answer = (text) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text });
  const edit = (view) => tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, ...view });
  const X = T[L];
  if (data === 'sl_done') {
    const view = stopView(model, await stopList(env), L);
    await edit({ text: view.text, parse_mode: 'HTML' });
    return answer();
  }
  if (data.startsWith('sl:')) {
    const key = data.slice(3);
    const it = model.items.find((x) => x.key === key);
    if (!it) return answer();
    const stop = await toggleStop(env, key, by);
    await edit(stopView(model, stop, L));
    return answer(stop[key] ? X.stopAdded(it[L] || it.uz) : X.stopRemoved(it[L] || it.uz));
  }
  if (data.startsWith('rush:')) {
    const add = [15, 30].includes(Number(data.slice(5))) ? Number(data.slice(5)) : 0;
    const rush = await setRush(env, add, by);
    await edit(rushView(rush, L));
    return answer(rush ? `🔥 +${add}` : X.rushOffOk);
  }
  return answer();
}
