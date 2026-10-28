(() => {
  'use strict';

  const CONFIG = window.MENU_CONFIG || {};
  const TABS = CONFIG.tabs || { menu: 'Меню', categories: 'Категории', settings: 'Настройки' };
  const SITE = 'https://buddy.cheking.uz/';
  const CACHE_KEY = 'buddy-menu:data:v2';
  const LANG_KEY = 'buddy-menu:lang';
  const FALLBACK_AFTER = 2000; // мс ожидания таблицы, после которых показываем запасную копию
  const STALE_AFTER = 24 * 3600 * 1000; // кэш старше суток помечаем датой

  const UI = {
    uz: {
      title: 'Buddy Coffee — Menyu', h1: '— menyu', skip: 'Menyuga o‘tish', cats: 'Kategoriyalar',
      search: 'Qidirish', searchPh: 'Taom yoki ichimlik…', close: 'Yopish', popular: 'Ommabop',
      nothing: 'Hech narsa topilmadi', found: (n) => `${n} ta natija`, currency: 'so‘m', out: 'Hozir yo‘q', price: 'Narxi',
      from: (p) => `${p} so‘mdan`,
      contacts: 'Biz bilan bog‘lanish', address: 'Manzil', hours: 'Ish vaqti', phone: 'Telefon',
      delivery: 'Yetkazib berish', payment: 'To‘lov', wifi: 'Wi‑Fi', password: 'parol',
      copy: 'Nusxa olish', copied: 'Nusxalandi', call: 'Qo‘ng‘iroq qilish', map: 'Xaritada',
      pricesNote: 'Barcha narxlar so‘mda.', error: 'Menyuni yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
      retry: 'Qayta urinish', other: 'Boshqa',
      stale: (d) => `Internet yo‘q — narxlar ${d} holatiga ko‘rsatilmoqda.`
    },
    ru: {
      title: 'Buddy Coffee — Меню', h1: '— меню', skip: 'Перейти к меню', cats: 'Категории',
      search: 'Поиск', searchPh: 'Блюдо или напиток…', close: 'Закрыть', popular: 'Популярное',
      nothing: 'Ничего не найдено', found: (n) => `Найдено: ${n}`, currency: 'сум', out: 'Нет в наличии', price: 'Цена',
      from: (p) => `от ${p} сум`,
      contacts: 'Контакты', address: 'Адрес', hours: 'Часы работы', phone: 'Телефон',
      delivery: 'Доставка', payment: 'Оплата', wifi: 'Wi‑Fi', password: 'пароль',
      copy: 'Копировать', copied: 'Скопировано', call: 'Позвонить', map: 'На карте',
      pricesNote: 'Все цены указаны в сумах.', error: 'Не удалось загрузить меню. Проверьте интернет и попробуйте ещё раз.',
      retry: 'Повторить', other: 'Другое',
      stale: (d) => `Нет связи — показаны цены на ${d}.`
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
    'в_наличии': 'avail', 'вес': 'weight', 'выход': 'weight', 'объём': 'weight', 'объем': 'weight',
    'иконка': 'icon', 'ключ': 'key', 'значение_uz': 'uz', 'значение_ru': 'ru'
  };
  const NOT_AVAILABLE = /^(нет|no|false|0|-|yo[‘'ʻ’`]?q)$/i;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const els = {
    nav: $('.nav'), chips: $('#chips'), menu: $('#menu'), empty: $('#empty'), status: $('#status'), info: $('#info'),
    q: $('#q'), searchBtn: $('.nav__search-btn'), sheet: $('#sheet'), card: $('.sheet__card'), sheetMedia: $('.sheet__media'),
    sheetBadge: $('#sheet-badge'), sheetTitle: $('#sheet-title'), sheetDesc: $('#sheet-desc'), sheetMeta: $('#sheet-meta'),
    sheetPrices: $('#sheet-prices'), lang: $('.lang')
  };

  let lang = 'uz';
  let model = null;
  let shownJSON = '';
  let activeCat = '';
  let openId = null;
  let goingBack = false;
  let opener = null;
  let spyLockUntil = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */

  const t = (key, ...args) => {
    const v = (UI[lang] && UI[lang][key]) || UI.uz[key];
    return typeof v === 'function' ? v(...args) : (v || key);
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const norm = (s) => String(s || '').toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/ё/g, 'е');
  const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-');
  const splitList = (s) => String(s || '').split(/[\/;|]/).map((x) => x.trim()).filter(Boolean);
  // «35000.00» → 35000; «35 000», «35,000» → 35000
  const toPrices = (s) => splitList(s).map((x) => parseInt(x.replace(/[.,]\d{1,2}$/, '').replace(/\D/g, ''), 10)).filter((n) => n > 0);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function storage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  // Ссылки из таблицы: только http(s), tel и mailto
  function safeUrl(v) {
    try {
      const u = new URL(String(v).trim(), location.href);
      return ['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol) ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function setting(key) {
    const s = model && model.settings[key];
    if (!s) return '';
    return s[lang] || s.uz || s.ru || '';
  }

  /* ---------- data ---------- */

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
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
        weight: r.weight || '',
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
    return !!tables && has(tables.menu, ['cat', 'uz', 'price']) && has(tables.categories, ['id']) && has(tables.settings, ['key']);
  }

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
    if (!CONFIG.sheetId) throw new Error('sheetId is empty');
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CONFIG.sheetId)}`;
    const gids = CONFIG.gids || {};
    const url = (key) => (gids[key]
      ? `${base}/export?format=csv&gid=${encodeURIComponent(gids[key])}`
      : `${base}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(TABS[key])}`);
    const [menu, categories, settings] = await Promise.all(
      ['menu', 'categories', 'settings'].map((k) => fetchText(url(k), 12000).then(parseCSV))
    );
    const tables = { menu, categories, settings };
    if (!validTables(tables)) throw new Error('Unexpected sheet structure');
    return tables;
  }

  async function loadFallback() {
    const data = JSON.parse(await fetchText(CONFIG.fallback || 'data/menu.json', 8000));
    return { menu: data[TABS.menu], categories: data[TABS.categories], settings: data[TABS.settings] };
  }

  // Показывает данные, только если они отличаются от уже показанных
  function apply(tables) {
    const json = JSON.stringify(tables);
    if (json === shownJSON) return;
    shownJSON = json;
    model = buildModel(tables);
    render();
  }

  /* ---------- images ---------- */

  const isLocalImg = (v) => /^[\w-]+$/.test(v);

  function imgSrc(it, size) {
    const v = it.img;
    if (!v) return '';
    const drive = v.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w${size === 's' ? 360 : 960}`;
    if (/^https?:\/\//i.test(v)) return safeUrl(v);
    if (isLocalImg(v)) return `img/${size}/${v}.webp`;
    return 'img/' + v.replace(/^\/+/, '').replace(/\.\.\//g, '');
  }

  function catIcon(it) {
    const c = model.cats.find((x) => x.id === it.cat);
    return (c && c.icon) || '🍽️';
  }

  function placeholder(it) {
    return `<span class="item__ph" aria-hidden="true">${esc(catIcon(it))}</span>`;
  }

  function pictureHTML(it, cls, w, h, eager) {
    const src = imgSrc(it, 's');
    if (!src) return placeholder(it);
    const avif = isLocalImg(it.img) ? `<source type="image/avif" srcset="img/s/${it.img}.avif">` : '';
    const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
    return `<picture>${avif}<img class="${cls}" src="${esc(src)}" alt="" width="${w}" height="${h}" decoding="async" ${loading}></picture>`;
  }

  function markLoaded(root) {
    $$('img', root).forEach((img) => { if (img.complete && img.naturalWidth) img.classList.add('is-loaded'); });
  }

  /* ---------- render ---------- */

  function badgeHTML(badge) {
    if (!badge || !BADGES[badge]) return '';
    return `<span class="badge badge--${badge}">${esc(BADGES[badge][lang])}</span>`;
  }

  function sizesOf(it) {
    return it['sizes_' + lang].length ? it['sizes_' + lang] : it.sizes_uz;
  }

  // «150 / 200 / 250 g» → ['150 g', '200 g', '250 g']; единицы — под язык (g/г, ml/мл, kg/кг, l/л)
  const UNITS = { g: ['g', 'г'], kg: ['kg', 'кг'], ml: ['ml', 'мл'], l: ['l', 'л'] };
  const UNIT_ALIASES = { g: 'g', gr: 'g', 'г': 'g', 'гр': 'g', kg: 'kg', 'кг': 'kg', ml: 'ml', 'мл': 'ml', l: 'l', 'л': 'l' };

  function weightsOf(it) {
    const parts = splitList(it.weight);
    if (!parts.length) return [];
    const tail = parts[parts.length - 1].match(/(\p{L}+)\.?\s*$/u);
    return parts.map((p) => {
      const m = p.match(/^([\d.,]+)\s*(\p{L}*)\.?$/u);
      if (!m) return p;
      const unit = UNIT_ALIASES[(m[2] || (tail ? tail[1] : '')).toLowerCase()];
      return unit ? `${m[1]}\u00a0${UNITS[unit][lang === 'ru' ? 1 : 0]}` : p;
    });
  }

  // Вес у каждого размера показываем в плашке размера, а здесь — только общий
  function weightHTML(it) {
    const w = weightsOf(it);
    if (!w.length || (it.avail && it.prices.length > 1 && w.length === it.prices.length)) return '';
    return `<span class="weight">${esc(w.join(' / '))}</span>`;
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
    const w = weightsOf(it);
    const ws = w.length === it.prices.length ? w : [];
    return `<div class="variants">${it.prices.map((p, i) =>
      `<span class="variant">${sizes[i] ? `<small>${esc(sizes[i])}</small>` : ''}<b>${fmt(p)}<span class="sr-only"> ${esc(t('currency'))}</span></b>${ws[i] ? `<small class="variant__w">${esc(ws[i])}</small>` : ''}</span>`).join('')}</div>`;
  }

  function itemHTML(it, index) {
    const desc = it['desc_' + lang];
    const variants = variantsHTML(it);
    const meta = variants ? weightHTML(it) : pricesHTML(it) + weightHTML(it);
    return `<article class="item${it.avail ? '' : ' is-out'}" data-id="${it.id}">
      <div class="item__body">
        <h3 class="item__name"><button type="button" class="item__btn" aria-haspopup="dialog">${esc(it[lang])}</button></h3>
        ${desc ? `<p class="item__desc">${esc(desc)}</p>` : ''}
        ${meta ? `<div class="prices">${meta}</div>` : ''}
      </div>
      <div class="item__media"><span class="item__frame">${pictureHTML(it, 'item__img', 116, 116, index < 2)}</span>${badgeHTML(it.badge)}</div>
      ${variants}
    </article>`;
  }

  function popularHTML() {
    const picks = model.items.filter((it) => it.avail && (it.badge === 'hit' || it.badge === 'recommend')).slice(0, 8);
    if (picks.length < 2) return '';
    return `<section class="popular" aria-labelledby="pop-title">
      <h2 class="popular__title" id="pop-title">${esc(t('popular'))}</h2>
      <div class="popular__track">${picks.map((it) => {
        const price = it.prices.length > 1 ? t('from', fmt(Math.min(...it.prices))) : it.prices.length ? `${fmt(it.prices[0])} ${t('currency')}` : '';
        return `<button type="button" class="pop" data-id="${it.id}" aria-haspopup="dialog">
          <span class="pop__frame">${pictureHTML(it, 'pop__img', 156, 128, false)}</span>
          <span class="pop__body"><span class="pop__name">${esc(it[lang])}</span><span class="pop__price">${esc(price)}</span></span>
          ${badgeHTML(it.badge)}
        </button>`;
      }).join('')}</div>
    </section>`;
  }

  function renderChips() {
    els.chips.innerHTML = model.cats.map((c) =>
      `<button type="button" class="chip" data-cat="${c.id}" aria-controls="cat-${c.id}">${c.icon ? `<span class="chip__icon" aria-hidden="true">${esc(c.icon)}</span>` : ''}${esc(c[lang])}</button>`
    ).join('');
  }

  function renderMenu() {
    let n = 0;
    els.menu.innerHTML = popularHTML() + model.cats.map((c) => {
      const items = model.items.filter((it) => it.cat === c.id);
      return `<section class="section" id="cat-${c.id}" data-cat="${c.id}" aria-labelledby="h-${c.id}">
        <h2 class="section__title" id="h-${c.id}" tabindex="-1">${esc(c[lang])} <small aria-hidden="true">${items.length}</small></h2>
        <div class="items">${items.map((it) => itemHTML(it, n++)).join('')}</div>
      </section>`;
    }).join('');
    markLoaded(els.menu);
  }

  function infoRow(icon, label, valueHTML) {
    return `<li class="info__row"><span class="info__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></span>
      <span><span class="info__label">${esc(label)}</span><span class="info__value">${valueHTML}</span></span></li>`;
  }

  function socialURL(v, base) {
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? safeUrl(v) : safeUrl(base + v.replace(/^@/, ''));
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

    const map = safeUrl(setting('ссылка_на_карту'));
    const insta = socialURL(setting('instagram'), 'https://instagram.com/');
    const tg = socialURL(setting('telegram'), 'https://t.me/');
    const actions = [];
    if (phone) actions.push(`<a class="btn btn--primary" href="${esc(telHref(phone))}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-phone"/></svg>${esc(t('call'))}</a>`);
    if (setting('ссылка_на_карту') && map) actions.push(`<a class="btn" href="${esc(map)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-pin"/></svg>${esc(t('map'))}</a>`);
    if (insta) actions.push(`<a class="btn" href="${esc(insta)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-insta"/></svg>Instagram</a>`);
    if (tg) actions.push(`<a class="btn" href="${esc(tg)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-tg"/></svg>Telegram</a>`);

    const notes = [t('pricesNote'), setting('примечание_к_фото'), setting('продавец')].filter(Boolean);
    els.info.innerHTML = `<section class="info__card" aria-labelledby="info-title">
        <h2 class="info__title" id="info-title">${esc(t('contacts'))}</h2>
        <ul class="info__list">${rows.join('')}</ul>
        ${actions.length ? `<div class="info__actions">${actions.join('')}</div>` : ''}
      </section>
      ${notes.map((n) => `<p class="info__note">${esc(n)}</p>`).join('')}`;
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
    document.documentElement.lang = lang === 'uz' ? 'uz-Latn' : 'ru';
    document.title = t('title');
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    els.lang.dataset.active = lang;
  }

  // Структурированные данные schema.org: кафе + меню (для поисковиков и карт)
  function renderJSONLD() {
    const abs = (src) => (src ? new URL(src, SITE).href : undefined);
    const data = {
      '@context': 'https://schema.org',
      '@type': 'CafeOrCoffeeShop',
      name: 'Buddy Coffee',
      url: SITE,
      image: SITE + 'img/og.jpg',
      telephone: setting('телефон').replace(/[^\d+]/g, '') || undefined,
      servesCuisine: ['Fast food', 'Coffee'],
      address: setting('адрес') ? { '@type': 'PostalAddress', streetAddress: setting('адрес'), addressCountry: 'UZ' } : undefined,
      hasMenu: {
        '@type': 'Menu',
        inLanguage: lang,
        hasMenuSection: model.cats.map((c) => ({
          '@type': 'MenuSection',
          name: c[lang],
          hasMenuItem: model.items.filter((it) => it.cat === c.id).map((it) => ({
            '@type': 'MenuItem',
            name: it[lang],
            description: it['desc_' + lang] || undefined,
            image: abs(imgSrc(it, 'l')),
            offers: it.prices.map((p, i) => ({
              '@type': 'Offer',
              price: p,
              priceCurrency: 'UZS',
              name: sizesOf(it)[i] || undefined,
              availability: it.avail ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
            }))
          }))
        }))
      }
    };
    let node = $('#ld-json');
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/ld+json';
      node.id = 'ld-json';
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify(data);
  }

  function render() {
    applyStatic();
    if (!model) return;
    // Перерисовка не должна сбивать фокус клавиатуры
    const focused = document.activeElement;
    const focusHost = focused && focused.closest && focused.closest('[data-id], [data-cat]');
    const focusSel = focusHost ? (focusHost.dataset.id ? `[data-id="${focusHost.dataset.id}"]` : `.chip[data-cat="${focusHost.dataset.cat}"]`) : '';
    const focusIsBtn = focused && focused.classList && focused.classList.contains('item__btn');
    applySettings();
    renderChips();
    renderMenu();
    renderInfo();
    renderJSONLD();
    applySearch(true);
    activeCat = '';
    updateSpy();
    if (openId && els.sheet.open) fillSheet(model.items.find((x) => x.id === openId));
    if (focusSel) {
      const host = $(focusSel);
      const target = host && (focusIsBtn ? $('.item__btn', host) : host);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function renderError() {
    els.menu.innerHTML = `<div class="empty"><p>${esc(t('error'))}</p><button type="button" class="chip" id="retry">${esc(t('retry'))}</button></div>`;
    $('#retry').addEventListener('click', () => location.reload());
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

  function sheetImgHTML(it, thumb) {
    const src = thumb || imgSrc(it, 's');
    if (!src) return placeholder(it);
    return `<img class="sheet__img${thumb ? ' is-loaded' : ''}" src="${esc(src)}" alt="" width="960" height="720">`;
  }

  function fillSheet(it, thumb) {
    if (!it) return;
    els.sheetMedia.innerHTML = sheetImgHTML(it, thumb);
    els.sheetBadge.innerHTML = badgeHTML(it.badge);
    els.sheetTitle.textContent = it[lang];
    els.sheetDesc.textContent = it['desc_' + lang];
    els.sheetDesc.hidden = !it['desc_' + lang];
    const weights = weightsOf(it);
    const perSize = it.prices.length > 1 && weights.length === it.prices.length;
    els.sheetMeta.textContent = perSize ? '' : weights.join(' / ');

    const sizes = sizesOf(it);
    const cur = esc(t('currency'));
    let rows = '';
    if (!it.avail) rows = `<li class="is-out">${esc(t('out'))}</li>`;
    else if (it.prices.length > 1) rows = it.prices.map((p, i) => `<li><span>${esc(sizes[i] || '')}${perSize ? ` <small>· ${esc(weights[i])}</small>` : ''}</span><b>${fmt(p)} ${cur}</b></li>`).join('');
    else if (it.prices.length === 1) rows = `<li><span>${esc(t('price'))}</span><b>${fmt(it.prices[0])} ${cur}</b></li>`;
    els.sheetPrices.innerHTML = rows;

    // Сначала показываем уже загруженное превью, затем подменяем на большое фото
    const img = $('img', els.sheetMedia);
    const large = imgSrc(it, 'l');
    if (img && large) {
      const wantAvif = thumb && /\.avif(\?|$)/.test(thumb) && isLocalImg(it.img);
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
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
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
    const q = norm(els.q.value.trim());
    let total = 0;
    $$('.section', els.menu).forEach((sec) => {
      let shown = 0;
      $$('.item', sec).forEach((el) => {
        const it = model.items.find((x) => x.id === el.dataset.id);
        const cat = model.cats.find((c) => c.id === it.cat) || {};
        const hit = !q || norm([it.uz, it.ru, it.desc_uz, it.desc_ru, cat.uz, cat.ru].join(' ')).includes(q);
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
      const el = e.target.closest('.item, .pop');
      if (el) openSheet(el.dataset.id, el);
    });

    // Плавное появление фото; битая ссылка → заглушка с иконкой категории
    document.addEventListener('load', (e) => {
      if (e.target instanceof HTMLImageElement) e.target.classList.add('is-loaded');
    }, true);
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !model) return;
      const host = img.closest('[data-id]');
      const it = host ? model.items.find((x) => x.id === host.dataset.id) : model.items.find((x) => x.id === openId);
      (img.closest('picture') || img).outerHTML = it ? placeholder(it) : '';
    }, true);

    $('.sheet__close').addEventListener('click', closeSheet);
    els.sheet.addEventListener('click', (e) => { if (e.target === els.sheet) closeSheet(); });
    els.sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
    window.addEventListener('popstate', () => { goingBack = false; hideSheet(); });
    $('.sheet__done').addEventListener('click', closeSheet);
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

  function showStale(time) {
    const el = $('#stale');
    if (!el) return;
    const d = new Date(time);
    const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    el.textContent = t('stale', date);
    el.hidden = false;
  }

  async function init() {
    lang = detectLang();
    // После перезагрузки с открытой шторкой в истории остаётся её запись — убираем
    if (history.state && history.state.sheet) history.replaceState(null, '');
    bindUI();
    applyStatic();

    // Кэш: последняя удачно загруженная таблица + время загрузки
    let cached = null;
    try { cached = JSON.parse(storage((s) => s.getItem(CACHE_KEY)) || 'null'); } catch (e) { cached = null; }
    if (cached && validTables(cached.tables)) apply(cached.tables);
    else cached = null;

    const sheet = loadSheet().catch((e) => {
      if (CONFIG.sheetId) console.warn('[menu] Google Sheet:', e.message);
      return null;
    });

    // Нет кэша: ждём таблицу недолго, потом показываем запасную копию
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
      els.status.textContent = t('error');
    } else if (cached && Date.now() - cached.t > STALE_AFTER) {
      showStale(cached.t);
    }

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
