/*
 * Closyria's service worker (chantier 4 « Alertes »): it only shows her notifications and opens them. No `fetch`
 * handler on purpose: every page and data request goes to the network as before (on dev, behind the password, a
 * worker answering requests would send them without it). The worker sends `{ title, body, url }`
 * (apps/worker/src/alerts/push.ts); a tap opens `url`, an address of the app.
 */

const ICON = "/icons/icon-192.png";

/** `url` when it is an address of this site, else « Accueil » (never another site). */
function sameSiteUrl(url) {
  try {
    const target = new URL(typeof url === "string" ? url : "/", self.location.origin);
    return target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  } catch {
    return `${self.location.origin}/`;
  }
}

function readMessage(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === "string") {
      return { title: data.title, body: typeof data.body === "string" ? data.body : "", url: data.url };
    }
  } catch {
    // Not JSON: shown as plain text below.
  }
  return { title: "Closyria", body: event.data ? event.data.text() : "", url: "/" };
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const message = readMessage(event);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: ICON,
      badge: ICON,
      lang: "fr",
      data: { url: sameSiteUrl(message.url) },
    }),
  );
});

/** Opens `url`: in a Closyria window already open (brought to the front), else in a new one. */
async function open(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    try {
      const shown = "navigate" in client ? await client.navigate(url) : client;
      if (shown) {
        await shown.focus().catch(() => {});
        return;
      }
    } catch {
      // Not ours to steer (not controlled yet): a new window instead.
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(open(sameSiteUrl(event.notification.data?.url)));
});
