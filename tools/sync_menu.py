"""Копирует меню из Google Таблицы в data/menu.json (запасная копия для сайта).

Запускается GitHub Action'ом по расписанию; вручную: python3 tools/sync_menu.py
Если таблица недоступна или её структура сломана — файл не трогается.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = open(os.path.join(ROOT, 'assets', 'config.js'), encoding='utf-8').read()
SHEET_ID = re.search(r"sheetId:\s*'([^']*)'", CONFIG).group(1)
GIDS = dict(re.findall(r"(menu|categories|settings):\s*'(\d+)'", CONFIG))
PUB = (re.search(r"pub:\s*'([^']*)'", CONFIG) or [None, ''])[1]
TABS = {'Меню': 'menu', 'Категории': 'categories', 'Настройки': 'settings'}
REQUIRED = {'Меню': {'категория', 'название_uz', 'цена'}, 'Категории': {'id'}, 'Настройки': {'ключ'}}
OUT = os.path.join(ROOT, 'data', 'menu.json')


def fetch(tab):
    base = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}'
    gid = GIDS.get(TABS[tab])
    # Опубликованная ссылка работает и при закрытом доступе к таблице
    if PUB and gid:
        url = f'https://docs.google.com/spreadsheets/d/e/{PUB}/pub?gid={gid}&single=true&output=csv'
    else:
        url = (f'{base}/export?format=csv&gid={gid}' if gid
               else f'{base}/gviz/tq?tqx=out:csv&headers=1&sheet=' + urllib.parse.quote(tab))
    with urllib.request.urlopen(url, timeout=30) as r:
        rows = list(csv.reader(io.StringIO(r.read().decode('utf-8-sig'))))
    rows = [row for row in rows if any(c.strip() for c in row)]
    head = {h.strip().lower() for h in rows[0]} if rows else set()
    if len(rows) < 2 or not REQUIRED[tab] <= head:
        raise ValueError(f'вкладка «{tab}»: неожиданная структура')
    return [[c.strip() for c in row] for row in rows]


def dump(data):
    # Одна строка таблицы — одна строка файла: удобно смотреть diff
    parts = []
    for tab, rows in data.items():
        lines = ',\n'.join('    ' + json.dumps(r, ensure_ascii=False) for r in rows)
        parts.append(f'  {json.dumps(tab, ensure_ascii=False)}: [\n{lines}\n  ]')
    return '{\n' + ',\n'.join(parts) + '\n}\n'


def main():
    if not SHEET_ID:
        print('sheetId пуст — синхронизировать нечего')
        return
    try:
        data = {tab: fetch(tab) for tab in TABS}
    except Exception as e:  # сеть, доступ, структура — оставляем старую копию
        print(f'Таблица недоступна, копия не обновлена: {e}', file=sys.stderr)
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
