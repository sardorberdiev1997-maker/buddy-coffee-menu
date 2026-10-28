// Раз в минуту (Cron Trigger воркера buddy-cron): напоминания о неподтверждённых заказах,
// повторная отправка в группу, сводки в 00:00 по Ташкенту, удаление личных данных через 90 дней.
// Всё идемпотентно — лишний вызов ничего не дублирует.
import { continueBroadcasts } from './broadcast.js';
import { claimKV, getKV, parseOrder, setKV } from './db.js';
import { sendGroup, UNDO_WINDOW } from './orders.js';
import { reportText } from './stats.js';
import { T } from './texts.js';
import { groupChat, groupLang, tg } from './tg.js';
import { DAY, dayKey, HOUR, MIN, periodStart, prevPeriod } from './util.js';

const REMIND = [3 * MIN, 10 * MIN]; // первое и второе напоминание
const REPORT_GRACE = 6 * HOUR; // сводку за период отправляем не позже 6 часов после его конца
const KEEP_PERSONAL = 90 * DAY;

export async function tick(env, now = Date.now()) {
  const last = parseInt((await getKV(env, 'tick_at')) || '0', 10);
  if (now - last < 30 * 1000) return { skipped: true };
  await setKV(env, 'tick_at', now);

  const done = { resent: 0, reminded: 0, reports: [], cleaned: 0 };
  const group = await groupChat(env);
  if (env.BOT_TOKEN && group) {
    const L = await groupLang(env);

    // 1. Заказы, которые не дошли до группы (Telegram был недоступен)
    // Старше минуты — чтобы не задвоить заказ, который ещё отправляется сразу после оформления
    const lost = (await env.DB.prepare("SELECT * FROM orders WHERE group_msg IS NULL AND status != 'canceled' AND created_at > ? AND created_at < ? ORDER BY id LIMIT 10")
      .bind(now - 2 * HOUR, now - MIN).all()).results.map(parseOrder);
    for (const o of lost) { await sendGroup(env, o); done.resent++; }

    // 2. Напоминания: заказ не приняли за 3 и за 10 минут
    const waiting = (await env.DB.prepare("SELECT * FROM orders WHERE status = 'new' AND group_msg IS NOT NULL AND reminded < 2 AND created_at < ? ORDER BY id LIMIT 10")
      .bind(now - REMIND[0]).all()).results.map(parseOrder);
    for (const o of waiting) {
      const level = now - o.created_at >= REMIND[1] ? 2 : 1;
      if (o.reminded >= level) continue;
      await tg(env, 'sendMessage', {
        chat_id: o.group_chat, text: T[L].remind(o.id, Math.floor((now - o.created_at) / MIN)), parse_mode: 'HTML',
        reply_parameters: { message_id: o.group_msg, allow_sending_without_reply: true }
      });
      await env.DB.prepare('UPDATE orders SET reminded = ? WHERE id = ?').bind(level, o.id).run();
      done.reminded++;
    }

    // 3. Через 15 минут после «Доставлен / Выдан / Отменён» кнопка «Шаг назад» больше не нужна — убираем
    const closed = (await env.DB.prepare("SELECT id, group_chat, group_msg FROM orders WHERE status IN ('delivered', 'picked', 'canceled') AND group_msg IS NOT NULL AND done_at >= ? AND done_at < ? LIMIT 20")
      .bind(now - UNDO_WINDOW - 3 * MIN, now - UNDO_WINDOW).all()).results;
    for (const o of closed) {
      await tg(env, 'editMessageReplyMarkup', { chat_id: o.group_chat, message_id: o.group_msg, reply_markup: { inline_keyboard: [] } });
      done.closed = (done.closed || 0) + 1;
    }

    // 4. Рассылка акций: следующая порция получателей
    done.broadcast = await continueBroadcasts(env);

    // 5. Сводки за закончившиеся день, неделю, месяц, квартал и год
    for (const kind of ['day', 'week', 'month', 'quarter', 'year']) {
      const end = periodStart(kind, now);
      if (now - end > REPORT_GRACE) continue;
      const [start] = prevPeriod(kind, end);
      const key = `report:${kind}:${dayKey(start)}`;
      if (!(await claimKV(env, key, now))) continue;
      const r = await tg(env, 'sendMessage', { chat_id: group, text: await reportText(env, L, kind, start, end), parse_mode: 'HTML', disable_notification: true });
      if (r.ok) done.reports.push(kind);
      else await setKV(env, key, null); // Telegram не ответил — повторим на следующей минуте
    }
  }

  // 6. В заказах личные данные (адрес, точка, комментарий, имя, телефон) храним 90 дней; имя и телефон остаются в базе клиентов
  if (await claimKV(env, `cleanup:${dayKey(now)}`, now)) {
    const r = await env.DB.prepare(`UPDATE orders SET name = NULL, phone = NULL, address = NULL, lat = NULL, lng = NULL, acc = NULL,
        comment = NULL, ip_hash = NULL, tg_user = NULL, tg_chat = NULL, tg_msg = NULL, anonymized = 1 WHERE anonymized = 0 AND created_at < ?`)
      .bind(now - KEEP_PERSONAL).run();
    done.cleaned = (r.meta && r.meta.changes) || 0;
  }
  return done;
}
