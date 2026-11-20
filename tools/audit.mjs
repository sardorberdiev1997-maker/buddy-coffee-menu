// Аудит доступности одной командой: npm run audit [адрес сайта]
// Без адреса поднимает tools/dev-server.mjs с пустой базой (как сквозные тесты), с адресом — проверяет его (например, живой сайт).
// Каждая страница: uz и ru × светлая и тёмная тема × 320 px (телефон), 640 px (компьютер при масштабе 200 %) и 1280 px.
//   • axe-core, правила WCAG 2.2 A/AA — нарушения serious и critical роняют проверку;
//   • нет горизонтальной прокрутки;
//   • обход клавиатурой: Tab доходит до кнопок, фокус виден (обводка или тень) и не теряется на <body>.
// Браузер — уже установленный Google Chrome (puppeteer-core ничего не скачивает); путь можно задать в CHROME_PATH.
// Идея — из аудита сессии SORT (обмен находками 20.11.2026).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => p && existsSync(p));
const VIEWPORTS = [
  { name: '320', width: 320, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '640 (200 %)', width: 640, height: 400 },
  { name: '1280', width: 1280, height: 800 }
];
const PAGES = [
  { path: '/', name: 'меню' },
  { path: '/', name: 'карточка блюда', open: async (page) => { await tap(page, '.item__btn'); await page.waitForSelector('#sheet[open]'); } },
  { path: '/', name: 'корзина', open: async (page) => {
    // «+» у блюда с размерами открывает выбор — берём первое блюдо, которое кладётся в корзину сразу
    const added = await page.evaluate(() => {
      for (const b of document.querySelectorAll('.item:not(.is-out) [data-add]')) {
        b.click();
        const sheet = document.getElementById('sheet');
        if (sheet.open) { sheet.close(); continue; }
        if (!document.getElementById('cartbar').hidden) return true;
      }
      return false;
    });
    if (!added) throw new Error('не удалось положить блюдо в корзину');
    await tap(page, '#cartbar button, #cartbar');
    await page.waitForSelector('#cart[open]');
  } },
  { path: '/order.html?t=nonexistent', name: 'заказ: не найден' },
  { path: '/privacy.html', name: 'конфиденциальность' },
  { path: '/404.html', name: '404' }
];

// Нажать первый видимый элемент (часть карточек может быть свёрнута или за краем экрана)
async function tap(page, sel) {
  const ok = await page.evaluate((q) => {
    const el = [...document.querySelectorAll(q)].find((e) => e.getClientRects().length && !e.disabled);
    if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
    return el ? '' : `${document.querySelectorAll(q).length} всего, ${location.pathname}${location.search}`;
  }, sel);
  if (ok) throw new Error(`нет видимого элемента ${sel} (${ok})`);
}

let server = null;
let tmp = null;
async function startServer() {
  tmp = mkdtempSync(path.join(tmpdir(), 'buddy-audit-'));
  const port = 8923 + (process.pid % 50);
  server = spawn(process.execPath, ['--no-warnings', 'tools/dev-server.mjs', String(port)], {
    cwd: ROOT, env: { ...process.env, DEV_DB: path.join(tmp, 'db.sqlite'), BOT_TOKEN: '' }, stdio: ['ignore', 'ignore', 'inherit']
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/')).ok) break; } catch (e) { /* ещё поднимается */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  // Без подключённой группы сайт не принимает заказы и кнопок «+» нет — подключаем, как сквозные тесты (заглушка Telegram)
  await fetch(base + '/api/tg/setup');
  await fetch(base + '/__tg/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    update_id: 1, message: { message_id: 1, date: 0, chat: { id: -100777, type: 'supergroup', title: 'Audit' }, from: { id: 501, first_name: 'Audit' }, text: '/bind' }
  }) });
  if (!(await (await fetch(base + '/api/state')).json()).accepting) throw new Error('dev-server не принимает заказы');
  return base;
}

async function check(browser, base, pg, lang, theme, vp) {
  const page = await browser.newPage();
  const found = [];
  try {
    await page.setBypassCSP(true); // строгий CSP сайта не пускает внедрённый axe — только в этом браузере
    await page.setViewport(vp);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    const sep = pg.path.includes('?') ? '&' : '?';
    // networkidle2: страница заказа опрашивает сервер, полной тишины в сети на ней не бывает
    await page.goto(`${base}${pg.path}${sep}lang=${lang}`, { waitUntil: 'networkidle2', timeout: 45000 });
    if (pg.open) await pg.open(page);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(() => window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations']
    }));
    for (const v of res.violations) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      found.push(`${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
    }
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 1) found.push(`горизонтальная прокрутка на ${wide} px`);
  } finally {
    await page.close();
  }
  return found;
}

// Tab по странице: фокус должен быть виден и не уходить на <body>
async function keyboard(browser, base, lang) {
  const page = await browser.newPage();
  const found = [];
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'networkidle2', timeout: 45000 });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      await new Promise((r) => setTimeout(r, 250)); // элемент может въезжать (ссылка «к меню») или прокручиваться к фокусу
      const f = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { body: true };
        // Обводку может рисовать обёртка (например, вся карточка блюда через :has(:focus-visible))
        const drawn = (x) => { const s = getComputedStyle(x); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); };
        let ring = false;
        for (let x = el, i = 0; x && i < 4 && !ring; x = x.parentElement, i++) ring = drawn(x);
        const r = el.getBoundingClientRect();
        const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
        return { ring, seen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, label };
      });
      if (f.body) { found.push(`Tab №${i + 1}: фокус ушёл на <body>`); break; }
      if (!f.ring) found.push(`Tab №${i + 1} «${f.label}»: фокус не виден`);
      if (!f.seen) found.push(`Tab №${i + 1} «${f.label}»: элемент с фокусом вне экрана`);
    }
  } finally {
    await page.close();
  }
  return found;
}

async function main() {
  if (!CHROME) {
    console.log('Аудит пропущен: не найден Google Chrome (укажите путь в CHROME_PATH)');
    return 0;
  }
  const base = (process.argv[2] || '').replace(/\/$/, '') || (await startServer());
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  let problems = 0;
  try {
    for (const pg of PAGES) {
      for (const lang of ['uz', 'ru']) {
        for (const theme of ['light', 'dark']) {
          for (const vp of VIEWPORTS) {
            const found = await check(browser, base, pg, lang, theme, vp);
            for (const f of found) console.log(`✖ ${pg.name} · ${lang} · ${theme} · ${vp.name}: ${f}`);
            problems += found.length;
          }
        }
      }
    }
    for (const lang of ['uz', 'ru']) {
      const found = await keyboard(browser, base, lang);
      for (const f of found) console.log(`✖ клавиатура · ${lang}: ${f}`);
      problems += found.length;
    }
  } finally {
    await browser.close();
  }
  console.log(problems ? `Аудит: замечаний ${problems}` : `Аудит доступности: замечаний нет (${PAGES.length} состояний × 2 языка × 2 темы × ${VIEWPORTS.length} ширины, клавиатура)`);
  return problems ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('Аудит не выполнен:', e.message);
} finally {
  if (server) server.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
