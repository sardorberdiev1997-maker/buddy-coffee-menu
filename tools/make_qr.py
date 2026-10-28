"""QR-коды для печати: векторный SVG с логотипом в центре и PNG 2400 px без логотипа.
print/qr.svg — меню (сайт), qr-bot — Telegram-бот, qr-instagram — Instagram,
qr-google / qr-yandex / qr-2gis — отзывы. Отзывы ведут на короткие ссылки сайта /r/… (server/index.js),
а те — на ссылки из «Настроек» таблицы: настоящие ссылки можно вписать позже, не перепечатывая постеры.

Уровень коррекции H (до 30 % потерь): центр кода (≈ 28 % ширины) очищается целыми модулями
и в него ставится логотип с белой рамкой. Сканирование проверено — см. tools/check_qr.swift.

Запуск: python3 tools/make_qr.py   (нужен пакет qrcode: pip install qrcode pillow)
"""
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_H

SITE = 'https://buddy.cheking.uz'
CODES = {
    'qr': (SITE, 'buddy'),
    'qr-bot': ('https://t.me/buddy_coffee_uz_bot', 'tg'),
    'qr-instagram': ('https://www.instagram.com/buddy_coffee_/', 'ig'),
    'qr-google': (SITE + '/r/google', 'google'),
    'qr-yandex': (SITE + '/r/yandex', 'yandex'),
    'qr-2gis': (SITE + '/r/2gis', '2gis'),
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'print')
INK = '#1B1612'

# Логотипы в квадрате 24×24
CUP = ('<path d="M21 13 25 5l7 6 7-6 4 8z" fill="#FFD23F" stroke="#1B1612" stroke-width="2.4" stroke-linejoin="round"/>'
       '<path d="M11 17h42l-4.2 33.5A7 7 0 0 1 41.9 57H22.1a7 7 0 0 1-6.9-6.5z" fill="#1B1612"/>'
       '<path d="M52 24h2.5a8 8 0 0 1 0 16H50" fill="none" stroke="#1B1612" stroke-width="4.5" stroke-linecap="round"/>'
       '<ellipse cx="25" cy="30" rx="2.6" ry="3.2" fill="#fff"/><ellipse cx="39" cy="30" rx="2.6" ry="3.2" fill="#fff"/>'
       '<path d="M23 39q9 9 18 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>')
TILE = '<rect x=".4" y=".4" width="23.2" height="23.2" rx="6" fill="#fff" stroke="#DADCE0" stroke-width=".8"/>'
LOGOS = {
    'buddy': f'<rect width="24" height="24" rx="6" fill="#E31B23"/><g transform="translate(2.2 2.4) scale(.31)">{CUP}</g>',
    'tg': ('<circle cx="12" cy="12" r="12" fill="#229ED9"/>'
           '<path d="M5.4 11.8 17 7.3c.6-.2 1.1.1.9 1l-2 9.3c-.1.7-.6.8-1.1.5l-3-2.2-1.5 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5'
           'c.2-.2 0-.3-.3-.1l-6.9 4.3-3-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/>'),
    'ig': ('<defs><radialGradient id="ig" cx="30%" cy="107%" r="150%"><stop offset=".05" stop-color="#FDF497"/>'
           '<stop offset=".45" stop-color="#FD5949"/><stop offset=".6" stop-color="#D6249F"/><stop offset=".9" stop-color="#285AEB"/>'
           '</radialGradient></defs><rect width="24" height="24" rx="6.5" fill="url(#ig)"/>'
           '<g fill="none" stroke="#fff" stroke-width="1.9"><rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4"/>'
           '<circle cx="12" cy="12" r="3.3"/></g><circle cx="16.3" cy="7.7" r="1" fill="#fff"/>'),
    'google': (TILE + '<g transform="translate(4 4) scale(.3333)">'
               '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
               '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
               '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
               '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></g>'),
    'yandex': (TILE + '<path d="M12 3.4a6.6 6.6 0 0 0-6.6 6.6c0 4.7 6.6 11 6.6 11s6.6-6.3 6.6-11A6.6 6.6 0 0 0 12 3.4z" fill="#FC3F1D"/>'
               '<circle cx="12" cy="10" r="2.6" fill="#fff"/>'),
    '2gis': ('<rect width="24" height="24" rx="6" fill="#19AA1E"/>'
             '<text x="12" y="15.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" '
             'font-size="8.4" fill="#fff" letter-spacing="-.2">2GIS</text>'),
}


def make(name, url, logo):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=0)
    qr.add_data(url)
    qr.make(fit=True)
    m = qr.get_matrix()
    n = len(m)

    # Центр под логотип: нечётное число целых модулей ≈ 28 % ширины, чтобы край выреза был ровным
    k = round(n * 0.28) | 1
    lo = (n - k) // 2
    hole = range(lo, lo + k)

    # Один path из квадратов-модулей: файл чёткий в любом размере
    d = ''.join(f'M{x} {y}h1v1h-1z' for y, row in enumerate(m) for x, on in enumerate(row)
                if on and not (y in hole and x in hole))
    pad = 0.6  # белая рамка вокруг логотипа, в модулях
    s = (k - 2 * pad) / 24
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}">'
           f'<path fill="{INK}" shape-rendering="crispEdges" d="{d}"/>'
           f'<g transform="translate({lo + pad} {lo + pad}) scale({s:.4f})">{LOGOS[logo]}</g></svg>\n')
    with open(os.path.join(OUT, f'{name}.svg'), 'w') as f:
        f.write(svg)

    from PIL import Image
    quiet = 4
    side = n + quiet * 2
    canvas = Image.new('RGB', (side, side), 'white')
    for y, row in enumerate(m):
        for x, on in enumerate(row):
            if on:
                canvas.putpixel((x + quiet, y + quiet), (0x1B, 0x16, 0x12))
    size = (2400 // side) * side  # целый масштаб — все модули одного размера
    canvas.resize((size, size), Image.NEAREST).save(os.path.join(OUT, f'{name}.png'))
    print(f'{url}: {n}x{n} modules, logo {k}x{k} -> print/{name}.svg, print/{name}.png')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (url, logo) in CODES.items():
        make(name, url, logo)


if __name__ == '__main__':
    main()
