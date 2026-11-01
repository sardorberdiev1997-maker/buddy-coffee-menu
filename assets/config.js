// В браузере — window, на сервере (server/) — globalThis
(typeof window !== 'undefined' ? window : globalThis).MENU_CONFIG = {
  // Названия вкладок — ключи в data/menu.json
  tabs: { menu: 'Меню', categories: 'Категории', settings: 'Настройки' },
  fallback: 'data/menu.json',
  // Telegram-бот кафе (без @)
  bot: 'buddy_coffee_uz_bot'
};
