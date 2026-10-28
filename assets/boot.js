// Выбор языка до первой отрисовки. Меню в HTML собрано на узбекском:
// если нужен русский, прячем его до перерисовки в app.js (страховка в CSS — показать через 2,5 с).
(function () {
  var l = new URLSearchParams(location.search).get('lang');
  if (l !== 'uz' && l !== 'ru') { try { l = localStorage.getItem('buddy-menu:lang'); } catch (e) { l = null; } }
  if (l !== 'uz' && l !== 'ru') l = /^ru\b/i.test(navigator.language || '') ? 'ru' : 'uz';
  document.documentElement.setAttribute('data-lang', l);
  if (l !== 'uz') document.documentElement.classList.add('is-booting');
})();
