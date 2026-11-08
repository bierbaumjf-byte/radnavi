/* ------------------------------------------------------------------ *
 *  geocode.js – Adressen suchen und Koordinaten benennen (Nominatim).
 *
 *  Nominatim ist ein Gemeinschaftsdienst mit maximal einer Anfrage je
 *  Sekunde. Deshalb: entprellen, Ergebnisse merken, bei "429" ruhig
 *  bleiben statt nachzubohren.
 * ------------------------------------------------------------------ */

const BASE = 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 1100;

let lastCall = 0;
const searchCache = new Map();
const reverseCache = new Map();

function throttle() {
  const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
  lastCall = Date.now() + wait;
  return wait ? new Promise(r => setTimeout(r, wait)) : Promise.resolve();
}

/** Koordinaten erkennen, die direkt eingetippt wurden. */
function parseCoords(q) {
  const m = q.trim().match(
    /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.'));
  const b = parseFloat(m[2].replace(',', '.'));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // Erst Breite, dann Länge – wie überall üblich.
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lon: b, name: `${a.toFixed(5)}, ${b.toFixed(5)}`, detail: 'Koordinaten', isCoords: true };
}

/**
 * Sucht Orte. `near` (Karte in Sicht) hebt nahe Treffer nach oben.
 */
export async function search(query, { near, limit = 7, signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];

  const direct = parseCoords(q);
  if (direct) return [direct];

  const key = q.toLowerCase() + '|' + (near ? near.join(',') : '');
  if (searchCache.has(key)) return searchCache.get(key);

  await throttle();

  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: String(limit),
    addressdetails: '1', 'accept-language': 'de'
  });
  if (near) {
    // Suchfenster um die Karte, aber ohne harte Begrenzung.
    const [lat, lon] = near;
    params.set('viewbox', [lon - 1.2, lat + 0.9, lon + 1.2, lat - 0.9].join(','));
  }

  const res = await fetch(`${BASE}/search?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('Die Adresssuche ist gerade überlastet. Bitte kurz warten.');
  if (!res.ok) throw new Error('Adresssuche nicht erreichbar');

  const json = await res.json();
  const out = json.map(r => ({
    lat: parseFloat(r.lat), lon: parseFloat(r.lon),
    name: shortName(r), detail: longName(r),
    kind: r.type, importance: r.importance || 0
  }));

  searchCache.set(key, out);
  if (searchCache.size > 120) searchCache.delete(searchCache.keys().next().value);
  return out;
}

/** Nächstgelegene Adresse zu einem Punkt – benennt Kartenklicks. */
export async function reverse(lat, lon, { signal } = {}) {
  const key = lat.toFixed(4) + ',' + lon.toFixed(4);
  if (reverseCache.has(key)) return reverseCache.get(key);

  await throttle();
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon), format: 'jsonv2',
    zoom: '17', addressdetails: '1', 'accept-language': 'de'
  });

  let name = null;
  try {
    const res = await fetch(`${BASE}/reverse?${params}`, { signal, headers: { Accept: 'application/json' } });
    if (res.ok) {
      const r = await res.json();
      if (r && !r.error) name = shortName(r);
    }
  } catch { /* ohne Namen ist auch gut */ }

  const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const out = name || fallback;
  reverseCache.set(key, out);
  if (reverseCache.size > 200) reverseCache.delete(reverseCache.keys().next().value);
  return out;
}

function shortName(r) {
  const a = r.address || {};
  const street = a.road || a.pedestrian || a.footway || a.path;
  const place = a.village || a.town || a.city || a.municipality || a.suburb || a.county;
  const poi = r.name || a.amenity || a.tourism || a.shop;

  // „Nottuln, Nottuln“ hilft niemandem.
  const join = (a1, b1) => (b1 && b1 !== a1) ? `${a1}, ${b1}` : a1;

  if (poi && !street) return join(poi, place);
  if (street) {
    const nr = a.house_number ? ' ' + a.house_number : '';
    return join(`${street}${nr}`, place);
  }
  if (place) return place;
  return (r.display_name || '').split(',').slice(0, 2).join(',').trim() || 'Unbenannter Ort';
}

function longName(r) {
  const parts = (r.display_name || '').split(',').map(s => s.trim());
  return parts.slice(1).join(', ');
}
