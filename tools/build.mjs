// Сборка сайта в dist/ (Cloudflare Pages: npm run build, папка dist).
// 1) Меню из data/menu.json вшивается в index.html — показывается сразу, без ожидания скриптов и данных.
// 2) JS/CSS минифицируются, к ссылкам добавляется хеш содержимого — можно кэшировать «навсегда».
// 3) Service worker получает тот же список файлов и версию.
// 4) Сервер заказов (server/) собирается в dist/_worker.js и обслуживает только /api/* (dist/_routes.json).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, data) => {
  mkdirSync(path.dirname(path.join(DIST, p)), { recursive: true });
  writeFileSync(path.join(DIST, p), data);
};
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const jsonInHtml = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// Общий рендер (assets/render.js) и конфиг выполняем в песочнице — тот же код, что в браузере
const sandbox = { URL, URLSearchParams, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('assets/config.js'), sandbox);
vm.runInContext(read('assets/order.js'), sandbox);
vm.runInContext(read('assets/render.js'), sandbox);
const R = sandbox.MenuRender;
const TABS = sandbox.MENU_CONFIG.tabs;

// Данные: сначала свежие из Google Таблицы, при сбое — запасная копия data/menu.json
async function fromSheet() {
  const { sheetId, gids } = sandbox.MENU_CONFIG;
  if (!sheetId || !gids) throw new Error('нет sheetId/gids');
  const get = async (key) => {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gids[key]}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return R.parseCSV(await res.text());
  };
  const t = { menu: await get('menu'), categories: await get('categories'), settings: await get('settings') };
  if (!R.validTables(t)) throw new Error('неожиданная структура таблицы');
  return t;
}
let tables;
try {
  tables = await fromSheet();
  console.log('Данные: Google Таблица');
} catch (e) {
  const data = JSON.parse(read('data/menu.json'));
  tables = { menu: data[TABS.menu], categories: data[TABS.categories], settings: data[TABS.settings] };
  if (!R.validTables(tables)) throw new Error('data/menu.json: неожиданная структура');
  console.log(`Данные: data/menu.json (таблица недоступна: ${e.message})`);
}
const view = R.createView(R.buildModel(tables), 'uz');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Скрипты и стили: минификация + хеш
const versions = {};
const ASSETS = ['assets/boot.js', 'assets/config.js', 'assets/order.js', 'assets/render.js', 'assets/app.js', 'assets/cart.js', 'assets/track.js', 'assets/style.css', 'assets/vt.css'];
for (const file of ASSETS) {
  const isCss = file.endsWith('.css');
  const out = await esbuild.transform(read(file), { loader: isCss ? 'css' : 'js', minify: true, target: isCss ? undefined : 'es2020', charset: 'utf8' });
  write(file, out.code);
  versions[file] = hash(out.code);
}
const withVersions = (s) => s.replace(/(assets\/(?:boot|config|order|render|app|cart|track)\.js|assets\/(?:style|vt)\.css)\?v=[\w-]+/g, (m, file) => `${file}?v=${versions[file]}`);

// index.html: вставляем готовую разметку по меткам <!--name-->…<!--/name-->
let html = withVersions(read('index.html'));
const put = (name, content) => {
  const re = new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`);
  if (!re.test(html)) throw new Error(`index.html: нет метки ${name}`);
  html = html.replace(re, () => content);
};
put('ld', `<script type="application/ld+json" id="ld-json">${jsonInHtml(view.jsonLD())}</script>`);
put('hero', view.heroBodyHTML());
put('notice', view.noticeHTML());
put('chips', view.chipsHTML());
put('menu', view.menuHTML());
put('info', view.infoHTML());
put('data', `<script type="application/json" id="menu-data">${jsonInHtml({ generated: Date.now(), tables })}</script>`);
// boot.js и стили вшиваем в HTML (минус два блокирующих запроса); в CSP — их sha256
const sha = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const bootCode = readFileSync(path.join(DIST, 'assets/boot.js'), 'utf8').trim();
const cssCode = readFileSync(path.join(DIST, 'assets/style.css'), 'utf8').trim().replace(/url\((["']?)fonts\//g, 'url($1assets/fonts/');
const inline = (re, tag) => {
  if (!re.test(html)) throw new Error('index.html: не найдено ' + re);
  html = html.replace(re, () => tag);
};
inline(/<script src="assets\/boot\.js\?v=[\w-]+"><\/script>/, `<script>${bootCode}</script>`);
inline(/<link rel="stylesheet" href="assets\/style\.css\?v=[\w-]+">/, `<style>${cssCode}</style>`);
write('index.html', html);
// Страница заказа: без встроенных скриптов и стилей — CSP не нужны хеши
write('order.html', withVersions(read('order.html')));
// Встроенные стили страниц 404 и «нет сети» тоже разрешаем по хешу
const inlineStyle = (file) => (read(file).match(/<style>([\s\S]*?)<\/style>/) || [])[1];
const scriptHashes = [sha(bootCode)];
const styleHashes = [sha(cssCode)].concat(['404.html', 'offline.html'].map(inlineStyle).filter(Boolean).map(sha));

// Service worker: тот же список файлов и версия по их хешам
const sw = withVersions(read('sw.js'))
  .replace(/const VERSION = '[^']*'/, `const VERSION = 'bm-${hash(JSON.stringify(versions) + html)}'`);
write('sw.js', (await esbuild.transform(sw, { loader: 'js', minify: true, target: 'es2020', charset: 'utf8' })).code);

// Остальное — как есть
for (const p of ['404.html', 'offline.html', 'favicon.svg', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'data/menu.json', 'assets/fonts', 'img']) {
  cpSync(path.join(ROOT, p), path.join(DIST, p), { recursive: true });
}
// Сервер заказов: один файл для Cloudflare Pages (advanced mode)
await esbuild.build({
  entryPoints: [path.join(ROOT, 'server/index.js')],
  outfile: path.join(DIST, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning'
});
write('_routes.json', JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));

write('_headers', read('tools/_headers')
  .replace('{{SCRIPT_HASHES}}', scriptHashes.join(' '))
  .replace('{{STYLE_HASHES}}', styleHashes.join(' ')));

const kb = (p) => (readFileSync(path.join(DIST, p)).length / 1024).toFixed(1) + ' KB';
console.log(`dist готов: index.html ${kb('index.html')}, app.js ${kb('assets/app.js')}, cart.js ${kb('assets/cart.js')}, render.js ${kb('assets/render.js')}, style.css ${kb('assets/style.css')}, _worker.js ${kb('_worker.js')}`);
if (!existsSync(path.join(DIST, 'img/og.jpg'))) throw new Error('нет img/og.jpg');
