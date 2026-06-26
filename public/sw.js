// AUGUST service worker — deliberately MINIMAL.
//
// Two jobs only: (1) exist so the app is installable + push-capable, (2) handle
// incoming web push and notification clicks. NO offline caching — AUGUST is a
// live-data app, so there is intentionally no fetch handler and no cache; a stale
// cached shell would be worse than a normal load. Served as a static file from
// /public at /sw.js (root scope, no Service-Worker-Allowed header needed).

// Activate immediately on update so a new push handler takes over without a manual
// reload (single-user app; nothing to migrate).
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A push arrived. The server sends a JSON payload { title, body, url, tag }.
// web-push encrypts it; here event.data.json() gives it back. userVisibleOnly was
// set at subscribe time, so we MUST show a notification for every push.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "AUGUST";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192",
    badge: data.badge || "/icon-192",
    data: { url: data.url || "/" },
    tag: data.tag, // optional: collapses successive same-tag notifications
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open AUGUST window, else opens one
// at the payload's url (defaults to start_url "/").
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of wins) {
        if ("focus" in client) {
          try {
            await client.focus();
            return;
          } catch (e) {
            /* fall through to opening a new window */
          }
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
