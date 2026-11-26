const CACHE_NAME = 'stratos-xband-offline-v1';
const CORE_PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './terrain/real_ladakh_dem.bin',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          CORE_PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('stratos-xband-offline-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Strictly ignore any cross-origin / external requests (air-gap invariant)
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok &&
          networkResponse.type === 'basic'
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return networkResponse;
      });
    })
  );
});
