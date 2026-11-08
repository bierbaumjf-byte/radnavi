/* ------------------------------------------------------------------ *
 *  router.js – Routenberechnung über BRouter.
 *
 *  Das eigene Profil "Naturroute" wird als Text gehalten, mit den
 *  Reglerwerten zusammengebaut und zum Server hochgeladen; der
 *  antwortet mit einer Profil-ID, die wir uns zum Textinhalt merken.
 *  Die Live-Parameter des Servers (profile:name=wert) taugen dafür
 *  nicht: numerische Werte werden ignoriert, boolesche quittiert der
 *  Server mit Fehler 500. Nachgemessen, nicht vermutet.
 * ------------------------------------------------------------------ */

import { cumulative, elevationStats, lineLength } from './geo.js';
import { cachedProfileId, cacheProfileId, forgetProfileId } from './store.js';

/* ------------------------- Regler und Profile --------------------- */

/** Die Regler der Feinabstimmung, mit ihrem Namen im Profiltext. */
export const TUNABLES = [
  { key: 'route',    assign: 'cycleroute_weight', min: 0, max: 8, step: 0.25 },
  { key: 'noise',    assign: 'noise_weight',     min: 0, max: 4, step: 0.2 },
  { key: 'traffic',  assign: 'traffic_weight',   min: 0, max: 4, step: 0.2 },
  { key: 'forest',   assign: 'forest_weight',    min: 0, max: 4, step: 0.2 },
  { key: 'river',    assign: 'river_weight',     min: 0, max: 4, step: 0.2 },
  { key: 'town',     assign: 'town_weight',      min: 0, max: 4, step: 0.2 },
  { key: 'sidepath', assign: 'sidepath_penalty', min: 0, max: 8, step: 0.25 },
  { key: 'unpaved',  assign: 'unpaved_extra',    min: 0, max: 8, step: 0.25 },
  { key: 'hill',     assign: 'downhillcost',     min: 0, max: 120, step: 5 }
];

const BOOLEANS = [
  { key: 'steps', assign: 'allow_steps' },
  { key: 'ferry', assign: 'allow_ferries' }
];

/** Voreinstellungen der wählbaren Streckencharaktere. */
export const PRESETS = {
  natur: {
    label: 'Radrouten-Naturroute',
    custom: true,
    tune: { route: 3.5, noise: 2.0, traffic: 2.0, forest: 1.6, river: 0.8, town: 2.5,
            sidepath: 5.0, unpaved: 4.5, hill: 60, steps: false, ferry: true }
  },
  'natur+': {
    label: 'Radrouten streng',
    custom: true,
    tune: { route: 6.0, noise: 3.2, traffic: 3.2, forest: 2.6, river: 1.4, town: 3.5,
            sidepath: 7.0, unpaved: 6.5, hill: 60, steps: false, ferry: true }
  },
  trekking: { label: 'Trekking', custom: false, server: 'trekking' },
  fastbike: { label: 'Schnell',  custom: false, server: 'fastbike' },
  shortest: { label: 'Kürzeste', custom: false, server: 'shortest' }
};

/* ----------------------- Profiltext erzeugen ---------------------- */

let templateCache = null;

export async function loadTemplate() {
  if (templateCache) return templateCache;
  const res = await fetch('profiles/naturroute.brf', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Routing-Profil konnte nicht geladen werden');
  templateCache = await res.text();
  return templateCache;
}

export function setTemplate(text) { templateCache = text; }

/**
 * Setzt im Profiltext die Werte der Regler ein. Ersetzt wird jeweils
 * nur die erste Zuweisung eines Namens – `downhillcost` steht weiter
 * unten ein zweites Mal, bedingt, und muss so bleiben.
 */
export function applyTune(template, tune) {
  if (!tune) return template;
  let text = template;

  const setAssign = (name, value) => {
    const re = new RegExp('^(\\s*assign\\s+' + name + '\\s*=\\s*)([^\\s#]+)', 'm');
    if (re.test(text)) text = text.replace(re, (_, head) => head + value);
  };

  for (const t of TUNABLES) {
    const v = tune[t.key];
    if (v == null || Number.isNaN(Number(v))) continue;
    setAssign(t.assign, Number(v));
  }
  for (const b of BOOLEANS) {
    const v = tune[b.key];
    if (v == null) continue;
    setAssign(b.assign, v ? 'true' : 'false');
  }
  return text;
}

/** Kurzer, stabiler Fingerabdruck eines Textes (FNV-1a). */
export function hashText(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + '-' + str.length.toString(36);
}

/* --------------------------- Profil-Upload ------------------------ */

const inflight = new Map();

/**
 * Sorgt dafür, dass der Server dieses Profil kennt, und liefert
 * seine Profil-ID. Gleiche Texte werden nicht erneut hochgeladen.
 */
export async function ensureProfileId(server, profileText) {
  const hash = hashText(profileText);
  const known = cachedProfileId(hash);
  if (known) return { id: known, hash, uploaded: false };

  if (inflight.has(hash)) return inflight.get(hash);

  const task = (async () => {
    const res = await fetch(server.replace(/\/+$/, '') + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: profileText
    });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); }
    catch { throw new Error('Server antwortete unverständlich auf den Profil-Upload'); }
    if (data.error) throw new Error('Profilfehler: ' + data.error.replace(/^Profile error:\s*/, ''));
    if (!data.profileid) throw new Error('Server lieferte keine Profil-ID');
    cacheProfileId(hash, data.profileid);
    return { id: data.profileid, hash, uploaded: true };
  })().finally(() => inflight.delete(hash));

  inflight.set(hash, task);
  return task;
}

