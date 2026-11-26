import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

/** The service worker. Everything is served from the cache first; old caches are removed. */
export function serviceWorker(cache: string, files: readonly string[]): string {
  return `const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(['./', ...files])};
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
`;
}

/**
 * Writes sw.js into the build with every built and public file in its list, so the game
 * loads with no network after the first visit. The cache name changes whenever any file does.
 */
export function offline(): Plugin {
  let publicDir = '';
  return {
    name: 'tdi-offline',
    apply: 'build',
    // After Vite writes index.html, so the page itself is listed and hashed.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      const built = Object.values(bundle).map((file) => {
        hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source);
        return file.fileName;
      });
      const pub = publicDir ? filesIn(publicDir).map((path) => {
        const name = relative(publicDir, path).split(sep).join('/');
        hash.update(name).update(readFileSync(path));
        return name;
      }) : [];
      const files = [...built, ...pub].filter((f) => f !== 'sw.js').sort();
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorker(`tdi-${hash.digest('hex').slice(0, 12)}`, files),
      });
    },
  };
}
