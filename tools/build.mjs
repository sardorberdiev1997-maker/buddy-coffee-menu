// Сборка сайта в dist/ (Cloudflare Pages: npm run build, папка dist).
// 1) Меню из data/menu.json вшивается в index.html — показывается сразу, без ожидания скриптов и данных.
// 2) JS/CSS минифицируются, к ссылкам добавляется хеш содержимого — можно кэшировать «навсегда».
// 3) Service worker получает тот же список файлов и версию.
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
vm.runInContext(read('assets/render.js'), sandbox);
const R = sandbox.MenuRender;
const TABS = sandbox.MENU_CONFIG.tabs;

const data = JSON.parse(read('data/menu.json'));
const tables = { menu: data[TABS.menu], categories: data[TABS.categories], settings: data[TABS.settings] };
if (!R.validTables(tables)) throw new Error('data/menu.json: неожиданная структура');
const view = R.createView(R.buildModel(tables), 'uz');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Скрипты и стили: минификация + хеш
const versions = {};
for (const file of ['assets/boot.js', 'assets/config.js', 'assets/render.js', 'assets/app.js', 'assets/style.css']) {
  const isCss = file.endsWith('.css');
  const out = await esbuild.transform(read(file), { loader: isCss ? 'css' : 'js', minify: true, target: isCss ? undefined : 'es2020', charset: 'utf8' });
  write(file, out.code);
  versions[file] = hash(out.code);
}
const withVersions = (s) => s.replace(/(assets\/(?:boot|config|render|app)\.js|assets\/style\.css)\?v=[\w-]+/g, (m, file) => `${file}?v=${versions[file]}`);

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
write('index.html', html);

// Service worker: тот же список файлов и версия по их хешам
const sw = withVersions(read('sw.js')).replace(/const VERSION = '[^']*'/, `const VERSION = 'bm-${hash(JSON.stringify(versions) + html)}'`);
write('sw.js', (await esbuild.transform(sw, { loader: 'js', minify: true, target: 'es2020', charset: 'utf8' })).code);

// Остальное — как есть
for (const p of ['404.html', 'favicon.svg', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'data/menu.json', 'assets/fonts', 'img']) {
  cpSync(path.join(ROOT, p), path.join(DIST, p), { recursive: true });
}
write('_headers', read('tools/_headers'));

const kb = (p) => (readFileSync(path.join(DIST, p)).length / 1024).toFixed(1) + ' KB';
console.log(`dist готов: index.html ${kb('index.html')}, app.js ${kb('assets/app.js')}, render.js ${kb('assets/render.js')}, style.css ${kb('assets/style.css')}`);
if (!existsSync(path.join(DIST, 'img/og.jpg'))) throw new Error('нет img/og.jpg');