/* --------------------------- Routing ------------------------------ */

const CMD = {
  1:  { text: 'geradeaus',            arrow: '↑',  say: 'weiter geradeaus' },
  2:  { text: 'links abbiegen',       arrow: '←',  say: 'links abbiegen' },
  3:  { text: 'leicht links',         arrow: '↖',  say: 'leicht links' },
  4:  { text: 'scharf links',         arrow: '↰',  say: 'scharf links abbiegen' },
  5:  { text: 'rechts abbiegen',      arrow: '→',  say: 'rechts abbiegen' },
  6:  { text: 'leicht rechts',        arrow: '↗',  say: 'leicht rechts' },
  7:  { text: 'scharf rechts',        arrow: '↱',  say: 'scharf rechts abbiegen' },
  8:  { text: 'links halten',         arrow: '↖',  say: 'links halten' },
  9:  { text: 'rechts halten',        arrow: '↗',  say: 'rechts halten' },
  10: { text: 'wenden',               arrow: '↺',  say: 'bitte wenden' },
  11: { text: 'wenden',               arrow: '↺',  say: 'bitte wenden' },
  12: { text: 'wenden',               arrow: '↻',  say: 'bitte wenden' },
  13: { text: 'zurück zur Route',     arrow: '⚑',  say: 'zurück zur Route' },
  14: { text: 'in den Kreisverkehr',  arrow: '⟳',  say: 'in den Kreisverkehr' },
  15: { text: 'in den Kreisverkehr',  arrow: '⟲',  say: 'in den Kreisverkehr' },
  16: { text: 'Luftlinie',            arrow: '⇢',  say: 'weiter' }
};

const WAYTYPE = {
  cycleway: 'Radweg', path: 'Pfad', footway: 'Fußweg', track: 'Wirtschaftsweg',
  unclassified: 'Nebenstraße', residential: 'Wohnstraße', living_street: 'Wohnstraße',
  service: 'Zufahrt', tertiary: 'Landstraße', secondary: 'Hauptstraße',
  primary: 'Hauptstraße', trunk: 'Schnellstraße', pedestrian: 'Fußgängerzone',
  bridleway: 'Reitweg', road: 'Weg', steps: 'Treppe'
};

const SURFACE = {
  asphalt: 'Asphalt', paved: 'befestigt', concrete: 'Beton',
  paving_stones: 'Pflaster', sett: 'Kopfsteinpflaster', cobblestone: 'Kopfsteinpflaster',
  compacted: 'verdichtet', fine_gravel: 'Feinschotter', gravel: 'Schotter',
  ground: 'Naturboden', dirt: 'Erde', grass: 'Gras', sand: 'Sand', mud: 'Matsch',
  wood: 'Holz', pebblestone: 'Kies'
};

/**
 * Berechnet eine Route.
 *
 * @param opts.server        Basis-URL, z. B. https://brouter.de/brouter
 * @param opts.waypoints     [{lat, lon}, …] – mindestens zwei
 * @param opts.profileName   Servername oder custom_… ID
 * @param opts.alternativeIdx 0–3
 * @param opts.signal        AbortSignal
 */
