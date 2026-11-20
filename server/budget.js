// Лимиты бесплатного Cloudflare на один вызов: 50 запросов к D1 (db.batch — один запрос) и 50 запросов наружу.
// https://developers.cloudflare.com/d1/platform/limits/ и /workers/platform/limits/#subrequests
// Минутный tick делает много дел сразу (рассылка, просьбы об оценке, сводка, ночная чистка). Без счёта он в тяжёлую
// минуту упал бы посередине («Too many API requests by single Worker invocation»), поэтому необязательное
// откладываем на следующую минуту. Вне tick счётчика нет — там и лимит не проверяем.
export const LIMIT = 50;

export function metered(env) {
  const use = { db: 0, net: 0 };
  const wrap = (st) => ({
    stmt: st,
    bind: (...a) => wrap(st.bind(...a)),
    first: (...a) => { use.db++; return st.first(...a); },
    all: () => { use.db++; return st.all(); },
    run: () => { use.db++; return st.run(); },
    raw: (...a) => { use.db++; return st.raw(...a); }
  });
  const e = Object.create(env); // привязки (ASSETS, секреты) берутся из исходного env
  e.DB = {
    prepare: (q) => wrap(env.DB.prepare(q)),
    batch: (list) => { use.db++; return env.DB.batch(list.map((s) => s.stmt || s)); }
  };
  e.use = use;
  return e;
}

// Сколько обращений ещё можно сделать в этом вызове
export const left = (env) => (env.use ? LIMIT - Math.max(env.use.db, env.use.net) : Infinity);
export const countNet = (env) => { if (env.use) env.use.net++; };
