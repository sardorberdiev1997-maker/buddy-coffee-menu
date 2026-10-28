# Buddy Coffee — онлайн-меню

Сайт: **https://buddy.cheking.uz** (сюда ведёт QR-код на столах).

Статический сайт без сборки: `index.html` + `assets/` + `img/`. Хостинг — GitHub Pages, домен — поддомен `buddy` у `cheking.uz` (DNS на ahost.uz, запись CNAME → `sardorberdiev1997-maker.github.io`).

## Как поменять меню

Цены, позиции, наличие, тексты шапки и контакты правятся в Google Таблице:
https://docs.google.com/spreadsheets/d/1kNo_wDgMou0T0M79G-gFn0dmuhOThz96vISxytnSJsY/edit

Подробная инструкция — на вкладке «Инструкция» в самой таблице. Сайт читает таблицу при каждом открытии, публиковать ничего не нужно.

У таблицы должен быть включён доступ «Все, у кого есть ссылка → Читатель», иначе сайт её не видит и показывает запасную копию из `data/menu.json`.

## Как устроено

- `assets/config.js` — ID таблицы и ID вкладок (`gids`). Данные читаются через `export?format=csv` — значения приходят ровно как в ячейках.
- `assets/app.js` — загрузка (кэш в браузере → Google Таблица; если таблица молчит 2 с — `data/menu.json`), отрисовка, поиск, UZ/RU, шторка блюда, schema.org-разметка.
- `data/menu.json` — запасная копия меню. Обновляется автоматически раз в 6 часов GitHub Action'ом `.github/workflows/sync-menu.yml` (`tools/sync_menu.py`), вручную — Actions → «Sync menu backup» → Run workflow.
- `sw.js` — офлайн-кэш (сайт открывается без интернета после первого визита). При смене набора файлов поднять `VERSION` и `?v=` в `index.html`.
- `img/s/*` (360×360) и `img/l/*` (960×720) — фото в AVIF и WebP. В таблице в колонке «фото» указывается имя файла без расширения.
- `assets/fonts/` — шрифт Rubik (свой хостинг, без запросов к Google Fonts).
- `tools/build_sheet.py` — собирает `tools/menu.xlsx` из `data/menu.json` (так создавалась таблица).
- `print/` — QR-код и постеры для печати (`tools/make_qr.py`).

Чтобы добавить своё фото: положить `img/s/<имя>.avif|.webp` и `img/l/<имя>.avif|.webp` (или любую картинку `img/<имя>.jpg`) и вписать имя в таблицу. Можно и просто вставить в таблицу прямую ссылку на картинку.

## Стандарты

- Доступность WCAG 2.2 AA: контраст ≥ 4.5:1, семантика (h1–h3, кнопки), фокус, `prefers-reduced-motion`, объявления результатов поиска.
- Строгий CSP через `<meta>`, никаких inline-скриптов и стилей; ссылки из таблицы фильтруются (только http/https/tel/mailto).
- SEO: canonical, hreflang uz/ru, Open Graph, schema.org `CafeOrCoffeeShop` + `Menu`, `robots.txt`, `sitemap.xml`.
- PWA: манифест, иконки, service worker.

## Фото

Временные фото — с [Unsplash](https://unsplash.com) (бесплатная лицензия, разрешено коммерческое использование). Список с ID — `tools/photos.txt`. Заменить на реальные фото блюд, когда будут готовы.
