const CACHE = "juntos-finance-v2";
const APP_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-32.png",
  "/icons/icon-180.png",
  "/icons/juntos-app-icon-192-v2.png",
  "/icons/juntos-app-icon-512-v2.png",
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match("/"))));
});
