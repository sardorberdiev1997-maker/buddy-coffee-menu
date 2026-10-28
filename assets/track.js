/* Страница статуса заказа: /order?t=<токен>. Обновляется сама, пока заказ не завершён. */
(() => {
  'use strict';

  const R = window.MenuRender;
  const OC = window.OrderCore;
  const CONFIG = window.MENU_CONFIG || {};
  const LANG_KEY = 'buddy-menu:lang';
  const CART_KEY = 'buddy-menu:cart';
  const POLL = 8000;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = R.esc;
  const icon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  const main = $('#track');
  const token = new URLSearchParams(location.search).get('t') || '';
  const home = /[?&]tg=1\b/.test(location.search) ? '/?tg=1' : '/'; // внутри Telegram остаёмся в Mini App

  let lang = 'uz';
  let order = null;
  let failCount = 0;
  let timer = 0;
  let lastStatus = '';
  let updatedAt = 0;
  let busy = false;

  function storage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  function t(key, ...args) {
    let v = OC.UI[lang] && OC.UI[lang][key];
    if (v == null) v = (R.UI[lang] && R.UI[lang][key]);
    if (v == null) v = OC.UI.uz[key] != null ? OC.UI.uz[key] : R.UI.uz[key];
    return typeof v === 'function' ? v(...args) : (v == null ? key : v);
  }
  const money = (n) => `${R.fmt(n)} ${t('currency')}`;
  const time = (ms) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }).format(new Date(ms));

  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl === 'uz' || fromUrl === 'ru') return fromUrl;
    const saved = storage((s) => s.getItem(LANG_KEY));
    if (saved === 'uz' || saved === 'ru') return saved;
    return /^ru\b/i.test(navigator.language || '') ? 'ru' : 'uz';
  }

  function applyLang() {
    document.documentElement.lang = lang === 'uz' ? 'uz-Latn' : 'ru';
    document.documentElement.dataset.lang = lang;
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    $('.lang').dataset.active = lang;
    document.title = `Buddy Coffee — ${order ? t('orderN', order.number) : t('yourOrder')}`;
  }

  /* ---------- разметка ---------- */

  function stepsHTML(o) {
    const flow = OC.FLOW[o.type] || OC.FLOW.delivery;
    const at = {};
    (o.history || []).forEach((h) => { at[h.s] = h.t; });
    const cur = flow.indexOf(o.status) + (OC.DONE.includes(o.status) ? 1 : 0); // завершённый заказ — все шаги пройдены
    return `<ol class="steps">${flow.map((s, i) => {
      const state = i < cur ? 'done' : i === cur ? 'now' : 'next';
      return `<li class="steps__item is-${state}"${state === 'now' ? ' aria-current="step"' : ''}>
        <span class="steps__dot" aria-hidden="true">${state === 'done' ? '✓' : ''}</span>
        <span class="steps__name">${esc(OC.STATUS[s][lang])}</span>
        ${at[s] ? `<span class="steps__time">${time(at[s])}</span>` : ''}
      </li>`;
    }).join('')}</ol>`;
  }

  // Оценка и отзыв: сначала своя оценка 1–5, затем всем, при любой оценке, — ссылки на карты
  // (просить отзыв только у довольных запрещают правила Google). Низкую оценку с причиной видит администратор
  const SITE_NAMES = { google: ['Google', 'Google'], yandex: ['Yandex', 'Яндекс'], '2gis': ['2GIS', '2ГИС'] };
  const rate = { editing: false, reason: null, busy: false, error: false };

  function rateHTML(o) {
    const r = !rate.editing && o.rating;
    const low = r && r.stars <= 3;
    const asking = low && !r.reason && !r.comment;
    const sites = (o.review || []).filter((k) => SITE_NAMES[k]).map((k) =>
      `<a class="rate__btn" href="/r/${k}" target="_blank" rel="noopener">${icon('i-star')}${esc(SITE_NAMES[k][lang === 'ru' ? 1 : 0])}</a>`).join('');
    const title = !r ? t('rateAsk') : !low ? t('rateHigh') : asking ? t('rateLow') : t('rateDone');
    const text = !r ? t('rateAskText') : !low ? (sites ? t('rateHighText') : '') : asking ? t('rateLowText') : '';
    const reasons = Object.keys(OC.RATE_REASONS).filter((k) => o.type === 'delivery' || k !== 'courier');
    return `<section class="rate track__rate" aria-labelledby="rate-title">
        <h2 class="rate__title" id="rate-title" tabindex="-1">${esc(title)}</h2>
        ${text ? `<p class="rate__text">${esc(text)}</p>` : ''}
        <div class="rate__pick" role="group" aria-label="${esc(t('rateAsk'))}">${[1, 2, 3, 4, 5].map((n) =>
          `<button type="button" class="rate__star${r && r.stars >= n ? ' is-on' : ''}" data-stars="${n}" aria-label="${esc(t('starN', n))}" aria-pressed="${!!r && r.stars === n}"${r || rate.busy ? ' disabled' : ''}>${icon('i-star-o')}</button>`).join('')}</div>
        ${asking ? `<form class="rate__why" data-why>
          <div class="rate__reasons">${reasons.map((k) =>
            `<button type="button" class="rate__chip" data-reason="${k}" aria-pressed="${rate.reason === k}">${esc(OC.RATE_REASONS[k][lang])}</button>`).join('')}</div>
          <textarea class="rate__note" name="comment" maxlength="500" rows="2" placeholder="${esc(t('ratePh'))}" aria-label="${esc(t('ratePh'))}"></textarea>
          <button type="submit" class="rate__send"${rate.busy ? ' disabled' : ''}>${esc(t('rateSend'))}</button>
        </form>` : ''}
        ${rate.error ? `<p class="rate__err" role="alert">${esc(t('rateFail'))}</p>` : ''}
        ${r && sites ? `${low ? `<p class="rate__text">${esc(t('rateMaps'))}</p>` : ''}<div class="rate__actions">${sites}</div>` : ''}
        ${r ? `<button type="button" class="link rate__change" data-rate-change>${esc(t('rateChange'))}</button>` : ''}
      </section>`;
  }

  async function sendRate(payload) {
    if (rate.busy) return;
    rate.busy = true;
    rate.error = false;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}/rate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.rating) throw new Error('HTTP ' + res.status);
      order.rating = j.rating;
      rate.editing = false;
      rate.reason = null;
    } catch (e) {
      rate.error = true;
    }
    rate.busy = false;
    render();
    const title = $('#rate-title');
    if (title) title.focus({ preventScroll: true });
  }

  function render() {
    const o = order;
    const st = OC.STATUS[o.status] || OC.STATUS.new;
    const canceled = o.status === 'canceled';
    const final = OC.FINAL.includes(o.status);
    const delivery = o.type === 'delivery';
    const phone = o.cafe && o.cafe.phone;
    const tel = phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : '';
    const bot = CONFIG.bot;
    const reason = o.cancel_reason && OC.CANCEL_REASONS[o.cancel_reason] ? OC.CANCEL_REASONS[o.cancel_reason][lang] : '';
    const addr = o.address ? [o.address.street, o.address.apt, o.address.landmark].filter(Boolean).join(', ') : '';

    main.innerHTML = `
      <section class="status${canceled ? ' status--canceled' : final ? ' status--done' : ''}" aria-labelledby="st-title">
        <p class="status__num">${esc(t('orderN', o.number))} · ${esc(t(delivery ? 'delivery' : 'pickup'))}</p>
        <div class="status__icon" aria-hidden="true">${st.icon}</div>
        <h1 class="status__title" id="st-title" tabindex="-1">${esc(st[lang])}</h1>
        <p class="status__text">${esc(t('st')[o.status] || '')}</p>
        ${reason ? `<p class="status__reason">${esc(t('reason'))}: ${esc(reason)}</p>` : ''}
        ${o.eta && !final ? `<p class="status__eta">${esc(t('etaAt', time(o.eta)))}</p>` : ''}
        ${!canceled ? stepsHTML(o) : ''}
        ${!final ? `<p class="status__auto"><span class="pulse" aria-hidden="true"></span>${esc(t('autoUpdate'))}</p>` : ''}
      </section>
      ${OC.DONE.includes(o.status) && (o.can_rate || o.rating) ? rateHTML(o) : ''}

      <div class="track__actions">
        ${!final && bot ? (o.tg
          ? `<p class="track__tg">${icon('i-tg')}${esc(t('tgOn'))}</p>`
          : `<a class="cta cta--tg" href="https://t.me/${esc(bot)}?start=o_${esc(token)}" target="_blank" rel="noopener">${icon('i-tg')}${esc(t('tgFollow'))}</a>`) : ''}
        ${tel ? `<a class="cta cta--ghost" href="${esc(tel)}">${icon('i-phone')}${esc(t('callCafe'))}</a>` : ''}
        ${final ? `<button type="button" class="cta" data-repeat>${icon('i-repeat')}${esc(t('repeatOrder'))}</button>` : ''}
      </div>

      <section class="track__card" aria-labelledby="ord-title">
        <h2 class="cart__h" id="ord-title">${esc(t('yourOrder'))}</h2>
        <ul class="track__items">${o.items.map((it) => `<li>
          <span class="track__qty">${it.qty}×</span>
          <span class="track__name">${esc(it[lang] || it.uz)}${it['size_' + lang] ? ` <small>${esc(it['size_' + lang])}</small>` : ''}
            ${it.note ? `<small class="track__note">${icon('i-chat')}${esc(it.note)}</small>` : ''}</span>
          <b>${esc(money(it.sum))}</b></li>`).join('')}</ul>
        <dl class="totals">
          ${delivery ? `<div><dt>${esc(t('deliveryCost'))}</dt><dd class="totals__free">${esc(t('free'))}</dd></div>` : ''}
          <div class="totals__sum"><dt>${esc(t('total'))}</dt><dd>${esc(money(o.total))}</dd></div>
        </dl>
      </section>

      <section class="track__card" aria-labelledby="det-title">
        <h2 class="cart__h" id="det-title">${esc(t('details'))}</h2>
        <dl class="track__dl">
          <div><dt>${esc(t('payment'))}</dt><dd>${esc(t(o.payment === 'card' ? 'card' : 'cash'))}${o.change ? ` · ${esc(t('changeFrom', money(o.change)))}` : ''}</dd></div>
          ${delivery ? `<div><dt>${esc(t('address'))}</dt><dd>${esc(addr)}${o.geo ? ` · ${icon('i-pin')}` : ''}</dd></div>` : `<div><dt>${esc(t('pickupFrom'))}</dt><dd>${esc((o.cafe && o.cafe.address) || '')}${o.cafe && o.cafe.map ? ` · <a href="${esc(o.cafe.map)}" target="_blank" rel="noopener">${esc(t('route'))}</a>` : ''}</dd></div>`}
          ${o.comment ? `<div><dt>${esc(t('orderNote'))}</dt><dd>${esc(o.comment)}</dd></div>` : ''}
          <div><dt>${esc(t('name'))}</dt><dd>${esc(o.name || '')}${o.phone ? ` · ${esc(o.phone)}` : ''}</dd></div>
          <div><dt>${esc(t('placed'))}</dt><dd>${time(o.created)}</dd></div>
        </dl>
        ${o.status === 'new' ? `<button type="button" class="link track__cancel" data-cancel>${esc(t('cancel'))}</button>` : ''}
      </section>

      <p class="track__upd" id="upd">${updatedAt ? esc(t('updated', time(updatedAt))) : ''}</p>
      <p class="track__back"><a class="link" href="${home}">${icon('i-back')}${esc(t('toMenu'))}</a></p>`;
    applyLang();
  }

  function renderMessage(title, text, retry) {
    main.innerHTML = `<section class="status status--canceled">
        <div class="status__icon" aria-hidden="true">🔎</div>
        <h1 class="status__title" tabindex="-1">${esc(title)}</h1>
        <p class="status__text">${esc(text)}</p>
        ${retry ? `<button type="button" class="cta" data-retry>${esc(t('retry'))}</button>` : ''}
      </section>
      <p class="track__back"><a class="link" href="${home}">${icon('i-back')}${esc(t('toMenu'))}</a></p>`;
    applyLang();
  }

  /* ---------- данные ---------- */

  async function load() {
    clearTimeout(timer);
    if (!token) { renderMessage(t('notFound'), t('notFoundText')); return; }
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.status === 404) { renderMessage(t('notFound'), t('notFoundText')); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const o = await res.json();
      failCount = 0;
      updatedAt = Date.now();
      const changed = !order || o.status !== lastStatus;
      order = o;
      if (changed || !$('.status', main)) {
        render();
        if (lastStatus && changed) {
          $('#track-status').textContent = OC.STATUS[o.status][lang];
          const h = $('#st-title');
          if (h) h.focus({ preventScroll: true });
        }
      } else {
        const upd = $('#upd');
        if (upd) upd.textContent = t('updated', time(updatedAt));
      }
      lastStatus = o.status;
      if (!OC.FINAL.includes(o.status)) schedule(POLL);
    } catch (e) {
      failCount++;
      console.warn('[order]', e && e.message);
      // Нет связи или сбой отрисовки — не оставляем пустой экран
      if (!$('.status', main)) renderMessage(t('loadFail'), '', true);
      schedule(Math.min(60000, POLL * 2 ** failCount));
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (document.visibilityState === 'hidden') return; // вернёмся на вкладку — обновим сразу
    timer = setTimeout(load, ms);
  }

  async function cancel() {
    if (busy || !window.confirm(t('cancelAsk'))) return;
    busy = true;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok && d.error === 'late') window.alert(t('cancelLate'));
      else if (!res.ok) window.alert(t('errServer') + ' ' + ((order.cafe && order.cafe.phone) || ''));
    } catch (e) {
      window.alert(t('errOffline'));
    }
    busy = false;
    lastStatus = '';
    load();
  }

  // «Повторить заказ»: кладём позиции в корзину и открываем меню
  function repeat() {
    const lines = (order.items || []).filter((x) => x.key).map((x) => ({ key: x.key, size: x.size || 0, qty: x.qty, note: x.note || '' }));
    storage((s) => {
      const cur = JSON.parse(s.getItem(CART_KEY) || 'null') || {};
      s.setItem(CART_KEY, JSON.stringify({ type: order.type, ...cur, lines }));
    });
    location.href = home + '#cart';
  }

  /* ---------- start ---------- */

  function init() {
    R.crashGuard(t);
    lang = detectLang();
    applyLang();
    $$('.lang button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      storage((s) => s.setItem(LANG_KEY, lang));
      if (order) render(); else applyLang();
    }));
    main.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]')) cancel();
      else if (e.target.closest('[data-repeat]')) repeat();
      else if (e.target.closest('[data-retry]')) { failCount = 0; load(); }
      const star = e.target.closest('[data-stars]');
      if (star) sendRate({ stars: Number(star.dataset.stars) });
      const chip = e.target.closest('[data-reason]');
      if (chip) {
        rate.reason = rate.reason === chip.dataset.reason ? null : chip.dataset.reason;
        main.querySelectorAll('[data-reason]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.reason === rate.reason)));
      }
      if (e.target.closest('[data-rate-change]')) { rate.editing = true; render(); }
    });
    main.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-why]');
      if (!form) return;
      e.preventDefault();
      const comment = form.elements.comment.value.trim();
      sendRate({ stars: order.rating.stars, reason: rate.reason || (comment ? 'other' : null), comment });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!order || !OC.FINAL.includes(order.status))) load();
    });
    const net = $('#net');
    const upd = () => { net.hidden = navigator.onLine !== false; net.textContent = t('offline'); if (navigator.onLine && order && !OC.FINAL.includes(order.status)) load(); };
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    if (navigator.onLine === false) upd();
    // Telegram Mini App: та же страница внутри Telegram
    // Кнопка «Назад» Telegram ведёт в меню (иначе она осталась бы от корзины и ничего не делала)
    const tgInit = () => {
      const w = window.Telegram && window.Telegram.WebApp;
      if (!w || !w.initData) return;
      try {
        w.ready();
        w.expand();
        w.BackButton.show();
        w.BackButton.onClick(() => { location.href = home; });
        if (w.MainButton) w.MainButton.hide();
        if (typeof w.setHeaderColor === 'function') w.setHeaderColor('#E31B23');
      } catch (e) { /* старые версии Telegram */ }
      // Внешние ссылки — через Telegram: t.me открывает сам Telegram, остальные — браузер (Mini App не закрывается)
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[target="_blank"]');
        if (!a || typeof w.openLink !== 'function') return;
        e.preventDefault();
        const url = new URL(a.getAttribute('href'), location.href).href;
        if (/^https:\/\/t\.me\//.test(url) && typeof w.openTelegramLink === 'function') w.openTelegramLink(url);
        else w.openLink(url);
      });
      // Тема — как в Telegram
      const theme = () => { document.documentElement.dataset.theme = w.colorScheme === 'dark' ? 'dark' : 'light'; };
      theme();
      w.onEvent('themeChanged', theme);
    };
    if (window.Telegram && window.Telegram.WebApp) tgInit();
    else document.addEventListener('tg-ready', tgInit, { once: true });
    load();
  }

  init();
})();
