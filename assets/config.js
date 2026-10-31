// В браузере — window, на сервере (server/) — globalThis
(typeof window !== 'undefined' ? window : globalThis).MENU_CONFIG = {
  // ID Google Таблицы (часть ссылки docs.google.com/spreadsheets/d/<ID>/edit) здесь не храним: файл видит каждый
  // посетитель, а по ID таблицы с открытым доступом можно скачать любую вкладку, в том числе «Клиенты».
  // Меню читается по публикации (pub); если пусты и sheetId, и pub — из data/menu.json
  sheetId: '',
  // ID вкладок (число после gid= в ссылке). Не удалять и не пересоздавать вкладки — gid сменится
  gids: { menu: '1991140194', categories: '5003781', settings: '864498900' },
  // ID публикации («Файл → Поделиться → Опубликовать в интернете», вкладки Меню/Категории/Настройки, CSV):
  // часть ссылки docs.google.com/spreadsheets/d/e/<ID>/pub. С ним сайт читает меню, даже когда доступ к таблице закрыт
  pub: '2PACX-1vSuoMKSvNKrVFBObq8kItYtwKUr_QLx074nSwlBktZoumZbTYfMsBnK_njqnNPd5hcwhOFrBfLALWZA',
  // Названия вкладок — ключи в data/menu.json
  tabs: { menu: 'Меню', categories: 'Категории', settings: 'Настройки' },
  fallback: 'data/menu.json',
  // Telegram-бот кафе (без @)
  bot: 'buddy_coffee_uz_bot'
};
