"""Постеры, карточки и наклейки для печати → print/posters/ (PDF для типографии + PNG 300 dpi).

Источник правды — этот скрипт: HTML пишется в print/posters/src/, PDF и PNG делает headless Chrome.
Форматы A подобны (стороны 1 : √2), поэтому A3 = A4 × √2, A2 = A4 × 2, A5 = A6 × √2 —
масштаб через CSS zoom, текст и QR остаются векторными. PDF — с вылетами 3 мм под обрезку,
PNG — в обрезном формате. У каждого изделия светлая и тёмная версия.

Изделия:
  poster  — A4 / A3 (дверь) / A2 (витрина): главный QR на сайт + 5 малых (бот, Instagram, отзывы)
  card    — двусторонняя карточка A6 (стол, акриловая подставка) / A5 (флаер): лицо — меню, оборот — отзывы
  tent    — «домик» на стол: лист A4, разрезать вдоль пополам, каждую полосу согнуть посередине
  sticker — наклейка 100 × 100 мм с главным QR

Запуск: python3 tools/make_posters.py   (нужен Google Chrome; QR-коды — tools/make_qr.py, проверка — tools/check_qr.swift)
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'print', 'posters')
SRC = os.path.join(OUT, 'src')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PX = 96 / 25.4   # CSS px в 1 мм
DPI = 300
BLEED = 3        # мм

ic = lambda n: f'<svg class="icon"><use href="#{n}"/></svg>'
STARS = '<span class="stars">' + ''.join('<svg><use href="#star"/></svg>' for _ in range(5)) + '</span>'
CUP = ('<path d="M21 13 25 5l7 6 7-6 4 8z" fill="#FFD23F" stroke="#1B1612" stroke-width="2.4" stroke-linejoin="round"/>'
       '<path d="M11 17h42l-4.2 33.5A7 7 0 0 1 41.9 57H22.1a7 7 0 0 1-6.9-6.5z" fill="#1B1612"/>'
       '<path d="M52 24h2.5a8 8 0 0 1 0 16H50" fill="none" stroke="#1B1612" stroke-width="4.5" stroke-linecap="round"/>')
SPRITE = f'''<svg width="0" height="0" style="position:absolute"><defs>
<symbol id="cup" viewBox="0 0 64 64">{CUP}<ellipse cx="25" cy="30" rx="2.6" ry="3.2" fill="#fff"/><ellipse cx="39" cy="30" rx="2.6" ry="3.2" fill="#fff"/><path d="M23 39q9 9 18 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></symbol>
<symbol id="buddy" viewBox="0 0 64 64" overflow="visible">{CUP}<ellipse cx="25" cy="30" rx="3.6" ry="4.2" fill="#fff"/><ellipse cx="39" cy="30" rx="3.6" ry="4.2" fill="#fff"/><circle cx="23.4" cy="31.6" r="2" fill="#1B1612"/><circle cx="37.4" cy="31.6" r="2" fill="#1B1612"/><circle cx="19.5" cy="38" r="2.2" fill="#E31B23"/><circle cx="44.5" cy="38" r="2.2" fill="#E31B23"/><path d="M25 40q7 7 14 0" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></symbol>
<symbol id="buddy-o" viewBox="0 0 64 64" overflow="visible"><g fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" stroke-width="8"><path d="M21 13 25 5l7 6 7-6 4 8z"/><path d="M21 13h22v6H21z"/><path d="M11 17h42l-4.2 33.5A7 7 0 0 1 41.9 57H22.1a7 7 0 0 1-6.9-6.5z"/><path d="M52 24h2.5a8 8 0 0 1 0 16H50" fill="none" stroke-width="12.5"/></g></symbol>
<symbol id="phone" viewBox="0 0 24 24"><path d="M6.6 3.5h2.6l1.4 4.2-2 1.3a11 11 0 0 0 6.4 6.4l1.3-2 4.2 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>
<symbol id="pin" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></g></symbol>
<symbol id="clock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></g></symbol>
<symbol id="scooter" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h6.5l2-6h-4M14 5h2l3 12M3 11h6v3"/></g></symbol>
<symbol id="camera" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.4"/></g></symbol>
<symbol id="star" viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor"/></symbol>
</defs></svg>'''

# Маскот смотрит влево-вниз — туда, куда нужно посмотреть зрителю. Белый контур — вектором, без фильтров
MASCOT = ('<div class="mascot"><svg viewBox="0 0 64 64" overflow="visible"><use href="#buddy-o" class="m-sh" transform="translate(0 2.6)"/>'
          '<use href="#buddy-o" class="m-ol"/><use href="#buddy"/></svg></div>')
BRAND = '<div class="brand"><span class="mark"><svg><use href="#cup"/></svg></span><span class="word">Buddy <i>COFFEE</i></span></div>'
OPEN = f'<div class="open">{ic("clock")}<div><b>24/7</b><span>Har kuni · Ежедневно</span></div></div>'
HEAD = '<h1>Menyu va buyurtma <em>bitta skanerda</em></h1><p>Меню и заказ — в один скан</p>'
MAIN = (f'<div class="stage"><div class="qcard"><div class="cta">{ic("camera")}<b>Skanerlang</b><span>Сканируйте</span></div>'
        '<img src="../../qr.svg" alt=""><div class="url">buddycoffee.uz</div></div></div>')
tile = lambda qr, name: f'<div class="tile"><div class="q"><img src="../../{qr}.svg" alt=""></div><b>{name}</b></div>'
SOCIAL = tile('qr-bot', 'Telegram') + tile('qr-instagram', 'Instagram')
REVIEWS = tile('qr-google', 'Google') + tile('qr-yandex', 'Yandex') + tile('qr-2gis', '2GIS')
ADDRESS = f'{ic("pin")}<div>Fusunkor ko‘chasi, 70<span>ул. Фусункор, 70 · рядом с «Visol»</span></div>'
BAND = f'<div class="band"><div class="ph">{ic("phone")}+998 90 896 54 00</div><div class="ad">{ADDRESS}</div></div>'

BODIES = {
    'poster': f'''<div class="top">{BRAND}{OPEN}</div><div class="head">{HEAD}</div>
<div class="sticker"><div>{ic('scooter')}<b>BEPUL</b><span>yetkazib berish</span><small>Бесплатная доставка</small></div></div>
{MAIN}{MASCOT}
<div class="links"><div class="panel"><h2>Obuna bo‘ling <small>· Подпишитесь</small></h2><div class="row r2">{SOCIAL}</div></div>
<div class="panel"><h2>Sharh qoldiring <small>· Оставьте отзыв</small>{STARS}</h2><div class="row r3">{REVIEWS}</div></div></div>{BAND}''',
    'front': f'''<div class="top">{BRAND}{OPEN}</div><div class="head">{HEAD}</div>{MAIN}
<div class="foot"><div class="deal">{ic('scooter')}<div><b>BEPUL yetkazib berish</b><span>Бесплатная доставка</span></div></div>{MASCOT}</div>''',
    'back': f'''<div class="sec s1"><h2>Sharh qoldiring {STARS}</h2><p>Оставьте отзыв — нам важно ваше мнение</p><div class="row r3">{REVIEWS}</div></div>
<div class="sec s2"><h2>Obuna bo‘ling</h2><p>Подпишитесь: акции и новинки</p><div class="row r3">{SOCIAL}
<div class="thanks"><div class="bubble">Rahmat!<span>Спасибо!</span></div>{MASCOT}</div></div></div>{BAND}''',
    'sticker': f'{MAIN}',
}

CSS = '''
@font-face { font-family: "Rubik"; font-weight: 400 800; src: url("../../../assets/fonts/rubik-cyrillic.woff2") format("woff2"); unicode-range: U+0400-045F, U+2116; }
@font-face { font-family: "Rubik"; font-weight: 400 800; src: url("../../../assets/fonts/rubik-latin-ext.woff2") format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF; }
@font-face { font-family: "Rubik"; font-weight: 400 800; src: url("../../../assets/fonts/rubik-latin.woff2") format("woff2"); unicode-range: U+0000-00FF, U+02BB-02BC, U+2000-206F, U+20AC, U+2212; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: "Rubik", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
svg.icon { width: 1em; height: 1em; flex: none; }

.light { --bg: #FFF6EA; --dots: rgb(27 22 18 / .07); --fg: #1B1612; --muted: #74695F; --accent: #E31B23; --chip: #fff; --line: #EEDDC8; --star: #F5A300; }
.dark  { --bg: #17120F; --dots: rgb(255 255 255 / .06); --fg: #FBF3EA; --muted: #B9AA9B; --accent: #FFD23F; --chip: #241C17; --line: #3A2E26; --star: #FFD23F; }
.bg { background: radial-gradient(var(--dots) .35mm, transparent .4mm) 0 0 / 4mm 4mm, var(--bg); }
/* свечение без прозрачности: красный 38 % поверх фона уже смешан — так большие форматы печатаются без растрирования */
.dark .bg { background: radial-gradient(var(--dots) .35mm, transparent .4mm) 0 0 / 4mm 4mm, radial-gradient(70% 40% at 100% 0%, #641516, var(--bg) 70%); }
.sheet { position: relative; overflow: hidden; padding: var(--b); break-after: page; }
.sheet:last-child { break-after: auto; }
.page { position: relative; color: var(--fg); }
.poster { width: 210mm; height: 297mm; }
.front, .back { width: 105mm; height: 148mm; }
.sticker-pg { width: 100mm; height: 100mm; }

/* общие детали */
.brand { display: flex; align-items: center; gap: 3.2mm; }
.mark { display: grid; place-items: center; width: 15mm; height: 15mm; border-radius: 4.6mm; background: #fff; transform: rotate(-4deg); box-shadow: 0 1mm 0 rgb(0 0 0 / .2); }
.mark svg { width: 11.4mm; height: 11.4mm; }
.word { display: flex; flex-direction: column; align-items: flex-start; font-weight: 800; font-size: 9.2mm; line-height: .92; letter-spacing: -.02em; color: var(--fg); }
.word i { margin-top: 1.4mm; padding: .8mm 2.2mm .5mm; border-radius: 1.4mm; background: #FFD23F; color: #1B1612; font-style: normal; font-size: 3.1mm; letter-spacing: .24em; }
.open { display: flex; align-items: center; gap: 2.4mm; padding: 2.2mm 4.4mm 2.2mm 3mm; border-radius: 99mm; background: var(--chip); border: .5mm solid var(--line); }
.open svg { width: 7.4mm; height: 7.4mm; color: var(--accent); }
.open b { display: block; font-size: 6.6mm; font-weight: 800; line-height: 1; }
.open span { display: block; margin-top: .6mm; font-size: 2.9mm; font-weight: 600; color: var(--muted); }
.top { position: absolute; display: flex; justify-content: space-between; align-items: center; }
.head { position: absolute; text-align: center; }
h1 { font-weight: 800; line-height: 1; letter-spacing: -.03em; }
h1 em { display: block; font-style: normal; color: var(--accent); }
.head p { font-weight: 600; color: var(--muted); }
.stage { position: absolute; left: 50%; transform: translateX(-50%); }
.stage::before { content: ""; position: absolute; inset: -4.5mm -6mm; border-radius: 10mm; background: #FFD23F; transform: rotate(-3.5deg); }
.qcard { position: relative; background: #fff; text-align: center; box-shadow: 0 1.6mm 0 rgb(0 0 0 / .14); }
.qcard img { display: block; width: 100%; height: auto; }
.cta { position: absolute; top: 0; left: 50%; transform: translate(-50%, -55%); display: flex; align-items: center; gap: 2.2mm; padding: 2.5mm 5.2mm 2.5mm 4.4mm; border-radius: 99mm; background: #E31B23; color: #fff; white-space: nowrap; box-shadow: 0 1mm 0 #A80E17; }
.cta svg { width: 6.2mm; height: 6.2mm; }
.cta b { font-size: 5.2mm; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.cta span { font-size: 3.8mm; font-weight: 600; opacity: .9; }
.url { font-weight: 800; color: #1B1612; }
.mascot svg { display: block; width: 100%; height: auto; }
.m-sh { color: #000; opacity: .16; }
.m-ol { color: #fff; }
.stars { display: inline-flex; gap: .3mm; color: var(--star); }
.stars svg { width: 3.7mm; height: 3.7mm; }
h2 { display: flex; align-items: center; gap: 1.8mm; font-weight: 800; line-height: 1.1; white-space: nowrap; }
h2 small { font-size: 3.3mm; font-weight: 500; color: var(--muted); }
.row { display: grid; gap: 4mm; margin-top: 3mm; }
.r2 { grid-template-columns: repeat(2, 1fr); }
.r3 { grid-template-columns: repeat(3, 1fr); }
.tile { text-align: center; }
.tile .q { padding: 2.9mm; border-radius: 3mm; background: #fff; border: .4mm solid #E9E1D6; }
.dark .tile .q { border-color: #fff; }
.tile .q img { display: block; width: 100%; }
.tile b { display: block; margin-top: 1.8mm; font-size: 3.2mm; font-weight: 700; }
.band { position: absolute; left: calc(-1 * var(--b)); right: calc(-1 * var(--b)); bottom: calc(-1 * var(--b)); display: grid; align-items: center; background: #E31B23; color: #fff; }
.band .ph { display: flex; align-items: center; gap: 2.4mm; font-weight: 800; white-space: nowrap; }
.band .ph svg { width: 1em; height: 1em; }
.band .ad { display: flex; align-items: center; gap: 2.4mm; font-weight: 800; line-height: 1.2; }
.band .ad svg { width: 1.4em; height: 1.4em; }
.band .ad span { display: block; font-size: .75em; font-weight: 500; opacity: .88; }

/* постер A4 */
.poster .top { top: 13mm; left: 16mm; right: 16mm; }
.poster .head { top: 41mm; left: 14mm; right: 14mm; }
.poster h1 { font-size: 14mm; }
.poster .head p { margin-top: 3.2mm; font-size: 5.2mm; }
.poster .stage { top: 94mm; width: 94mm; }
.poster .qcard { padding: 15mm 11mm 4mm; border-radius: 7mm; }
.poster .url { margin-top: 3.4mm; font-size: 5.8mm; }
.poster .sticker { position: absolute; top: 106mm; left: 9mm; width: 39mm; height: 39mm; border-radius: 50%; background: #E31B23; color: #fff; display: grid; place-items: center; text-align: center; transform: rotate(-11deg); box-shadow: 0 1.4mm 0 #A80E17; }
.poster .sticker::before { content: ""; position: absolute; inset: 1.6mm; border-radius: 50%; border: .45mm dashed rgb(255 255 255 / .6); }
.poster .sticker svg { width: 8mm; height: 8mm; color: #FFD23F; }
.poster .sticker b { display: block; font-size: 7.4mm; font-weight: 800; line-height: .95; letter-spacing: -.01em; }
.poster .sticker span { display: block; font-size: 3.1mm; font-weight: 700; line-height: 1.1; }
.poster .sticker small { display: block; margin-top: .9mm; font-size: 2.9mm; font-weight: 500; opacity: .85; }
.poster .mascot { position: absolute; top: 150mm; right: 7mm; width: 40mm; transform: rotate(9deg); }
.poster .links { position: absolute; top: 214mm; left: 16mm; right: 16mm; display: grid; grid-template-columns: 2fr 3fr; gap: 6mm; }
.poster .panel { padding: 3.6mm 4mm 3.2mm; border-radius: 5mm; background: var(--chip); border: .5mm solid var(--line); }
.poster .panel h2 { height: 4.8mm; font-size: 4mm; }
.poster .panel .stars { margin-left: auto; }
.poster .band { height: calc(24mm + var(--b)); padding: 0 calc(16mm + var(--b)) var(--b); grid-template-columns: auto 1fr; gap: 8mm; }
.poster .band .ph { font-size: 6.6mm; }
.poster .band .ad { padding-left: 8mm; border-left: .4mm solid rgb(255 255 255 / .35); font-size: 4mm; }

/* карточка A6: лицо */
.front .top { top: 7mm; left: 7mm; right: 7mm; }
.front .brand { zoom: .58; }
.front .open { zoom: .62; }
.front .head { top: 25mm; left: 5mm; right: 5mm; }
.front h1 { font-size: 7.3mm; }
.front .head p { margin-top: 1.8mm; font-size: 3.2mm; }
.front .stage { top: 55mm; width: 67mm; }
.front .stage::before { inset: -3mm -4mm; border-radius: 7mm; }
.front .qcard { padding: 10.5mm 7.5mm 3mm; border-radius: 5mm; box-shadow: 0 1.1mm 0 rgb(0 0 0 / .14); }
.front .cta { zoom: .64; }
.front .url { margin-top: 2.2mm; font-size: 4mm; }
.front .foot { position: absolute; left: 7mm; right: 5mm; bottom: 6mm; display: flex; align-items: flex-end; justify-content: space-between; }
.deal { display: flex; align-items: center; gap: 2mm; padding: 2mm 4mm 2mm 2.8mm; border-radius: 99mm; background: #E31B23; color: #fff; box-shadow: 0 .8mm 0 #A80E17; }
.deal svg { width: 5.6mm; height: 5.6mm; color: #FFD23F; }
.deal b { display: block; font-size: 3.6mm; font-weight: 800; line-height: 1.05; }
.deal span { display: block; font-size: 2.9mm; font-weight: 500; opacity: .9; }
.front .mascot { width: 16mm; transform: rotate(9deg); }

/* карточка A6: оборот */
.back .sec { position: absolute; left: 7mm; right: 7mm; }
.back .s1 { top: 9mm; }
.back .s2 { top: 66mm; }
.back h2 { font-size: 5.2mm; }
.back h2 .stars svg { width: 4mm; height: 4mm; }
.back p { margin-top: 1mm; font-size: 3mm; font-weight: 500; color: var(--muted); }
.back .row { gap: 3.5mm; }
.back .tile .q { padding: 2.8mm; border-radius: 2.6mm; }
.back .tile b { margin-top: 1.4mm; font-size: 3mm; }
.thanks { display: grid; justify-items: center; align-content: start; }
.bubble { position: relative; padding: 1.4mm 2.8mm; border-radius: 2.6mm; background: #FFD23F; color: #1B1612; text-align: center; font-size: 3.6mm; font-weight: 800; line-height: 1.1; box-shadow: 0 .8mm 0 rgb(0 0 0 / .12); }
.bubble span { display: block; font-size: 2.9mm; font-weight: 600; }
.bubble::after { content: ""; position: absolute; left: 38%; bottom: -1.7mm; border: 1.8mm solid transparent; border-top-color: #FFD23F; border-bottom: 0; }
.thanks .mascot { width: 17mm; margin-top: 3.4mm; transform: rotate(-6deg); }
.back .band { height: calc(25mm + var(--b)); padding: 0 calc(7mm + var(--b)) var(--b); grid-template-columns: 1fr; gap: 1.8mm; align-content: center; }
.back .band .ph { font-size: 5.6mm; }
.back .band .ad { font-size: 3.4mm; }

/* наклейка 100 × 100 */
.sticker-pg .stage { top: 15mm; width: 66mm; }
.sticker-pg .stage::before { inset: -3mm -4mm; border-radius: 7mm; }
.sticker-pg .qcard { padding: 10.5mm 7.5mm 3mm; border-radius: 5mm; box-shadow: 0 1.1mm 0 rgb(0 0 0 / .14); }
.sticker-pg .cta { zoom: .64; }
.sticker-pg .url { margin-top: 2.2mm; font-size: 4mm; }

/* домик A4: четыре грани A6, верхние перевёрнуты */
.tent { position: relative; width: 210mm; height: 297mm; overflow: hidden; }
.tent .tf { position: absolute; width: 105mm; height: 148.5mm; overflow: hidden; }
.tent .flip { transform: rotate(180deg); }
.tent .cut { position: absolute; left: 105mm; top: 0; bottom: 0; border-left: .2mm dashed rgb(128 128 128 / .7); }
.tent .fold { position: absolute; top: 148.5mm; left: 0; right: 0; border-top: .2mm dashed rgb(128 128 128 / .7); }
'''

BASE = {'poster': (210, 297), 'front': (105, 148), 'back': (105, 148), 'sticker': (100, 100)}
PAGE_CLASS = {'poster': 'poster', 'front': 'front', 'back': 'back', 'sticker': 'sticker-pg'}
# файл, страницы, обрезной формат в мм
PRODUCTS = [
    ('A4-poster', ['poster'], (210, 297)),
    ('A3-poster-dver', ['poster'], (297, 420)),
    ('A2-poster-vitrina', ['poster'], (420, 594)),
    ('A6-kartochka-stol', ['front', 'back'], (105, 148)),
    ('A5-flaer', ['front', 'back'], (148, 210)),
    ('nakleyka-100mm', ['sticker'], (100, 100)),
]


def sheet(page, trim, b):
    """Макет, увеличенный до обрезного формата. Стороны A-форматов округлены в стандарте, поэтому
    масштаб берём по большей стороне, а лишние доли миллиметра уходят в вылеты поровну с обеих сторон."""
    w, h = BASE[page]
    z = max(trim[0] / w, trim[1] / h)
    dx, dy = (trim[0] / z - w) / 2, (trim[1] / z - h) / 2  # ≤ 0, в мм макета
    bz = b / z
    return (f'<div class="sheet bg" style="zoom:{z:.5f};--b:{bz:.4f}mm;width:{w + 2 * bz:.4f}mm;height:{h + 2 * bz:.4f}mm;'
            f'margin:{dy:.4f}mm 0 0 {dx:.4f}mm"><div class="page {PAGE_CLASS[page]}">{BODIES[page]}</div></div>')


def tent():
    faces = ''.join(f'<div class="tf bg flip" style="left:{x}mm;top:0;--b:0mm"><div class="page back">{BODIES["back"]}</div></div>'
                    f'<div class="tf bg" style="left:{x}mm;top:148.5mm;--b:0mm"><div class="page front">{BODIES["front"]}</div></div>'
                    for x in (0, 105))
    return f'<div class="tent">{faces}<i class="cut"></i><i class="fold"></i></div>'


def doc(theme, size, body, extra=''):
    return (f'<!doctype html><html lang="uz" class="{theme}"><head><meta charset="utf-8"><title>Buddy Coffee</title>'
            f'<style>@page {{ size: {size[0]:.3f}mm {size[1]:.3f}mm; margin: 0; }}{CSS}{extra}</style></head>'
            f'<body>{SPRITE}{body}</body></html>')


def chrome(*args):
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                    '--no-pdf-header-footer', '--virtual-time-budget=4000',
                    f'--user-data-dir={os.path.join(SRC, ".chrome")}', *args],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def render(name, html_pdf, html_png, size_mm, pages):
    """PDF с вылетами + PNG 300 dpi каждой страницы в обрезном формате."""
    pdf_src = os.path.join(SRC, f'{name}.html')
    open(pdf_src, 'w', encoding='utf-8').write(html_pdf)
    chrome(f'--print-to-pdf={os.path.join(OUT, name + ".pdf")}', 'file://' + pdf_src)
    for i, html in enumerate(html_png):
        suffix = f'-{pages[i]}' if len(html_png) > 1 else ''
        src = os.path.join(SRC, f'{name}{suffix}-png.html')
        open(src, 'w', encoding='utf-8').write(html)
        w, h = (round(v * PX) for v in size_mm)
        dpi = DPI if max(size_mm) < 450 else 150  # A2 смотрят издалека: 150 dpi хватает, файл в 4 раза легче
        chrome(f'--force-device-scale-factor={dpi / 96}', f'--window-size={w},{h}',
               f'--screenshot={os.path.join(OUT, name + suffix + ".png")}', 'file://' + src)
    print(name)


def main():
    os.makedirs(SRC, exist_ok=True)
    for theme in ('light', 'dark'):
        for name, pages, trim in PRODUCTS:
            pdf = doc(theme, (trim[0] + 2 * BLEED, trim[1] + 2 * BLEED), ''.join(sheet(p, trim, BLEED) for p in pages))
            pngs = [doc(theme, trim, sheet(p, trim, 0)) for p in pages]
            render(f'{name}-{theme}', pdf, pngs, trim, pages)
        # домик печатается на обычном принтере — без вылетов
        t = doc(theme, (210, 297), tent())
        render(f'A4-domik-stol-{theme}', t, [t], (210, 297), ['tent'])


if __name__ == '__main__':
    main()
