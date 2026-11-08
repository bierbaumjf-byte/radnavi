/* ------------------------------------------------------------------ *
 *  gpx.js – Wege hereinholen und herausgeben.
 *
 *  Herein: GPX (Track, Route, nur Wegpunkte), GeoJSON, KML, TCX.
 *  Heraus: GPX 1.1 mit Höhen und, wenn vorhanden, Wegpunkten.
 * ------------------------------------------------------------------ */

import { lineLength, elevationStats } from './geo.js';

const NS = 'http://www.topografix.com/GPX/1/1';

/* ------------------------------ Import ---------------------------- */

/**
 * Liest eine Datei und liefert eine Liste von Wegen. Eine GPX-Datei
 * kann mehrere Tracks enthalten – jeder wird ein eigener Weg.
 */
export async function parseFile(file) {
  const text = await file.text();
  const base = file.name.replace(/\.[^.]+$/, '');
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return parseJSONDatei(text, base);
  if (lower.endsWith('.kml')) return parseKML(text, base);
  if (lower.endsWith('.tcx')) return parseTCX(text, base);
  return parseGPX(text, base);
}

function xmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Datei ist kein gültiges XML');
  return doc;
}

function ptsFrom(nodes) {
  const out = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat'));
    const lon = parseFloat(n.getAttribute('lon'));
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const eleEl = n.getElementsByTagName('ele')[0];
    const ele = eleEl ? parseFloat(eleEl.textContent) : undefined;
    out.push(Number.isNaN(ele) || ele === undefined ? [lon, lat] : [lon, lat, ele]);
  }
  return out;
}

function timesFrom(nodes) {
  const out = [];
  for (const n of nodes) {
    const t = n.getElementsByTagName('time')[0];
    if (t) {
      const ms = Date.parse(t.textContent);
      if (!Number.isNaN(ms)) out.push(ms);
    }
  }
  return out;
}

export function parseGPX(text, base = 'Importierter Weg') {
  const doc = xmlDoc(text);
  const out = [];

  const nameOf = (el, fallback) => {
    const n = el.getElementsByTagName('name')[0];
    const v = n ? n.textContent.trim() : '';
    return v || fallback;
  };

  // Wegpunkte der Datei – als mögliche Zwischenziele.
  const fileWpts = Array.from(doc.getElementsByTagName('wpt')).map(w => ({
    lat: parseFloat(w.getAttribute('lat')),
    lon: parseFloat(w.getAttribute('lon')),
    name: nameOf(w, '')
  })).filter(w => !Number.isNaN(w.lat));

  // 1) Tracks
  for (const trk of doc.getElementsByTagName('trk')) {
    const coords = [];
    const times = [];
    for (const seg of trk.getElementsByTagName('trkseg')) {
      const nodes = Array.from(seg.getElementsByTagName('trkpt'));
      coords.push(...ptsFrom(nodes));
      times.push(...timesFrom(nodes));
    }
    if (coords.length < 2) continue;
    out.push(makeWeg(coords, nameOf(trk, base), 'imported', times, fileWpts));
  }

  // 2) Routen (nur wenn kein Track dabei war)
  if (!out.length) {
    for (const rte of doc.getElementsByTagName('rte')) {
      const coords = ptsFrom(Array.from(rte.getElementsByTagName('rtept')));
      if (coords.length < 2) continue;
      const w = makeWeg(coords, nameOf(rte, base), 'imported', [], fileWpts);
      w.waypoints = coords.map((c, i) => ({ lat: c[1], lon: c[0], name: i === 0 ? 'Start' : '' }));
      out.push(w);
    }
  }

  // 3) Nur Wegpunkte – als Planungsgerüst brauchbar
  if (!out.length && fileWpts.length >= 2) {
    const coords = fileWpts.map(w => [w.lon, w.lat]);
    const w = makeWeg(coords, base, 'imported', [], fileWpts);
    w.waypoints = fileWpts;
    w.note = 'Nur Wegpunkte – über "Route berechnen" zu einer Strecke machen.';
    out.push(w);
  }

  if (!out.length) throw new Error('Keine Strecke in der Datei gefunden');
  return out;
}

