// Lumixo — minimal service worker. Its only job is to make the app
// installable ("Add to Home Screen"). It deliberately does NOT cache hashed
// build assets (that risks serving stale chunks after a deploy); every request
// falls through to the network. A future iteration can add a precache with a
// proper Workbox/manifest-aware strategy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // no-op: default network handling. Presence of a fetch handler satisfies the
  // installability criterion in Chromium-based browsers.
});
