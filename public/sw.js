/**
 * The shell, kept so a wall tablet survives the network going away.
 *
 * §16: the UI should survive a LAN blip with a cached shell and a clear stale
 * indicator. The blip that matters is not the one while somebody is watching —
 * the app is already reconnecting for that — it is the reload afterwards. A
 * panel that has been up for a month gets rebooted, or Chrome discards the tab,
 * and without this it comes back to a blank page because the machine serving it
 * is a hop away and that hop is down.
 *
 * **Hand-written, and small enough to read.** Workbox generates a better
 * service worker than this for an app with a hundred routes; this app has one
 * shell and an API, so the whole policy is two rules, and a dependency whose
 * output nobody reads is a worse trade here than sixty lines somebody can.
 */

const SHELL = 'hc-shell-v1';

/**
 * Precached at install: enough to draw *something* without the network.
 *
 * Deliberately not the whole build. Hashed assets are cached as they are used
 * — listing them here would mean regenerating this file on every build, which
 * is the thing a plugin exists to do and the reason not to hand-write one that
 * needs it.
 */
const SHELL_FILES = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // **Never the API.** Devices, dashboards, history and a household's content
  // are all things whose whole value is being current; a cached answer for any
  // of them is a lie with a timestamp. The app already knows how to say it is
  // disconnected, which is the honest version of the same situation.
  if (url.pathname.startsWith('/api/')) return;

  // The shell: cache first, because it changes only when the app is rebuilt,
  // and a tablet reloading during an outage needs it more than it needs the
  // newest one. A background refresh takes the update for next time.
  event.respondWith(
    caches.match(request).then((hit) => {
      const live = fetch(request)
        .then((res) => {
          if (res.ok) void caches.open(SHELL).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit ?? caches.match('/index.html'));
      return hit ?? live;
    }),
  );
});
