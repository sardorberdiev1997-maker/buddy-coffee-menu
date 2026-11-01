"""Копирует меню в data/menu.json и фото из панели в data/photos/ (запасная копия для сайта и сборки).

Источник — сервер сайта (/api/menu: меню из панели владельца, docs/admin-panel.md).
Запускается GitHub Action'ом по расписанию; вручную: python3 tools/sync_menu.py
Если источник недоступен или структура сломана — файл не трогается.
Фото (up_<id>) не меняются после загрузки, поэтому скачиваются один раз; фото, которых больше нет в меню, из папки
убираются (в истории git они остаются). Если база фото потеряется, сайт отдаст их из этой папки (servePhoto в server/admin.js).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED = {'Меню': {'категория', 'название_uz', 'цена'}, 'Категории': {'id'}, 'Настройки': {'ключ'}}
OUT = os.path.join(ROOT, 'data', 'menu.json')
PHOTOS = os.path.join(ROOT, 'data', 'photos')
SITE = 'https://buddycoffee.uz/'
API = SITE + 'api/menu'
UPLOADED = re.compile(r'^up_([a-f0-9]{16})$')
EXT = {'image/webp': 'webp', 'image/jpeg': 'jpg'}
API_TABS = {'Меню': 'menu', 'Категории': 'categories', 'Настройки': 'settings'}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'buddy-menu sync'})
    return urllib.request.urlopen(req, timeout=30)


def from_api():
    with get(API) as r:
        tables = json.load(r)['tables']
    data = {}
    for tab, key in API_TABS.items():
        rows = [[str(c) for c in row] for row in tables[key] if any(str(c).strip() for c in row)]
        head = {h.strip().lower() for h in rows[0]} if rows else set()
        if len(rows) < 2 or not REQUIRED[tab] <= head:
            raise ValueError(f'/api/menu: «{tab}» неожиданной структуры')
        data[tab] = rows
    return data


def dump(data):
    # Одна строка таблицы — одна строка файла: удобно смотреть diff
    parts = []
    for tab, rows in data.items():
        lines = ',\n'.join('    ' + json.dumps(r, ensure_ascii=False) for r in rows)
        parts.append(f'  {json.dumps(tab, ensure_ascii=False)}: [\n{lines}\n  ]')
    return '{\n' + ',\n'.join(parts) + '\n}\n'


def photo_ids(data):
    rows = data['Меню']
    col = [h.strip().lower() for h in rows[0]].index('фото') if 'фото' in [h.strip().lower() for h in rows[0]] else -1
    ids = set()
    for row in rows[1:]:
        m = UPLOADED.match(row[col].strip()) if 0 <= col < len(row) else None
        if m:
            ids.add(m.group(1))
    return ids


def sync_photos(ids):
    os.makedirs(PHOTOS, exist_ok=True)
    have = {}
    for name in os.listdir(PHOTOS):
        m = re.match(r'^([a-f0-9]{16})-(sq|l)\.(webp|jpg)$', name)
        if m:
            have.setdefault(m.group(1), set()).add(m.group(2))
        elif not name.startswith('.'):
            os.remove(os.path.join(PHOTOS, name))
    added = removed = 0
    for pid in ids:
        for size in ('sq', 'l'):
            if size in have.get(pid, set()):
                continue
            with get(f'{SITE}api/photo/{pid}/{size}') as r:
                ext = EXT.get(r.headers.get_content_type())
                body = r.read()
            if not ext or len(body) < 100:
                raise ValueError(f'фото {pid}/{size}: неожиданный ответ')
            with open(os.path.join(PHOTOS, f'{pid}-{size}.{ext}'), 'wb') as f:
                f.write(body)
            added += 1
    for pid in set(have) - ids:
        for name in os.listdir(PHOTOS):
            if name.startswith(pid + '-'):
                os.remove(os.path.join(PHOTOS, name))
                removed += 1
    print(f'Фото: в меню {len(ids)}, скачано файлов {added}, убрано {removed}')


def main():
    try:
        data = from_api()
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        # Сайт недоступен — оставляем прежнюю копию; о недоступности сообщает проверка сайта (site-check.yml)
        print(f'::warning::/api/menu недоступен, копия не обновлена: {e}')
        return
    new = dump(data)
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
    if new == old:
        print('Меню без изменений')
    else:
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write(new)
        print('data/menu.json обновлён')
    sync_photos(photo_ids(data))


if __name__ == '__main__':
    main()