export async function route(opts) {
  const { server, waypoints, profileName, alternativeIdx = 0, signal } = opts;
  if (!waypoints || waypoints.length < 2) throw new Error('Mindestens zwei Punkte nötig');

  const lonlats = waypoints
    .map(w => `${Number(w.lon).toFixed(6)},${Number(w.lat).toFixed(6)}`)
    .join('|');

  // timode muss in die URL. Das turnInstructionMode im Profil allein
  // genügt dem Server nicht – ohne diesen Parameter kommt die Route
  // ganz ohne Abbiegehinweise zurück. Nachgemessen.
  const url = server.replace(/\/+$/, '') +
    '?lonlats=' + encodeURIComponent(lonlats) +
    '&profile=' + encodeURIComponent(profileName) +
    '&alternativeidx=' + alternativeIdx +
    '&timode=2' +
    '&format=geojson';

  const res = await fetch(url, { signal });
  const text = await res.text();

  // BRouter quittiert manche Fehler mit Status 200 und Klartext,
  // deshalb zählt nicht der Status, sondern die Form der Antwort.
  const looksLikeJson = text.trimStart().startsWith('{');
  if (!res.ok || !looksLikeJson) {
    const raw = text.trim().slice(0, 300) || ('Server-Fehler ' + res.status);
    throw serverError(raw, res.status, text);
  }

  return parseRoute(JSON.parse(text));
}

/** Server-Klartext in eine verständliche Meldung übersetzen. */
function serverError(raw, status, full) {
  let message = raw;
  let profileGone = false;

  if (/profile.*not found|unknown profile|no such profile/i.test(raw)) {
    message = 'Das Routing-Profil ist dem Server nicht mehr bekannt – es wird neu hochgeladen.';
    profileGone = true;
  } else if (/datafile.*not found|no data file|not covered/i.test(raw)) {
    message = 'Für diesen Bereich hat der Routing-Server keine Kartendaten. Punkt näher an befahrbares Gebiet setzen.';
  } else if (/target island|position not mapped|no route found|unreachable|no track found/i.test(raw)) {
    message = 'Keine Verbindung gefunden. Liegt ein Punkt abseits des Wegenetzes?';
  } else if (status === 500) {
    message = 'Der Routing-Server konnte die Anfrage nicht verarbeiten.';
  }

  const err = new Error(message);
  err.status = status;
  err.profileGone = profileGone;
  err.raw = full;
  return err;
}

/** GeoJSON von BRouter in die Form bringen, die die App benutzt. */
export function parseRoute(gj) {
  const f = gj.features && gj.features[0];
  if (!f || !f.geometry || !f.geometry.coordinates) throw new Error('Leere Antwort vom Routing-Server');

  const coords = f.geometry.coordinates;
  const p = f.properties || {};
  const cum = cumulative(coords);
  const length = Number(p['track-length']) || Math.round(lineLength(coords));
  const elev = elevationStats(coords);

  // Wegeigenschaften je Abschnitt – für Anzeige und Qualitätsurteil.
  const segments = parseMessages(p.messages);

  const hints = (p.voicehints || []).map(h => {
    const idx = Math.min(Math.max(0, h[0] | 0), coords.length - 1);
    const cmd = CMD[h[1]] || CMD[1];
    return {
      index: idx,
      along: cum[idx],
      cmd: h[1],
      text: cmd.text,
      say: cmd.say,
      arrow: cmd.arrow,
      exit: h[2] | 0,
      angle: Number(h[4]) || 0
    };
  });

  return {
    coords, cum, length,
    beeline: rangesWhere(segments, cum, istLuftlinie),
    ferry: rangesWhere(segments, cum, istFaehre),
    ascend: Number(p['filtered ascend']) || elev.ascend,
    descend: elev.descend,
    duration: Number(p['total-time']) || null,
    times: (p.times || []).map(Number),
    hints,
    segments,
    quality: quality(segments, length),
    raw: p
  };
}

/** Fähre: eine Schiffsverbindung, kein Weg zum Fahren. */
export function istFaehre(s) { return s.tags.route === 'ferry'; }

/** Luftlinie: weder Weg noch Fähre – von BRouter schnurgerade gezogen. */
export function istLuftlinie(s) { return !s.tags.highway && !istFaehre(s); }

/** Weg, auf dem man wirklich fährt. Eine Fähre ist das nicht. */
export function istFahrbar(s) { return !!s.tags.highway; }

/**
 * Zusammenhängende Teile der Linie, auf die `pred` zutrifft – als
 * Index-Bereiche in `coords`.
 *
 * Gebraucht für zweierlei, das auf der Karte gleich aussah und beides
 * keine Radstrecke ist: Luftlinien (BRouter verbindet einen Punkt
 * abseits jedes Weges schnurgerade) und Fährlinien. In der Table Bay
 * kamen beide zusammen – 16 km Fähre und 4 km Luftlinie, gezeichnet
 * als ganz normale rote Route.
 */
