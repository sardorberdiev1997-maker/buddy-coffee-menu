"""QR-код на адрес меню: print/qr.svg (векторный) и print/qr.png (2400 px) для типографии.

Запуск: python3 tools/make_qr.py   (нужен пакет qrcode: pip install qrcode pillow)
"""
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_Q

URL = 'https://buddy.cheking.uz'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'print')
INK = '#1B1612'


def main():
    os.makedirs(OUT, exist_ok=True)
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, border=0)
    qr.add_data(URL)
    qr.make(fit=True)
    m = qr.get_matrix()
    n = len(m)

    # Один path из квадратов-модулей: файл чёткий в любом размере
    d = ''.join(f'M{x} {y}h1v1h-1z' for y, row in enumerate(m) for x, on in enumerate(row) if on)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
           f'<path fill="{INK}" d="{d}"/></svg>\n')
    with open(os.path.join(OUT, 'qr.svg'), 'w') as f:
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
    canvas.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'qr.png'))
    print(f'{URL}: {n}x{n} modules -> print/qr.svg, print/qr.png')


if __name__ == '__main__':
    main()
