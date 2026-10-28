/* Общая логика меню: разбор данных таблицы и HTML-разметка.
   Работает и в браузере (assets/app.js), и при сборке (tools/build.mjs) — поэтому без DOM. */
(function (root) {
  'use strict';

  const SITE = 'https://buddy.cheking.uz/';

  const UI = {
    uz: {
      title: 'Buddy Coffee — Menyu', h1: '— menyu', skip: 'Menyuga o‘tish', cats: 'Kategoriyalar',
      search: 'Qidirish', searchPh: 'Taom yoki ichimlik…', close: 'Yopish', popular: 'Ommabop',
      nothing: 'Hech narsa topilmadi', found: (n) => `${n} ta natija`, currency: 'so‘m', out: 'Hozir yo‘q', price: 'Narxi',
      from: (p) => `${p} so‘mdan`,
      contacts: 'Biz bilan bog‘lanish', address: 'Manzil', hours: 'Ish vaqti', phone: 'Telefon',
      delivery: 'Yetkazib berish', payment: 'To‘lov', wifi: 'Wi‑Fi', password: 'parol',
      copy: 'Nusxa olish', copied: 'Nusxalandi', call: 'Qo‘ng‘iroq qilish', map: 'Xaritada',
      pricesNote: 'Barcha narxlar so‘mda.', privacy: 'Sayt cookie-fayllardan foydalanmaydi va shaxsiy ma’lumot yig‘maydi.',
      error: 'Menyuni yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
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
      pricesNote: 'Все цены указаны в сумах.', privacy: 'Сайт не использует cookie и не собирает персональные данные.',
      error: 'Не удалось загрузить меню. Проверьте интернет и попробуйте ещё раз.',
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

  // Единицы веса/объёма под язык: g/г, ml/мл, kg/кг, l/л
  const UNITS = { g: ['g', 'г'], kg: ['kg', 'кг'], ml: ['ml', 'мл'], l: ['l', 'л'] };
  const UNIT_ALIASES = { g: 'g', gr: 'g', 'г': 'g', 'гр': 'g', kg: 'kg', 'кг': 'kg', ml: 'ml', 'мл': 'ml', l: 'l', 'л': 'l' };

  /* ---------- helpers ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const norm = (s) => String(s || '').toLowerCase().replace(/[‘’ʻʼ'`]/g, '').replace(/ё/g, 'е');
  const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-');
  const splitList = (s) => String(s || '').split(/[\/;|]/).map((x) => x.trim()).filter(Boolean);
  // «35000.00» → 35000; «35 000», «35,000» → 35000
  const toPrices = (s) => splitList(s).map((x) => parseInt(x.replace(/[.,]\d{1,2}$/, '').replace(/\D/g, ''), 10)).filter((n) => n > 0);

  // Ссылки из таблицы: только http(s), tel и mailto
  function safeUrl(v) {
    try {
      const u = new URL(String(v || '').trim(), SITE);
      return v && ['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol) ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  /* ---------- data ---------- */

  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
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

  /* ---------- images ---------- */

  const isLocalImg = (v) => /^[\w-]+$/.test(v);

  // Имя файла из папки img, прямая ссылка или ссылка на файл Google Диска с доступом по ссылке
  function imgSrc(it, size) {
    const v = it.img;
    if (!v) return '';
    const drive = v.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w${size === 'l' ? 960 : 360}`;
    if (/^https?:\/\//i.test(v)) return safeUrl(v);
    if (isLocalImg(v)) return `img/${size}/${v}.webp`;
    return 'img/' + v.replace(/^\/+/, '').replace(/\.\.\//g, '');
  }

  /* ---------- view: разметка для конкретного языка ---------- */

  function createView(model, lang) {
    const t = (key, ...args) => {
      const v = (UI[lang] && UI[lang][key]) || UI.uz[key];
      return typeof v === 'function' ? v(...args) : (v || key);
    };

    const setting = (key) => {
      const s = model.settings[key];
      return s ? (s[lang] || s.uz || s.ru || '') : '';
    };

    const telHref = (v) => 'tel:' + String(v).replace(/[^\d+]/g, '');
    const socialURL = (v, base) => (!v ? '' : /^https?:\/\//i.test(v) ? safeUrl(v) : safeUrl(base + v.replace(/^@/, '')));

    function catIcon(it) {
      const c = model.cats.find((x) => x.id === it.cat);
      return (c && c.icon) || '🍽️';
    }

    function placeholder(it) {
      return `<span class="item__ph" aria-hidden="true">${esc(catIcon(it))}</span>`;
    }

    // priority: 'high' — первый экран (LCP), 'eager' — сразу, иначе лениво
    function pictureHTML(it, cls, w, h, priority) {
      const src = imgSrc(it, 's');
      if (!src) return placeholder(it);
      const sizes = cls === 'item__img' ? '(max-width: 360px) 96px, 116px' : `${w}px`;
      const load = priority === 'high' ? 'fetchpriority="high"' : priority === 'eager' ? '' : 'loading="lazy"';
      if (!isLocalImg(it.img)) {
        return `<img class="${cls}" src="${esc(src)}" alt="" width="${w}" height="${h}" decoding="async" ${load}>`;
      }
      const set = (ext) => `img/xs/${it.img}.${ext} 240w, img/s/${it.img}.${ext} 360w`;
      return `<picture><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">` +
        `<img class="${cls}" src="${src}" srcset="${set('webp')}" sizes="${sizes}" alt="" width="${w}" height="${h}" decoding="async" ${load}></picture>`;
    }

    function badgeHTML(badge) {
      if (!badge || !BADGES[badge]) return '';
      return `<span class="badge badge--${badge}">${esc(BADGES[badge][lang])}</span>`;
    }

    function sizesOf(it) {
      return it['sizes_' + lang].length ? it['sizes_' + lang] : it.sizes_uz;
    }

    // «150 / 200 / 250 g» → ['150 g', '200 g', '250 g']
    function weightsOf(it) {
      const parts = splitList(it.weight);
      if (!parts.length) return [];
      const tail = parts[parts.length - 1].match(/(\p{L}+)\.?\s*$/u);
      return parts.map((p) => {
        const m = p.match(/^([\d.,]+)\s*(\p{L}*)\.?$/u);
        if (!m) return p;
        const unit = UNIT_ALIASES[(m[2] || (tail ? tail[1] : '')).toLowerCase()];
        return unit ? `${m[1]} ${UNITS[unit][lang === 'ru' ? 1 : 0]}` : p;
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
      <div class="item__media"><span class="item__frame">${pictureHTML(it, 'item__img', 116, 116, index < 2 ? 'eager' : 'lazy')}</span>${badgeHTML(it.badge)}</div>
      ${variants}
    </article>`;
    }

    function popularHTML() {
      const picks = model.items.filter((it) => it.avail && (it.badge === 'hit' || it.badge === 'recommend')).slice(0, 8);
      if (picks.length < 2) return '';
      return `<section class="popular" aria-labelledby="pop-title">
      <h2 class="popular__title" id="pop-title">${esc(t('popular'))}</h2>
      <div class="popular__track">${picks.map((it, i) => {
        const price = it.prices.length > 1 ? t('from', fmt(Math.min(...it.prices))) : it.prices.length ? `${fmt(it.prices[0])} ${t('currency')}` : '';
        return `<button type="button" class="pop" data-id="${it.id}" aria-haspopup="dialog">
          <span class="pop__frame">${pictureHTML(it, 'pop__img', 156, 128, i < 2 ? 'high' : i < 3 ? 'eager' : 'lazy')}</span>
          <span class="pop__body"><span class="pop__name">${esc(it[lang])}</span><span class="pop__price">${esc(price)}</span></span>
          ${badgeHTML(it.badge)}
        </button>`;
      }).join('')}</div>
    </section>`;
    }

    function menuHTML() {
      let n = 0;
      return popularHTML() + model.cats.map((c) => {
        const items = model.items.filter((it) => it.cat === c.id);
        return `<section class="section" id="cat-${c.id}" data-cat="${c.id}" aria-labelledby="h-${c.id}">
        <h2 class="section__title" id="h-${c.id}" tabindex="-1">${esc(c[lang])} <small aria-hidden="true">${items.length}</small></h2>
        <div class="items">${items.map((it) => itemHTML(it, n++)).join('')}</div>
      </section>`;
      }).join('');
    }

    function chipsHTML() {
      return model.cats.map((c) =>
        `<button type="button" class="chip" data-cat="${c.id}" aria-controls="cat-${c.id}">${c.icon ? `<span class="chip__icon" aria-hidden="true">${esc(c.icon)}</span>` : ''}${esc(c[lang])}</button>`
      ).join('');
    }

    function heroBodyHTML() {
      const slogan = setting('слоган');
      const sub = setting('подзаголовок');
      const delivery = setting('доставка');
      const phone = setting('телефон');
      return `${slogan ? `<p class="hero__slogan">${esc(slogan)}</p>` : ''}
    ${sub ? `<p class="hero__sub" lang="en">${esc(sub)}</p>` : ''}
    <div class="hero__pills">
      ${delivery ? `<span class="pill pill--delivery"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-scooter"/></svg><span>${esc(delivery)}</span></span>` : ''}
      ${phone ? `<a class="pill pill--ghost" href="${esc(telHref(phone))}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-phone"/></svg><span>${esc(phone)}</span></a>` : ''}
    </div>`;
    }

    function noticeHTML() {
      const text = setting('объявление');
      return `<div class="notice" id="notice"${text ? '' : ' hidden'}>${esc(text)}</div>`;
    }

    function infoRow(icon, label, valueHTML) {
      return `<li class="info__row"><span class="info__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#${icon}"/></svg></span>
      <span><span class="info__label">${esc(label)}</span><span class="info__value">${valueHTML}</span></span></li>`;
    }

    function infoHTML() {
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
      if (map) actions.push(`<a class="btn" href="${esc(map)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-pin"/></svg>${esc(t('map'))}</a>`);
      if (insta) actions.push(`<a class="btn" href="${esc(insta)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-insta"/></svg>Instagram</a>`);
      if (tg) actions.push(`<a class="btn" href="${esc(tg)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-tg"/></svg>Telegram</a>`);

      const notes = [t('pricesNote'), setting('примечание_к_фото'), setting('продавец'), t('privacy')].filter(Boolean);
      return `<section class="info__card" aria-labelledby="info-title">
        <h2 class="info__title" id="info-title">${esc(t('contacts'))}</h2>
        <ul class="info__list">${rows.join('')}</ul>
        ${actions.length ? `<div class="info__actions">${actions.join('')}</div>` : ''}
      </section>
      ${notes.map((n) => `<p class="info__note">${esc(n)}</p>`).join('')}`;
    }

    // Структурированные данные schema.org: кафе + меню (для поисковиков и карт)
    function jsonLD() {
      const abs = (src) => (src ? new URL(src, SITE).href : undefined);
      return {
        '@context': 'https://schema.org',
        '@type': 'CafeOrCoffeeShop',
        name: 'Buddy Coffee',
        url: SITE,
        image: SITE + 'img/og.jpg',
        telephone: setting('телефон').replace(/[^\d+]/g, '') || undefined,
        servesCuisine: ['Fast food', 'Coffee'],
        address: setting('адрес') ? { '@type': 'PostalAddress', streetAddress: setting('адрес'), addressCountry: 'UZ' } : undefined,
        sameAs: [socialURL(setting('instagram'), 'https://instagram.com/'), socialURL(setting('telegram'), 'https://t.me/')]
          .filter((u) => u && !/^https:\/\/(www\.)?(instagram\.com|t\.me)\/?$/.test(u)),
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
    }

    return {
      lang, model, t, setting, telHref, placeholder, badgeHTML, sizesOf, weightsOf,
      menuHTML, chipsHTML, heroBodyHTML, noticeHTML, infoHTML, jsonLD
    };
  }

  root.MenuRender = { SITE, UI, parseCSV, buildModel, validTables, imgSrc, isLocalImg, esc, fmt, norm, createView };
})(typeof window !== 'undefined' ? window : globalThis);
