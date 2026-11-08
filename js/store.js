/* ------------------------------------------------------------------ *
 *  store.js – alles, was die App behalten soll.
 *
 *  Wege und Aufzeichnungen liegen in IndexedDB (beliebig groß),
 *  Einstellungen in localStorage (klein, synchron lesbar).
 * ------------------------------------------------------------------ */

const DB_NAME = 'radnavi';
const DB_VERSION = 1;
const STORE_WEGE = 'wege';
const STORE_META = 'meta';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_WEGE)) {
        const s = db.createObjectStore(STORE_WEGE, { keyPath: 'id' });
        s.createIndex('created', 'created');
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ------------------------------ Wege ------------------------------ *
 *  Ein Weg:
 *  { id, name, kind: 'planned'|'imported'|'recorded',
 *    coords: [[lon,lat,ele?], …],
 *    waypoints: [{lat,lon,name}],         nur bei geplanten Routen
 *    length, ascend, descend, duration,   Kennzahlen in m / s
 *    created, source, note, profile }
 * ------------------------------------------------------------------ */

export async function putWeg(weg) {
  if (!weg.id) weg.id = newId();
  if (!weg.created) weg.created = Date.now();
  await tx(STORE_WEGE, 'readwrite', s => s.put(weg));
  return weg;
}

export async function putWege(list) {
  await tx(STORE_WEGE, 'readwrite', s => { list.forEach(w => {
    if (!w.id) w.id = newId();
    if (!w.created) w.created = Date.now();
    s.put(w);
  }); });
  return list;
}

export function getWeg(id) {
  return tx(STORE_WEGE, 'readonly', s => s.get(id));
}

export function allWege() {
  return tx(STORE_WEGE, 'readonly', s => s.getAll());
}

export function deleteWeg(id) {
  return tx(STORE_WEGE, 'readwrite', s => s.delete(id));
}

export async function renameWeg(id, name) {
  const w = await getWeg(id);
  if (!w) return null;
  w.name = name;
  return putWeg(w);
}

/* ---------------------------- Startbild --------------------------- *
 *  Das eigene Bild bleibt bewusst hier in der Datenbank des Geräts und
 *  nicht im Programmordner: der liegt öffentlich auf GitHub. So ist das
 *  Bild auf PC und Handy da, ohne dass es jemand sonst zu sehen bekommt.
 *  Dafür muss es auf jedem Gerät einmal ausgewählt werden.
 * ------------------------------------------------------------------ */

const BILD_KEY = 'startbild';

/** Höchstens so breit/hoch wird gespeichert – ein Handyfoto hat 4000 px
 *  und würde die Datenbank unnötig füllen. */
const BILD_KANTE = 900;

export async function getStartbild() {
  try {
    const e = await tx(STORE_META, 'readonly', s => s.get(BILD_KEY));
    return e && e.blob ? e : null;
  } catch { return null; }
}

export async function putStartbild(blob, name) {
  return tx(STORE_META, 'readwrite', s =>
    s.put({ key: BILD_KEY, blob, name: name || '', gespeichert: Date.now() }));
}

export async function deleteStartbild() {
  return tx(STORE_META, 'readwrite', s => s.delete(BILD_KEY));
}

/**
 * Ein ausgewähltes Foto auf vernünftige Größe bringen. Liefert einen
 * JPEG-Blob. Schlägt das Zeichnen fehl (sehr altes Gerät, HEIC ohne
 * Unterstützung), kommt die Datei unverändert zurück – lieber groß als
 * gar nicht.
 */
export async function bildVerkleinern(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, BILD_KANTE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch { return file; }
}

/* --------------------------- Einstellungen ------------------------ */

const SETTINGS_KEY = 'radnavi.settings';

export const SETTINGS_VERSION = 3;

/** Ab diesem Reglerwert meidet die Route Ortslagen tatsächlich. Darunter
 *  gewinnt der kürzere Weg durch den Ort. Nachgemessen: 1,5 ändert nichts,
 *  2,5 senkt den Ortsanteil von 20 % auf 5 %. */
export const TOWN_WIRKSAM = 2.5;

export const defaultSettings = {
  v: SETTINGS_VERSION,
  profile: 'natur',
  tune: null,                 // null = Profilwerte verwenden
  layer: 'osm',
  cycleOverlay: false,
  theme: 'auto',
  voice: true,
  reroute: true,
  wakeLock: true,
  rotate: false,
  offRouteMeters: 60,
  prewarnMeters: 150,
  server: 'https://brouter.de/brouter',
  profileOverride: null,      // vom Nutzer bearbeiteter Profiltext
  lastView: null,             // {lat, lon, zoom}
  lastWaypoints: null
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const stored = JSON.parse(raw);
    const s = { ...defaultSettings, ...stored };

    // Fassung 2: Kartenwahl auf OpenStreetMap umgestellt – dieselbe
    // Karte, die Naviki benutzt. Wer die Karte danach selbst wechselt,
    // behält seine Wahl, weil die Version dann schon gesetzt ist.
    // Geprüft wird die *gespeicherte* Version: die aus den Vorgaben
    // ist nach dem Zusammenführen immer die aktuelle.
    if (!stored.v || stored.v < 2) {
      s.layer = 'osm';
      s.tune = null;        // neue Profilwerte greifen lassen
    }

    // Fassung 3: "Stadtgebiete meiden" war ausdrücklich gewünscht, stand
    // in den gespeicherten Reglern aber auf einem Wert ohne Wirkung.
    // Angehoben wird nur dieser eine Regler – alle anderen bleiben, wie
    // der Nutzer sie eingestellt hat. Wer wieder durch die Orte fahren
    // will, zieht ihn einfach zurück; das bleibt dann erhalten.
    if ((!stored.v || stored.v < 3) && s.tune && s.tune.town < TOWN_WIRKSAM) {
      s.tune = { ...s.tune, town: TOWN_WIRKSAM };
    }

    if (!stored.v || stored.v < SETTINGS_VERSION) {
      s.v = SETTINGS_VERSION;
      saveSettings(s);
    }
    return s;
  } catch { return { ...defaultSettings }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* voller Speicher */ }
}

