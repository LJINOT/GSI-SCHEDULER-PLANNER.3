/* GSI Schedule Planner Web Push Service Worker */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Failed to parse push payload:", error);
  }

  const title =
    data.title || "GSI Schedule Planner";

  const options = {
    body:
      data.body ||
      "You have a new GSI notification.",

    icon:
      data.icon ||
      "/favicon.ico",

    badge:
      data.badge ||
      "/favicon.ico",

    tag:
      data.tag ||
      "gsi-notification",

    requireInteraction:
      Boolean(data.requireInteraction),

    data: {
      url:
        data.url ||
        "/",
      taskId:
        data.taskId || null,
    },
  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options,
    ),
  );
});


self.addEventListener(
  "notificationclick",
  (event) => {
    event.notification.close();

    const url =
      event.notification?.data?.url ||
      "/";

    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      }).then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();

            if ("navigate" in client) {
              client.navigate(url);
            }

            return;
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      }),
    );
  },
);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
