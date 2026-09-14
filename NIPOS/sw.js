self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = { title: "NIPOS", body: "" };
  try { if (event.data) data = event.data.json(); } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  const title = data.title || "NIPOS";
  const options = {
    body: data.body || "",
    tag: data.urgent ? "urgent-" + Date.now() : "notice",
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [300, 150, 300, 150, 300] : [200],
    icon: "icon-192.png",
    badge: "icon-192.png"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) { if ("focus" in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