/* ------------------- Profil-IDs des Routing-Servers ---------------- *
 *  Hochgeladene BRouter-Profile bekommen eine ID. Wir merken uns,
 *  welcher Profiltext zu welcher ID gehört, damit derselbe Text nicht
 *  zweimal hochgeladen wird.
 * ------------------------------------------------------------------ */

const PROFILE_MAP_KEY = 'radnavi.profileids';

export function cachedProfileId(hash) {
  try {
    const m = JSON.parse(localStorage.getItem(PROFILE_MAP_KEY) || '{}');
    return m[hash] || null;
  } catch { return null; }
}

export function cacheProfileId(hash, id) {
  try {
    const m = JSON.parse(localStorage.getItem(PROFILE_MAP_KEY) || '{}');
    m[hash] = id;
    // Mehr als 40 gemerkte Profile braucht niemand.
    const keys = Object.keys(m);
    if (keys.length > 40) delete m[keys[0]];
    localStorage.setItem(PROFILE_MAP_KEY, JSON.stringify(m));
  } catch { /* ignorieren */ }
}

export function forgetProfileId(hash) {
  try {
    const m = JSON.parse(localStorage.getItem(PROFILE_MAP_KEY) || '{}');
    delete m[hash];
    localStorage.setItem(PROFILE_MAP_KEY, JSON.stringify(m));
  } catch { /* ignorieren */ }
}

/* ---------------------------- Kartenkacheln ----------------------- */

export async function tileCacheSize() {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open('radnavi-tiles');
    const keys = await c.keys();
    return keys.length;
  } catch { return null; }
}

export async function clearTileCache() {
  if (!('caches' in window)) return;
  try { await caches.delete('radnavi-tiles'); } catch { /* ignorieren */ }
}