function rangesWhere(segments, cum, pred) {
  if (!segments.length || cum.length < 2) return [];
  const idxFor = m => {
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < m) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const out = [];
  let von = null;
  for (const s of segments) {
    if (pred(s)) { if (von === null) von = s.along; }
    else if (von !== null) { out.push([idxFor(von), idxFor(s.along)]); von = null; }
  }
  if (von !== null) out.push([idxFor(von), cum.length - 1]);
  return out.filter(([a, b]) => b > a);
}

/**
 * Gehört dieser Abschnitt zu einem ausgeschilderten Radroutennetz?
 * Die vier route_bicycle_* kommen aus Relationen (D-Routen, Radfernwege,
 * regionale und örtliche Netze), lcn=yes steht am Weg selbst.
 */
function isSignedRoute(t) {
  return t.route_bicycle_icn === 'yes' || t.route_bicycle_ncn === 'yes'
      || t.route_bicycle_rcn === 'yes' || t.route_bicycle_lcn === 'yes'
      || t.lcn === 'yes';
}

/** Baulich oder rechtlich ausgewiesener Radweg bzw. Fahrradstraße. */
function isOfficialBikeway(t) {
  return t.bicycle_road === 'yes' || t.cyclestreet === 'yes'
      || t.highway === 'cycleway' || t.bicycle === 'designated';
}

function parseMessages(messages) {
  if (!messages || messages.length < 2) return [];
  const hdr = messages[0];
  const iLon = hdr.indexOf('Longitude'), iLat = hdr.indexOf('Latitude');
  const iDist = hdr.indexOf('Distance'), iTags = hdr.indexOf('WayTags');
  const out = [];
  let along = 0;
  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const d = Number(row[iDist]) || 0;
    const tags = {};
    for (const t of String(row[iTags] || '').split(' ')) {
      const eq = t.indexOf('=');
      if (eq > 0) tags[t.slice(0, eq)] = t.slice(eq + 1);
    }
    out.push({
      along, length: d,
      lon: Number(row[iLon]) / 1e6, lat: Number(row[iLat]) / 1e6,
      tags,
      type: WAYTYPE[tags.highway] || (tags.highway ? tags.highway : 'Weg'),
      surface: SURFACE[tags.surface] || tags.surface || null,
      noise: tags.estimated_noise_class ? Number(tags.estimated_noise_class) : null,
      traffic: tags.estimated_traffic_class ? Number(tags.estimated_traffic_class) : null,
      forest: tags.estimated_forest_class ? Number(tags.estimated_forest_class) : null,
      town: tags.estimated_town_class ? Number(tags.estimated_town_class) : null,
      onRoute: isSignedRoute(tags),
      official: isOfficialBikeway(tags)
    });
    along += d;
  }
  return out;
}

/**
 * Wie gut passt die Route zum Wunsch? Anteile in Prozent der Länge –
 * das ist die ehrliche Rückmeldung, ob das Profil hier etwas finden
 * konnte oder ob es im Gelände einfach keine stille Alternative gibt.
 */
