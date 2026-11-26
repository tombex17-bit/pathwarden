const CACHE = "tdi-53259d2f3190";
const FILES = ["./","assets/index-BK_eH40c.css","assets/index-CNtE4U8z.js","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest"];
// Hosts may vary responses by headers such as Origin, which module scripts send and precaching does not.
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tdi-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(request, MATCH) ?? (request.mode === 'navigate' ? await c.match('./', MATCH) : undefined);
    return hit ?? fetch(request);
  }));
});
