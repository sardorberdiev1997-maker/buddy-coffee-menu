/* Общая логика заказа: зона доставки, телефон, расчёт корзины, статусы.
   Работает в браузере (корзина, страница заказа) и на сервере (server/) — поэтому без DOM. */
(function (root) {
  'use strict';

  // Граница города Шахрисабз (OpenStreetMap, relation 15602076), упрощена до ~60 м. [lat, lng]
  const ZONE = [[39.03631, 66.78964], [39.03485, 66.79002], [39.03371, 66.79361], [39.03384, 66.79741], [39.03233, 66.80315], [39.03264, 66.80879], [39.01972, 66.80464], [39.02138, 66.80791], [39.02024, 66.81098], [39.02349, 66.8137], [39.02335, 66.81622], [39.02264, 66.8162], [39.02218, 66.83087], [39.01976, 66.83236], [39.01866, 66.84334], [39.0218, 66.84277], [39.02159, 66.84375], [39.02552, 66.84687], [39.02605, 66.85195], [39.02844, 66.85025], [39.0282, 66.85192], [39.0302, 66.85366], [39.03144, 66.85774], [39.03153, 66.86158], [39.03007, 66.86213], [39.03068, 66.86255], [39.03023, 66.86678], [39.03124, 66.86687], [39.02989, 66.87575], [39.04006, 66.87598], [39.05994, 66.88118], [39.06287, 66.87939], [39.08641, 66.87855], [39.08689, 66.85662], [39.09492, 66.8563], [39.09501, 66.85788], [39.09713, 66.8569], [39.09757, 66.8588], [39.09891, 66.85876], [39.09838, 66.85356], [39.10076, 66.85182], [39.09779, 66.84528], [39.09808, 66.84121], [39.10137, 66.8402], [39.10487, 66.84318], [39.10494, 66.83872], [39.10584, 66.83785], [39.10332, 66.83746], [39.1006, 66.8349], [39.09827, 66.8263], [39.09799, 66.81778], [39.09982, 66.81758], [39.09993, 66.8153], [39.07653, 66.81164], [39.06752, 66.81425], [39.03969, 66.8102], [39.0399, 66.79823], [39.04122, 66.79605], [39.04321, 66.79646], [39.0434, 66.79505], [39.04113, 66.79447], [39.03971, 66.79104]];
  const ZONE_MARGIN = 400; // м за границей — ещё «город» (окраинные дома, неточность GPS)

  const DEFAULTS = { min: 40000, etaDelivery: '30–45', etaPickup: '15–20' };

  // Статусы: доставка и самовывоз — как в Yandex Eats / Wolt
  const FLOW = {
    delivery: ['new', 'accepted', 'cooking', 'courier', 'onway', 'delivered'],
    pickup: ['new', 'accepted', 'cooking', 'ready', 'picked']
  };
  const FINAL = ['delivered', 'picked', 'canceled'];
  const DONE = ['delivered', 'picked'];

  const STATUS = {
    new: { icon: '⏳', uz: 'Tasdiqlash kutilmoqda', ru: 'Ждёт подтверждения' },
    accepted: { icon: '✅', uz: 'Qabul qilindi', ru: 'Принят' },
    cooking: { icon: '👨‍🍳', uz: 'Tayyorlanmoqda', ru: 'Готовится' },
    courier: { icon: '📦', uz: 'Kuryerga topshirildi', ru: 'Передан курьеру' },
    onway: { icon: '🛵', uz: 'Kuryer yo‘lda', ru: 'Курьер в пути' },
    delivered: { icon: '🎉', uz: 'Yetkazildi', ru: 'Доставлен' },
    ready: { icon: '🛍️', uz: 'Olib ketishga tayyor', ru: 'Готов к выдаче' },
    picked: { icon: '🎉', uz: 'Topshirildi', ru: 'Выдан' },
    canceled: { icon: '❌', uz: 'Bekor qilindi', ru: 'Отменён' }
  };

  const CANCEL_REASONS = {
    stock: { uz: 'Taom tugab qoldi', ru: 'Нет в наличии' },
    zone: { uz: 'Manzil yetkazish hududidan tashqarida', ru: 'Адрес вне зоны доставки' },
    noanswer: { uz: 'Mijoz bilan bog‘lanib bo‘lmadi', ru: 'Не дозвонились до клиента' },
    client: { uz: 'Mijozning iltimosi bilan', ru: 'По просьбе клиента' },
    busy: { uz: 'Hozir buyurtmalar juda ko‘p', ru: 'Сейчас слишком много заказов' },
    other: { uz: 'Boshqa sabab', ru: 'Другая причина' },
    self: { uz: 'Mijoz bekor qildi', ru: 'Клиент отменил сам' }
  };

  // Что не понравилось — при оценке 1–3 (курьер — только у доставки)
  const RATE_REASONS = {
    slow: { uz: '⏱ Uzoq kutdim', ru: '⏱ Долго ждал' },
    cold: { uz: '🥶 Sovuq keldi', ru: '🥶 Остыло' },
    taste: { uz: '😕 Mazasi yoqmadi', ru: '😕 Невкусно' },
    wrong: { uz: '📦 Buyurtmada xato', ru: '📦 Ошибка в заказе' },
    courier: { uz: '🛵 Kuryer', ru: '🛵 Курьер' },
    other: { uz: '💬 Boshqa', ru: '💬 Другое' }
  };

  // Тексты корзины, оформления и страницы заказа (меню — в render.js)
  const UI = {
    uz: {
      cart: 'Savat', clear: 'Tozalash', clearAsk: 'Savatni tozalaysizmi?',
      add: 'Qo‘shish', addSum: (s) => `Qo‘shish · ${s}`, added: 'Savatga qo‘shildi',
      less: 'Kamaytirish', more: 'Ko‘paytirish', qty: 'Soni', size: 'O‘lcham',
      itemNote: 'Taomga izoh', itemNotePh: 'Masalan: piyozsiz',
      cartEmpty: 'Savat bo‘sh', cartEmptyText: 'Menyudan taom tanlang — u shu yerda paydo bo‘ladi.', toMenu: 'Menyuga qaytish',
      repeat: 'Oldingi buyurtmani takrorlash', repeatMeta: (d, s) => `${d} · ${s}`,
      delivery: 'Yetkazib berish', pickup: 'Olib ketish', howGet: 'Qanday olasiz',
      free: 'Bepul', itemsSum: 'Taomlar', deliveryCost: 'Yetkazib berish', total: 'Jami',
      minLeft: (left, min) => `Yetkazib berish ${min} so‘mdan. Yana ${left} so‘mlik taom qo‘shing yoki olib keting.`,
      zoneNote: (eta) => `Shahrisabz shahri bo‘ylab bepul · ${eta} daqiqa`,
      pickupNote: (eta) => `Tayyor bo‘ladi: ${eta} daqiqada`,
      rushNote: 'Hozir buyurtmalar ko‘p — odatdagidan biroz uzoqroq tayyorlaymiz. Sabringiz uchun rahmat!',
      upsell: 'Buyurtmaga qo‘shasizmi?',
      checkout: 'Rasmiylashtirish', back: 'Orqaga', checkoutTitle: 'Rasmiylashtirish',
      contact: 'Bog‘lanish uchun', name: 'Ismingiz', phone: 'Telefon raqam', phoneHint: 'Kuryer yoki kafe shu raqamga qo‘ng‘iroq qiladi',
      tgPhone: 'Telegram’dagi raqamni olish',
      address: 'Yetkazish manzili', street: 'Ko‘cha va uy', apt: 'Xonadon, podyezd, qavat', aptPh: 'Masalan: 12-xonadon, 2-podyezd',
      landmark: 'Mo‘ljal', landmarkPh: 'Masalan: 3-maktab yonida',
      geoBtn: 'Joylashuvni yuborish', geoHint: 'Kuryer sizni tezroq topadi', geoWait: 'Aniqlanmoqda…', geoOk: 'Joylashuv qo‘shildi ✓', geoRemove: 'O‘chirish',
      geoDenied: 'Joylashuvga ruxsat berilmadi. Manzilni yozib qoldiring — bu ham yetarli.',
      geoFail: 'Joylashuvni aniqlab bo‘lmadi. Manzilni yozib qoldiring — bu ham yetarli.',
      pickupFrom: 'Qayerdan olib ketasiz', route: 'Yo‘nalish',
      payment: 'To‘lov', cash: 'Naqd pul', card: 'Kartaga o‘tkazma', cardShort: 'Kartaga', changeFrom: (s) => `${s} dan qaytim`,
      cardNote: (pickup) => (pickup ? 'Karta raqamini kafeda aytishadi. To‘lov — olganingizda.' : 'Karta raqamini kuryer aytadi. To‘lov — olganingizda.'),
      cashNote: 'To‘lov — olganingizda.',
      change: 'Qaysi summadan qaytim kerak?', changePh: 'Qaytimsiz',
      orderNote: 'Buyurtmaga izoh', orderNotePh: 'Masalan: yetib kelganda qo‘ng‘iroq qiling',
      confirm: (s) => `Buyurtma berish · ${s}`, sending: 'Yuborilmoqda…',
      dataNote: 'Ism va telefon keyingi buyurtmalar va aksiyalar uchun mijozlar bazasida saqlanadi, manzil 90 kundan keyin o‘chiriladi.',
      optional: 'ixtiyoriy',
      errName: 'Ismingizni yozing.',
      errPhone: 'Telefon raqami noto‘g‘ri. Masalan: 90 123 45 67.',
      errAddress: 'Manzilni yozing: ko‘cha va uy raqami.',
      errZone: 'Bu joy Shahrisabz shahridan tashqarida. Biz faqat shahar ichida yetkazamiz — olib ketishni tanlang yoki qo‘ng‘iroq qiling.',
      errPaused: 'Hozir onlayn buyurtma qabul qilinmayapti. Buyurtma uchun qo‘ng‘iroq qiling:',
      errOffline: 'Internet yo‘q — buyurtma yuborilmadi. Aloqani tekshirib, qayta urinib ko‘ring.',
      errServer: 'Buyurtmani yuborib bo‘lmadi. Qayta urinib ko‘ring yoki qo‘ng‘iroq qiling:',
      errRate: 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.',
      errPrice: 'Narxlar yangilandi — savatni tekshirib, qayta tasdiqlang.',
      errGone: (n) => `Hozir yo‘q, savatdan olib tashlandi: ${n}.`,
      errMin: (left) => `Yetkazib berish uchun yana ${left} so‘mlik taom qo‘shing.`,
      offline: 'Internet aloqasi yo‘q',
      ordersOff: 'Onlayn buyurtma vaqtincha ishlamayapti — qo‘ng‘iroq orqali buyurtma bering.',
      activeOrder: (n, s) => `Buyurtma №${n} · ${s}`,
      // страница заказа
      orderN: (n) => `Buyurtma №${n}`, placed: 'Buyurtma vaqti',
      etaAt: (t) => `Taxminan soat ${t} da`, autoUpdate: 'Holat o‘zi yangilanadi',
      tgFollow: 'Holatni Telegram’da olish', tgOn: 'Holat Telegram’ga keladi',
      callCafe: 'Kafega qo‘ng‘iroq', cancel: 'Buyurtmani bekor qilish', cancelAsk: 'Buyurtmani bekor qilasizmi?',
      cancelLate: 'Buyurtma allaqachon qabul qilingan. Bekor qilish uchun kafega qo‘ng‘iroq qiling.',
      rateAsk: 'Buyurtma qanday bo‘ldi?', rateAskText: 'Baholang — bir soniya oladi.', starN: (n) => `5 dan ${n}`,
      rateHigh: 'Baho uchun rahmat!', rateHighText: 'Qiyin bo‘lmasa, xaritada fikr qoldiring — kichik kafe uchun bu juda muhim.',
      rateLow: 'Afsusdamiz 😔', rateLowText: 'Nima yoqmadi? Administratorga yetkazamiz.', ratePh: 'Bir-ikki so‘z — ixtiyoriy',
      rateSend: 'Yuborish', rateDone: 'Rahmat! Albatta tuzatamiz.', rateMaps: 'Xaritada ham sharh qoldirishingiz mumkin:',
      rateChange: 'Bahoni o‘zgartirish', rateFail: 'Yuborib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.',
      reason: 'Sabab', repeatOrder: 'Yana buyurtma berish', yourOrder: 'Buyurtmangiz', details: 'Tafsilotlar',
      notFound: 'Buyurtma topilmadi', notFoundText: 'Havola noto‘g‘ri yoki buyurtma ma’lumotlari o‘chirilgan.',
      loadFail: 'Holatni yuklab bo‘lmadi. Internet paydo bo‘lishi bilan sahifa o‘zi yangilanadi.',
      retry: 'Qayta urinish', updated: (t) => `Yangilandi: ${t}`,
      st: {
        new: 'Kafe buyurtmani tasdiqlashini kutyapmiz — odatda 1–3 daqiqa.',
        accepted: 'Kafe buyurtmani qabul qildi.',
        cooking: 'Taomlaringiz tayyorlanmoqda.',
        courier: 'Buyurtma kuryerda — tez orada yo‘lga chiqadi.',
        onway: 'Kuryer yo‘lda, tez orada yetib keladi.',
        delivered: 'Yoqimli ishtaha! Rahmat, yana kutib qolamiz.',
        ready: 'Buyurtma tayyor — kafedan olib ketishingiz mumkin.',
        picked: 'Yoqimli ishtaha! Rahmat, yana kutib qolamiz.',
        canceled: 'Buyurtma bekor qilindi.'
      }
    },
    ru: {
      cart: 'Корзина', clear: 'Очистить', clearAsk: 'Очистить корзину?',
      add: 'Добавить', addSum: (s) => `Добавить · ${s}`, added: 'Добавлено в корзину',
      less: 'Уменьшить', more: 'Увеличить', qty: 'Количество', size: 'Размер',
      itemNote: 'Комментарий к блюду', itemNotePh: 'Например: без лука',
      cartEmpty: 'Корзина пуста', cartEmptyText: 'Выберите блюда в меню — они появятся здесь.', toMenu: 'Вернуться в меню',
      repeat: 'Повторить прошлый заказ', repeatMeta: (d, s) => `${d} · ${s}`,
      delivery: 'Доставка', pickup: 'Самовывоз', howGet: 'Как получить',
      free: 'Бесплатно', itemsSum: 'Блюда', deliveryCost: 'Доставка', total: 'Итого',
      minLeft: (left, min) => `Доставка — от ${min} сум. Добавьте блюд ещё на ${left} сум или заберите сами.`,
      zoneNote: (eta) => `Бесплатно по Шахрисабзу · ${eta} мин`,
      pickupNote: (eta) => `Будет готов через ${eta} мин`,
      rushNote: 'Сейчас много заказов — готовим чуть дольше обычного. Спасибо за терпение!',
      upsell: 'Добавить к заказу?',
      checkout: 'Оформить заказ', back: 'Назад', checkoutTitle: 'Оформление',
      contact: 'Для связи', name: 'Имя', phone: 'Телефон', phoneHint: 'На этот номер позвонит курьер или кафе',
      tgPhone: 'Взять номер из Telegram',
      address: 'Адрес доставки', street: 'Улица и дом', apt: 'Кв., подъезд, этаж', aptPh: 'Например: кв. 12, подъезд 2',
      landmark: 'Ориентир', landmarkPh: 'Например: рядом со школой №3',
      geoBtn: 'Отправить геолокацию', geoHint: 'Курьер найдёт вас быстрее', geoWait: 'Определяем…', geoOk: 'Геолокация добавлена ✓', geoRemove: 'Убрать',
      geoDenied: 'Нет доступа к геолокации. Укажите адрес текстом — этого достаточно.',
      geoFail: 'Не удалось определить геолокацию. Укажите адрес текстом — этого достаточно.',
      pickupFrom: 'Откуда забрать', route: 'Маршрут',
      payment: 'Оплата', cash: 'Наличными', card: 'Переводом на карту', cardShort: 'На карту', changeFrom: (s) => `сдача с ${s}`,
      cardNote: (pickup) => (pickup ? 'Номер карты для перевода подскажут в кафе. Оплата — при получении.' : 'Номер карты для перевода сообщит курьер. Оплата — при получении.'),
      cashNote: 'Оплата — при получении.',
      change: 'С какой суммы нужна сдача?', changePh: 'Без сдачи',
      orderNote: 'Комментарий к заказу', orderNotePh: 'Например: позвоните, как подъедете',
      confirm: (s) => `Заказать · ${s}`, sending: 'Отправляем…',
      dataNote: 'Имя и телефон сохраняем в базе клиентов кафе для следующих заказов и акций, адрес удаляем через 90 дней.',
      optional: 'необязательно',
      errName: 'Укажите имя.',
      errPhone: 'Неверный номер. Пример: 90 123 45 67.',
      errAddress: 'Укажите адрес: улицу и номер дома.',
      errZone: 'Эта точка за пределами Шахрисабза. Мы доставляем только по городу — выберите самовывоз или позвоните нам.',
      errPaused: 'Сейчас онлайн-заказы не принимаются. Чтобы заказать, позвоните:',
      errOffline: 'Нет интернета — заказ не отправлен. Проверьте связь и попробуйте ещё раз.',
      errServer: 'Не получилось отправить заказ. Попробуйте ещё раз или позвоните:',
      errRate: 'Слишком много попыток. Попробуйте через несколько минут.',
      errPrice: 'Цены обновились — проверьте корзину и подтвердите заказ ещё раз.',
      errGone: (n) => `Сейчас нет в наличии, убрали из корзины: ${n}.`,
      errMin: (left) => `Для доставки добавьте блюд ещё на ${left} сум.`,
      offline: 'Нет подключения к интернету',
      ordersOff: 'Онлайн-заказ временно не работает — закажите по телефону.',
      activeOrder: (n, s) => `Заказ №${n} · ${s}`,
      orderN: (n) => `Заказ №${n}`, placed: 'Время заказа',
      etaAt: (t) => `Ожидаем примерно к ${t}`, autoUpdate: 'Статус обновляется сам',
      tgFollow: 'Получать статус в Telegram', tgOn: 'Статус приходит в Telegram',
      callCafe: 'Позвонить в кафе', cancel: 'Отменить заказ', cancelAsk: 'Отменить заказ?',
      cancelLate: 'Заказ уже принят. Чтобы отменить его, позвоните в кафе.',
      rateAsk: 'Как вам заказ?', rateAskText: 'Оцените — это займёт секунду.', starN: (n) => `${n} из 5`,
      rateHigh: 'Спасибо за оценку!', rateHighText: 'Если не сложно, поделитесь мнением на картах — для небольшого кафе это очень важно.',
      rateLow: 'Нам жаль 😔', rateLowText: 'Что пошло не так? Передадим администратору.', ratePh: 'Пара слов — необязательно',
      rateSend: 'Отправить', rateDone: 'Спасибо! Разберёмся и исправим.', rateMaps: 'Отзыв на картах можно оставить тоже:',
      rateChange: 'Изменить оценку', rateFail: 'Не удалось отправить. Проверьте интернет и попробуйте ещё раз.',
      reason: 'Причина', repeatOrder: 'Повторить заказ', yourOrder: 'Ваш заказ', details: 'Детали',
      notFound: 'Заказ не найден', notFoundText: 'Ссылка неверная или данные заказа уже удалены.',
      loadFail: 'Не удалось загрузить статус. Как только появится интернет, страница обновится сама.',
      retry: 'Повторить', updated: (t) => `Обновлено в ${t}`,
      st: {
        new: 'Ждём подтверждения кафе — обычно 1–3 минуты.',
        accepted: 'Кафе приняло заказ.',
        cooking: 'Готовим ваш заказ.',
        courier: 'Заказ у курьера — скоро выедет к вам.',
        onway: 'Курьер едет к вам.',
        delivered: 'Приятного аппетита! Спасибо, ждём вас снова.',
        ready: 'Заказ готов — можно забирать.',
        picked: 'Приятного аппетита! Спасибо, ждём вас снова.',
        canceled: 'Заказ отменён.'
      }
    }
  };

  // Мобильные коды операторов и городские коды Узбекистана
  const PHONE_CODES = /^(20|33|50|55|61|62|65|66|67|69|70|71|72|73|74|75|76|77|78|79|88|90|91|93|94|95|97|98|99)\d{7}$/;

  /* ---------- зона доставки ---------- */

  function inPolygon(lat, lng, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [y1, x1] = poly[i], [y2, x2] = poly[j];
      if ((y1 > lat) !== (y2 > lat) && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  }

  // Расстояние (м) от точки до границы — для запаса на окраинах
  function distToEdge(lat, lng, poly) {
    const ky = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180);
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = (poly[j][1] - lng) * kx, ay = (poly[j][0] - lat) * ky;
      const bx = (poly[i][1] - lng) * kx, by = (poly[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }

  function inZone(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return inPolygon(lat, lng, ZONE) || distToEdge(lat, lng, ZONE) <= ZONE_MARGIN;
  }

  /* ---------- телефон ---------- */

  // «+998 90 123-45-67», «90 1234567», «8 90…» → '998901234567'; иначе ''
  function normPhone(s) {
    let d = String(s || '').replace(/\D/g, '');
    if (d.length === 9) d = '998' + d;
    if (d.length === 12 && d.startsWith('998') && PHONE_CODES.test(d.slice(3))) return d;
    return '';
  }

  function fmtPhone(d) {
    d = String(d || '');
    if (d.length !== 12) return d;
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }

  /* ---------- настройки заказа из «Настроек» таблицы ---------- */

  const NO = /^(нет|no|false|0|-|yo[‘'ʻ’`]?q|o[‘'ʻ’`]?chiq|выкл)$/i;

  // «Час пик» (/rush в группе кафе): «30–45» → «45–60» при add = 15
  function shiftEta(s, add) {
    return add ? String(s).replace(/\d+/g, (n) => String(+n + add)) : s;
  }

  function config(model) {
    const s = (k) => {
      const v = model && model.settings && model.settings[k];
      return v ? String(v.uz || v.ru || '').trim() : '';
    };
    const sl = (k, lang) => {
      const v = model && model.settings && model.settings[k];
      return v ? String(v[lang] || v.uz || v.ru || '').trim() : '';
    };
    const min = parseInt(s('мин_заказ').replace(/\D/g, ''), 10);
    const geo = s('координаты').split(/[,;\s]+/).map(Number).filter(Number.isFinite);
    return {
      enabled: !NO.test(s('заказы')),
      min: Number.isFinite(min) ? min : DEFAULTS.min,
      eta: (type, lang) => sl(type === 'pickup' ? 'время_самовывоза' : 'время_доставки', lang) || (type === 'pickup' ? DEFAULTS.etaPickup : DEFAULTS.etaDelivery),
      cafe: geo.length === 2 ? { lat: geo[0], lng: geo[1] } : null
    };
  }

  /* ---------- корзина ---------- */

  // lines: [{ key, size, qty, note }] → позиции с актуальными ценами из модели меню
  function price(model, lines) {
    const out = [];
    const missing = [];
    let total = 0;
    (Array.isArray(lines) ? lines : []).forEach((l) => {
      const it = model.items.find((x) => x.key === l.key);
      const size = Math.max(0, parseInt(l.size, 10) || 0);
      const qty = Math.max(1, Math.min(20, parseInt(l.qty, 10) || 1));
      if (!it || !it.avail || !it.prices.length || size >= it.prices.length) { missing.push(l.key); return; }
      const p = it.prices[size];
      const multi = it.prices.length > 1;
      out.push({
        key: it.key, item: it, size, qty, note: String(l.note || '').trim().slice(0, 140),
        price: p, sum: p * qty,
        uz: it.uz, ru: it.ru,
        size_uz: multi ? it.sizes_uz[size] || it.sizes_ru[size] || '' : '',
        size_ru: multi ? it.sizes_ru[size] || it.sizes_uz[size] || '' : ''
      });
      total += p * qty;
    });
    return { lines: out, total, missing };
  }

  root.OrderCore = { UI, ZONE, FLOW, FINAL, DONE, STATUS, CANCEL_REASONS, RATE_REASONS, shiftEta, inZone, normPhone, fmtPhone, config, price };
})(typeof window !== 'undefined' ? window : globalThis);
