window.MENU_CONFIG = {
  // ID Google Таблицы: часть ссылки docs.google.com/spreadsheets/d/<ID>/edit
  // Пусто — сайт берёт меню из data/menu.json
  sheetId: '1kNo_wDgMou0T0M79G-gFn0dmuhOThz96vISxytnSJsY',
  // ID вкладок (число после gid= в ссылке). Не удалять и не пересоздавать вкладки — gid сменится
  gids: { menu: '1991140194', categories: '5003781', settings: '864498900' },
  // Названия вкладок — ключи в data/menu.json
  tabs: { menu: 'Меню', categories: 'Категории', settings: 'Настройки' },
  fallback: 'data/menu.json'
};
