self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  event.waitUntil(
    self.registration.showNotification(data.title || "BennyFix Hub", {
      body: data.body || "You have a new update",
      icon: "bennyfix logo.png",
      badge: "bennyfix logo.png",
      data: {
        url: data.url || "/admin.html",
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/admin.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }

      return clients.openWindow(url);
    })
  );
});