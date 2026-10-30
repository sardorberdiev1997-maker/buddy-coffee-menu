(() => {
  'use strict';

  const R = window.MenuRender;
  const CONFIG = window.MENU_CONFIG || {};
  const TABS = CONFIG.tabs || { menu: 'Меню', categories: 'Категории', settings: 'Настройки' };
  const CACHE_KEY = 'buddy-menu:data:v2';
  const LANG_KEY = 'buddy-menu:lang';
  const FALLBACK_AFTER = 2000; // мс ожидания таблицы, после которых показываем запасную копию (если меню нет в HTML)
  const STALE_AFTER = 24 * 3600 * 1000; // кэш старше суток помечаем датой

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const els = {
    nav: $('.nav'), chips: $('#chips'), menu: $('#menu'), empty: $('#empty'), status: $('#status'), info: $('#info'),
    heroBody: $('#hero-body'), noticeSlot: $('#notice-slot'), q: $('#q'), searchBtn: $('.nav__search-btn'),
    sheet: $('#sheet'), card: $('.sheet__card'), sheetMedia: $('.sheet__media'),
    sheetBadge: $('#sheet-badge'), sheetTitle: $('#sheet-title'), sheetDesc: $('#sheet-desc'), sheetMeta: $('#sheet-meta'),
    sheetPrices: $('#sheet-prices'), sheetPairs: $('#sheet-pairs'), sheetNutr: $('#sheet-nutr'), lang: $('.lang')
  };
  const cart = () => window.BuddyCart;

  let lang = 'uz';
  let model = null;
  let view = null;
  let shownJSON = '';
  let activeCat = '';
  let openId = null;
  let opener = null;
  let goingBack = false;
  let spyLockUntil = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Фокус возвращаем на карточку только тем, кто работает с клавиатуры:
  // на телефоне (Safari) иначе остаётся чёрная рамка вокруг карточки
  let keyboard = false;
  document.addEventListener('keydown', (e) => { if (['Tab', 'Enter', ' ', 'Escape'].includes(e.key)) keyboard = true; }, true);
  document.addEventListener('pointerdown', () => { keyboard = false; }, true);

  const t = (key, ...args) => {
    const v = (R.UI[lang] && R.UI[lang][key]) || R.UI.uz[key];
    return typeof v === 'function' ? v(...args) : (v || key);
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function storage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  /* ---------- data ---------- */

  async function fetchText(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // export?format=csv отдаёт значения как в ячейках; gviz угадывает типы колонок и может обнулить «чужие» ячейки
  async function loadSheet() {
    if (!CONFIG.sheetId && !CONFIG.pub) throw new Error('sheetId is empty');
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CONFIG.sheetId)}`;
    const gids = CONFIG.gids || {};
    const url = (key) => (gids[key]
      ? R.sheetCsvUrl(CONFIG, key)
      : `${base}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(TABS[key])}`);
    const [menu, categories, settings] = await Promise.all(
      ['menu', 'categories', 'settings'].map((k) => fetchText(url(k), 12000).then(R.parseCSV))
    );
    const tables = { menu, categories, settings };
    if (!R.validTables(tables)) throw new Error('Unexpected sheet structure');
    return tables;
  }

  async function loadFallback() {
    const data = JSON.parse(await fetchText(CONFIG.fallback || 'data/menu.json', 8000));
    return { menu: data[TABS.menu], categories: data[TABS.categories], settings: data[TABS.settings] };
  }

  // Меню, вшитое в HTML при сборке: { generated, tables }
  function readEmbedded() {
    const el = $('#menu-data');
    if (!el) return null;
    try {
      const d = JSON.parse(el.textContent);
      return R.validTables(d.tables) ? d : null;
    } catch (e) {
      return null;
    }
  }

  // Перерисовываем, только если данные действительно изменились (сравниваем уже разобранную модель)
  // Стоп-лист из группы кафе (/stop): эти блюда сейчас «нет в наличии». Приходит с /api/state (assets/cart.js)
  let stopKeys = [];
  let lastTables = null;
  function build(tables) {
    lastTables = tables;
    const m = R.buildModel(tables);
    if (stopKeys.length) m.items.forEach((it) => { if (stopKeys.includes(it.key)) it.avail = false; });
    return m;
  }

  function setStop(keys) {
    const next = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string').sort();
    if (next.join() === stopKeys.join()) return;
    stopKeys = next;
    if (lastTables) apply(lastTables);
  }

  // Воронка для /stats: открыли меню → корзина → оформление. Каждое событие — раз за визит, без данных о человеке
  function track(e) {
    try {
      if (sessionStorage.getItem('buddy-ev:' + e)) return;
      sessionStorage.setItem('buddy-ev:' + e, '1');
    } catch (err) { /* приватный режим — считаем как есть */ }
    try { if (navigator.sendBeacon) navigator.sendBeacon('/api/ev', JSON.stringify({ e })); } catch (err) { /* без сети — не важно */ }
  }

  function apply(tables) {
    const next = build(tables);
    const json = JSON.stringify(next);
    if (json === shownJSON) return false;
    shownJSON = json;
    model = next;
    render();
    return true;
  }

  // Меню уже в HTML (предрендер на узбекском) — только «оживляем» без перерисовки
  function hydrate(tables) {
    model = build(tables);
    shownJSON = JSON.stringify(model);
    view = R.createView(model, lang);
    applyStatic();
    markLoaded(document);
    applySearch(true);
    updateSpy();
    if (cart()) cart().refresh();
  }

  /* ---------- render ---------- */

  function markLoaded(root) {
    $$('img', root).forEach((img) => { if (img.complete && img.naturalWidth) img.classList.add('is-loaded'); });
  }

  function applyStatic() {
    document.documentElement.lang = lang === 'uz' ? 'uz-Latn' : 'ru';
    document.documentElement.dataset.lang = lang;
    document.title = t('title');
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    els.lang.dataset.active = lang;
  }

  function render() {
    if (!model) { applyStatic(); return; }
    view = R.createView(model, lang);
    // Перерисовка не должна сбивать фокус клавиатуры
    const focused = document.activeElement;
    const focusHost = focused && focused.closest && focused.closest('[data-id], [data-cat]');
    const focusSel = focusHost ? (focusHost.dataset.id ? `[data-id="${focusHost.dataset.id}"]` : `.chip[data-cat="${focusHost.dataset.cat}"]`) : '';
    const focusIsBtn = focused && focused.classList && focused.classList.contains('item__btn');

    applyStatic();
    els.heroBody.innerHTML = view.heroBodyHTML();
    els.noticeSlot.innerHTML = view.noticeHTML();
    els.chips.innerHTML = view.chipsHTML();
    els.menu.innerHTML = view.menuHTML();
    els.info.innerHTML = view.infoHTML();
    markLoaded(els.menu);
    renderJSONLD();
    applySearch(true);
    activeCat = '';
    requestAnimationFrame(updateSpy);
    if (cart()) cart().refresh();
    if (openId && els.sheet.open) fillSheet(model.items.find((x) => x.id === openId));
    if (focusSel) {
      const host = $(focusSel);
      const target = host && (focusIsBtn ? $('.item__btn', host) : host);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderJSONLD() {
    let node = $('#ld-json');
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/ld+json';
      node.id = 'ld-json';
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify(view.jsonLD());
  }

  function renderError() {
    els.menu.innerHTML = `<div class="empty"><p class="empty__icon" aria-hidden="true">📡</p><p>${R.esc(t('error'))}</p><button type="button" class="chip" id="retry">${R.esc(t('retry'))}</button></div>`;
    $('#retry').addEventListener('click', () => location.reload());
    els.status.textContent = t('error');
  }

  function showStale(time) {
    const el = $('#stale');
    if (!el) return;
    const d = new Date(time);
    const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    el.textContent = t('stale', date);
    el.hidden = false;
  }

  /* ---------- language ---------- */

  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl === 'uz' || fromUrl === 'ru') return fromUrl;
    const saved = storage((s) => s.getItem(LANG_KEY));
    if (saved === 'uz' || saved === 'ru') return saved;
    return /^ru\b/i.test(navigator.language || '') ? 'ru' : 'uz';
  }

  function setLang(l) {
    lang = l;
    storage((s) => s.setItem(LANG_KEY, l));
    render();
    if (cart()) cart().lang();
  }

  /* ---------- sheet (item details) ---------- */

  function sheetImgHTML(it, thumb) {
    const src = thumb || R.imgSrc(it, 's');
    if (!src) return view.placeholder(it);
    return `<img class="sheet__img${thumb ? ' is-loaded' : ''}" src="${R.esc(src)}" alt="" width="960" height="720">`;
  }

  function fillSheet(it, thumb) {
    if (!it) return;
    els.sheetMedia.innerHTML = sheetImgHTML(it, thumb);
    els.sheetBadge.innerHTML = view.badgeHTML(it.badge);
    els.sheetTitle.textContent = it[lang];
    els.sheetDesc.textContent = it['desc_' + lang];
    els.sheetDesc.hidden = !it['desc_' + lang];
    const weights = view.weightsOf(it);
    const perSize = it.prices.length > 1 && weights.length === it.prices.length;
    els.sheetMeta.textContent = perSize ? '' : weights.join(' / ');

    const sizes = view.sizesOf(it);
    const cur = R.esc(t('currency'));
    let rows = '';
    if (!it.avail) rows = `<li class="is-out">${R.esc(t('out'))}</li>`;
    else if (it.prices.length > 1) rows = it.prices.map((p, i) => `<li><span>${R.esc(sizes[i] || '')}${perSize ? ` <small>· ${R.esc(weights[i])}</small>` : ''}</span><b>${R.fmt(p)} ${cur}</b></li>`).join('');
    else if (it.prices.length === 1) rows = `<li><span>${R.esc(t('price'))}</span><b>${R.fmt(it.prices[0])} ${cur}</b></li>`;
    els.sheetPrices.innerHTML = rows;
    els.sheetNutr.innerHTML = view.nutritionHTML(it, 0);
    els.sheetPairs.innerHTML = view.pairsHTML(it);
    markLoaded(els.sheetPairs);
    if (cart()) cart().fillSheet(it);

    // Сначала показываем уже загруженное превью, затем подменяем на большое фото
    const img = $('img', els.sheetMedia);
    const large = R.imgSrc(it, 'l');
    if (img && large) {
      const wantAvif = thumb && /\.avif(\?|$)/.test(thumb) && R.isLocalImg(it.img);
      const big = wantAvif ? `img/l/${it.img}.avif` : large;
      const pre = new Image();
      pre.src = big;
      pre.decode().then(() => {
        if (openId === it.id && img.isConnected) { img.src = big; img.classList.add('is-loaded'); }
      }).catch(() => {});
    }
  }

  function openSheet(id, fromEl) {
    const it = model && model.items.find((x) => x.id === id);
    if (!it) return;
    const thumbImg = fromEl && $('img.is-loaded', fromEl);
    const thumb = thumbImg ? thumbImg.currentSrc || thumbImg.src : '';
    openId = id;
    opener = fromEl ? $('.item__btn', fromEl) || fromEl : document.activeElement;

    const show = () => {
      if (openId !== id) return; // успели закрыть до начала анимации
      els.sheet.classList.remove('is-closing');
      els.card.style.transform = '';
      fillSheet(it, thumb);
      if (typeof els.sheet.showModal === 'function') els.sheet.showModal();
      else els.sheet.setAttribute('open', '');
      els.card.scrollTop = 0;
    };

    if (document.startViewTransition && !reduceMotion && thumbImg) {
      thumbImg.style.viewTransitionName = 'dish';
      els.sheet.classList.add('is-vt');
      const vt = document.startViewTransition(() => {
        thumbImg.style.viewTransitionName = '';
        show();
        const img = $('img', els.sheetMedia);
        if (img) img.style.viewTransitionName = 'dish';
      });
      // Анимация может быть пропущена (быстрые нажатия, вкладка в фоне) — это не ошибка
      vt.ready.catch(() => {});
      vt.updateCallbackDone.catch(() => {});
      vt.finished.catch(() => {}).then(() => {
        const img = $('img', els.sheetMedia);
        if (img) img.style.viewTransitionName = '';
        els.sheet.classList.remove('is-vt');
      });
    } else {
      show();
    }
    history.pushState({ sheet: true }, '');
  }

  function closeSheet() {
    if (goingBack) return;
    if (history.state && history.state.sheet) {
      goingBack = true;
      history.back();
    } else hideSheet();
  }

  function hideSheet() {
    openId = null;
    if (!els.sheet.open || els.sheet.classList.contains('is-closing')) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      els.sheet.classList.remove('is-closing');
      els.card.style.transform = '';
      if (typeof els.sheet.close === 'function') els.sheet.close();
      else els.sheet.removeAttribute('open');
      // Возвращаем фокус на карточку, с которой открыли (на телефоне кнопки фокус не получают)
      if (keyboard && opener && opener.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    };
    els.sheet.classList.add('is-closing');
    els.card.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);
  }

  // Свайп вниз по фото или «ручке» закрывает шторку
  function bindSheetDrag() {
    let drag = null;
    els.card.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.target.closest('.sheet__close') || !e.target.closest('.sheet__media, .sheet__handle')) return;
      if (els.card.scrollTop > 0) return;
      drag = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
      els.card.classList.remove('is-settling');
      els.card.setPointerCapture(e.pointerId);
    });
    els.card.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      els.card.style.transform = drag.dy ? `translateY(${drag.dy}px)` : '';
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { dy, t: t0 } = drag;
      drag = null;
      const speed = dy / Math.max(1, performance.now() - t0);
      if (dy > 110 || (dy > 30 && speed > 0.6)) {
        closeSheet();
      } else if (dy) {
        els.card.classList.add('is-settling');
        els.card.style.transform = '';
        setTimeout(() => els.card.classList.remove('is-settling'), 260);
      }
    };
    els.card.addEventListener('pointerup', end);
    els.card.addEventListener('pointercancel', end);
  }

  /* ---------- search ---------- */

  function applySearch(silent) {
    if (!model) return;
    const q = R.norm(els.q.value.trim());
    let total = 0;
    $$('.section', els.menu).forEach((sec) => {
      let shown = 0;
      $$('.item', sec).forEach((el) => {
        const it = model.items.find((x) => x.id === el.dataset.id);
        const cat = model.cats.find((c) => c.id === it.cat) || {};
        const hit = !q || R.norm([it.uz, it.ru, it.desc_uz, it.desc_ru, cat.uz, cat.ru].join(' ')).includes(q);
        el.hidden = !hit;
        if (hit) shown++;
      });
      sec.hidden = shown === 0;
      $('.section__title small', sec).textContent = shown;
      total += shown;
    });
    const pop = $('.popular', els.menu);
    if (pop) pop.hidden = !!q;
    els.empty.hidden = total > 0;
    if (!silent) els.status.textContent = q ? (total ? t('found', total) : t('nothing')) : '';
  }

  function openSearch() {
    els.nav.classList.add('is-search');
    els.searchBtn.setAttribute('aria-expanded', 'true');
    const top = els.nav.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY < top) window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    els.q.focus({ preventScroll: true });
  }

  function closeSearch() {
    els.q.value = '';
    els.nav.classList.remove('is-search');
    els.searchBtn.setAttribute('aria-expanded', 'false');
    applySearch();
    els.searchBtn.focus({ preventScroll: true });
  }

  /* ---------- scroll spy ---------- */

  function setActive(id) {
    if (id === activeCat) return;
    activeCat = id;
    $$('.chip', els.chips).forEach((c) => {
      const on = c.dataset.cat === id;
      if (on) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
      if (on) {
        const left = c.offsetLeft - els.chips.offsetLeft - 8;
        els.chips.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
  }

  function updateSpy() {
    const navRect = els.nav.getBoundingClientRect();
    els.nav.classList.toggle('is-stuck', navRect.top <= 0 && window.scrollY > 0);
    if (spyLockUntil > performance.now()) return;
    spyLockUntil = 0;
    const line = navRect.bottom + 24;
    let current = '';
    $$('.section', els.menu).forEach((sec) => {
      if (!sec.hidden && sec.getBoundingClientRect().top <= line) current = sec.dataset.cat;
    });
    if (!current) {
      const first = $$('.section', els.menu).find((sec) => !sec.hidden);
      if (first) current = first.dataset.cat;
    }
    setActive(current);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateSpy();
    });
  }

  /* ---------- events ---------- */

  function bindUI() {
    $$('.lang button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.lang !== lang) setLang(b.dataset.lang); }));

    els.chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const sec = document.getElementById('cat-' + chip.dataset.cat);
      if (!sec) return;
      setActive(chip.dataset.cat);
      // Пока идёт плавная прокрутка, подсветку категорий не пересчитываем
      spyLockUntil = performance.now() + 1200;
      sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      const h = $('.section__title', sec);
      if (h) h.focus({ preventScroll: true });
    });
    window.addEventListener('scrollend', () => { if (spyLockUntil) { spyLockUntil = 0; updateSpy(); } });

    els.menu.addEventListener('click', (e) => {
      if (e.target.closest('.add-slot')) return; // «+» и счётчик — в cart.js
      const el = e.target.closest('.item, .pop');
      if (el) openSheet(el.dataset.id, el);
    });
    $('#clear-search').addEventListener('click', () => { closeSearch(); });

    // Плавное появление фото; битая ссылка → заглушка с иконкой категории
    document.addEventListener('load', (e) => {
      if (e.target instanceof HTMLImageElement) e.target.classList.add('is-loaded');
    }, true);
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !model || !view) return;
      const host = img.closest('[data-id]');
      const it = host ? model.items.find((x) => x.id === host.dataset.id) : model.items.find((x) => x.id === openId);
      (img.closest('picture') || img).outerHTML = it ? view.placeholder(it) : '';
    }, true);

    $('.sheet__close').addEventListener('click', closeSheet);
    $('.sheet__done').addEventListener('click', closeSheet);
    els.sheet.addEventListener('click', (e) => {
      if (e.target === els.sheet) { closeSheet(); return; }
      // «С этим берут»: открываем выбранное блюдо в той же шторке
      const pair = e.target.closest('[data-pair]');
      const it = pair && model.items.find((x) => x.id === pair.dataset.pair);
      if (!it) return;
      const img = $('img.is-loaded', pair);
      openId = it.id;
      fillSheet(it, img ? img.currentSrc || img.src : '');
      els.card.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      els.sheetTitle.focus({ preventScroll: true });
    });
    els.sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
    window.addEventListener('popstate', () => { goingBack = false; hideSheet(); });
    bindSheetDrag();

    els.searchBtn.addEventListener('click', openSearch);
    $('.nav__search-close').addEventListener('click', closeSearch);
    els.q.addEventListener('input', () => {
      applySearch();
      // Результаты начинаются сразу под панелью — прокручиваем к ней, если ушли ниже
      const top = els.menu.getBoundingClientRect().top + window.scrollY - els.nav.offsetHeight;
      if (window.scrollY > top) window.scrollTo({ top });
      updateSpy();
    });
    els.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); if (e.key === 'Enter') els.q.blur(); });

    els.info.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn || !navigator.clipboard) return;
      navigator.clipboard.writeText(btn.dataset.copy).then(() => { btn.textContent = t('copied'); }).catch(() => {});
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  /* ---------- start ---------- */

  async function init() {
    track('view');
    lang = detectLang();
    // После перезагрузки с открытой шторкой в истории остаётся её запись — убираем
    if (history.state && history.state.sheet) history.replaceState(null, '');
    bindUI();

    // 1. Меню, вшитое в HTML при сборке, и кэш последнего визита — берём то, что новее
    const embedded = readEmbedded();
    let cached = null;
    try { cached = JSON.parse(storage((s) => s.getItem(CACHE_KEY)) || 'null'); } catch (e) { cached = null; }
    if (!(cached && R.validTables(cached.tables))) cached = null;
    const useCache = cached && (!embedded || cached.t > embedded.generated);
    const base = useCache ? cached.tables : embedded ? embedded.tables : null;
    const prerendered = embedded && lang === 'uz' && $('.section', els.menu);

    if (base && prerendered && (!useCache || JSON.stringify(R.buildModel(base)) === JSON.stringify(R.buildModel(embedded.tables)))) {
      hydrate(embedded.tables);
    } else if (base) {
      apply(base);
    } else {
      applyStatic();
    }
    document.documentElement.classList.remove('is-booting');

    // 2. Свежие данные из Google Таблицы
    const sheet = loadSheet().catch((e) => {
      if (CONFIG.sheetId) console.warn('[menu] Google Sheet:', e.message);
      return null;
    });

    // Меню нет ни в HTML, ни в кэше: ждём таблицу недолго, потом показываем запасную копию
    if (!model) {
      const first = await Promise.race([sheet, delay(FALLBACK_AFTER).then(() => 'slow')]);
      if (first && first !== 'slow') apply(first);
      else {
        try { apply(await loadFallback()); } catch (e) { console.warn('[menu] fallback:', e.message); }
      }
    }

    const tables = await sheet;
    if (tables) {
      apply(tables);
      storage((s) => s.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), tables })));
    } else if (!model) {
      renderError();
    } else if (useCache && Date.now() - cached.t > STALE_AFTER) {
      showStale(cached.t);
    }

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  R.crashGuard(t);

  // Для cart.js: модель, язык и шторка блюда
  window.BuddyApp = {
    get model() { return model; },
    get view() { return view; },
    get lang() { return lang; },
    get keyboard() { return keyboard; },
    t,
    openSheet,
    closeSheet,
    setLang,
    setStop,
    track,
    // После «цены обновились» — перечитать таблицу сразу
    reload: () => loadSheet().then((tables) => { if (tables) apply(tables); }).catch(() => {})
  };

  init();
})();
