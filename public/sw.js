const CACHE_NAME = 'xband-twin-offline-v3';
const CACHE_PREFIXES = ['xband-twin-offline-', 'stratos-xband-offline-'];
const CORE_PRECACHE_URLS = [
  './',
  './index.html',
  './docs.html',
  './manifest.webmanifest',
  './terrain/real_ladakh_dem.bin',
];

function isCacheableOkResponse(response) {
  return Boolean(
    response &&
      response.ok &&
      response.status === 200 &&
      response.type === 'basic'
  );
}

function cacheResponse(request, response) {
  if (!isCacheableOkResponse(response)) return;
  const clone = response.clone();
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, clone))
    .catch(() => {});
}

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
            .filter(
              (k) =>
                CACHE_PREFIXES.some((prefix) => k.startsWith(prefix)) &&
                k !== CACHE_NAME
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Strictly ignore any cross-origin / external requests (air-gap invariant)
  if (url.origin !== self.location.origin) {
    return;
  }

  const isNavigationOrHtml =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('manifest.webmanifest');

  // Network-First for HTML navigation & manifest so new deployments are never stuck behind stale cache
  if (isNavigationOrHtml) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' }))
        .then((networkResponse) => {
          cacheResponse(request, networkResponse);
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        })
    );
    return;
  }

  // Cache-First with 200-OK network backfill for hashed /assets/*, /terrain/*, and static files
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((networkResponse) => {
        cacheResponse(request, networkResponse);
        return networkResponse;
      });
    })
  );
});
