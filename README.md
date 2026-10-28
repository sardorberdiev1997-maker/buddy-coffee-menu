# Buddy Coffee — онлайн-меню

Сайт: **https://buddy.cheking.uz** (сюда ведёт QR-код на столах).

## Как поменять меню (для владельца)

Всё меняется в Google Таблице — сайт подхватывает правки сам, обычно в течение минуты:
https://docs.google.com/spreadsheets/d/1kNo_wDgMou0T0M79G-gFn0dmuhOThz96vISxytnSJsY/edit

- Вкладка «Меню»: цены, названия, описания, вес, метки, наличие («нет» — позиция станет серой).
- Вкладка «Настройки»: шапка, телефон, часы, Wi‑Fi, соцсети, объявление, юрлицо.
- Подробности — на вкладке «Инструкция».
- Заголовки колонок и ключи настроек защищены предупреждением: их менять нельзя, иначе сайт не прочитает таблицу.

Доступ к таблице: всем по ссылке — **только чтение** (так сайт её читает), редактирование — только конкретным Google-аккаунтам (владелец кафе добавляется по Gmail как «Редактор»). Ссылку на редактирование для всех не включать: ID таблицы виден в коде сайта.

## Как устроено

```
Google Таблица ──(export CSV в браузере)──► сайт обновляет меню на лету
      │
      └─(GitHub Action каждые 15 мин)──► data/menu.json ──► git push ──► Cloudflare Pages: npm run build ──► dist/
```

- **Хостинг:** Cloudflare Pages, проект `buddy-coffee-menu` (сборка `npm run build`, папка `dist`, Node 20). Каждый push в `main` — новая сборка. Резервный адрес: https://buddy-coffee-menu.pages.dev
- **Домен:** `buddy.cheking.uz` — запись CNAME `buddy` → `buddy-coffee-menu.pages.dev` в DNS cheking.uz на ahost.uz.
- **Сборка** (`tools/build.mjs`): вшивает меню из `data/menu.json` в `index.html` (страница показывается сразу, без ожидания данных), минифицирует JS/CSS (esbuild), ставит хеши версий для кэша, кладёт `_headers` (CSP, HSTS, X-Frame-Options и др.).
- **В браузере** (`assets/app.js` + общий `assets/render.js`): меню из HTML → кэш прошлого визита → свежие данные из таблицы (перерисовка только если что-то изменилось). Языки UZ/RU, поиск, шторка блюда, офлайн-режим (`sw.js`).
- **Запасная копия** `data/menu.json` — обновляется GitHub Action'ом `.github/workflows/sync-menu.yml` (`tools/sync_menu.py`). Если 60 дней в репозитории нет коммитов, GitHub отключит расписание и пришлёт письмо — включить в Actions одной кнопкой.
- **Статистика:** Cloudflare Web Analytics (без cookie) — dash.cloudflare.com → Analytics → Web analytics → buddy.cheking.uz.
- **Фото:** `img/xs` (240 px), `img/s` (360 px), `img/l` (960 px) в AVIF и WebP. В таблице в колонке «фото» — имя файла без расширения, прямая ссылка на картинку или ссылка на файл Google Диска с доступом по ссылке.
- `print/` — QR-код и постеры (`tools/make_qr.py`).

## Локально

```bash
npm install
npm run build
python3 -m http.server 8766 --directory dist
```

## Стандарты

- WCAG 2.2 AA: контраст ≥ 4.5:1, семантика (h1–h3, кнопки), фокус, `prefers-reduced-motion`, объявления результатов поиска.
- Безопасность: CSP без inline-скриптов, `frame-ancestors 'none'`, HSTS, nosniff, Permissions-Policy; ссылки из таблицы фильтруются (http/https/tel/mailto); нет сторонних JS-библиотек.
- Производительность: меню в HTML, свой шрифт, AVIF + srcset, долгий кэш для файлов с хешем.
- SEO: canonical, hreflang uz/ru, Open Graph, schema.org `CafeOrCoffeeShop` + `Menu`, `robots.txt`, `sitemap.xml`.

## Фото

Временные фото — с [Unsplash](https://unsplash.com) (бесплатная лицензия, разрешено коммерческое использование). Список с ID — `tools/photos.txt`.
