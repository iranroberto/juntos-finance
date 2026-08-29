const CACHE = "juntos-finance-v10";
const APP_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon.svg",
  "/icons/juntos-favicon-32-v3.png",
  "/icons/juntos-apple-icon-180-v3.png",
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

self.addEventListener("message", event => {
  if (event.data?.type !== "SHOW_NOTIFICATION") return;
  const { title, body, tag, url = "/" } = event.data;
  event.waitUntil(self.registration.showNotification(title || "Juntos Finance", {
    body,
    tag,
    icon: "/icons/juntos-app-icon-192-v2.png",
    badge: "/icons/juntos-favicon-32-v3.png",
    data: { url },
    renotify: false,
    vibrate: [180, 80, 180],
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return clients.openWindow(target);
  }));
});