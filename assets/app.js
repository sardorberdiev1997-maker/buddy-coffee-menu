(() => {
  'use strict';

  const CONFIG = window.MENU_CONFIG || {};
  const TABS = CONFIG.tabs || { menu: 'Меню', categories: 'Категории', settings: 'Настройки' };
  const CACHE_KEY = 'buddy-menu:data:v1';
  const LANG_KEY = 'buddy-menu:lang';

  const UI = {
    uz: {
      title: 'Buddy Coffee — Menyu', search: 'Qidirish', searchPh: 'Taom yoki ichimlik…', close: 'Yopish',
      nothing: 'Hech narsa topilmadi', currency: 'so‘m', out: 'Hozir yo‘q', price: 'Narxi',
      contacts: 'Biz bilan bog‘lanish', address: 'Manzil', hours: 'Ish vaqti', phone: 'Telefon',
      delivery: 'Yetkazib berish', payment: 'To‘lov', wifi: 'Wi‑Fi', password: 'parol',
      copy: 'Nusxa', copied: 'Nusxalandi', call: 'Qo‘ng‘iroq qilish', map: 'Xaritada',
      pricesNote: 'Barcha narxlar so‘mda.', error: 'Menyuni yuklab bo‘lmadi. Internetni tekshirib, sahifani yangilang.',
      retry: 'Yangilash', other: 'Boshqa'
    },
    ru: {
      title: 'Buddy Coffee — Меню', search: 'Поиск', searchPh: 'Блюдо или напиток…', close: 'Закрыть',
      nothing: 'Ничего не найдено', currency: 'сум', out: 'Нет в наличии', price: 'Цена',
      contacts: 'Контакты', address: 'Адрес', hours: 'Часы работы', phone: 'Телефон',
      delivery: 'Доставка', payment: 'Оплата', wifi: 'Wi‑Fi', password: 'пароль',
      copy: 'Копировать', copied: 'Скопировано', call: 'Позвонить', map: 'На карте',
      pricesNote: 'Все цены указаны в сумах.', error: 'Не удалось загрузить меню. Проверьте интернет и обновите страницу.',
      retry: 'Обновить', other: 'Другое'
    }
  };

  const BADGES = {
    hit: { uz: 'Hit', ru: 'Хит' },
    new: { uz: 'Yangi', ru: 'Новинка' },
    spicy: { uz: 'Achchiq', ru: 'Острое' },
    recommend: { uz: 'Tavsiya', ru: 'Советуем' }
  };
  const BADGE_ALIASES = {
    'хит': 'hit', 'hit': 'hit',
    'новинка': 'new', 'новое': 'new', 'yangi': 'new', 'new': 'new',
    'острое': 'spicy', 'острый': 'spicy', 'achchiq': 'spicy', 'spicy': 'spicy',
    'советуем': 'recommend', 'рекомендуем': 'recommend', 'tavsiya': 'recommend', 'recommend': 'recommend'
  };

  // Колонки таблицы → внутренние ключи
  const HEADER_ALIASES = {
    'категория': 'cat', 'название_uz': 'uz', 'название_ru': 'ru', 'описание_uz': 'desc_uz', 'описание_ru': 'desc_ru',
    'цена': 'price', 'размеры_uz': 'sizes_uz', 'размеры_ru': 'sizes_ru', 'фото': 'img', 'метка': 'badge',
    'в_наличии': 'avail', 'иконка': 'icon', 'ключ': 'key', 'значение_uz': 'uz', 'значение_ru': 'ru'
  };
  const NOT_AVAILABLE = /^(нет|no|false|0|-|yo[‘'ʻ’`]?q)$/i;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const els = {
    nav: $('.nav'), chips: $('#chips'), menu: $('#menu'), empty: $('#empty'), info: $('#info'),
    q: $('#q'), sheet: $('#sheet'), sheetMedia: $('.sheet__media'), sheetBadge: $('#sheet-badge'),
    sheetTitle: $('#sheet-title'), sheetDesc: $('#sheet-desc'), sheetPrices: $('#sheet-prices')
  };

  let lang = 'uz';
  let model = null;
  let activeCat = '';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */

  const t = (key) => (UI[lang] && UI[lang][key]) || UI.uz[key] || key;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const norm = (s) => String(s || '').toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/ё/g, 'е');
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/gi, '-');
  const splitList = (s) => String(s || '').split(/[\/;|]/).map((x) => x.trim()).filter(Boolean);
  const toPrices = (s) => splitList(s).map((x) => parseInt(x.replace(/\D/g, ''), 10)).filter((n) => n > 0);

  function storage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  function setting(key) {
    const s = model && model.settings[key];
    if (!s) return '';
    return s[lang] || s.uz || s.ru || '';
  }

  /* ---------- data ---------- */

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function normHeader(h) {
    const key = String(h || '').replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/\s+/g, '_');
    return HEADER_ALIASES[key] || key;
  }

  function toObjects(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const head = rows[0].map(normHeader);
    return rows.slice(1)
      .filter((r) => r.some((c) => String(c == null ? '' : c).trim()))
      .map((r) => {
        const o = {};
        head.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]).trim(); });
        return o;
      });
  }

  function buildModel(tables) {
    const settings = {};
    toObjects(tables.settings).forEach((r) => {
      if (r.key) settings[r.key.toLowerCase()] = { uz: r.uz || '', ru: r.ru || '' };
    });

    const cats = toObjects(tables.categories)
      .filter((c) => c.id)
      .map((c) => ({ id: slug(c.id), uz: c.uz || c.id, ru: c.ru || c.uz || c.id, icon: c.icon || '' }));

    const items = toObjects(tables.menu)
      .filter((r) => r.uz || r.ru)
      .map((r, i) => ({
        id: 'i' + i,
        cat: slug(r.cat) || 'other',
        uz: r.uz || r.ru,
        ru: r.ru || r.uz,
        desc_uz: r.desc_uz || r.desc_ru || '',
        desc_ru: r.desc_ru || r.desc_uz || '',
        prices: toPrices(r.price),
        sizes_uz: splitList(r.sizes_uz),
        sizes_ru: splitList(r.sizes_ru),
        img: r.img || '',
        badge: BADGE_ALIASES[norm(r.badge)] || '',
        avail: !NOT_AVAILABLE.test(r.avail || '')
      }));

    items.forEach((it) => {
      if (!cats.some((c) => c.id === it.cat)) {
        cats.push({ id: it.cat, uz: it.cat === 'other' ? UI.uz.other : it.cat, ru: it.cat === 'other' ? UI.ru.other : it.cat, icon: '' });
      }
    });

    return { settings, cats: cats.filter((c) => items.some((it) => it.cat === c.id)), items };
  }

  function validTables(tables) {
    const has = (rows, keys) => Array.isArray(rows) && rows.length > 1 && keys.every((k) => rows[0].map(normHeader).includes(k));
    return has(tables.menu, ['cat', 'uz', 'price']) && has(tables.categories, ['id']) && has(tables.settings, ['key']);
  }

  async function fetchText(url, ms = 8000) {
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

  async function loadSheet() {
    if (!CONFIG.sheetId) throw new Error('sheetId is empty');
    const url = (name) => `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`;
    const [menu, categories, settings] = await Promise.all([TABS.menu, TABS.categories, TABS.settings].map((n) => fetchText(url(n)).then(parseCSV)));
    const tables = { menu, categories, settings };
    if (!validTables(tables)) throw new Error('Unexpected sheet structure');
    return tables;
  }

  async function loadFallback() {
    const data = JSON.parse(await fetchText(CONFIG.fallback || 'data/menu.json'));
    return { menu: data[TABS.menu], categories: data[TABS.categories], settings: data[TABS.settings] };
  }

  /* ---------- images ---------- */

  function imgSrc(it, size) {
    const v = it.img;
    if (!v) return '';
    const drive = v.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w${size === 's' ? 360 : 960}`;
    if (/^https?:\/\//i.test(v)) return v;
    if (/\.(webp|jpe?g|png|avif)$/i.test(v)) return 'img/' + v.replace(/^\/+/, '');
    return `img/${size}/${v}.webp`;
  }

  function catIcon(it) {
    const c = model.cats.find((x) => x.id === it.cat);
    return (c && c.icon) || '🍽️';
  }

  function placeholder(it) {
    return `<div class="item__ph" aria-hidden="true">${esc(catIcon(it))}</div>`;
  }

  /* ---------- render ---------- */

  function badgeHTML(badge) {
    if (!badge || !BADGES[badge]) return '';
    return `<span class="badge badge--${badge}">${esc(BADGES[badge][lang])}</span>`;
  }

  function sizesOf(it) {
    return it['sizes_' + lang].length ? it['sizes_' + lang] : it.sizes_uz;
  }

  function pricesHTML(it) {
    if (!it.avail) return `<span class="price price--out">${esc(t('out'))}</span>`;
    if (it.prices.length === 1) return `<span class="price">${fmt(it.prices[0])} <small>${esc(t('currency'))}</small></span>`;
    return '';
  }

  // Несколько размеров — отдельная строка на всю ширину карточки
  function variantsHTML(it) {
    if (!it.avail || it.prices.length < 2) return '';
    const sizes = sizesOf(it);
    return `<div class="variants">${it.prices.map((p, i) =>
      `<span class="variant">${sizes[i] ? `<small>${esc(sizes[i])}</small>` : ''}<b>${fmt(p)}</b></span>`).join('')}</div>`;
  }

  function itemHTML(it, index) {
    const name = it[lang];
    const src = imgSrc(it, 's');
    const media = src
      ? `<img class="item__img" src="${esc(src)}" alt="" width="116" height="116" decoding="async"${index < 3 ? '' : ' loading="lazy"'}>`
      : placeholder(it);
    const variants = variantsHTML(it);
    return `<article class="item${it.avail ? '' : ' is-out'}" data-id="${it.id}" tabindex="0" role="button" aria-label="${esc(name)}">
      <div class="item__body">
        <h3 class="item__name">${esc(name)}</h3>
        ${it['desc_' + lang] ? `<p class="item__desc">${esc(it['desc_' + lang])}</p>` : ''}
        ${variants ? '' : `<div class="prices">${pricesHTML(it)}</div>`}
      </div>
      <div class="item__media">${media}${badgeHTML(it.badge)}</div>
      ${variants}
    </article>`;
  }

  function renderChips() {
    els.chips.innerHTML = model.cats.map((c) =>
      `<button type="button" class="chip" data-cat="${c.id}">${c.icon ? `<span class="chip__icon" aria-hidden="true">${esc(c.icon)}</span>` : ''}${esc(c[lang])}</button>`
    ).join('');
  }

  function renderMenu() {
    let n = 0;
    els.menu.innerHTML = model.cats.map((c) => {
      const items = model.items.filter((it) => it.cat === c.id);
      return `<section class="section" id="cat-${c.id}" data-cat="${c.id}" aria-labelledby="h-${c.id}">
        <h2 class="section__title" id="h-${c.id}">${esc(c[lang])} <small>${items.length}</small></h2>
        <div class="items">${items.map((it) => itemHTML(it, n++)).join('')}</div>
      </section>`;
    }).join('');
  }

  function infoRow(icon, label, valueHTML) {
    return `<li class="info__row"><span class="info__icon"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></span>
      <span><span class="info__label">${esc(label)}</span><span class="info__value">${valueHTML}</span></span></li>`;
  }

  function socialURL(v, base) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return base + v.replace(/^@/, '');
  }

  function telHref(v) {
    return 'tel:' + String(v).replace(/[^\d+]/g, '');
  }

  function renderInfo() {
    const phone = setting('телефон');
    const rows = [];
    if (setting('адрес')) rows.push(infoRow('i-pin', t('address'), esc(setting('адрес'))));
    if (setting('часы_работы')) rows.push(infoRow('i-clock', t('hours'), esc(setting('часы_работы'))));
    if (phone) rows.push(infoRow('i-phone', t('phone'), `<a href="${esc(telHref(phone))}">${esc(phone)}</a>`));
    if (setting('доставка')) rows.push(infoRow('i-scooter', t('delivery'), esc(setting('доставка'))));
    if (setting('оплата')) rows.push(infoRow('i-card', t('payment'), esc(setting('оплата'))));
    if (setting('wifi_сеть') || setting('wifi_пароль')) {
      const pass = setting('wifi_пароль');
      rows.push(infoRow('i-wifi', t('wifi'),
        `${esc(setting('wifi_сеть'))}${pass ? ` · ${esc(t('password'))}: <b>${esc(pass)}</b> <button type="button" class="info__copy" data-copy="${esc(pass)}">${esc(t('copy'))}</button>` : ''}`));
    }

    const actions = [];
    if (phone) actions.push(`<a class="btn btn--primary" href="${esc(telHref(phone))}"><svg viewBox="0 0 24 24"><use href="#i-phone"/></svg>${esc(t('call'))}</a>`);
    if (setting('ссылка_на_карту')) actions.push(`<a class="btn" href="${esc(setting('ссылка_на_карту'))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><use href="#i-pin"/></svg>${esc(t('map'))}</a>`);
    if (setting('instagram')) actions.push(`<a class="btn" href="${esc(socialURL(setting('instagram'), 'https://instagram.com/'))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><use href="#i-insta"/></svg>Instagram</a>`);
    if (setting('telegram')) actions.push(`<a class="btn" href="${esc(socialURL(setting('telegram'), 'https://t.me/'))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><use href="#i-tg"/></svg>Telegram</a>`);

    els.info.innerHTML = `<div class="info__card">
        <h2 class="info__title">${esc(t('contacts'))}</h2>
        <ul class="info__list">${rows.join('')}</ul>
        ${actions.length ? `<div class="info__actions">${actions.join('')}</div>` : ''}
      </div>
      <p class="info__note">${esc(t('pricesNote'))}</p>
      ${setting('примечание_к_фото') ? `<p class="info__note">${esc(setting('примечание_к_фото'))}</p>` : ''}`;
  }

  function applySettings() {
    $$('[data-setting]').forEach((el) => {
      const v = setting(el.dataset.setting);
      if (v) el.textContent = v;
    });
    $$('[data-setting-wrap]').forEach((el) => { el.hidden = !setting(el.dataset.settingWrap); });
    const tel = $('[data-tel]');
    if (tel && setting('телефон')) tel.href = telHref(setting('телефон'));
  }

  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = t('title');
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }

  function render() {
    applyStatic();
    if (!model) return;
    applySettings();
    renderChips();
    renderMenu();
    renderInfo();
    applySearch();
    activeCat = '';
    updateSpy();
  }

  function renderError() {
    els.menu.innerHTML = `<div class="empty"><p>${esc(t('error'))}</p><button type="button" class="chip" onclick="location.reload()">${esc(t('retry'))}</button></div>`;
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
  }

  /* ---------- sheet (item details) ---------- */

  function openSheet(id) {
    const it = model && model.items.find((x) => x.id === id);
    if (!it) return;
    const src = imgSrc(it, 'l');
    els.sheetMedia.innerHTML = src ? `<img src="${esc(src)}" alt="${esc(it[lang])}" width="960" height="720">` : placeholder(it);
    els.sheetBadge.innerHTML = badgeHTML(it.badge);
    els.sheetTitle.textContent = it[lang];
    els.sheetDesc.textContent = it['desc_' + lang];
    els.sheetDesc.hidden = !it['desc_' + lang];

    const sizes = sizesOf(it);
    let rows;
    if (!it.avail) rows = `<li class="is-out">${esc(t('out'))}</li>`;
    else if (it.prices.length > 1) rows = it.prices.map((p, i) => `<li><span>${esc(sizes[i] || '')}</span><b>${fmt(p)} ${esc(t('currency'))}</b></li>`).join('');
    else if (it.prices.length === 1) rows = `<li><span>${esc(t('price'))}</span><b>${fmt(it.prices[0])} ${esc(t('currency'))}</b></li>`;
    else rows = '';
    els.sheetPrices.innerHTML = rows;

    if (typeof els.sheet.showModal === 'function') els.sheet.showModal();
    else els.sheet.setAttribute('open', '');
    $('.sheet__card').scrollTop = 0;
    history.pushState({ sheet: true }, '');
  }

  function closeSheet() {
    if (history.state && history.state.sheet) history.back();
    else hideSheet();
  }

  function hideSheet() {
    if (!els.sheet.open) return;
    if (typeof els.sheet.close === 'function') els.sheet.close();
    else els.sheet.removeAttribute('open');
  }

  /* ---------- search ---------- */

  function applySearch() {
    if (!model) return;
    const q = norm(els.q.value.trim());
    let any = false;
    $$('.section', els.menu).forEach((sec) => {
      let shown = 0;
      $$('.item', sec).forEach((el) => {
        const it = model.items.find((x) => x.id === el.dataset.id);
        const hay = norm([it.uz, it.ru, it.desc_uz, it.desc_ru].join(' '));
        const hit = !q || hay.includes(q);
        el.hidden = !hit;
        if (hit) shown++;
      });
      sec.hidden = shown === 0;
      $('.section__title small', sec).textContent = shown;
      if (shown) any = true;
    });
    els.empty.hidden = any;
  }

  function openSearch() {
    els.nav.classList.add('is-search');
    const top = els.nav.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY < top) window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    els.q.focus();
  }

  function closeSearch() {
    els.q.value = '';
    els.nav.classList.remove('is-search');
    applySearch();
  }

  /* ---------- scroll spy ---------- */

  function setActive(id) {
    if (id === activeCat) return;
    activeCat = id;
    $$('.chip', els.chips).forEach((c) => {
      const on = c.dataset.cat === id;
      c.setAttribute('aria-current', String(on));
      if (on) {
        const left = c.offsetLeft - els.chips.offsetLeft - 8;
        els.chips.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
  }

  function updateSpy() {
    const navRect = els.nav.getBoundingClientRect();
    els.nav.classList.toggle('is-stuck', navRect.top <= 0 && window.scrollY > 0);
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
      if (sec) sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      setActive(chip.dataset.cat);
    });

    els.menu.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (item) openSheet(item.dataset.id);
    });
    els.menu.addEventListener('keydown', (e) => {
      const item = e.target.closest('.item');
      if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSheet(item.dataset.id); }
    });

    // Битая ссылка на фото → заглушка с иконкой категории
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !model) return;
      const host = img.closest('.item, .sheet');
      const id = host && host.classList.contains('item') ? host.dataset.id : null;
      const it = model.items.find((x) => x.id === id) || model.items.find((x) => x[lang] === img.alt);
      img.outerHTML = it ? placeholder(it) : '';
    }, true);

    $('.sheet__close').addEventListener('click', closeSheet);
    els.sheet.addEventListener('click', (e) => { if (e.target === els.sheet) closeSheet(); });
    els.sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
    window.addEventListener('popstate', hideSheet);

    $('.nav__search-btn').addEventListener('click', openSearch);
    $('.nav__search-close').addEventListener('click', closeSearch);
    els.q.addEventListener('input', () => { applySearch(); updateSpy(); });
    els.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); if (e.key === 'Enter') els.q.blur(); });

    els.info.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn || !navigator.clipboard) return;
      navigator.clipboard.writeText(btn.dataset.copy).then(() => { btn.textContent = t('copied'); });
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  /* ---------- start ---------- */

  async function init() {
    lang = detectLang();
    bindUI();
    applyStatic();

    const cachedRaw = storage((s) => s.getItem(CACHE_KEY));
    let cached = null;
    try { cached = cachedRaw ? JSON.parse(cachedRaw) : null; } catch (e) { cached = null; }
    if (cached && validTables(cached)) {
      model = buildModel(cached);
      render();
    } else cached = null;

    let tables = null;
    try {
      tables = await loadSheet();
    } catch (e) {
      if (CONFIG.sheetId) console.warn('[menu] Google Sheet:', e.message);
    }
    if (!tables && !cached) {
      try { tables = await loadFallback(); } catch (e) { console.warn('[menu] fallback:', e.message); }
    }

    if (tables) {
      const json = JSON.stringify(tables);
      if (json !== cachedRaw) {
        model = buildModel(tables);
        render();
      }
      if (CONFIG.sheetId) storage((s) => s.setItem(CACHE_KEY, json));
    } else if (!model) {
      renderError();
    }
  }

  init();
})();
