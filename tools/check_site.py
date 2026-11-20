"""Внешняя проверка сайта и бота (GitHub Action site-check.yml, раз в полчаса).

Если что-то не так — шаг падает, и GitHub присылает письмо автору репозитория.
Перед ошибкой — повторная проверка через минуту, чтобы не будить из-за секундного сбоя сети.
Вручную: python3 tools/check_site.py
"""
import json
import sys
import time
import urllib.error
import urllib.request

SITE = 'https://buddycoffee.uz/'
OLD = 'https://buddy.cheking.uz/'
TICK_LATE = 15 * 60  # cron-воркер зовёт /api/tick каждую минуту
PENDING_MAX = 20  # столько сообщений боту ждут в очереди Telegram — вебхук не принимает


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def get(url, follow=True):
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, headers={'User-Agent': 'buddy-menu site-check'})
    try:
        with opener.open(req, timeout=20) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def problems():
    found = []

    def check(name, fn):
        try:
            msg = fn()
        except Exception as e:  # сеть, таймаут, неверный JSON
            msg = f'{type(e).__name__}: {e}'
        if msg:
            found.append(f'{name}: {msg}')

    def home():
        code, _, body = get(SITE)
        if code != 200 or b'Buddy Coffee' not in body:
            return f'HTTP {code}'

    def state():
        code, _, body = get(SITE + 'api/state')
        if code != 200 or 'accepting' not in json.loads(body):
            return f'HTTP {code}'

    def bot():
        code, _, body = get(SITE + 'api/tg/info')
        if code != 200:
            return f'HTTP {code}'
        info = json.loads(body)
        out = []
        if not info.get('ok'):
            out.append('Telegram не отвечает')
        if (info.get('pending') or 0) > PENDING_MAX:
            out.append(f"очередь сообщений боту: {info['pending']}")
        if info.get('has_bot_problem'):
            out.append('сторож бота нашёл проблему (подробности: /api/tg/info?key=…)')
        tick = info.get('last_tick') or ''
        age = time.time() - time.mktime(time.strptime(tick[:19], '%Y-%m-%dT%H:%M:%S')) + time.timezone if tick else 1e9
        if age > TICK_LATE:
            out.append(f'фоновые задачи (воркер buddy-cron) не запускались {int(age // 60)} мин')
        return '; '.join(out)

    def admin():
        code, _, _ = get(SITE + 'admin')
        if code != 200:
            return f'HTTP {code}'

    def old_domain():
        # С 20.11.2026 старый адрес отдаёт GitHub Pages (репозиторий buddy-cheking-redirect, там нет ECH):
        # любая страница сразу переводит на buddycoffee.uz с тем же путём. HTTPS должен быть с настоящим сертификатом
        # Прежний путь (Cloudflare Pages, 301) тоже рабочий: так отвечают кэши DNS первые часы и после отката
        code, headers, body = get(OLD + 'r/google', follow=False)
        github = code in (200, 404) and b"location.replace('https://buddycoffee.uz'" in body
        pages = code in (301, 308) and (headers.get('location') or '').startswith(SITE)
        if not (github or pages):
            return f'HTTP {code}, нет перевода на buddycoffee.uz'

    check('Сайт', home)
    check('Приём заказов /api/state', state)
    check('Бот /api/tg/info', bot)
    check('Панель /admin', admin)
    check('Старый адрес buddy.cheking.uz', old_domain)
    return found


def main():
    found = problems()
    if found:
        time.sleep(60)
        found = problems()
    if found:
        for p in found:
            print(f'::error::{p}')
        sys.exit(1)
    print('Всё в порядке')


if __name__ == '__main__':
    main()
