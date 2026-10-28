// Тексты Telegram-бота: группа кафе (язык выбирается командой /lang) и покупатели (язык заказа).
import { fmt } from './util.js';

const WEEKDAYS = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  uz: ['yak', 'dush', 'sesh', 'chor', 'pay', 'jum', 'shan']
};
const WEEKDAYS_FULL = {
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba']
};
const MONTHS = {
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
};

export const T = {
  ru: {
    sum: (n) => `${fmt(n)} сум`,
    weekday: (i) => WEEKDAYS.ru[i], weekdayFull: (i) => WEEKDAYS_FULL.ru[i], month: (i) => MONTHS.ru[i],
    order: 'Заказ', delivery: 'Доставка', pickup: 'Самовывоз',
    total: 'Итого', cash: 'Наличные', card: 'Перевод на карту', change: (n) => `сдача с ${fmt(n)}`,
    landmark: 'Ориентир', apt: 'Кв./подъезд', map: 'Карта', comment: 'Комментарий',
    fromSite: 'сайт', fromTg: 'Telegram', status: 'Статус', etaTo: (t) => `к ${t}`,
    byWhom: (n) => ` (${n})`,
    accept: (m) => `✅ ${m} мин`, cancel: '❌ Отменить', back: '← Назад', undo: '↩️ Шаг назад',
    next: { cooking: '👨‍🍳 Готовится', courier: '📦 Передан курьеру', onway: '🛵 Курьер в пути', delivered: '🎉 Доставлен', ready: '🛍️ Готов к выдаче', picked: '🎉 Выдан' },
    acceptHint: 'Примите заказ — выберите, через сколько он будет у клиента:',
    cancelAsk: 'Причина отмены:',
    already: 'Статус уже изменили', done: 'Готово', tooLate: 'Вернуть статус уже нельзя',
    remind: (n, m) => `⏰ Заказ №${n} ждёт подтверждения уже ${m} мин!`,
    customerCanceled: (n) => `❌ Клиент сам отменил заказ №${n}.`,
    bound: '✅ Группа подключена. Новые заказы будут приходить сюда.\n\nКоманды: /stats — статистика, /orders — заказы в работе, /pause и /resume — остановить или включить онлайн-заказы, /lang — язык.',
    boundAlready: 'Эта группа уже подключена ✅',
    boundOther: 'Бот уже подключён к другой группе. Чтобы перенести заказы сюда, отправьте /unbind в той группе.',
    unbound: 'Группа отключена — заказы сюда больше не придут. Чтобы подключить группу, отправьте /bind.',
    notBound: 'Группа ещё не подключена. Отправьте /bind (нужны права администратора).',
    adminOnly: 'Эту команду может выполнить только администратор группы.',
    hello: 'Здравствуйте! Чтобы получать заказы в эту группу, администратор должен отправить /bind',
    paused: '⏸ Онлайн-заказы остановлены. На сайте видно: «закажите по телефону». Включить снова: /resume',
    resumed: '▶️ Онлайн-заказы снова принимаются.',
    langSet: 'Язык бота в группе: русский',
    noActive: 'Сейчас заказов в работе нет 👌',
    activeTitle: (n) => `📋 Заказы в работе: ${n}`,
    help: 'Команды бота:\n/stats — статистика продаж\n/orders — заказы в работе\n/pause — остановить онлайн-заказы\n/resume — снова принимать заказы\n/lang — язык бота (рус/узб)\n/bind, /unbind — подключить или отключить группу',
    // статистика
    statsTitle: { today: 'Сегодня', yesterday: 'Вчера', week: 'Эта неделя', month: 'Этот месяц', quarter: 'Этот квартал', year: 'Этот год' },
    reportTitle: { day: 'Итоги дня', week: 'Итоги недели', month: 'Итоги месяца', quarter: 'Итоги квартала', year: 'Итоги года' },
    statBtn: { today: 'Сегодня', yesterday: 'Вчера', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' },
    revenue: 'Выручка', orders: 'Заказов', doneN: (n) => `выполнено ${n}`, canceledN: (n) => `отменено ${n}`, activeN: (n) => `в работе ${n}`,
    avg: 'Средний чек', deliveryTime: 'Среднее время доставки', min: 'мин',
    clients: 'Клиентов', newClients: (n) => `новых ${n}`, peak: 'Пик', ordersShort: (n) => `${n} зак.`,
    top: 'Топ', bestDay: 'Лучший день', noOrders: 'Заказов не было.', lost: 'потеряно',
    vs: (p, label) => `${p} к ${label}`, prevLabel: { day: (d) => d, week: 'прошлой неделе', month: 'прошлому месяцу', quarter: 'прошлому кварталу', year: 'прошлому году' },
    quarterN: (q, y) => `${q} квартал ${y}`
  },
  uz: {
    sum: (n) => `${fmt(n)} so‘m`,
    weekday: (i) => WEEKDAYS.uz[i], weekdayFull: (i) => WEEKDAYS_FULL.uz[i], month: (i) => MONTHS.uz[i],
    order: 'Buyurtma', delivery: 'Yetkazib berish', pickup: 'Olib ketish',
    total: 'Jami', cash: 'Naqd pul', card: 'Kartaga o‘tkazma', change: (n) => `${fmt(n)} dan qaytim`,
    landmark: 'Mo‘ljal', apt: 'Xonadon/podyezd', map: 'Xarita', comment: 'Izoh',
    fromSite: 'sayt', fromTg: 'Telegram', status: 'Holat', etaTo: (t) => `soat ${t} gacha`,
    byWhom: (n) => ` (${n})`,
    accept: (m) => `✅ ${m} daq`, cancel: '❌ Bekor qilish', back: '← Orqaga', undo: '↩️ Bir qadam orqaga',
    next: { cooking: '👨‍🍳 Tayyorlanmoqda', courier: '📦 Kuryerga berildi', onway: '🛵 Kuryer yo‘lda', delivered: '🎉 Yetkazildi', ready: '🛍️ Olib ketishga tayyor', picked: '🎉 Topshirildi' },
    acceptHint: 'Buyurtmani qabul qiling — mijozga qancha vaqtda yetib borishini tanlang:',
    cancelAsk: 'Bekor qilish sababi:',
    already: 'Holat allaqachon o‘zgargan', done: 'Tayyor', tooLate: 'Holatni qaytarib bo‘lmaydi',
    remind: (n, m) => `⏰ №${n} buyurtma ${m} daqiqadan beri tasdiqlanmagan!`,
    customerCanceled: (n) => `❌ Mijoz №${n} buyurtmani o‘zi bekor qildi.`,
    bound: '✅ Guruh ulandi. Yangi buyurtmalar shu yerga keladi.\n\nBuyruqlar: /stats — statistika, /orders — jarayondagi buyurtmalar, /pause va /resume — onlayn buyurtmani to‘xtatish yoki yoqish, /lang — til.',
    boundAlready: 'Bu guruh allaqachon ulangan ✅',
    boundOther: 'Bot boshqa guruhga ulangan. Buyurtmalarni bu yerga o‘tkazish uchun o‘sha guruhda /unbind yuboring.',
    unbound: 'Guruh uzildi — buyurtmalar endi bu yerga kelmaydi. Qayta ulash uchun /bind yuboring.',
    notBound: 'Guruh hali ulanmagan. /bind yuboring (administrator huquqi kerak).',
    adminOnly: 'Bu buyruqni faqat guruh administratori bajara oladi.',
    hello: 'Assalomu alaykum! Buyurtmalarni shu guruhga olish uchun administrator /bind yuborishi kerak',
    paused: '⏸ Onlayn buyurtmalar to‘xtatildi. Saytda «telefon orqali buyurtma bering» deb ko‘rinadi. Qayta yoqish: /resume',
    resumed: '▶️ Onlayn buyurtmalar yana qabul qilinmoqda.',
    langSet: 'Guruhdagi bot tili: o‘zbekcha',
    noActive: 'Hozir jarayondagi buyurtmalar yo‘q 👌',
    activeTitle: (n) => `📋 Jarayondagi buyurtmalar: ${n}`,
    help: 'Bot buyruqlari:\n/stats — savdo statistikasi\n/orders — jarayondagi buyurtmalar\n/pause — onlayn buyurtmani to‘xtatish\n/resume — buyurtmani qayta yoqish\n/lang — bot tili (o‘zb/rus)\n/bind, /unbind — guruhni ulash yoki uzish',
    statsTitle: { today: 'Bugun', yesterday: 'Kecha', week: 'Shu hafta', month: 'Shu oy', quarter: 'Shu chorak', year: 'Shu yil' },
    reportTitle: { day: 'Kun yakuni', week: 'Hafta yakuni', month: 'Oy yakuni', quarter: 'Chorak yakuni', year: 'Yil yakuni' },
    statBtn: { today: 'Bugun', yesterday: 'Kecha', week: 'Hafta', month: 'Oy', quarter: 'Chorak', year: 'Yil' },
    revenue: 'Tushum', orders: 'Buyurtmalar', doneN: (n) => `bajarildi ${n}`, canceledN: (n) => `bekor ${n}`, activeN: (n) => `jarayonda ${n}`,
    avg: 'O‘rtacha chek', deliveryTime: 'O‘rtacha yetkazish vaqti', min: 'daq',
    clients: 'Mijozlar', newClients: (n) => `yangi ${n}`, peak: 'Eng gavjum vaqt', ordersShort: (n) => `${n} ta`,
    top: 'Top', bestDay: 'Eng yaxshi kun', noOrders: 'Buyurtmalar bo‘lmadi.', lost: 'yo‘qotildi',
    vs: (p, label) => `${label} nisbatan ${p}`, prevLabel: { day: (d) => d, week: 'o‘tgan haftaga', month: 'o‘tgan oyga', quarter: 'o‘tgan chorakka', year: 'o‘tgan yilga' },
    quarterN: (q, y) => `${y}-yil ${q}-chorak`
  }
};

// Покупателю: карточка заказа в личном чате
export const C = {
  ru: {
    hello: 'Здравствуйте! Это бот <b>Buddy Coffee</b> 👋\n\nОткройте меню, выберите блюда и оформите заказ. Доставка по Шахрисабзу — бесплатно, работаем круглосуточно.\n\nСтатус заказа будет приходить сюда.',
    menuBtn: '🍔 Открыть меню', openOrder: '📄 Открыть заказ', cancel: '❌ Отменить заказ',
    linked: 'Готово! Статус этого заказа будет приходить сюда 👇',
    notFound: 'Заказ не найден. Возможно, ссылка устарела.',
    title: (n) => `☕ <b>Buddy Coffee</b> · Заказ №${n}`,
    eta: (t) => `⏱ Ожидаем примерно к <b>${t}</b>`,
    total: 'Итого', cash: 'наличными', card: 'переводом на карту',
    noOrders: 'У вас пока нет заказов. Нажмите «Открыть меню» 👇',
    myOrders: 'Ваши последние заказы:',
    help: (phone) => `Чтобы заказать, нажмите «Открыть меню». По вопросам звоните: ${phone}`,
    canceledOk: 'Заказ отменён.', cancelLate: 'Заказ уже принят — чтобы отменить, позвоните в кафе.'
  },
  uz: {
    hello: 'Assalomu alaykum! Bu <b>Buddy Coffee</b> boti 👋\n\nMenyuni oching, taom tanlang va buyurtma bering. Shahrisabz bo‘ylab yetkazib berish — bepul, kecha-kunduz ishlaymiz.\n\nBuyurtma holati shu yerga keladi.',
    menuBtn: '🍔 Menyuni ochish', openOrder: '📄 Buyurtmani ochish', cancel: '❌ Buyurtmani bekor qilish',
    linked: 'Tayyor! Bu buyurtma holati shu yerga keladi 👇',
    notFound: 'Buyurtma topilmadi. Havola eskirgan bo‘lishi mumkin.',
    title: (n) => `☕ <b>Buddy Coffee</b> · Buyurtma №${n}`,
    eta: (t) => `⏱ Taxminan soat <b>${t}</b> da`,
    total: 'Jami', cash: 'naqd pul', card: 'kartaga o‘tkazma',
    noOrders: 'Sizda hali buyurtma yo‘q. «Menyuni ochish» tugmasini bosing 👇',
    myOrders: 'Oxirgi buyurtmalaringiz:',
    help: (phone) => `Buyurtma berish uchun «Menyuni ochish» tugmasini bosing. Savollar bo‘yicha: ${phone}`,
    canceledOk: 'Buyurtma bekor qilindi.', cancelLate: 'Buyurtma qabul qilingan — bekor qilish uchun kafega qo‘ng‘iroq qiling.'
  }
};
