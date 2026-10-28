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
    const cur = flow.indexOf(o.status);
    return `<ol class="steps">${flow.map((s, i) => {
      const state = i < cur ? 'done' : i === cur ? 'now' : 'next';
      return `<li class="steps__item is-${state}"${state === 'now' ? ' aria-current="step"' : ''}>
        <span class="steps__dot" aria-hidden="true">${state === 'done' ? '✓' : ''}</span>
        <span class="steps__name">${esc(OC.STATUS[s][lang])}</span>
        ${at[s] ? `<span class="steps__time">${time(at[s])}</span>` : ''}
      </li>`;
    }).join('')}</ol>`;
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
      if (!order) renderMessage(t('loadFail'), '', true);
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
    document.addEventListener('tg-ready', () => { try { window.Telegram.WebApp.ready(); } catch (e) { /* нет */ } }, { once: true });
    load();
  }

  init();
})();
