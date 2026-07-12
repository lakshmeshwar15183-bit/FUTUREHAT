// Lumixo — installability + safe network-first for navigations.
// Does NOT precache hashed Vite assets (avoids stale-chunk white screens after deploy).
// Optional: runtime cache for static icons only.

const ICON_CACHE = 'lumixo-icons-v1';
const ICON_PATHS = ['/lumixo.svg', '/favicon.png', '/lumixo-192.png', '/lumixo-512.png', '/manifest.webmanifest'];

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

  // Navigations & JS/CSS chunks: network-first. Never serve stale index.html.
  // Default browser fetch for everything else.
});
