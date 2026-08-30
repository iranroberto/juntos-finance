const CACHE = "juntos-finance-v12";
const APP_ICON_PATH = "/icons/juntos-app-icon-192-v2.png?v=12";
const APP_ICON = new URL(APP_ICON_PATH, self.location.origin).href;

const APP_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
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
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match("/"))));
});

const normalizePayload = raw => ({
  title: raw?.title || "Juntos Finance",
  body: raw?.body || "Você tem um novo alerta financeiro.",
  type: raw?.type || "financial_alert",
  url: raw?.url || "/",
  icon: raw?.icon ? new URL(raw.icon, self.location.origin).href : APP_ICON,
  entityId: raw?.entityId,
  tag: raw?.tag,
});

const displayNotification = raw => {
  const payload = normalizePayload(raw);
  return self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag || "juntos-" + payload.type + "-" + (payload.entityId || "general"),
    icon: payload.icon,
    badge: APP_ICON,
    data: { url: payload.url, type: payload.type, entityId: payload.entityId },
    renotify: false,
    vibrate: [180, 80, 180],
  });
};

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || "" }; }
  event.waitUntil(displayNotification(payload));
});

self.addEventListener("message", event => {
  if (event.data?.type !== "SHOW_NOTIFICATION") return;
  event.waitUntil(displayNotification(event.data));
});

self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    windows.forEach(client => client.postMessage({ type: "PUSH_SUBSCRIPTION_EXPIRED" }));
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});