/**
 * Eine .json-Datei kann zweierlei sein:
 *   – GeoJSON, wie es diese App selbst herausgibt;
 *   – das Rohbündel, das der Naviki-Export herunterlädt. Das ist eine
 *     Liste von Einträgen, in denen die ganze GPX-Datei als Zeichenkette
 *     unter "gpx" steckt. Vorher scheiterte der Import daran mit
 *     „Keine Linie im GeoJSON gefunden" – richtig, aber nicht hilfreich.
 */
async function parseJSONDatei(text, base) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Datei ist kein gültiges JSON'); }

  if (Array.isArray(data) && data.some(e => e && typeof e.gpx === 'string')) {
    return parseNavikiBuendel(data, base);
  }
  return parseGeoJSON(data, base);
}

/**
 * Das Naviki-Bündel. Hunderte Wege in einer Datei – zwischendurch den
 * Browser atmen lassen, sonst steht die Oberfläche minutenlang still.
 */
async function parseNavikiBuendel(liste, base) {
  const out = [];
  for (let i = 0; i < liste.length; i++) {
    const e = liste[i];
    if (!e || typeof e.gpx !== 'string') continue;
    // "Name | 28,98 km, 31.10.2026, 10:30" – vor dem Strich steht der Name.
    const titel = String(e.text || '').split('|')[0].trim() ||
                  `${base}-${String(i).padStart(3, '0')}`;
    try {
      for (const w of parseGPX(e.gpx, titel)) {
        w.source = 'Naviki';
        out.push(w);
      }
    } catch { /* ein kaputter Eintrag soll die anderen 400 nicht kippen */ }
    if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
  }
  if (!out.length) throw new Error('Keine Strecke im Naviki-Bündel gefunden');
  return out;
}

function parseGeoJSON(gj, base) {
  const feats = (gj && gj.type === 'FeatureCollection' ? gj.features
               : gj && gj.type === 'Feature' ? [gj]
               : [{ geometry: gj, properties: {} }]) || [];
  const out = [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'LineString' ? [g.coordinates]
                : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      if (line.length < 2) continue;
      const name = (f.properties && (f.properties.name || f.properties.trackname)) || base;
      const w = makeWeg(line.map(c => c.slice(0, 3)), name, 'imported');
      if (f.properties) {
        const p = f.properties;
        if (p['track-length']) w.length = Number(p['track-length']);
        if (p['filtered ascend']) w.ascend = Number(p['filtered ascend']);
        if (p['total-time']) w.duration = Number(p['total-time']);
        // Ein Datum in den Eigenschaften gilt als Datum des Weges –
        // sonst bekäme ein zehn Jahre alter Weg den Tag des Imports.
        const t = Date.parse(p.time || p.date || p.created || '');
        if (!Number.isNaN(t)) w.created = t;
        if (p.source) w.source = String(p.source);
      }
      out.push(w);
    }
  }
  if (!out.length) throw new Error('Keine Linie im GeoJSON gefunden');
  return out;
}

function parseKML(text, base) {
  const doc = xmlDoc(text);
  const out = [];
  for (const ls of doc.getElementsByTagName('LineString')) {
    const raw = (ls.getElementsByTagName('coordinates')[0] || {}).textContent || '';
    const coords = raw.trim().split(/\s+/).map(s => {
      const [lon, lat, ele] = s.split(',').map(Number);
      return Number.isNaN(lat) ? null : (Number.isNaN(ele) ? [lon, lat] : [lon, lat, ele]);
    }).filter(Boolean);
    if (coords.length < 2) continue;
    let name = base;
    let p = ls.parentElement;
    while (p && p.tagName !== 'Placemark') p = p.parentElement;
    if (p) {
      const n = p.getElementsByTagName('name')[0];
      if (n && n.textContent.trim()) name = n.textContent.trim();
    }
    out.push(makeWeg(coords, name, 'imported'));
  }
  if (!out.length) throw new Error('Keine Linie im KML gefunden');
  return out;
}

