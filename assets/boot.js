// Выбор языка до первой отрисовки. Меню в HTML собрано на узбекском:
// если нужен русский, прячем его до перерисовки в app.js (страховка в CSS — показать через 2,5 с).
(function () {
  var l = new URLSearchParams(location.search).get('lang');
  if (l !== 'uz' && l !== 'ru') { try { l = localStorage.getItem('buddy-menu:lang'); } catch (e) { l = null; } }
  if (l !== 'uz' && l !== 'ru') l = /^ru\b/i.test(navigator.language || '') ? 'ru' : 'uz';
  document.documentElement.setAttribute('data-lang', l);
  document.documentElement.classList.add('js');
  if (l !== 'uz') document.documentElement.classList.add('is-booting');

  // Сайт открыт как Telegram Mini App — подключаем скрипт Telegram (обычным посетителям он не нужен)
  if (/tgWebApp/.test(location.hash) || /[?&]tg=1\b/.test(location.search)) {
    var s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js?59';
    s.onload = function () { document.dispatchEvent(new Event('tg-ready')); };
    document.head.appendChild(s);
  }
})();
