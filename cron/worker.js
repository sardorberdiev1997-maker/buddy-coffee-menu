// Воркер buddy-cron: раз в минуту будит сервер заказов (у Cloudflare Pages нет своего расписания).
// Сам он ничего не хранит и секретов не знает: /api/tick идемпотентный — лишний вызов ничего не дублирует.
// Код вставлен в редактор воркера в панели Cloudflare; расписание — Settings → Triggers → Cron: * * * * *
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch('https://buddycoffee.uz/api/tick', { method: 'POST', headers: { 'user-agent': 'buddy-cron' } }));
  },
  async fetch() {
    return new Response('buddy-cron: ok');
  }
};