function parseTCX(text, base) {
  const doc = xmlDoc(text);
  const coords = [], times = [];
  for (const tp of doc.getElementsByTagName('Trackpoint')) {
    const pos = tp.getElementsByTagName('Position')[0];
    if (!pos) continue;
    const lat = parseFloat((pos.getElementsByTagName('LatitudeDegrees')[0] || {}).textContent);
    const lon = parseFloat((pos.getElementsByTagName('LongitudeDegrees')[0] || {}).textContent);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const alt = parseFloat((tp.getElementsByTagName('AltitudeMeters')[0] || {}).textContent);
    coords.push(Number.isNaN(alt) ? [lon, lat] : [lon, lat, alt]);
    const t = tp.getElementsByTagName('Time')[0];
    if (t) { const ms = Date.parse(t.textContent); if (!Number.isNaN(ms)) times.push(ms); }
  }
  if (coords.length < 2) throw new Error('Keine Strecke im TCX gefunden');
  return [makeWeg(coords, base, 'imported', times)];
}

function makeWeg(coords, name, kind, times = [], fileWpts = []) {
  const { ascend, descend } = elevationStats(coords);
  const weg = {
    name: name || 'Ohne Namen',
    kind,
    coords,
    length: Math.round(lineLength(coords)),
    ascend, descend,
    // Trägt die Datei einen Zeitstempel, gilt der als Datum des Weges –
    // sonst stünde bei einem Jahre alten Weg der Tag des Imports.
    created: times.length ? times[0] : Date.now(),
    importedAt: Date.now(),
    source: 'Import'
  };
  if (times.length > 1) {
    weg.duration = Math.round((times[times.length - 1] - times[0]) / 1000);
    weg.startedAt = times[0];
  }
  if (fileWpts.length && fileWpts.length <= 30) weg.fileWaypoints = fileWpts;
  return weg;
}

/* ------------------------------ Export ---------------------------- */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Ein oder mehrere Wege als GPX-Text. */
export function toGPX(wege) {
  const list = Array.isArray(wege) ? wege : [wege];
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Jan's super Fahrradnavi" xmlns="${NS}">`,
    '  <metadata>',
    `    <name>${esc(list.length === 1 ? list[0].name : 'RadNavi-Wege')}</name>`,
    `    <time>${new Date().toISOString()}</time>`,
    '  </metadata>'
  ];

  for (const w of list) {
    for (const wp of (w.waypoints || [])) {
      if (!wp || wp.lat == null) continue;
      parts.push(`  <wpt lat="${wp.lat.toFixed(7)}" lon="${wp.lon.toFixed(7)}">` +
                 `<name>${esc(wp.name || '')}</name></wpt>`);
    }
  }

  for (const w of list) {
    if (!w.coords || w.coords.length < 2) continue;
    parts.push('  <trk>');
    parts.push(`    <name>${esc(w.name)}</name>`);
    if (w.note) parts.push(`    <desc>${esc(w.note)}</desc>`);
    parts.push('    <trkseg>');
    for (const c of w.coords) {
      let p = `      <trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">`;
      if (c[2] != null && !Number.isNaN(c[2])) p += `<ele>${Number(c[2]).toFixed(1)}</ele>`;
      p += '</trkpt>';
      parts.push(p);
    }
    parts.push('    </trkseg>');
    parts.push('  </trk>');
  }

  parts.push('</gpx>');
  return parts.join('\n');
}

/** Datei im Browser anbieten. */
export function downloadGPX(wege, filename) {
  const text = toGPX(wege);
  const name = (filename || (Array.isArray(wege) ? 'radnavi-wege' : wege.name) || 'route')
    .replace(/[^\wäöüÄÖÜß .-]+/g, '_').slice(0, 80);
  const blob = new Blob([text], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.gpx') ? name : name + '.gpx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