export function quality(segments, total) {
  if (!segments.length || !total) return null;
  let paved = 0, unpaved = 0, loud = 0, busy = 0, nature = 0, mainroad = 0, sidepathish = 0;
  let onRoute = 0, official = 0, town = 0, beeline = 0, unknownSurface = 0, ferry = 0;

  // Begleitradwege dürfen nur kurze Lückenschlüsse sein. Dafür zählt
  // nicht der Gesamtanteil, sondern das längste Stück am Stück: zehn
  // getrennte 200-Meter-Schnipsel sind harmlos, zwei Kilometer nicht.
  let run = 0, longestRun = 0, longRuns = 0;
  const LANG = 1000;

  // BRouter gibt nur die Tags zurück, die das benutzte Profil auch
  // auswertet. Bei den Serverprofilen fehlen Wald- und Lärmklasse
  // deshalb vollständig – das ist "nicht gemessen", nicht "null
  // Prozent", und darf nicht als Aussage verkauft werden.
  const hasForest = segments.some(s => s.forest != null);
  const hasNoise  = segments.some(s => s.noise != null);
  const hasTraffic = segments.some(s => s.traffic != null);
  // Ortslage meldet BRouter nur dort, wo wirklich bebautes Gebiet ist –
  // ausserhalb fehlt die Klasse ganz. "Keine Angabe" heisst hier also
  // "freies Land", anders als bei Wald und Laerm.
  const hasTown = segments.some(s => s.town != null);

  // Fähre und Luftlinie sind keine Radstrecke. Sie gehören nicht in die
  // Belagsrechnung, sonst gilt eine Schiffspassage als "100 % befestigt" –
  // genau das stand in der Table Bay unter der Route.
  let ridable = 0;

  for (const s of segments) {
    const d = s.length;

    if (istLuftlinie(s)) { beeline += d; continue; }
    if (istFaehre(s))    { ferry += d;   continue; }
    ridable += d;

    const sf = s.tags.surface;
    if (sf === 'asphalt' || sf === 'concrete' || sf === 'paved') paved += d;
    else if (sf && sf !== 'paving_stones' && sf !== 'sett' && sf !== 'cobblestone') unpaved += d;
    else if (!sf && /track|path|bridleway|road/.test(s.tags.highway || '')) {
      // Feld- und Waldweg ohne Belagsangabe. Das ist kein Asphalt –
      // getrennt gezählt, weil "unbekannt" etwas anderes ist als "Schotter".
      unpaved += d; unknownSurface += d;
    }
    else paved += d;

    if (s.noise >= 3) loud += d;
    if (s.traffic >= 4) busy += d;
    if (s.forest >= 3) nature += d;
    if (/^(primary|secondary|trunk)/.test(s.tags.highway || '')) mainroad += d;

    if (s.town >= 1) town += d;

    if (s.onRoute) onRoute += d;
    else if (s.official) official += d;

    const isSidepath = s.noise >= 3 && /^(cycleway|path|footway)$/.test(s.tags.highway || '');
    if (isSidepath) {
      sidepathish += d;
      run += d;
      if (run > longestRun) longestRun = run;
    } else {
      if (run >= LANG) longRuns++;
      run = 0;
    }
  }
  if (run >= LANG) longRuns++;

  const pc = v => Math.round(100 * v / total);
  // Belag und Wegecharakter beziehen sich auf den Teil, den man fährt.
  const pcR = v => ridable ? Math.round(100 * v / ridable) : 0;
  return {
    ridableMeters: Math.round(ridable),
    pavedPct: pcR(paved), unpavedPct: pcR(unpaved), mainroadPct: pcR(mainroad),
    mainroadMeters: Math.round(mainroad),
    unpavedMeters: Math.round(unpaved),
    unknownSurfacePct: pcR(unknownSurface), unknownSurfaceMeters: Math.round(unknownSurface),
    // Fähre und Luftlinie als Anteil der ganzen Strecke, nicht des
    // gefahrenen Teils – sonst verschwindet gerade das Auffällige.
    beelineMeters: Math.round(beeline), beelinePct: pc(beeline),
    ferryMeters: Math.round(ferry), ferryPct: pc(ferry),
    onRoutePct: pcR(onRoute), officialPct: pcR(official),
    offRoutePct: pcR(ridable - onRoute - official),
    onRouteMeters: Math.round(onRoute),
    // Diese drei nur, wenn der Server die Klassen überhaupt mitgeliefert hat.
    naturePct: hasForest ? pcR(nature) : null,
    loudPct:   hasNoise  ? pcR(loud)   : null,
    busyPct:   hasTraffic ? pcR(busy)  : null,
    sidepathPct: hasNoise ? pcR(sidepathish) : null,
    sidepathLongest: hasNoise ? Math.round(longestRun) : null,
    sidepathLongRuns: hasNoise ? longRuns : null,
    loudMeters: hasNoise ? Math.round(loud) : null,
    townPct: hasTown ? pcR(town) : null,
    townMeters: hasTown ? Math.round(town) : null,
    measuredNature: hasForest, measuredNoise: hasNoise, measuredTown: hasTown
  };
}

/* --------------------- Profil für eine Anfrage -------------------- */

/**
 * Liefert den Profilnamen, mit dem geroutet werden kann – für eigene
 * Profile einschließlich Upload.
 */
export async function resolveProfile({ server, profileKey, tune, overrideText }) {
  const preset = PRESETS[profileKey] || PRESETS.natur;
  if (!preset.custom) return { name: preset.server, custom: false };

  const template = overrideText || await loadTemplate();
  const text = applyTune(template, tune || preset.tune);
  const { id, hash, uploaded } = await ensureProfileId(server, text);
  return { name: id, custom: true, hash, uploaded, text };
}

/** Nach „Profil unbekannt“ die gemerkte ID verwerfen. */
export function invalidateProfile(hash) {
  if (hash) forgetProfileId(hash);
}

export { CMD, WAYTYPE, SURFACE };
