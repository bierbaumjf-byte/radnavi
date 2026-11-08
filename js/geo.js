/* ------------------------------------------------------------------ *
 *  geo.js – Rechnen auf der Kugel. Koordinaten durchgehend als
 *  [lon, lat, ele?], so wie GeoJSON und BRouter sie liefern.
 * ------------------------------------------------------------------ */

const R = 6371008.8;              // mittlerer Erdradius in m
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

/** Entfernung zweier Punkte in Metern (Haversine). */
export function dist(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const la1 = rad(a[1]), la2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Kurs von a nach b in Grad (0 = Norden). */
export function bearing(a, b) {
  const la1 = rad(a[1]), la2 = rad(b[1]);
  const dLon = rad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Punkt in Entfernung d (m) und Kurs brg (Grad) von a aus. */
export function destination(a, d, brg) {
  const la1 = rad(a[1]), lo1 = rad(a[0]), b = rad(brg), dr = d / R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la1),
                               Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return [((deg(lo2) + 540) % 360) - 180, deg(la2)];
}

/** Differenz zweier Kurse, immer -180…180. */
export function bearingDelta(from, to) {
  let d = (to - from + 540) % 360 - 180;
  return d;
}

/** Gesamtlänge eines Linienzugs in Metern. */
export function lineLength(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += dist(coords[i - 1], coords[i]);
  return sum;
}

/** Kumulierte Längen je Punkt – Basis für alles Weitere. */
export function cumulative(coords) {
  const out = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + dist(coords[i - 1], coords[i]);
  return out;
}

/**
 * Höhenmeter bergauf und bergab. Kleine Zacken werden geglättet,
 * sonst sammelt GPS-Rauschen zweifelhafte Höhenmeter an.
 */
export function elevationStats(coords, threshold = 2.5) {
  let up = 0, down = 0, ref = null;
  for (const c of coords) {
    const e = c[2];
    if (e === undefined || e === null || Number.isNaN(e)) continue;
    if (ref === null) { ref = e; continue; }
    const d = e - ref;
    if (d > threshold)  { up   += d; ref = e; }
    else if (d < -threshold) { down -= d; ref = e; }
  }
  return { ascend: Math.round(up), descend: Math.round(down) };
}

/**
 * Nächster Punkt auf einem Liniensegment – in einer lokalen
 * Ebenenprojektion, auf Segmentlänge völlig ausreichend.
 */
function projectOnSegment(p, a, b) {
  const kx = Math.cos(rad(p[1])) * 111320, ky = 110540;
  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const px = p[0] * kx, py = p[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { t, dist: Math.hypot(px - cx, py - cy) };
}

/**
 * Wo liegt p auf der Linie? Liefert Index des Segments, Anteil darin,
 * Abstand zur Linie in m und die zurückgelegte Strecke.
 *
 * `fromIndex` beschleunigt die Suche während der Fahrt: dort wandert
 * man die Linie entlang und muss nicht jedes Mal von vorn suchen.
 */
export function locateOnLine(p, coords, cum, fromIndex = 0, window = 0) {
  let best = { index: 0, t: 0, dist: Infinity, along: 0 };
  const start = window ? Math.max(0, fromIndex - 2) : 0;
  const end   = window ? Math.min(coords.length - 1, fromIndex + window) : coords.length - 1;
  for (let i = start; i < end; i++) {
    const r = projectOnSegment(p, coords[i], coords[i + 1]);
    if (r.dist < best.dist) {
      const segLen = (cum[i + 1] - cum[i]);
      best = { index: i, t: r.t, dist: r.dist, along: cum[i] + r.t * segLen };
    }
  }
  return best;
}

/** Hüllrechteck als [[minLat,minLon],[maxLat,maxLon]] für Leaflet. */
export function boundsOf(coords) {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const c of coords) {
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
  }
  return [[minLat, minLon], [maxLat, maxLon]];
}

/**
 * Douglas-Peucker. Nötig, weil eine 200-km-Route schnell 20 000
 * Punkte hat und das Höhenprofil davon nichts gewinnt.
 */
export function simplify(coords, tolerance = 8) {
  if (coords.length < 3) return coords.slice();
  const kx = Math.cos(rad(coords[0][1])) * 111320, ky = 110540;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    const ax = coords[s][0] * kx, ay = coords[s][1] * ky;
    const bx = coords[e][0] * kx, by = coords[e][1] * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const px = coords[i][0] * kx, py = coords[i][1] * ky;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/* --------------------------- Darstellung -------------------------- */

export function fmtKm(m) {
  if (m == null || Number.isNaN(m)) return '–';
  if (m < 950) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', ',') + ' km';
}

export function fmtDistShort(m) {
  if (m == null) return '–';
  if (m < 1000) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(1).replace('.', ',') + ' km';
}

export function fmtDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '–';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h === 0) return m + ' min';
  return h + ':' + String(m).padStart(2, '0') + ' h';
}

export function fmtClock(date) {
  return date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
}
