/* Black History Live Reveal — offline shell for wall-display PWA installs. */
const CACHE = 'bhp-screensaver-v5';
const SHELL = [
  '/',
  '/index.html',
  '/screensaver.css',
  '/screensaver.js?v=20261103a',
  '/screensaver.js',
  '/manifest.webmanifest',
  '/overlay/overlay.css',
  '/shared/theme.css',
  '/background/reveal-tiers.js',
  '/background/history-api-client.js',
  '/background/mark-generator.js',
  '/overlay/paint-sketch.js',
  '/shared/config.js',
  '/lib/p5.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-128.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Always network for API + media so discoveries stay fresh.
  if (url.pathname.startsWith('/v1/') || url.pathname === '/healthz') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && (url.pathname.endsWith('.js')
            || url.pathname.endsWith('.css')
            || url.pathname.endsWith('.html')
            || url.pathname.endsWith('.webmanifest')
            || url.pathname.startsWith('/icons/')
            || url.pathname.startsWith('/overlay/')
            || url.pathname.startsWith('/background/')
            || url.pathname.startsWith('/shared/')
            || url.pathname.startsWith('/lib/'))) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
