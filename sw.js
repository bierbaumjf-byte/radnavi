/* ------------------------------------------------------------------ *
 *  sw.js – Service Worker.
 *
 *  Drei Fälle:
 *  1. Die App selbst  – aus dem Speicher, im Hintergrund erneuern.
 *  2. Kartenkacheln   – aus dem Speicher, sonst Netz und merken.
 *  3. Routing / Suche – nur Netz. Eine alte Route wäre falsch.
 * ------------------------------------------------------------------ */

const VERSION    = 'v6';
const SHELL      = 'radnavi-shell-' + VERSION;
const TILES      = 'radnavi-tiles';
const TILE_LIMIT = 9000;

const SHELL_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/map.js',
  'js/router.js',
  'js/geocode.js',
  'js/store.js',
  'js/gpx.js',
  'js/geo.js',
  'js/nav.js',
  'js/elev.js',
  'profiles/naturroute.brf',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/comic-radfahrer.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

const TILE_HOSTS = [
  'tile-cyclosm.openstreetmap.fr',
  'tile.openstreetmap.org',
  'tile.openstreetmap.fr',
  'tile.opentopomap.org',
  'tile.waymarkedtrails.org',
  'server.arcgisonline.com',     // Luftbild Esri und seine Beschriftung
  // Googles Kachelserver, einzeln aufgezählt. Nicht "google.com" als
  // Endung: damit liefe jede beliebige Google-Anfrage über diesen Zweig.
  'mt0.google.com', 'mt1.google.com', 'mt2.google.com', 'mt3.google.com'
];

const LIVE_HOSTS = ['brouter.de', 'bikerouter.de', 'nominatim.openstreetmap.org'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // Einzeln, damit ein fehlendes Teil nicht die Installation kippt.
    await Promise.all(SHELL_FILES.map(async f => {
      try { await c.add(new Request(f, { cache: 'reload' })); } catch { /* später */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('radnavi-shell-') && n !== SHELL)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Routing und Suche: niemals aus dem Speicher.
  if (LIVE_HOSTS.some(h => url.hostname.endsWith(h))) return;

  // Kartenkacheln
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(tileFirst(req));
    return;
  }

  // Leaflet liegt auf einer festen Version – aus dem Speicher.
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(req));
    return;
  }

  // Die App selbst: zuerst das Netz, damit Änderungen sofort
  // ankommen; ohne Netz der Speicher. Eine App, die ihre eigene
  // alte Fassung ausliefert, ist schwerer zu erklären als eine,
  // die eine Zehntelsekunde später startet.
  if (url.origin === self.location.origin) {
    // Der Naviki-Export ist eine einmalige Übernahme von vielen
    // Dutzend Megabyte. Der gehört nicht in den App-Speicher –
    // die Wege landen ohnehin in der Datenbank.
    if (url.pathname.includes('/naviki-export/')) return;
    e.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Nicht verfügbar – und nicht offline vorgehalten.',
      { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function tileFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).then(() => trimTiles(cache));
    }
    return res;
  } catch {
    // Offline und nicht vorgehalten: eine leere, graue Kachel.
    return new Response(EMPTY_TILE, { headers: { 'Content-Type': 'image/svg+xml' } });
  }
}

/** Den Kachelspeicher nicht unbegrenzt wachsen lassen. */
let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > TILE_LIMIT) {
      const drop = keys.slice(0, keys.length - TILE_LIMIT);
      await Promise.all(drop.map(k => cache.delete(k)));
    }
  } catch { /* ignorieren */ } finally { trimming = false; }
}

const EMPTY_TILE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
  '<rect width="256" height="256" fill="#e4e2da"/>' +
  '<text x="128" y="130" text-anchor="middle" font-family="sans-serif" ' +
  'font-size="11" fill="#9a978c">offline</text></svg>';
