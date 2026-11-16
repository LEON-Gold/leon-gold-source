// «روتین من»: shows the reminders the server sends (Web Push). It caches nothing; the page works as before.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (x) { m = {body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(m.title || "روتین من", {
    body: m.body || "", tag: m.tag || undefined, lang: "fa", dir: "rtl",
    icon: "icon-192.png", badge: "icon-192.png", data: {url: m.url || "./"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
