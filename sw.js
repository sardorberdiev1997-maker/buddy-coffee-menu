// Офлайн-кэш меню. VERSION и ?v= проставляет сборка (tools/build.mjs) по хешам файлов.
const VERSION = 'bm-v3';
const CORE = [
  './',
  'order',
  'offline.html',
  'assets/style.css?v=3',
  'assets/boot.js?v=3',
  'assets/config.js?v=3',
  'assets/order.js?v=3',
  'assets/render.js?v=3',
  'assets/app.js?v=3',
  'assets/cart.js?v=3',
  'assets/track.js?v=3',
  'assets/vt.css?v=3',
  'data/menu.json',
  'favicon.svg',
  'assets/fonts/rubik-latin.woff2',
  'assets/fonts/rubik-latin-ext.woff2',
  'assets/fonts/rubik-cyrillic.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bm-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Таблица и прочие внешние запросы — напрямую, их кэширует app.js
  if (url.origin !== self.location.origin) return;
  // Заказы и статусы — всегда из сети, никогда из кэша
  if (url.pathname.startsWith('/api/')) return;

  // Фото и шрифты: сразу из кэша, в фоне обновляем
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/assets/fonts/')) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Страница, стили, скрипты, menu.json: сначала сеть, без сети — кэш, для страниц — «нет сети»
  e.respondWith(
    fetch(req)
      .then((res) => put(req, res))
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
        .then((hit) => hit || (req.mode === 'navigate'
          ? caches.match(url.pathname === '/' ? './' : 'offline.html').then((page) => page || caches.match('offline.html'))
          : undefined)))
  );
});
