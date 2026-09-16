const CACHE_NAME = 'stitchcraft-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/main.js',
  './js/router.js',
  './js/toast.js',
  './js/db.js',
  './js/patternIO.js',
  './js/exportUtils.js',
  './js/designer.js',
  './js/colorMath.js',
  './js/threadData.js',
  './js/crosswalk.js',
  './js/quantize.js',
  './js/imageProcessing.js',
  './js/sizing.js',
  './js/pattern.js',
  './js/render.js',
  './js/pdfExport.js',
  './js/state.js',
  './js/views/library.js',
  './js/views/projects.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
