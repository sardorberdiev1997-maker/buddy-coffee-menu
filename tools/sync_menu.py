"""Копирует меню в data/menu.json (запасная копия для сайта и сборки).

Источник — сервер сайта (/api/menu: меню из панели владельца, docs/admin-panel.md).
Запускается GitHub Action'ом по расписанию; вручную: python3 tools/sync_menu.py
Если источник недоступен или структура сломана — файл не трогается.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED = {'Меню': {'категория', 'название_uz', 'цена'}, 'Категории': {'id'}, 'Настройки': {'ключ'}}
OUT = os.path.join(ROOT, 'data', 'menu.json')
API = 'https://buddycoffee.uz/api/menu'
API_TABS = {'Меню': 'menu', 'Категории': 'categories', 'Настройки': 'settings'}


def from_api():
    req = urllib.request.Request(API, headers={'User-Agent': 'buddy-menu sync'})
    with urllib.request.urlopen(req, timeout=30) as r:
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


def main():
    try:
        data = from_api()
    except Exception as e:  # сервер недоступен — оставляем прежнюю копию (Google Таблица для меню устарела)
        print(f'/api/menu недоступен, копия не обновлена: {e}', file=sys.stderr)
        sys.exit(1)
    new = dump(data)
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
    if new == old:
        print('Без изменений')
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(new)
    print('data/menu.json обновлён')


if __name__ == '__main__':
    main()
