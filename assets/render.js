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
      pricesNote: 'Barcha narxlar so‘mda.',
      privacy: 'Sayt cookie-fayllardan foydalanmaydi, tashriflar statistikasi anonim. Ism va telefon kafening mijozlar bazasida buyurtmalar, aksiya va chegirmalar uchun 3 yil saqlanadi; manzil va izoh 90 kundan keyin o‘chiriladi. Xabarnomadan botda chiqish mumkin, ma’lumotlarni o‘chirish — kafega qo‘ng‘iroq orqali.',
      privacyLink: 'Maxfiylik siyosati',
      error: 'Menyuni yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
      retry: 'Qayta urinish', other: 'Boshqa',
      pairs: 'Bu bilan olishadi', rateTitle: 'Sizga yoqdimi?', rateText: 'Baho va fikr qoldiring — bu bizga juda yordam beradi.',
      addTo: (n) => `Savatga qo‘shish: ${n}`, energy: 'Kaloriya',
      kcal: 'kkal', g: 'g', nutrTitle: 'Ozuqaviy qiymat', protein: 'Oqsil', fat: 'Yog‘', carbs: 'Uglevod',
      perPortion: (w) => `1 porsiya${w ? ` (${w})` : ''} uchun, taxminan`,
      nutrNote: 'Taxminiy qiymatlar: standart retseptlar va USDA FoodData Central ma’lumotlari asosida hisoblangan.',
      allergens: 'Allergenlar',
      allergenNote: 'Barcha taomlar bitta oshxonada tayyorlanadi, boshqa allergenlar izi bo‘lishi mumkin. Allergiyangiz bo‘lsa, buyurtmadan oldin so‘rang.',
      nothingHint: 'Boshqa so‘z bilan qidirib ko‘ring.', clearSearch: 'Qidiruvni tozalash',
      crash: 'Nimadir noto‘g‘ri ketdi. Sahifani yangilang.', reload: 'Yangilash',
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
      pricesNote: 'Все цены указаны в сумах.',
      privacy: 'Сайт не использует cookie, статистика посещений анонимная. Имя и телефон хранятся в базе клиентов кафе 3 года — для заказов, акций и скидок; адрес и комментарий удаляются через 90 дней. От рассылки можно отписаться в боте, удалить данные — по звонку в кафе.',
      privacyLink: 'Политика конфиденциальности',
      error: 'Не удалось загрузить меню. Проверьте интернет и попробуйте ещё раз.',
      retry: 'Повторить', other: 'Другое',
      pairs: 'С этим берут', rateTitle: 'Понравилось?', rateText: 'Оставьте оценку и отзыв — это очень нам помогает.',
      addTo: (n) => `Добавить в корзину: ${n}`, energy: 'Калории',
      kcal: 'ккал', g: 'г', nutrTitle: 'Пищевая ценность', protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы',
      perPortion: (w) => `на порцию${w ? ` ${w}` : ''}, примерно`,
      nutrNote: 'Примерные значения: расчёт по стандартным рецептам и данным USDA FoodData Central.',
      allergens: 'Аллергены',
      allergenNote: 'Все блюда готовятся на одной кухне — возможны следы других аллергенов. При аллергии уточните перед заказом.',
      nothingHint: 'Попробуйте другое слово.', clearSearch: 'Сбросить поиск',
      crash: 'Что-то пошло не так. Обновите страницу.', reload: 'Обновить',
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
    'в_наличии': 'avail', 'с_этим_берут': 'pairs', 'вес': 'weight', 'выход': 'weight', 'объём': 'weight', 'объем': 'weight',
    'ккал': 'kcal', 'калории': 'kcal', 'белки': 'protein', 'жиры': 'fat', 'углеводы': 'carbs', 'аллергены': 'allergens',
    'иконка': 'icon', 'ключ': 'key', 'значение_uz': 'uz', 'значение_ru': 'ru'
  };

  // 14 аллергенов, которые по правилам ЕС (Регламент 1169/2011) указывают в меню
  const ALLERGENS = {
    gluten: { uz: 'Glyuten', ru: 'Глютен', aliases: ['глютен', 'gluten', 'glyuten', 'пшеница', 'bug‘doy'] },
    milk: { uz: 'Sut', ru: 'Молоко', aliases: ['молоко', 'лактоза', 'milk', 'sut'] },
    eggs: { uz: 'Tuxum', ru: 'Яйца', aliases: ['яйца', 'яйцо', 'eggs', 'egg', 'tuxum'] },
    mustard: { uz: 'Xantal', ru: 'Горчица', aliases: ['горчица', 'mustard', 'xantal'] },
    sesame: { uz: 'Kunjut', ru: 'Кунжут', aliases: ['кунжут', 'sesame', 'kunjut'] },
    soy: { uz: 'Soya', ru: 'Соя', aliases: ['соя', 'soy', 'soya'] },
    nuts: { uz: 'Yong‘oq', ru: 'Орехи', aliases: ['орехи', 'орех', 'nuts', 'yong‘oq', 'yongoq'] },
    peanuts: { uz: 'Yeryong‘oq', ru: 'Арахис', aliases: ['арахис', 'peanuts', 'peanut', 'yeryong‘oq', 'yeryongoq'] },
    celery: { uz: 'Selderey', ru: 'Сельдерей', aliases: ['сельдерей', 'celery', 'selderey'] },
    fish: { uz: 'Baliq', ru: 'Рыба', aliases: ['рыба', 'fish', 'baliq'] },
    crustaceans: { uz: 'Qisqichbaqasimonlar', ru: 'Ракообразные', aliases: ['ракообразные', 'креветки', 'crustaceans', 'qisqichbaqasimonlar'] },
    molluscs: { uz: 'Mollyuskalar', ru: 'Моллюски', aliases: ['моллюски', 'molluscs', 'mollyuskalar'] },
    sulphites: { uz: 'Sulfitlar', ru: 'Сульфиты', aliases: ['сульфиты', 'sulphites', 'sulfites', 'sulfitlar'] },
    lupin: { uz: 'Lyupin', ru: 'Люпин', aliases: ['люпин', 'lupin', 'lyupin'] }
  };
  const ALLERGEN_ALIASES = {};
  Object.keys(ALLERGENS).forEach((code) => ALLERGENS[code].aliases.forEach((a) => { ALLERGEN_ALIASES[a.replace(/[‘’ʻʼ'`]/g, '')] = code; }));
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
  // «400 / 530 / 660» → [400, 530, 660]; пустые и нечисловые — null
  const toNums = (s) => splitList(s).map((x) => { const n = parseFloat(x.replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; });
  const toAllergens = (s) => String(s || '').split(/[,;\/|]/).map((x) => ALLERGEN_ALIASES[norm(x.trim())]).filter((c, i, a) => c && a.indexOf(c) === i);

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
      .map((c) => ({ id: slug(c.id), uz: c.uz || c.id, ru: c.ru || c.uz || c.id, icon: c.icon || '', pairs: splitList(c.pairs) }));

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
        nutr: { kcal: toNums(r.kcal), p: toNums(r.protein), f: toNums(r.fat), c: toNums(r.carbs) },
        allergens: toAllergens(r.allergens),
        pairs: splitList(r.pairs),
        img: r.img || '',
        badge: BADGE_ALIASES[norm(r.badge)] || '',
        avail: !NOT_AVAILABLE.test(r.avail || '')
      }));

    // Ключ для корзины: не зависит от порядка строк в таблице
    const seen = {};
    items.forEach((it) => {
      const base = slug(it.cat + '-' + it.uz);
      seen[base] = (seen[base] || 0) + 1;
      it.key = seen[base] > 1 ? `${base}-${seen[base]}` : base;
    });

    items.forEach((it) => {
      if (!cats.some((c) => c.id === it.cat)) {
        cats.push({ id: it.cat, uz: it.cat === 'other' ? UI.uz.other : it.cat, ru: it.cat === 'other' ? UI.ru.other : it.cat, icon: '', pairs: [] });
      }
    });

    return { settings, cats: cats.filter((c) => items.some((it) => it.cat === c.id)), items };
  }

  function validTables(tables) {
    const has = (rows, keys) => Array.isArray(rows) && rows.length > 1 && keys.every((k) => rows[0].map(normHeader).includes(k));
    return !!tables && has(tables.menu, ['cat', 'uz', 'price']) && has(tables.categories, ['id']) && has(tables.settings, ['key']);
  }

  // CSV вкладки: опубликованная ссылка (работает при закрытом доступе к таблице) или экспорт «всем по ссылке»
  function sheetCsvUrl(cfg, key) {
    const gid = encodeURIComponent((cfg.gids || {})[key] || '');
    if (cfg.pub) return `https://docs.google.com/spreadsheets/d/e/${encodeURIComponent(cfg.pub)}/pub?gid=${gid}&single=true&output=csv`;
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(cfg.sheetId)}/export?format=csv&gid=${gid}`;
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
    // Ссылка без аккаунта («https://t.me/» — шаблон в «Настройках») — кнопку не показываем, а не ведём на главную соцсети
    const socialURL = (v, base) => {
      const url = !v ? '' : /^https?:\/\//i.test(v) ? safeUrl(v) : safeUrl(base + v.replace(/^@/, ''));
      return url && /^https?:\/\/[^/]+\/?$/i.test(url) ? '' : url;
    };

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

    // КБЖУ размера i: значения по размерам или одно на все
    function nutrOf(it, i) {
      const pick = (arr) => (arr.length > 1 ? arr[i] : arr[0]);
      const n = { kcal: pick(it.nutr.kcal), p: pick(it.nutr.p), f: pick(it.nutr.f), c: pick(it.nutr.c) };
      return n.kcal == null ? null : n;
    }

    // На карточке — только калории: «≈ 530 ккал» или «≈ 400–660 ккал»
    function kcalHTML(it) {
      const list = it.nutr.kcal.filter((x) => x != null);
      if (!list.length) return '';
      const lo = Math.min(...list), hi = Math.max(...list);
      return `<span class="kcal">≈ ${lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`} ${esc(t('kcal'))}</span>`;
    }

    // В шторке — полное КБЖУ выбранного размера, аллергены и пометка «примерно»
    function nutritionHTML(it, i) {
      i = i || 0;
      const n = nutrOf(it, i);
      const all = it.allergens.map((c) => ALLERGENS[c][lang]);
      if (!n && !all.length) return '';
      const w = weightsOf(it);
      const portion = [it.prices.length > 1 ? sizesOf(it)[i] : '', w.length > 1 ? w[i] : w[0]].filter(Boolean).join(', ');
      const num = (v) => (v == null ? '—' : fmt(Math.round(v)));
      const tile = (v, unit, label, cls) => `<div class="nutr__cell${cls ? ' ' + cls : ''}"><b>${num(v)}<small> ${esc(unit)}</small></b><span>${esc(label)}</span></div>`;
      return `<section class="nutr" aria-labelledby="nutr-title">
        <h3 class="nutr__title" id="nutr-title">${esc(t('nutrTitle'))} <small>${esc(t('perPortion', portion))}</small></h3>
        ${n ? `<div class="nutr__grid">${tile(n.kcal, t('kcal'), t('energy'), 'nutr__cell--kcal')}${tile(n.p, t('g'), t('protein'))}${tile(n.f, t('g'), t('fat'))}${tile(n.c, t('g'), t('carbs'))}</div>` : ''}
        ${all.length ? `<p class="nutr__all"><span>${esc(t('allergens'))}:</span> ${all.map((a) => `<span class="allergen">${esc(a)}</span>`).join('')}</p>` : ''}
        <p class="nutr__note">${n ? esc(t('nutrNote')) + ' ' : ''}${esc(t('allergenNote'))}</p>
      </section>`;
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

    const OC = root.OrderCore;
    const ordering = !!(OC && OC.config(model).enabled);
    const canOrder = (it) => ordering && it.avail && it.prices.length > 0;

    // «+» на фото; когда блюдо уже в корзине, cart.js меняет его на счётчик
    function addHTML(it) {
      if (!canOrder(it)) return '';
      return `<span class="add-slot" data-add-slot="${it.id}"><button type="button" class="add" data-add="${it.id}" aria-label="${esc(t('addTo', it[lang]))}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-plus"/></svg></button></span>`;
    }

    function itemHTML(it, index) {
      const desc = it['desc_' + lang];
      const variants = variantsHTML(it);
      const meta = (variants ? weightHTML(it) : pricesHTML(it) + weightHTML(it)) + kcalHTML(it);
      return `<article class="item${it.avail ? '' : ' is-out'}" data-id="${it.id}">
      <div class="item__body">
        <h3 class="item__name"><button type="button" class="item__btn" aria-haspopup="dialog">${esc(it[lang])}</button></h3>
        ${desc ? `<p class="item__desc">${esc(desc)}</p>` : ''}
        ${meta ? `<div class="prices">${meta}</div>` : ''}
      </div>
      <div class="item__media"><span class="item__frame">${pictureHTML(it, 'item__img', 116, 116, index < 2 ? 'eager' : 'lazy')}</span>${badgeHTML(it.badge)}${addHTML(it)}</div>
      ${variants}
    </article>`;
    }

    function popularHTML() {
      const picks = model.items.filter((it) => it.avail && (it.badge === 'hit' || it.badge === 'recommend')).slice(0, 8);
      if (picks.length < 2) return '';
      return `<section class="popular" aria-labelledby="pop-title">
      <h2 class="popular__title" id="pop-title">${esc(t('popular'))}</h2>
      <div class="popular__track">${picks.map((it, i) => {
        const price = priceText(it);
        return `<button type="button" class="pop" data-id="${it.id}" aria-haspopup="dialog">
          <span class="pop__frame">${pictureHTML(it, 'pop__img', 156, 128, i < 2 ? 'high' : i < 3 ? 'eager' : 'lazy')}</span>
          <span class="pop__body"><span class="pop__name">${esc(it[lang])}</span><span class="pop__price">${esc(price)}</span></span>
          ${badgeHTML(it.badge)}
        </button>`;
      }).join('')}</div>
    </section>`;
    }

    // «С этим берут»: список названий у позиции, иначе — у её категории (колонка «с_этим_берут»)
    function pairsOf(it) {
      const cat = model.cats.find((c) => c.id === it.cat);
      const names = it.pairs.length ? it.pairs : (cat ? cat.pairs : []);
      const out = [];
      names.forEach((name) => {
        const key = norm(name);
        const p = model.items.find((x) => norm(x.uz) === key || norm(x.ru) === key);
        if (p && p.id !== it.id && p.avail && !out.includes(p)) out.push(p);
      });
      return out.slice(0, 3);
    }

    function priceText(it) {
      if (it.prices.length > 1) return t('from', fmt(Math.min(...it.prices)));
      return it.prices.length ? `${fmt(it.prices[0])} ${t('currency')}` : '';
    }

    function pairsHTML(it) {
      const list = pairsOf(it);
      if (!list.length) return '';
      return `<section class="pairs" aria-labelledby="pairs-title">
        <h3 class="pairs__title" id="pairs-title">${esc(t('pairs'))}</h3>
        <div class="pairs__list">${list.map((p) => `<button type="button" class="pair" data-pair="${p.id}" aria-haspopup="dialog">
          <span class="pair__frame">${pictureHTML(p, 'pair__img', 64, 64, 'eager')}</span>
          <span class="pair__body"><span class="pair__name">${esc(p[lang])}</span><span class="pair__price">${esc(priceText(p))}</span></span>
        </button>`).join('')}</div>
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

      // Отзывы: Google, Яндекс, 2ГИС — показываем те, для которых есть ссылка
      const reviews = [
        ['отзыв_google', 'Google'],
        ['отзыв_yandex', lang === 'ru' ? 'Яндекс' : 'Yandex'],
        ['отзыв_2gis', lang === 'ru' ? '2ГИС' : '2GIS']
      ].map(([key, label]) => [safeUrl(setting(key)), label]).filter(([url]) => url);
      const reviewHTML = reviews.length ? `<section class="rate" aria-labelledby="rate-title">
        <div class="rate__stars" aria-hidden="true">★★★★★</div>
        <h2 class="rate__title" id="rate-title">${esc(t('rateTitle'))}</h2>
        <p class="rate__text">${esc(t('rateText'))}</p>
        <div class="rate__actions">${reviews.map(([url, label]) =>
          `<a class="rate__btn" href="${esc(url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>${esc(label)}</a>`).join('')}</div>
      </section>` : '';

      const notes = [t('pricesNote'), setting('примечание_к_фото'), setting('продавец'), t('privacy')].filter(Boolean);
      return `${reviewHTML}<section class="info__card" aria-labelledby="info-title">
        <h2 class="info__title" id="info-title">${esc(t('contacts'))}</h2>
        <ul class="info__list">${rows.join('')}</ul>
        ${actions.length ? `<div class="info__actions">${actions.join('')}</div>` : ''}
      </section>
      ${notes.map((n) => `<p class="info__note">${esc(n)}</p>`).join('')}
      <p class="info__note"><a href="/privacy#${lang}" target="_blank" rel="noopener">${esc(t('privacyLink'))}</a></p>`;
    }

    // Структурированные данные schema.org: кафе + меню (для поисковиков и карт)
    function jsonLD() {
      const abs = (src) => (src ? new URL(src, SITE).href : undefined);
      const cafe = OC ? OC.config(model).cafe : null;
      return {
        '@context': 'https://schema.org',
        '@type': 'CafeOrCoffeeShop',
        name: 'Buddy Coffee',
        url: SITE,
        image: SITE + 'img/og.jpg',
        telephone: setting('телефон').replace(/[^\d+]/g, '') || undefined,
        servesCuisine: ['Fast food', 'Coffee'],
        address: setting('адрес') ? { '@type': 'PostalAddress', streetAddress: setting('адрес'), addressLocality: 'Shahrisabz', addressRegion: 'Qashqadaryo', addressCountry: 'UZ' } : undefined,
        geo: cafe ? { '@type': 'GeoCoordinates', latitude: cafe.lat, longitude: cafe.lng } : undefined,
        hasMap: safeUrl(setting('ссылка_на_карту')) || undefined,
        // «24/7», «24 soat», «круглосуточно» → все дни 00:00–23:59
        openingHoursSpecification: /24|круглосуточ|kecha-kunduz/i.test(setting('часы_работы')) ? {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          opens: '00:00',
          closes: '23:59'
        } : undefined,
        sameAs: [socialURL(setting('instagram'), 'https://instagram.com/'), socialURL(setting('telegram'), 'https://t.me/')]
          .filter(Boolean),
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
      lang, model, t, setting, telHref, placeholder, badgeHTML, sizesOf, weightsOf, pairsHTML, pairsOf, priceText,
      pictureHTML, nutritionHTML, addHTML, canOrder, ordering, menuHTML, chipsHTML, heroBodyHTML, noticeHTML, infoHTML, jsonLD
    };
  }

  // Сбой нашего скрипта: вместо молчаливой поломки — сообщение и кнопка «Обновить».
  // Ошибки чужих скриптов (статистика, расширения браузера) не показываем.
  function crashGuard(t) {
    if (typeof window === 'undefined') return;
    let shown = false;
    window.addEventListener('error', (e) => {
      if (shown || !e.filename || e.filename.indexOf(location.origin + '/assets/') !== 0) return;
      shown = true;
      const box = document.createElement('div');
      box.className = 'crash';
      box.setAttribute('role', 'alert');
      box.innerHTML = `<span>${esc(t('crash'))}</span><button type="button">${esc(t('reload'))}</button>`;
      box.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(box);
    });
  }

  root.MenuRender = { SITE, UI, ALLERGENS, crashGuard, sheetCsvUrl, parseCSV, buildModel, validTables, imgSrc, isLocalImg, esc, fmt, norm, safeUrl, createView };
})(typeof window !== 'undefined' ? window : globalThis);
