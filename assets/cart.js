/* Корзина, оформление заказа и Telegram Mini App.
   Меню рисует app.js; этот модуль добавляет «+» и счётчики, шторку корзины и форму заказа. */
(() => {
  'use strict';

  const R = window.MenuRender;
  const OC = window.OrderCore;
  const CART_KEY = 'buddy-menu:cart';
  const PROFILE_KEY = 'buddy-menu:profile';
  const ORDERS_KEY = 'buddy-menu:orders';
  const ACTIVE_FOR = 6 * 3600 * 1000; // заказ показываем в баннере «Ваш заказ» до 6 часов

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const app = () => window.BuddyApp;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    dlg: $('#cart'), body: $('#cart-body'), bar: $('#cartbar'), slot: $('#order-slot'), toast: $('#toast'), net: $('#net'),
    opts: $('#sheet-opts'), foot: $('#sheet-foot'), done: $('.sheet__done'), prices: $('#sheet-prices'), nutr: $('#sheet-nutr')
  };

  let cart = { lines: [], type: 'delivery' };
  let accepting; // ответ /api/state: true / false / null (нет сети); undefined — ещё не спросили
  let step = 'cart';
  let sel = null; // выбор в шторке блюда: { id, size, qty, note }
  let geo = null;
  let sending = false;
  let cid = '';
  let formError = '';
  let toastTimer = 0;

  /* ---------- helpers ---------- */

  function store(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }
  const load = (k) => { try { return JSON.parse(store((s) => s.getItem(k)) || 'null'); } catch (e) { return null; } };
  const save = (k, v) => store((s) => s.setItem(k, JSON.stringify(v)));

  const lang = () => (app() ? app().lang : 'uz');
  function t(key, ...args) {
    const L = lang();
    let v = OC.UI[L] && OC.UI[L][key];
    if (v == null) v = OC.UI.uz[key];
    if (v == null) return app() ? app().t(key, ...args) : key;
    return typeof v === 'function' ? v(...args) : v;
  }
  const money = (n) => `${R.fmt(n)} ${app().t('currency')}`;
  const esc = R.esc;
  const icon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
  const model = () => app() && app().model;
  const view = () => app() && app().view;
  const itemByKey = (key) => model() && model().items.find((x) => x.key === key);
  const itemById = (id) => model() && model().items.find((x) => x.id === id);
  const cfg = () => OC.config(model());
  const phone = () => (view() ? view().setting('телефон') : '');
  const qtyOf = (key) => cart.lines.filter((l) => l.key === key).reduce((n, l) => n + l.qty, 0);
  const priced = () => OC.price(model(), cart.lines);
  const canOrder = (it) => accepting !== false && view() && view().canOrder(it);

  function randomId() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function haptic(kind) {
    const h = tg() && tg().HapticFeedback;
    if (!h) return;
    try { kind === 'light' ? h.impactOccurred('light') : h.notificationOccurred(kind); } catch (e) { /* старые клиенты */ }
  }

  // Всплывающее сообщение. popover — чтобы было видно и поверх открытой шторки
  function toast(text) {
    const el = els.toast;
    const pop = typeof el.showPopover === 'function';
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-out');
    if (pop) { try { el.hidePopover(); } catch (e) { /* ещё не показан */ } el.showPopover(); }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => {
        el.hidden = true;
        if (pop) { try { el.hidePopover(); } catch (e) { /* уже скрыт */ } }
      }, 250);
    }, 2200);
  }

  /* ---------- корзина ---------- */

  function setCart(next) {
    cart = next;
    save(CART_KEY, cart);
    refresh();
  }

  function addLine(key, size, qty, note) {
    const lines = cart.lines.slice();
    const same = lines.find((l) => l.key === key && l.size === size && (l.note || '') === (note || ''));
    if (same) same.qty = Math.min(20, same.qty + qty);
    else lines.push({ key, size, qty, note: note || '' });
    setCart({ ...cart, lines });
  }

  function changeLine(i, delta) {
    const lines = cart.lines.slice();
    const l = lines[i];
    if (!l) return;
    l.qty = Math.min(20, l.qty + delta);
    if (l.qty <= 0) lines.splice(i, 1);
    setCart({ ...cart, lines });
  }

  // Счётчик на карточке меняет последнюю добавленную строку этого блюда
  function changeKey(key, delta) {
    if (delta > 0) { addLine(key, 0, 1, ''); return; }
    for (let i = cart.lines.length - 1; i >= 0; i--) {
      if (cart.lines[i].key === key) { changeLine(i, -1); return; }
    }
  }

  // Удалённые или закончившиеся позиции убираем и сообщаем об этом
  function prune() {
    if (!model()) return;
    const { missing } = priced();
    if (!missing.length) return;
    const names = missing.map((k) => itemByKey(k)).filter(Boolean).map((it) => it[lang()]);
    cart.lines = cart.lines.filter((l) => !missing.includes(l.key));
    save(CART_KEY, cart);
    if (names.length) toast(t('errGone', names.join(', ')));
  }

  /* ---------- карточки меню и панель корзины ---------- */

  function stepperHTML(key, qty, name) {
    return `<span class="step" role="group" aria-label="${esc(name)}">
      <button type="button" class="step__btn" data-step="-1" data-key="${esc(key)}" aria-label="${esc(t('less'))}">${icon(qty > 1 ? 'i-minus' : 'i-trash')}</button>
      <b class="step__n" aria-live="polite">${qty}</b>
      <button type="button" class="step__btn" data-step="1" data-key="${esc(key)}" aria-label="${esc(t('more'))}">${icon('i-plus')}</button>
    </span>`;
  }

  function renderSlots() {
    $$('[data-add-slot]').forEach((slot) => {
      const it = itemById(slot.dataset.addSlot);
      if (!it) return;
      const qty = qtyOf(it.key);
      const multi = it.prices.length > 1;
      const html = qty && !multi
        ? stepperHTML(it.key, qty, it[lang()])
        : `<button type="button" class="add${qty ? ' has-qty' : ''}" data-add="${it.id}" aria-label="${esc(app().t('addTo', it[lang()]))}">${qty ? `<b>${qty}</b>` : icon('i-plus')}</button>`;
      if (slot.dataset.html !== html) { slot.innerHTML = html; slot.dataset.html = html; }
    });
  }

  function renderBar() {
    const p = model() ? priced() : { lines: [], total: 0 };
    const n = p.lines.reduce((s, l) => s + l.qty, 0);
    const show = n > 0 && accepting !== false && !(els.dlg.open);
    els.bar.hidden = !show;
    document.documentElement.classList.toggle('has-cart', n > 0 && accepting !== false);
    if (!n) return;
    els.bar.innerHTML = `<span class="cartbar__n" aria-hidden="true">${n}</span><span class="cartbar__label">${esc(t('cart'))}<span class="sr-only">: ${n}</span></span><b class="cartbar__sum">${esc(money(p.total))}</b>`;
  }

  function refresh() {
    if (!model()) return;
    document.documentElement.classList.toggle('no-order', !(cfg().enabled && accepting !== false));
    document.documentElement.classList.toggle('order-ready', accepting !== undefined);
    renderSlots();
    renderBar();
    if (els.dlg.open) renderCart();
  }

  /* ---------- шторка блюда: размер, комментарий, количество ---------- */

  function fillSheet(it) {
    const on = it && canOrder(it);
    els.foot.hidden = !on;
    els.done.hidden = !!on;
    if (!on) {
      els.opts.innerHTML = '';
      els.prices.hidden = false;
      sel = null;
      return;
    }
    if (!sel || sel.id !== it.id) sel = { id: it.id, size: 0, qty: 1, note: '' };
    const multi = it.prices.length > 1;
    els.prices.hidden = multi;
    const sizes = view().sizesOf(it);
    const w = view().weightsOf(it);
    const ws = w.length === it.prices.length ? w : [];
    const opts = multi ? `<fieldset class="opts"><legend class="opts__title">${esc(t('size'))}</legend>${it.prices.map((p, i) => `
      <label class="opt"><input type="radio" name="size" value="${i}"${i === sel.size ? ' checked' : ''}>
        <span class="opt__name">${esc(sizes[i] || String(i + 1))}${ws[i] ? ` <small>· ${esc(ws[i])}</small>` : ''}</span><b>${esc(money(p))}</b></label>`).join('')}</fieldset>` : '';
    els.opts.innerHTML = `${opts}
      <details class="note"${sel.note ? ' open' : ''}><summary>${icon('i-chat')}${esc(t('itemNote'))}</summary>
        <textarea id="item-note" rows="2" maxlength="140" placeholder="${esc(t('itemNotePh'))}" aria-label="${esc(t('itemNote'))}">${esc(sel.note)}</textarea></details>`;
    renderFoot(it);
  }

  function renderFoot(it) {
    els.foot.innerHTML = `<span class="step step--lg" role="group" aria-label="${esc(t('qty'))}">
        <button type="button" class="step__btn" data-sel="-1" aria-label="${esc(t('less'))}"${sel.qty <= 1 ? ' disabled' : ''}>${icon('i-minus')}</button>
        <b class="step__n" aria-live="polite">${sel.qty}</b>
        <button type="button" class="step__btn" data-sel="1" aria-label="${esc(t('more'))}"${sel.qty >= 20 ? ' disabled' : ''}>${icon('i-plus')}</button>
      </span>
      <button type="button" class="cta" data-sheet-add>${esc(t('addSum', money(it.prices[sel.size] * sel.qty)))}</button>`;
    els.nutr.innerHTML = view().nutritionHTML(it, sel.size);
  }

  function bindSheet() {
    els.opts.addEventListener('change', (e) => {
      if (e.target.name !== 'size' || !sel) return;
      sel.size = parseInt(e.target.value, 10) || 0;
      renderFoot(itemById(sel.id));
    });
    els.opts.addEventListener('input', (e) => { if (e.target.id === 'item-note' && sel) sel.note = e.target.value; });
    els.foot.addEventListener('click', (e) => {
      const it = sel && itemById(sel.id);
      if (!it) return;
      const d = e.target.closest('[data-sel]');
      if (d) {
        sel.qty = Math.max(1, Math.min(20, sel.qty + parseInt(d.dataset.sel, 10)));
        renderFoot(it);
        haptic('light');
        const btn = $(`[data-sel="${d.dataset.sel}"]`, els.foot);
        if (btn && !btn.disabled) btn.focus();
        return;
      }
      if (e.target.closest('[data-sheet-add]')) {
        addLine(it.key, sel.size, sel.qty, sel.note.trim());
        haptic('success');
        sel = null;
        app().closeSheet();
        toast(t('added'));
      }
    });
  }

  /* ---------- шторка корзины ---------- */

  function lineHTML(l, i) {
    const it = l.item;
    const sizeName = l['size_' + lang()];
    return `<li class="line">
      <span class="line__img">${view().pictureHTML(it, 'pair__img', 56, 56, 'eager')}</span>
      <span class="line__body">
        <span class="line__name">${esc(it[lang()])}</span>
        ${sizeName ? `<span class="line__meta">${esc(sizeName)}</span>` : ''}
        ${l.note ? `<span class="line__note">${icon('i-chat')}${esc(l.note)}</span>` : ''}
        <b class="line__sum">${esc(money(l.sum))}</b>
      </span>
      <span class="step" role="group" aria-label="${esc(it[lang()])}">
        <button type="button" class="step__btn" data-line="${i}" data-d="-1" aria-label="${esc(t('less'))}">${icon(l.qty > 1 ? 'i-minus' : 'i-trash')}</button>
        <b class="step__n">${l.qty}</b>
        <button type="button" class="step__btn" data-line="${i}" data-d="1" aria-label="${esc(t('more'))}"${l.qty >= 20 ? ' disabled' : ''}>${icon('i-plus')}</button>
      </span>
    </li>`;
  }

  // «Добавить к заказу?»: пары блюд из корзины, которых в ней ещё нет
  function upsellHTML(lines) {
    const inCart = new Set(lines.map((l) => l.key));
    const out = [];
    lines.forEach((l) => view().pairsOf(l.item).forEach((p) => { if (!inCart.has(p.key) && !out.includes(p) && canOrder(p)) out.push(p); }));
    if (!out.length) return '';
    return `<section class="upsell" aria-labelledby="upsell-title"><h3 class="cart__h" id="upsell-title">${esc(t('upsell'))}</h3>
      <div class="upsell__track">${out.slice(0, 6).map((p) => `<button type="button" class="ups" data-ups="${esc(p.key)}" aria-label="${esc(app().t('addTo', p[lang()]))}">
        <span class="ups__img">${view().pictureHTML(p, 'pair__img', 96, 72, 'eager')}</span>
        <span class="ups__name">${esc(p[lang()])}</span>
        <span class="ups__price">${esc(money(p.prices[0]))}</span>
        <span class="ups__plus" aria-hidden="true">${icon('i-plus')}</span>
      </button>`).join('')}</div></section>`;
  }

  function typeHTML() {
    return `<div class="seg" role="radiogroup" aria-label="${esc(t('howGet'))}">
      ${['delivery', 'pickup'].map((k) => `<label class="seg__opt"><input type="radio" name="otype" value="${k}"${cart.type === k ? ' checked' : ''}><span>${icon(k === 'delivery' ? 'i-scooter' : 'i-bag')}${esc(t(k))}</span></label>`).join('')}
    </div>`;
  }

  function minState(total) {
    const c = cfg();
    const left = cart.type === 'delivery' ? Math.max(0, c.min - total) : 0;
    return { left, min: c.min, ok: left === 0 };
  }

  function renderCart() {
    const p = priced();
    if (step === 'checkout' && p.lines.length) { renderCheckout(p); return; }
    step = 'cart';
    if (!p.lines.length) {
      const last = (load(ORDERS_KEY) || []).find((o) => Array.isArray(o.lines) && o.lines.length);
      els.body.innerHTML = `<div class="cart__head"><h2 class="cart__title" id="cart-title" tabindex="-1">${esc(t('cart'))}</h2></div>
        <div class="cart__empty">
          <div class="cart__empty-icon" aria-hidden="true">🛒</div>
          <p class="cart__empty-title">${esc(t('cartEmpty'))}</p>
          <p>${esc(t('cartEmptyText'))}</p>
          ${last ? `<button type="button" class="cta cta--ghost" data-repeat>${icon('i-repeat')}<span>${esc(t('repeat'))}<small>${esc(t('repeatMeta', dateText(last.t), money(last.total)))}</small></span></button>` : ''}
          <button type="button" class="cta" data-close>${esc(t('toMenu'))}</button>
        </div>`;
      return;
    }
    const m = minState(p.total);
    const eta = cfg().eta(cart.type, lang());
    els.body.innerHTML = `<div class="cart__head">
        <h2 class="cart__title" id="cart-title" tabindex="-1">${esc(t('cart'))}</h2>
        <button type="button" class="link" data-clear>${esc(t('clear'))}</button>
      </div>
      <ul class="lines">${p.lines.map(lineHTML).join('')}</ul>
      ${upsellHTML(p.lines)}
      <h3 class="cart__h">${esc(t('howGet'))}</h3>
      ${typeHTML()}
      <p class="cart__hint">${esc(cart.type === 'delivery' ? t('zoneNote', eta) : t('pickupNote', eta))}</p>
      ${m.ok ? '' : `<div class="minbar" role="status"><span class="minbar__track"><span style="width:${Math.round((p.total / m.min) * 100)}%"></span></span><p>${esc(t('minLeft', R.fmt(m.left), R.fmt(m.min)))}</p></div>`}
      ${totalsHTML(p)}
      <div class="cart__foot"><button type="button" class="cta" data-checkout${m.ok ? '' : ' disabled'}>${esc(t('checkout'))}<b>${esc(money(p.total))}</b></button></div>`;
    $$('.minbar__track span', els.body).forEach((s) => s.setAttribute('aria-hidden', 'true'));
  }

  function totalsHTML(p) {
    return `<dl class="totals">
      <div><dt>${esc(t('itemsSum'))}</dt><dd>${esc(money(p.total))}</dd></div>
      ${cart.type === 'delivery' ? `<div><dt>${esc(t('deliveryCost'))}</dt><dd class="totals__free">${esc(t('free'))}</dd></div>` : ''}
      <div class="totals__sum"><dt>${esc(t('total'))}</dt><dd>${esc(money(p.total))}</dd></div>
    </dl>`;
  }

  function dateText(time) {
    const d = new Date(time);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /* ---------- оформление ---------- */

  function field(id, label, input, hint, optional) {
    return `<div class="field" data-field="${id}">
      <label for="f-${id}">${esc(label)}${optional ? ` <small>(${esc(t('optional'))})</small>` : ''}</label>
      ${input}
      ${hint ? `<p class="field__hint" id="h-${id}">${esc(hint)}</p>` : ''}
      <p class="field__err" id="e-${id}" hidden></p>
    </div>`;
  }

  function fmtLocal(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
  }

  function renderCheckout(p) {
    const pf = load(PROFILE_KEY) || {};
    const tgUser = tg() && tg().initDataUnsafe && tg().initDataUnsafe.user;
    const delivery = cart.type === 'delivery';
    const pay = pf.payment === 'card' ? 'card' : 'cash';
    const c = cfg();
    const cafeMap = R.safeUrl(view().setting('ссылка_на_карту'));
    els.body.innerHTML = `<div class="cart__head">
        <button type="button" class="iconbtn" data-back aria-label="${esc(t('back'))}">${icon('i-back')}</button>
        <h2 class="cart__title" id="cart-title" tabindex="-1">${esc(t('checkoutTitle'))}</h2>
      </div>
      <form class="form" id="order-form" novalidate>
        ${typeHTML()}
        <h3 class="cart__h">${esc(t('contact'))}</h3>
        ${field('name', t('name'), `<input id="f-name" name="name" autocomplete="name" maxlength="60" required value="${esc(pf.name || (tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : ''))}" aria-describedby="e-name">`)}
        ${field('phone', t('phone'), `<div class="tel"><span class="tel__cc" aria-hidden="true">+998</span><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="16" required placeholder="90 123 45 67" value="${esc(fmtLocal(pf.phone))}" aria-describedby="h-phone e-phone"></div>
          ${tg() && typeof tg().requestContact === 'function' ? `<button type="button" class="link link--btn" data-tgphone>${icon('i-tg')}${esc(t('tgPhone'))}</button>` : ''}`, t('phoneHint'))}
        ${delivery ? `<h3 class="cart__h">${esc(t('address'))}</h3>
        ${field('street', t('street'), `<input id="f-street" name="street" autocomplete="street-address" maxlength="160" required value="${esc(pf.street || '')}" aria-describedby="e-street">`)}
        <div class="field-row">
          ${field('apt', t('apt'), `<input id="f-apt" name="apt" maxlength="60" placeholder="${esc(t('aptPh'))}" value="${esc(pf.apt || '')}">`, '', true)}
        </div>
        ${field('landmark', t('landmark'), `<input id="f-landmark" name="landmark" maxlength="120" placeholder="${esc(t('landmarkPh'))}" value="${esc(pf.landmark || '')}">`, '', true)}
        <div class="geo" id="geo">${geoHTML()}</div>` : `<h3 class="cart__h">${esc(t('pickupFrom'))}</h3>
        <div class="pickup">${icon('i-pin')}<div><b>${esc(view().setting('адрес'))}</b><span>${esc(t('pickupNote', c.eta('pickup', lang())))}</span>
          ${cafeMap ? `<a href="${esc(cafeMap)}" target="_blank" rel="noopener">${esc(t('route'))}</a>` : ''}</div></div>`}
        <h3 class="cart__h">${esc(t('payment'))}</h3>
        <div class="seg" role="radiogroup" aria-label="${esc(t('payment'))}">
          <label class="seg__opt"><input type="radio" name="payment" value="cash"${pay === 'cash' ? ' checked' : ''}><span>${icon('i-cash')}${esc(t('cash'))}</span></label>
          <label class="seg__opt"><input type="radio" name="payment" value="card"${pay === 'card' ? ' checked' : ''}><span>${icon('i-card')}${esc(t('cardShort'))}</span></label>
        </div>
        <p class="cart__hint" id="pay-note">${esc(pay === 'card' ? t('cardNote', !delivery) : t('cashNote'))}</p>
        <div id="change-wrap"${pay === 'cash' && delivery ? '' : ' hidden'}>
          ${field('change', t('change'), `<input id="f-change" name="change" inputmode="numeric" maxlength="9" placeholder="${esc(t('changePh'))}">`, '', true)}
        </div>
        ${field('comment', t('orderNote'), `<textarea id="f-comment" name="comment" rows="2" maxlength="300" placeholder="${esc(t('orderNotePh'))}"></textarea>`, '', true)}
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${totalsHTML(p)}
        <p class="form__err" id="form-err" role="alert"${formError ? '' : ' hidden'}>${formError}</p>
        <p class="form__note">${esc(t('dataNote'))}</p>
        <div class="cart__foot"><button type="submit" class="cta" id="submit"${sending ? ' disabled' : ''}>${esc(sending ? t('sending') : t('confirm', money(p.total)))}</button></div>
      </form>`;
  }

  function geoHTML() {
    if (geo && geo.state === 'ok') return `<p class="geo__ok">${icon('i-pin')}${esc(t('geoOk'))} <button type="button" class="link" data-geo-clear>${esc(t('geoRemove'))}</button></p>`;
    const msg = geo && geo.state === 'wait' ? t('geoWait') : geo && geo.state === 'denied' ? t('geoDenied') : geo && geo.state === 'fail' ? t('geoFail') : geo && geo.state === 'zone' ? t('errZone') : t('geoHint');
    return `<button type="button" class="cta cta--ghost cta--sm" data-geo${geo && geo.state === 'wait' ? ' disabled' : ''}>${icon('i-locate')}${esc(t('geoBtn'))}</button>
      <p class="field__hint${geo && /denied|fail|zone/.test(geo.state) ? ' is-warn' : ''}" role="status">${esc(msg)}</p>`;
  }

  function setGeo(state, coords) {
    geo = { state, ...(coords || {}) };
    const box = $('#geo');
    if (box) box.innerHTML = geoHTML();
  }

  function locate() {
    setGeo('wait');
    const done = (lat, lng, acc) => {
      if (!OC.inZone(lat, lng)) { setGeo('zone', { lat, lng, acc }); return; }
      setGeo('ok', { lat, lng, acc });
      haptic('success');
    };
    const lm = tg() && tg().LocationManager;
    if (lm && typeof lm.init === 'function') {
      try {
        lm.init(() => {
          if (!lm.isLocationAvailable) { browserLocate(done); return; }
          lm.getLocation((loc) => { if (loc) done(loc.latitude, loc.longitude, loc.horizontal_accuracy); else setGeo('denied'); });
        });
        return;
      } catch (e) { /* ниже — обычная геолокация */ }
    }
    browserLocate(done);
  }

  function browserLocate(done) {
    if (!navigator.geolocation) { setGeo('fail'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => done(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => setGeo(err && err.code === 1 ? 'denied' : 'fail'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function showErr(id, text) {
    const f = $(`[data-field="${id}"]`, els.body);
    if (!f) return;
    const input = $('input, textarea', f);
    const err = $('.field__err', f);
    err.textContent = text || '';
    err.hidden = !text;
    if (input) {
      if (text) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function setFormError(html) {
    formError = html || '';
    const el = $('#form-err', els.body);
    if (!el) return;
    el.innerHTML = formError;
    el.hidden = !formError;
    if (formError) el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function validate(form) {
    const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const errs = {};
    if (!v('name')) errs.name = t('errName');
    if (!OC.normPhone(v('phone'))) errs.phone = t('errPhone');
    if (cart.type === 'delivery' && v('street').length < 3) errs.street = t('errAddress');
    ['name', 'phone', 'street'].forEach((k) => showErr(k, errs[k]));
    const first = Object.keys(errs)[0];
    if (first) {
      const input = $(`#f-${first}`, els.body);
      if (input) input.focus();
      haptic('error');
      return false;
    }
    if (cart.type === 'delivery' && geo && geo.state === 'zone') {
      setFormError(esc(t('errZone')));
      return false;
    }
    return true;
  }

  function callHTML() {
    const ph = phone();
    return ph ? ` <a href="${esc(view().telHref(ph))}">${esc(ph)}</a>` : '';
  }

  async function submit(form) {
    if (sending) return;
    setFormError('');
    if (!validate(form)) return;
    const p = priced();
    const m = minState(p.total);
    if (!m.ok) { setFormError(esc(t('errMin', R.fmt(m.left)))); return; }
    const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const profile = {
      name: v('name'), phone: OC.normPhone(v('phone')), street: v('street'), apt: v('apt'), landmark: v('landmark'),
      payment: form.elements.payment.value
    };
    const body = {
      cid: cid || (cid = randomId()),
      lang: lang(),
      type: cart.type,
      name: profile.name,
      phone: profile.phone,
      address: cart.type === 'delivery' ? { street: profile.street, apt: profile.apt, landmark: profile.landmark } : null,
      geo: cart.type === 'delivery' && geo && geo.state === 'ok' ? { lat: geo.lat, lng: geo.lng, acc: Math.round(geo.acc || 0) } : null,
      payment: profile.payment,
      change: profile.payment === 'cash' ? parseInt(v('change').replace(/\D/g, ''), 10) || 0 : 0,
      comment: v('comment'),
      website: v('website'),
      items: p.lines.map((l) => ({ key: l.key, size: l.size, qty: l.qty, note: l.note, price: l.price })),
      total: p.total,
      tg: tg() ? tg().initData : ''
    };

    sending = true;
    const btn = $('#submit', els.body);
    btn.disabled = true;
    btn.textContent = t('sending');
    if (tg()) await askWriteAccess();

    let res, data;
    try {
      res = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      res = null;
    }
    sending = false;
    if (!res) { failed(t('errOffline')); return; }
    if (res.ok && data.token) {
      save(PROFILE_KEY, profile);
      const list = (load(ORDERS_KEY) || []).filter((o) => o.token !== data.token);
      list.unshift({ token: data.token, number: data.number, t: Date.now(), total: data.total, lines: cart.lines });
      save(ORDERS_KEY, list.slice(0, 5));
      cid = '';
      geo = null;
      cart = { lines: [], type: cart.type };
      save(CART_KEY, cart);
      haptic('success');
      location.href = `/order?t=${encodeURIComponent(data.token)}${tg() ? '&tg=1' : ''}`;
      return;
    }
    const code = data && data.error;
    if (code === 'price_changed' || code === 'unavailable') {
      cid = '';
      step = 'cart';
      await app().reload(); // свежие цены и наличие из таблицы
      prune();
      renderCart();
      failed('');
      toast(code === 'unavailable' ? t('errGone', (data.names || []).join(', ')) : t('errPrice'));
      return;
    }
    cid = code === 'server' ? cid : '';
    if (code === 'phone') { showErr('phone', t('errPhone')); failed(''); return; }
    if (code === 'address') { showErr('street', t('errAddress')); failed(''); return; }
    if (code === 'zone') { setGeo('zone', geo); failed(esc(t('errZone'))); return; }
    if (code === 'min') { failed(esc(t('errMin', R.fmt(Math.max(0, (data.min || cfg().min) - p.total))))); return; }
    if (code === 'paused') { accepting = false; failed(esc(t('errPaused')) + callHTML()); refresh(); return; }
    if (code === 'rate') { failed(esc(t('errRate'))); return; }
    failed(esc(t('errServer')) + callHTML());
  }

  function failed(html) {
    haptic('error');
    const btn = $('#submit', els.body);
    if (btn) { btn.disabled = false; btn.textContent = t('confirm', money(priced().total)); }
    if (html) setFormError(html);
  }

  /* ---------- открытие и закрытие корзины ---------- */

  function openCart(toStep) {
    prune();
    step = toStep || 'cart';
    renderCart();
    if (!els.dlg.open) {
      els.dlg.classList.remove('is-closing');
      if (typeof els.dlg.showModal === 'function') els.dlg.showModal();
      else els.dlg.setAttribute('open', '');
      history.pushState({ cart: 1 }, '');
    }
    renderBar();
    tgBack();
    const title = $('#cart-title', els.body);
    if (title) title.focus({ preventScroll: true });
  }

  function goStep(next) {
    step = next;
    formError = '';
    renderCart();
    $('.sheet__card', els.dlg).scrollTop = 0;
    const title = $('#cart-title', els.body);
    if (title) title.focus({ preventScroll: true });
    if (next === 'checkout') history.pushState({ cart: 2 }, '');
  }

  function closeCart() {
    if (history.state && history.state.cart) history.go(-history.state.cart);
    else hideCart();
  }

  function hideCart() {
    if (!els.dlg.open || els.dlg.classList.contains('is-closing')) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      els.dlg.classList.remove('is-closing');
      if (typeof els.dlg.close === 'function') els.dlg.close();
      else els.dlg.removeAttribute('open');
      step = 'cart';
      renderBar();
      tgBack();
      els.bar.focus({ preventScroll: true });
    };
    els.dlg.classList.add('is-closing');
    $('.sheet__card', els.dlg).addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);
  }

  function repeat(order) {
    const lines = (order.lines || []).filter((l) => itemByKey(l.key));
    if (!lines.length) return;
    setCart({ ...cart, lines: lines.map((l) => ({ key: l.key, size: l.size || 0, qty: l.qty || 1, note: l.note || '' })) });
    prune();
    renderCart();
  }

  function bindCart() {
    els.bar.addEventListener('click', () => openCart());
    els.dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeCart(); });
    els.dlg.addEventListener('click', (e) => {
      if (e.target === els.dlg || e.target.closest('[data-close]')) { closeCart(); return; }
      const ln = e.target.closest('[data-line]');
      if (ln) { changeLine(parseInt(ln.dataset.line, 10), parseInt(ln.dataset.d, 10)); haptic('light'); return; }
      const ups = e.target.closest('[data-ups]');
      if (ups) { addLine(ups.dataset.ups, 0, 1, ''); haptic('success'); return; }
      if (e.target.closest('[data-clear]')) {
        if (window.confirm(t('clearAsk'))) setCart({ ...cart, lines: [] });
        return;
      }
      if (e.target.closest('[data-checkout]')) { goStep('checkout'); return; }
      if (e.target.closest('[data-back]')) { history.back(); return; }
      if (e.target.closest('[data-repeat]')) {
        const last = (load(ORDERS_KEY) || []).find((o) => Array.isArray(o.lines) && o.lines.length);
        if (last) repeat(last);
        return;
      }
      if (e.target.closest('[data-geo]')) { locate(); return; }
      if (e.target.closest('[data-geo-clear]')) { setGeo('none'); return; }
      if (e.target.closest('[data-tgphone]')) {
        tg().requestContact((ok, res) => {
          const ph = ok && res && res.responseUnsafe && res.responseUnsafe.contact && res.responseUnsafe.contact.phone_number;
          const input = $('#f-phone', els.body);
          if (ph && input) { input.value = fmtLocal(ph); showErr('phone', ''); }
        });
      }
    });
    els.dlg.addEventListener('change', (e) => {
      if (e.target.name === 'otype') {
        cart.type = e.target.value;
        save(CART_KEY, cart);
        const form = $('#order-form', els.body);
        // Введённое не теряем при переключении «доставка ↔ самовывоз»
        if (form) {
          const keep = {};
          ['name', 'phone', 'street', 'apt', 'landmark', 'comment', 'change'].forEach((n) => { if (form.elements[n]) keep[n] = form.elements[n].value; });
          const pay = form.elements.payment.value;
          renderCart();
          const f2 = $('#order-form', els.body);
          Object.keys(keep).forEach((n) => { if (f2.elements[n]) f2.elements[n].value = keep[n]; });
          f2.elements.payment.value = pay;
          syncPayment(f2);
        } else renderCart();
        return;
      }
      if (e.target.name === 'payment') syncPayment(e.target.form);
    });
    els.dlg.addEventListener('input', (e) => {
      if (e.target.id === 'f-phone') {
        const pos = e.target.value.length === e.target.selectionStart;
        e.target.value = fmtLocal(e.target.value);
        if (pos) e.target.setSelectionRange(e.target.value.length, e.target.value.length);
        if (OC.normPhone(e.target.value)) showErr('phone', '');
      }
      if (e.target.id === 'f-change') e.target.value = e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      if (e.target.id === 'f-name' && e.target.value.trim()) showErr('name', '');
      if (e.target.id === 'f-street' && e.target.value.trim().length >= 3) showErr('street', '');
    });
    els.dlg.addEventListener('focusout', (e) => {
      if (e.target.id === 'f-phone' && e.target.value.trim()) showErr('phone', OC.normPhone(e.target.value) ? '' : t('errPhone'));
    });
    els.dlg.addEventListener('submit', (e) => { e.preventDefault(); submit(e.target); });
    window.addEventListener('popstate', (e) => {
      const st = e.state && e.state.cart;
      if (!els.dlg.open) return;
      if (st === 1 && step === 'checkout') { step = 'cart'; formError = ''; renderCart(); return; }
      if (!st) hideCart();
    });
  }

  function syncPayment(form) {
    if (!form) return;
    const pay = form.elements.payment.value;
    $('#pay-note', els.body).textContent = pay === 'card' ? t('cardNote', cart.type === 'pickup') : t('cashNote');
    $('#change-wrap', els.body).hidden = !(pay === 'cash' && cart.type === 'delivery');
  }

  /* ---------- «+» на карточках ---------- */

  function bindMenu() {
    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) {
        const it = itemById(add.dataset.add);
        if (!it) return;
        if (it.prices.length > 1) { app().openSheet(it.id, add.closest('.item')); return; }
        addLine(it.key, 0, 1, '');
        haptic('light');
        const n = $(`[data-add-slot="${it.id}"] .step__n`);
        if (n && !reduceMotion) n.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 220 });
        // «+» заменился счётчиком — фокус переводим на его «+»
        const plus = $(`[data-add-slot="${it.id}"] [data-step="1"]`);
        if (plus) plus.focus({ preventScroll: true });
        return;
      }
      const st = e.target.closest('[data-step]');
      if (st) {
        const slot = st.closest('[data-add-slot]');
        changeKey(st.dataset.key, parseInt(st.dataset.step, 10));
        haptic('light');
        // Фокус остаётся на той же кнопке, если она ещё есть
        const again = slot && ($(`[data-step="${st.dataset.step}"]`, slot) || $('[data-add]', slot));
        if (again) again.focus({ preventScroll: true });
      }
    });
  }

  /* ---------- активный заказ, сеть, приём заказов ---------- */

  async function checkState() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      accepting = !!(d && d.accepting);
    } catch (e) {
      accepting = null; // нет сети: корзину собирать можно, отправим позже
    }
    if (accepting === false && model() && cfg().enabled) showSlot(`<p class="notice notice--muted">${esc(t('ordersOff'))}${callHTML()}</p>`);
    refresh();
  }

  async function checkActive() {
    const last = (load(ORDERS_KEY) || [])[0];
    if (!last || Date.now() - last.t > ACTIVE_FOR) return;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(last.token)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const o = await res.json();
      if (OC.FINAL.includes(o.status)) return;
      const st = OC.STATUS[o.status];
      showSlot(`<a class="active" href="/order?t=${encodeURIComponent(last.token)}${tg() ? '&tg=1' : ''}"><span class="active__icon" aria-hidden="true">${st.icon}</span><span>${esc(t('activeOrder', o.number, st[lang()]))}</span>${icon('i-chevron')}</a>`);
    } catch (e) { /* нет сети — баннер не нужен */ }
  }

  function showSlot(html) {
    els.slot.innerHTML = html;
  }

  function bindNet() {
    const upd = () => {
      els.net.hidden = navigator.onLine !== false;
      els.net.textContent = t('offline');
    };
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    upd();
  }

  /* ---------- Telegram Mini App ---------- */

  function tg() {
    const w = window.Telegram && window.Telegram.WebApp;
    return w && w.initData ? w : null;
  }

  function askWriteAccess() {
    const w = tg();
    const user = w && w.initDataUnsafe && w.initDataUnsafe.user;
    if (!w || !user || user.allows_write_to_pm || typeof w.requestWriteAccess !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
      try { w.requestWriteAccess(() => resolve()); } catch (e) { resolve(); }
      setTimeout(resolve, 15000);
    });
  }

  // Кнопка «Назад» Telegram: закрывает корзину или шторку блюда
  function tgBack() {
    const w = tg();
    if (!w || !w.BackButton) return;
    const open = els.dlg.open || $('#sheet').open;
    if (open) w.BackButton.show(); else w.BackButton.hide();
  }

  function initTelegram() {
    const w = tg();
    if (!w || initTelegram.done) return;
    initTelegram.done = true;
    document.documentElement.classList.add('is-tg');
    try {
      w.ready();
      w.expand();
      if (typeof w.disableVerticalSwipes === 'function') w.disableVerticalSwipes();
      if (typeof w.setHeaderColor === 'function') w.setHeaderColor('#E31B23');
      w.BackButton.onClick(() => history.back());
    } catch (e) { /* старые версии Telegram */ }
    // Язык из Telegram, если человек ещё не выбирал его сам
    const code = w.initDataUnsafe && w.initDataUnsafe.user && w.initDataUnsafe.user.language_code;
    const chosen = store((s) => s.getItem('buddy-menu:lang')) || new URLSearchParams(location.search).get('lang');
    if (!chosen && /^ru/i.test(code || '') && lang() !== 'ru') app().setLang('ru');
    const sheet = $('#sheet');
    new MutationObserver(tgBack).observe(sheet, { attributes: true, attributeFilter: ['open'] });
    tgBack(); // после страницы заказа кнопка «Назад» могла остаться видимой
    refresh();
  }

  /* ---------- start ---------- */

  function init() {
    cart = load(CART_KEY) || cart;
    if (!Array.isArray(cart.lines)) cart.lines = [];
    if (cart.type !== 'pickup') cart.type = 'delivery';
    bindSheet();
    bindCart();
    bindMenu();
    bindNet();
    if (window.Telegram && window.Telegram.WebApp) initTelegram();
    else document.addEventListener('tg-ready', initTelegram, { once: true });
    prune();
    refresh();
    checkState();
    checkActive();
    // «Повторить заказ» со страницы заказа ведёт на /#cart
    if (location.hash === '#cart') {
      history.replaceState(history.state, '', location.pathname + location.search);
      if (cart.lines.length) openCart();
    }
  }

  window.BuddyCart = {
    refresh: () => { prune(); refresh(); },
    fillSheet,
    lang: () => { if (els.dlg.open) renderCart(); renderBar(); }
  };
  init();
})();
