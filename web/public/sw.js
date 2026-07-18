// Lumixo — installability + safe network-first for navigations.
// Does NOT precache hashed Vite assets (avoids stale-chunk white screens after deploy).
// Optional: runtime cache for static icons only.

const ICON_CACHE = 'lumixo-icons-v3';
const ICON_PATHS = ['/lumixo.svg', '/lumi.svg', '/favicon.png', '/lumixo-192.png', '/lumixo-512.png', '/manifest.webmanifest', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(ICON_CACHE).then((c) => c.addAll(ICON_PATHS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== ICON_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin icons: cache-first (tiny, immutable branding).
  if (url.origin === self.location.origin && ICON_PATHS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(ICON_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })),
    );
    return;
  }

  // Document navigations: network-first, fall back to branded offline page.
  // Never serve a stale index.html (hashed Vite chunks would break).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html').then((hit) => hit || Response.error())),
    );
  }
});
