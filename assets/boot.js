// Выбор языка до первой отрисовки. Меню в HTML собрано на узбекском:
// если нужен русский, прячем его до перерисовки в app.js (страховка в CSS — показать через 2,5 с).
(function () {
  // Сайт переехал на buddycoffee.uz: со старого адреса (напечатанные QR, ссылки) и с www — туда же,
  // с той же страницей и параметрами. Mini App не уводим: с Bot API 10.2 (июль 2026) Telegram отключает
  // свои методы у Mini App, ушедшего на другой домен, — кнопки «Menyu» в старых сообщениях работают на старом адресе
  var inTg = /tgWebApp/.test(location.hash) || /[?&]tg=1\b/.test(location.search);
  if (/^(buddy\.cheking\.uz|www\.buddycoffee\.uz)$/.test(location.hostname) && !inTg) {
    location.replace('https://buddycoffee.uz' + location.pathname + location.search + location.hash);
    return;
  }
  var l = new URLSearchParams(location.search).get('lang');
  if (l !== 'uz' && l !== 'ru') { try { l = localStorage.getItem('buddy-menu:lang'); } catch (e) { l = null; } }
  if (l !== 'uz' && l !== 'ru') l = /^ru\b/i.test(navigator.language || '') ? 'ru' : 'uz';
  document.documentElement.setAttribute('data-lang', l);
  document.documentElement.classList.add('js');
  if (l !== 'uz') document.documentElement.classList.add('is-booting');

  // Ошибки JavaScript у посетителей — на сервер (без личных данных), видно в /api/tg/info.
  // Сетевые сбои мобильного интернета и чужие скрипты (расширения браузера) не шлём
  var sent = 0;
  function report(msg, src, line) {
    msg = String(msg || '');
    if (sent >= 3 || !msg || !navigator.sendBeacon || /Failed to fetch|NetworkError|Load failed|aborted|AbortError|Script error/i.test(msg)) return;
    if (src && String(src).indexOf(location.origin) !== 0) return;
    sent++;
    try {
      navigator.sendBeacon('/api/log', JSON.stringify({
        m: msg.slice(0, 300), s: String(src || '').replace(location.origin, '').split('?')[0], l: line || 0,
        p: location.pathname, tg: inTg
      }));
    } catch (e) { /* без сети — не страшно */ }
  }
  window.addEventListener('error', function (e) { report(e.message, e.filename, e.lineno); });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    report(r && r.message ? (r.name ? r.name + ': ' : '') + r.message : r, location.href, 0);
  });

  // Яндекс Метрика (счётчик 113975722, без Вебвизора): посещения, источники и цели cart / checkout / order.
  // Не на /order — в адресе токен заказа. В Mini App в #hash лежат данные Telegram (initData): скрипт Telegram
  // сохраняет их в sessionStorage, после него убираем их из адреса и только тогда грузим счётчик
  var YM = 113975722;
  var counted = !/^\/order/.test(location.pathname);
  function metrika() {
    if (/tgWebApp/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
    var m = document.createElement('script');
    m.async = true;
    m.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + YM;
    document.head.appendChild(m);
  }
  if (counted) {
    window.ym = function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    window.ym(YM, 'init', { ssr: true, clickmap: true, accurateTrackBounce: true, trackLinks: true, url: location.href.split('#')[0] });
  }
  // Цель Метрики; done — после отправки (или через секунду, если счётчик заблокирован), чтобы успеть до перехода
  window.buddyGoal = function (name, params, done) {
    var called = false;
    var fin = function () { if (!called) { called = true; if (done) done(); } };
    if (!window.ym) { fin(); return; }
    try { window.ym(YM, 'reachGoal', name, params || {}, fin); } catch (e) { fin(); return; }
    setTimeout(fin, 1000);
  };

  // Сайт открыт как Telegram Mini App — подключаем скрипт Telegram (обычным посетителям он не нужен)
  if (inTg) {
    var s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js?59';
    s.onload = function () {
      document.dispatchEvent(new Event('tg-ready'));
      if (counted) metrika();
    };
    document.head.appendChild(s);
  } else if (counted) metrika();
})();
