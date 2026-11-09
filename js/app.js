/* ------------------------------------------------------------------ *
 *  app.js – Oberfläche und Ablauf.
 * ------------------------------------------------------------------ */

import {
  loadSettings, saveSettings, defaultSettings,
  putWeg, putWege, allWege, deleteWeg, renameWeg, newId,
  tileCacheSize, clearTileCache,
  getStartbild, putStartbild, deleteStartbild, bildVerkleinern
} from './store.js';
import { MapView, BASE_LAYERS } from './map.js';
import { ElevationChart } from './elev.js';
import * as R from './router.js';
import * as G from './geocode.js';
import { parseFile, parseGPX, downloadGPX } from './gpx.js';
import { Navigator, Recorder, Voice, locateOnce } from './nav.js';
import {
  fmtKm, fmtDuration, fmtClock, fmtDistShort, destination, dist, overlapStats
} from './geo.js';

/* --------------------------- Zustand ------------------------------ */

const S = loadSettings();
const voice = new Voice();

let waypoints = [];           // [{lat, lon, name}]
let routes = [];              // berechnete Varianten
let activeIdx = 0;
let nav = null;               // laufende Navigation
let recorder = null;
let addMode = true;
let wegeCache = [];
let routeAbort = null;
let lastProfileHash = null;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* --------------------------- Hilfsmittel -------------------------- */

let toastTimer = null;
function toast(msg, ms = 3400) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let busyCount = 0;
function busy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  $('#busy').hidden = busyCount === 0;
}

function persist() { saveSettings(S); }

/* --------------------------- Karte -------------------------------- */

const map = new MapView('map', {
  onMapClick: (lat, lon) => {
    if (!addMode) return;
    addWaypoint({ lat, lon }, { name: null, autoRoute: true });
  },
  onWaypointMoved: (i, lat, lon) => {
    waypoints[i] = { ...waypoints[i], lat, lon, name: null };
    nameWaypoint(i);
    renderWaypoints();
    if (waypoints.length >= 2) computeRoute();
  },
  onWaypointClick: i => {
    if (waypoints.length <= 2) return;
    removeWaypoint(i);
  }
});

const elev = new ElevationChart($('#elev'), {
  onHover: h => {
    map.showHover(h.lat, h.lon);
    const box = $('#elevHover');
    box.hidden = false;
    box.textContent = `${fmtKm(h.along)} · ${h.ele} m`;
    const wrap = $('#elevWrap').getBoundingClientRect();
    const x = h.xFraction * wrap.width;
    box.style.left = Math.max(2, Math.min(wrap.width - box.offsetWidth - 2, x - box.offsetWidth / 2)) + 'px';
  },
  onLeave: () => { map.hideHover(); $('#elevHover').hidden = true; }
});

/* --------------------------- Startaufbau -------------------------- */

async function init() {
  applyTheme();
  zeigeSplash();
  map.setBase(S.layer);
  map.setCycleOverlay(S.cycleOverlay);

  const v = S.lastView || { lat: 51.9607, lon: 7.6261, zoom: 12 };
  map.setView(v.lat, v.lon, v.zoom);
  map.map.on('moveend zoomend', () => {
    S.lastView = map.getView();
    persist();
  });

  buildLayerMenu();
  bindUI();
  applySettingsToUI();
  applyTuneToUI(currentTune());

  if (S.lastWaypoints && S.lastWaypoints.length) {
    waypoints = S.lastWaypoints;
    renderWaypoints();
  }

  await refreshWege();
  updateProfileState();
  registerSW();

  // Profiltext für den Einblick in den Einstellungen.
  try {
    const tpl = S.profileOverride || await R.loadTemplate();
    $('#profileText').value = tpl;
    if (S.profileOverride) R.setTemplate(S.profileOverride);
  } catch (e) {
    $('#profileText').value = '# Profil konnte nicht geladen werden: ' + e.message;
  }

  // Standort beim Start, aber ohne zu drängeln.
  if (!S.lastView) locate({ quiet: true });
}

/* ---------------------------- Startbild --------------------------- *
 *  Voreingestellt ist der gezeichnete Radfahrer aus dem Programmordner –
 *  den sieht jeder, der den Link bekommt. Wer ein eigenes Bild wählt,
 *  überschreibt ihn; dieses Bild bleibt in der Datenbank des Geräts und
 *  wird nirgendwo hochgeladen.
 * ------------------------------------------------------------------ */

const SPLASH_MS = 1900;
let bildUrl = null;          // laufende Objekt-URL, muss wieder freigegeben werden

function zeigeSplash() {
  const el = $('#splash');
  const img = $('#splashBild');
  if (!el) return;

  img.src = 'icons/comic-radfahrer.svg';
  img.hidden = false;

  // Das eigene Bild kommt aus der Datenbank und damit später als das
  // gezeichnete. Ist eins da, wird getauscht, solange der Splash steht.
  getStartbild().then(e => {
    if (e && e.blob && !el.hidden) {
      if (bildUrl) URL.revokeObjectURL(bildUrl);
      bildUrl = URL.createObjectURL(e.blob);
      img.src = bildUrl;
    }
  }).catch(() => { /* dann eben der gezeichnete */ });

  const weg = () => {
    if (el.hidden) return;
    el.classList.add('weg');
    setTimeout(() => {
      el.hidden = true;
      if (bildUrl) { URL.revokeObjectURL(bildUrl); bildUrl = null; }
    }, 500);
  };
  el.addEventListener('click', weg, { once: true });
  setTimeout(weg, SPLASH_MS);
}

/** Vorschau und Beschriftung in den Einstellungen nachführen. */
let vorschauUrl = null;
async function renderBildZeile() {
  const img = $('#bildVorschau'), info = $('#bildInfo'), weg = $('#btnBildWeg');
  const e = await getStartbild();
  if (vorschauUrl) { URL.revokeObjectURL(vorschauUrl); vorschauUrl = null; }
  if (e && e.blob) {
    vorschauUrl = URL.createObjectURL(e.blob);
    img.src = vorschauUrl;
    img.hidden = false;
    weg.hidden = false;
    const kb = Math.round(e.blob.size / 1024);
    info.textContent = `Eigenes Bild${e.name ? ' – ' + e.name : ''} (${kb} kB)`;
  } else {
    img.hidden = true;
    weg.hidden = true;
    info.textContent = 'Noch keins gewählt – es erscheint der gezeichnete Radfahrer';
  }
}

async function bildWaehlen(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Das ist kein Bild'); return; }
  busy(true);
  try {
    const klein = await bildVerkleinern(file);
    await putStartbild(klein, file.name);
    await renderBildZeile();
    toast('Startbild gespeichert – bleibt auf diesem Gerät');
  } catch (e) {
    toast('Bild konnte nicht gespeichert werden: ' + e.message, 5000);
  } finally {
    busy(false);
  }
}

/* --------------------------- Streckenpunkte ----------------------- */

async function addWaypoint(p, { name = null, autoRoute = true, atIndex = null } = {}) {
  const wp = { lat: p.lat, lon: p.lon, name };
  if (atIndex == null) waypoints.push(wp);
  else waypoints.splice(atIndex, 0, wp);

  renderWaypoints();
  const idx = atIndex == null ? waypoints.length - 1 : atIndex;
  nameWaypoint(idx);

  if (autoRoute && waypoints.length >= 2) computeRoute();
  else { S.lastWaypoints = waypoints; persist(); }
}

/** Namen nachträglich holen – die Route soll nicht darauf warten. */
async function nameWaypoint(i) {
  const wp = waypoints[i];
  if (!wp || wp.name) return;
  try {
    const n = await G.reverse(wp.lat, wp.lon);
    if (waypoints[i] === wp) { wp.name = n; renderWaypoints(); S.lastWaypoints = waypoints; persist(); }
  } catch { /* Name ist Luxus */ }
}

function removeWaypoint(i) {
  waypoints.splice(i, 1);
  renderWaypoints();
  if (waypoints.length >= 2) computeRoute();
  else { clearRouteDisplay(); S.lastWaypoints = waypoints; persist(); }
}

function moveWaypoint(from, to) {
  if (to < 0 || to >= waypoints.length) return;
  const [x] = waypoints.splice(from, 1);
  waypoints.splice(to, 0, x);
  renderWaypoints();
  if (waypoints.length >= 2) computeRoute();
}

function renderWaypoints() {
  const ol = $('#wpList');
  ol.innerHTML = '';

  if (!waypoints.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="wp-name empty">In die Karte tippen oder oben eine Adresse suchen</span>';
    ol.appendChild(li);
  }

  waypoints.forEach((wp, i) => {
    const last = i === waypoints.length - 1 && waypoints.length > 1;
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = String(i);

    const badge = document.createElement('span');
    badge.className = 'wp-badge ' + (i === 0 ? 'start' : last ? 'end' : '');
    badge.textContent = i === 0 ? 'S' : last ? 'Z' : String(i);

    const name = document.createElement('span');
    name.className = 'wp-name' + (wp.name ? '' : ' empty');
    name.textContent = wp.name || `${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}`;
    name.title = 'Auf der Karte zeigen';
    name.onclick = () => map.panTo(wp.lat, wp.lon, Math.max(14, map.getView().zoom));

    li.append(badge, name);

    const mk = (label, title, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'iconbtn ghost';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = !!disabled;
      b.onclick = fn;
      return b;
    };
    li.append(
      mk('▲', 'Nach oben', () => moveWaypoint(i, i - 1), i === 0),
      mk('▼', 'Nach unten', () => moveWaypoint(i, i + 1), i === waypoints.length - 1),
      mk('✕', 'Punkt entfernen', () => removeWaypoint(i))
    );

    li.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('dragover'); });
    li.addEventListener('dragleave', () => li.classList.remove('dragover'));
    li.addEventListener('drop', e => {
      e.preventDefault();
      li.classList.remove('dragover');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(from) && from !== i) moveWaypoint(from, i);
    });

    ol.appendChild(li);
  });

  map.renderWaypoints(waypoints);
  $('#btnRoute').disabled = waypoints.length < 2;
}

/* --------------------------- Routenberechnung --------------------- */

function currentTune() {
  const preset = R.PRESETS[S.profile] || R.PRESETS.natur;
  if (!preset.custom) return null;
  return S.tune ? { ...preset.tune, ...S.tune } : { ...preset.tune };
}

async function computeRoute({ alternatives = true } = {}) {
  if (waypoints.length < 2) { toast('Mindestens Start und Ziel setzen'); return; }

  if (routeAbort) routeAbort.abort();
  routeAbort = new AbortController();
  const signal = routeAbort.signal;

  busy(true);
  $('#routeWarn').hidden = true;

  try {
    const resolved = await R.resolveProfile({
      server: S.server,
      profileKey: S.profile,
      tune: currentTune(),
      overrideText: S.profileOverride
    });
    lastProfileHash = resolved.hash || null;

    const want = alternatives ? [0, 1, 2] : [0];
    const results = [];

    for (const idx of want) {
      try {
        const r = await R.route({
          server: S.server, waypoints,
          profileName: resolved.name, alternativeIdx: idx, signal
        });
        // Varianten, die sich kaum unterscheiden, bringen nichts.
        if (!results.some(x => Math.abs(x.route.length - r.length) < r.length * 0.012)) {
          results.push({ idx, route: r });
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (idx === 0) {
          if (err.profileGone) {
            R.invalidateProfile(resolved.hash);
            toast('Profil war abgelaufen – bitte noch einmal berechnen.');
            return;
          }
          throw err;
        }
        // Fehlende Alternativen sind normal und kein Grund zur Sorge.
      }
    }

    if (!results.length) throw new Error('Keine Route gefunden');

    routes = results;
    activeIdx = 0;
    showRoute(0, { fit: true });
    updateProfileState();
    S.lastWaypoints = waypoints;
    persist();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    toast(err.message || 'Route konnte nicht berechnet werden', 6000);
    clearRouteDisplay();
  } finally {
    busy(false);
  }
}

function activeRoute() { return routes[activeIdx] ? routes[activeIdx].route : null; }

function showRoute(i, { fit = false } = {}) {
  activeIdx = i;
  const r = activeRoute();
  if (!r) return;

  map.showRoute(r.coords, r.beeline, r.ferry);
  map.showAlternatives(routes.filter((_, k) => k !== i).map(x => x.route.coords));
  if (fit) map.fit(r.coords);

  renderSummary(r);
  renderAlternatives();
  const ok = elev.setRoute(r.coords);
  $('#elevWrap').hidden = !ok;

  $('#btnNavStart').disabled = false;
  $('#btnSaveRoute').disabled = false;
  $('#btnExport').disabled = false;
}

function renderSummary(r) {
  const eta = r.duration ? new Date(Date.now() + r.duration * 1000) : null;
  const box = $('#routeSummary');
  box.hidden = false;
  box.innerHTML = `
    <div><b>${fmtKm(r.length)}</b><span>Strecke</span></div>
    <div><b>${fmtDuration(r.duration)}</b><span>Fahrzeit</span></div>
    <div><b>${r.ascend} m</b><span>bergauf</span></div>
    <div><b>${r.descend} m</b><span>bergab</span></div>
    ${eta ? `<div><b>${fmtClock(eta)}</b><span>Ankunft</span></div>` : ''}`;

  renderQuality(r);
}

/**
 * Was die Route tatsächlich geworden ist. Ohne diese Rückmeldung
 * weiß man nie, ob das Profil gegriffen hat oder ob es im Gelände
 * einfach keine stille Alternative gab.
 */
function renderQuality(r) {
  const q = r.quality;
  const warn = $('#routeWarn');
  if (!q) { warn.hidden = true; return; }

  const notes = [];

  // Zuerst das, wonach gefragt wurde: wie viel läuft auf
  // ausgeschilderten Radrouten.
  notes.push(`<b>${q.onRoutePct} % auf ausgeschilderten Radrouten</b>` +
             (q.officialPct ? ` · ${q.officialPct} % Radweg oder Fahrradstraße` : '') +
             (q.offRoutePct ? ` · ${q.offRoutePct} % sonstige Wege` : ''));

  let first = `${q.pavedPct} % befestigt` +
              (q.ridableMeters && q.ridableMeters < r.length - 100
                ? ` (vom gefahrenen Teil, ${fmtKm(q.ridableMeters)})` : '');
  if (q.measuredNature) first += ` · ${q.naturePct} % durch Wald und Grün`;
  if (q.townPct != null) first += ` · ${q.townPct} % durch Ortslage`;
  notes.push(first);

  // Rundtour: wurde ein Stück zweimal gefahren? Das sieht man der
  // Länge nicht an, und es ist das Erste, was auf einer Runde stört.
  const rund = r.coords && r.coords.length > 3 &&
               dist(r.coords[0], r.coords[r.coords.length - 1]) < 150;
  if (rund) {
    const d = overlapStats(r.coords);
    if (d.laengste >= 600) {
      notes.push(`⚠ ${fmtDistShort(d.laengste)} am Stück zweimal gefahren ` +
                 `(${d.anteil} % der Runde) – andere Richtung oder Länge versuchen`);
    } else {
      notes.push('Runde ohne nennenswerte Wiederholung');
    }
  }

  if (!q.measuredNature) {
    notes.push('Dieses Profil bewertet Lärm und Natur nicht – für die Angaben „Radrouten-Naturroute“ wählen.');
  }
  if (q.onRoutePct < 50) {
    notes.push(`⚠ Nur ${q.onRoutePct} % auf ausgeschilderten Radrouten – hier gibt es offenbar kein durchgehendes Netz`);
  }
  if (q.mainroadPct >= 8) {
    notes.push(`⚠ ${q.mainroadPct} % auf Haupt- oder Landstraße (${fmtKm(q.mainroadMeters)})`);
  }
  // Der Wunsch war: Begleitradwege höchstens als Stück unter einem
  // Kilometer. Das lässt sich im Kostenmodell nicht erzwingen, aber
  // an der fertigen Route nachmessen.
  if (q.sidepathLongest != null && q.sidepathLongest >= 1000) {
    notes.push(`⚠ Längstes Stück Radweg an einer lauten Straße: ${fmtKm(q.sidepathLongest)}` +
               (q.sidepathLongRuns > 1 ? ` (${q.sidepathLongRuns} Stücke über 1 km)` : '') +
               ' – Regler „Radwege an Autostraßen meiden“ höher stellen');
  } else if (q.sidepathLongest > 0) {
    notes.push(`Begleitradwege: längstes Stück ${fmtDistShort(q.sidepathLongest)} – unter einem Kilometer`);
  }
  if (q.loudPct != null && q.loudPct >= 20) {
    notes.push(`⚠ ${q.loudPct} % in Straßenlärm – hier gibt es offenbar keine ruhige Verbindung`);
  }
  // Luftlinie: zuerst nennen, das ist der gröbste Mangel einer Route.
  // Nicht nur "da stimmt was nicht", sondern welcher Punkt es ist und
  // wie weit er daneben liegt – sonst sucht man sich tot.
  const abseits = punkteAbseitsDerWege(r);
  if (q.beelineMeters >= 50) {
    const anteil = Math.round(100 * q.beelineMeters / r.length);
    let text = `⚠ <b>${fmtKm(q.beelineMeters)} davon Luftlinie</b> (${anteil} %) – ` +
               `dort kennt die Karte keinen Weg. Grau gepunktet auf der Karte.`;
    if (abseits.length) {
      text += '<br>Diese Punkte liegen abseits jedes Weges: ' + abseits.map(a =>
        `<b>${a.marke}</b> „${a.name}“ (${fmtDistShort(a.abstand)} bis zur nächsten ` +
        `befahrbaren Stelle dieser Route)`).join(', ');
      text += ' <button type="button" id="btnFangPunkte" class="minibtn">' +
              'Punkte dorthin ziehen</button>';
    }
    notes.push(text);
  }

  // Fähren sind erlaubt – ein Rheinübergang ist Gold wert. Eine
  // Schiffspassage quer über eine Bucht ist etwas anderes, und sie sah
  // auf der Karte aus wie eine Radstrecke.
  if (q.ferryMeters >= 200) {
    notes.push(`⚠ <b>${fmtKm(q.ferryMeters)} mit der Fähre</b> (${q.ferryPct} % der Strecke) – ` +
               `blau gestrichelt. Unter „Feinabstimmung“ lassen sich Fähren abschalten.`);
  }
  if (q.unpavedPct >= 12) {
    const woher = q.unknownSurfacePct >= 5
      ? ` (davon ${q.unknownSurfacePct} % Feld- und Waldwege ohne Belagsangabe)` : '';
    notes.push(`⚠ ${q.unpavedPct} % nicht asphaltiert${woher} – ` +
               `Regler „Asphalt statt Schotter“ höher stellen`);
  }

  warn.hidden = false;
  warn.innerHTML = notes.map(n => `<div>${n}</div>`).join('');

  const knopf = $('#btnFangPunkte');
  if (knopf) knopf.addEventListener('click', () => fangePunkteEin(abseits));
}

/**
 * Welche Streckenpunkte liegen abseits des Wegenetzes?
 *
 * Gemessen wird gegen die Punkte der Route, die wirklich aus einem Weg
 * stammen – die Luftlinienstücke selbst zählen nicht mit. Was dabei
 * herauskommt, ist zugleich die Rettung: der nächstgelegene Punkt, auf
 * dem man tatsächlich fahren kann.
 */
function punkteAbseitsDerWege(r, grenze = 150) {
  if (!r.segments || !r.segments.length || !r.coords) return [];

  // Luftlinien und Fähren ausblenden. Eine Fähre ist zwar eine echte
  // Verbindung, aber kein Ort, an den man einen Streckenpunkt schiebt –
  // sonst landet der Punkt wieder im Wasser.
  const aus = new Array(r.coords.length).fill(false);
  for (const bereiche of [r.beeline, r.ferry]) {
    for (const [von, bis] of (bereiche || [])) {
      for (let i = von; i <= bis && i < aus.length; i++) aus[i] = true;
    }
  }
  const echt = [];
  for (let i = 0; i < r.coords.length; i++) if (!aus[i]) echt.push(r.coords[i]);
  if (!echt.length) return [];

  const marke = i => i === 0 ? 'S' : i === waypoints.length - 1 ? 'Z' : String(i);
  const out = [];
  waypoints.forEach((wp, i) => {
    let best = Infinity, ziel = null;
    for (const c of echt) {
      const d = dist([wp.lon, wp.lat], c);
      if (d < best) { best = d; ziel = c; }
    }
    if (best > grenze) {
      out.push({ i, marke: marke(i), name: wp.name || 'ohne Namen',
                 abstand: Math.round(best), ziel });
    }
  });
  return out;
}

/**
 * Die genannten Punkte auf die nächste befahrbare Stelle schieben.
 *
 * "Nächste befahrbare Stelle" heißt: der nächste Punkt *dieser Route*,
 * der auf einem Weg liegt – nicht der nächste Weg überhaupt. Das kann
 * weit sein; deshalb steht der Abstand vorher im Hinweis und hinterher
 * noch einmal in der Meldung.
 */
async function fangePunkteEin(liste) {
  if (!liste || !liste.length) return;
  const bewegt = [];
  for (const a of liste) {
    if (!waypoints[a.i] || !a.ziel) continue;
    waypoints[a.i] = { ...waypoints[a.i], lat: a.ziel[1], lon: a.ziel[0], name: null };
    bewegt.push(`${a.marke} um ${fmtDistShort(a.abstand)}`);
  }
  if (!bewegt.length) return;
  renderWaypoints();
  for (const a of liste) nameWaypoint(a.i);
  toast('Verschoben: ' + bewegt.join(', '), 5000);
  await computeRoute();
}

function renderAlternatives() {
  const bar = $('#altBar');
  if (routes.length < 2) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  routes.forEach((x, k) => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(k === activeIdx));
    b.innerHTML = `<span>${k === 0 ? 'Beste' : 'Variante ' + k}</span>` +
                  `<small>${fmtKm(x.route.length)} · ${x.route.ascend} hm</small>`;
    b.onclick = () => showRoute(k);
    bar.appendChild(b);
  });
}

function clearRouteDisplay() {
  routes = [];
  map.clearRoute();
  $('#routeSummary').hidden = true;
  $('#elevWrap').hidden = true;
  $('#altBar').hidden = true;
  $('#routeWarn').hidden = true;
  $('#btnNavStart').disabled = true;
  $('#btnSaveRoute').disabled = true;
  $('#btnExport').disabled = true;
}

/* --------------------------- Rundtouren --------------------------- */

/*
 * BRouter kennt keine Rundtouren. Man muss ihm Zwischenziele vorgeben.
 *
 * Entscheidend ist, wo diese Punkte liegen. Legt man sie sternförmig um
 * den Start, führen der erste und der letzte Schenkel radial hinein und
 * hinaus – meist über dieselbe Straße. Genau das ist das Umkehren, das
 * nicht vorkommen soll.
 *
 * Deshalb liegt der Start hier nicht in der Mitte, sondern selbst auf
 * dem Kreis: der Kreismittelpunkt ist um den Radius in Fahrtrichtung
 * verschoben, und die Zwischenziele verteilen sich gleichmäßig darauf.
 * Die Tour ist damit ein Vieleck, das durch den Start läuft, und hat
 * keinen Schenkel, der zweimal benutzt werden müsste.
 */

/** Umfang eines einbeschriebenen Vielecks: 2·k·r·sin(π/k), mal Wegfaktor. */
const WEGFAKTOR = 1.35;           // echte Wege sind kurviger als die Sehne
// Ecken des Vielecks, in der Reihenfolge des Ausprobierens. Das Viereck
// lief in der Messung am saubersten, das Sechseck am zweitbesten.
const FORMEN = [4, 6, 5];
const formFaktor = k => 2 * k * Math.sin(Math.PI / k) * WEGFAKTOR;

/** Ab hier gilt ein Stück als "zurückgefahren" und die Tour als untauglich. */
const MAX_DOPPELT = 600;          // Meter am Stück

/** Wie weit unter der Wunschlänge darf es höchstens liegen? */
const MIN_ANTEIL = 0.8;

const HIMMEL = ['Norden', 'Nordosten', 'Osten', 'Südosten',
                'Süden', 'Südwesten', 'Westen', 'Nordwesten'];

async function roundtrips() {
  const start = waypoints[0];
  if (!start) { toast('Zuerst einen Startpunkt setzen'); return; }

  const km = Math.max(5, Math.min(250, Number($('#rtLen').value) || 40));
  const chosen = Number($('#rtDir').value);
  const dirs = chosen >= 0 ? [chosen] : [35, 125, 215, 305];

  const box = $('#rtResults');
  box.innerHTML = '<div class="muted small">Suche läuft …</div>';
  busy(true);

  try {
    // Genau die Feinabstimmung, die auch für jede andere Route gilt.
    // Hier wird nichts zusätzlich verstellt – wer die Regler kennt,
    // soll die Rundtour daran wiedererkennen.
    const resolved = await R.resolveProfile({
      server: S.server, profileKey: S.profile,
      tune: currentTune(), overrideText: S.profileOverride
    });

    const target = km * 1000;
    let anfragen = 0;
    const MAX_ANFRAGEN = 18;

    /** Vieleck durch den Start; Mittelpunkt um r in Richtung dir versetzt. */
    const ring = (radius, dir, k) => {
      const mitte = destination([start.lon, start.lat], radius, dir);
      const abMitte = (dir + 180) % 360;
      const pts = [start];
      for (let i = 1; i < k; i++) {
        pts.push(latlonOf(destination(mitte, radius, abMitte + i * 360 / k)));
      }
      pts.push(start);
      return pts;
    };

    /** Eine Punktfolge rechnen lassen und vermessen. */
    const fahre = async (pts, dir, k, radius) => {
      if (anfragen >= MAX_ANFRAGEN) return null;
      anfragen++;
      // Die Suche rechnet mehrere Runden durch; ohne Rückmeldung sieht
      // das nach einer hängenden App aus.
      box.innerHTML = `<div class="muted small">Suche läuft – ${anfragen}. Runde …</div>`;
      let r = null;
      for (let n = 0; n < 2 && !r; n++) {
        try {
          r = await R.route({ server: S.server, waypoints: pts,
                              profileName: resolved.name, alternativeIdx: 0 });
        } catch (e) {
          if (n === 0) await warte(900); else return null;
        }
      }
      if (!r) return null;
      await warte(350);           // brouter.de mag keine Salven
      return { dir, k, radius, route: r, waypoints: pts,
               doppelt: overlapStats(r.coords) };
    };

    const versuch = (radius, dir, k) => fahre(ring(radius, dir, k), dir, k, radius);

    /**
     * Eine Stichfahrt kommt fast immer von einem einzelnen Zwischenziel,
     * das in einer Sackgasse gelandet ist: man fährt hin und denselben
     * Weg zurück. Den Übeltäter findet man an der Stelle, wo das doppelt
     * gefahrene Stück liegt – und schiebt ihn seitwärts auf dem Kreis.
     */
    const ruecke = async (c, schritt) => {
      const stelle = c.doppelt.stelle;
      if (stelle < 0 || c.waypoints.length < 4) return null;
      const pos = c.route.coords[stelle];

      let schuld = 1, nah = Infinity;
      for (let i = 1; i < c.waypoints.length - 1; i++) {
        const d = dist(pos, [c.waypoints[i].lon, c.waypoints[i].lat]);
        if (d < nah) { nah = d; schuld = i; }
      }

      const mitte = destination([start.lon, start.lat], c.radius, c.dir);
      const abMitte = (c.dir + 180) % 360;
      const pts = c.waypoints.slice();
      pts[schuld] = latlonOf(destination(
        mitte, c.radius * 0.93, abMitte + schuld * 360 / c.k + schritt));
      return fahre(pts, c.dir, c.k, c.radius);
    };

    const kandidaten = [];
    for (const dir of dirs) {
      let bester = null;

      for (const k of FORMEN) {
        let radius = target / formFaktor(k);
        let c = await versuch(radius, dir, k);
        if (!c) continue;

        // Nach unten abrunden: lieber etwas kürzer als zu lang.
        for (let n = 0; n < 2 && c.route.length > target; n++) {
          radius *= (target / c.route.length) * 0.97;
          const enger = await versuch(radius, dir, k);
          if (!enger) break;
          c = enger;
        }

        // Stichfahrt? Den schuldigen Punkt einmal nach links, einmal
        // nach rechts verschieben und nehmen, was besser wird.
        if (c.doppelt.laengste > MAX_DOPPELT) {
          const weite = 360 / c.k / 3;
          for (const schritt of [weite, -weite]) {
            const neu = await ruecke(c, schritt);
            if (neu && besser(neu, c, target)) { c = neu; }
            if (c.doppelt.laengste <= MAX_DOPPELT) break;
          }
        }

        if (!bester || besser(c, bester, target)) bester = c;
        if (c.doppelt.laengste <= MAX_DOPPELT && c.route.length <= target) break;
        if (anfragen >= MAX_ANFRAGEN) break;
      }
      if (bester) kandidaten.push(bester);
      if (anfragen >= MAX_ANFRAGEN) break;
    }

    if (!kandidaten.length) {
      box.innerHTML = '<div class="muted small">Keine Rundtour gefunden. ' +
        'Andere Länge oder Richtung versuchen.</div>';
      return;
    }

    kandidaten.sort((a, b) =>
      besser(a, b, target) ? -1 : besser(b, a, target) ? 1 : 0);
    renderRoundtrips(box, kandidaten, target);
  } catch (err) {
    box.innerHTML = '';
    toast(err.message || 'Rundtouren fehlgeschlagen', 5000);
  } finally {
    busy(false);
  }
}

const warte = ms => new Promise(r => setTimeout(r, ms));

/**
 * Ist a besser als b? In dieser Reihenfolge:
 * 1. ohne Luftlinie – eine Runde übers Wasser ist keine Runde
 * 2. ohne längeres doppelt gefahrenes Stück
 * 3. nicht länger als gewünscht  (abrunden, nicht aufrunden)
 * 4. näher an der Wunschlänge von unten
 * 5. weniger Ortslage
 */
function besser(a, b, target) {
  // Ein Ring um den Start kann Ecken im Wasser oder im Nichts haben.
  // BRouter verbindet die dann schnurgerade oder über eine Fährlinie.
  // Beides ist keine Runde, die man fährt – solche Vorschläge fliegen
  // zuerst raus, egal wie gut ihre Länge passt.
  const nassM = c => {
    const q = (c.route && c.route.quality) || {};
    return (q.beelineMeters || 0) + (q.ferryMeters || 0);
  };
  const trocken = c => nassM(c) < 100;
  if (trocken(a) !== trocken(b)) return trocken(a);

  const sauber = c => c.doppelt.laengste <= MAX_DOPPELT;
  if (sauber(a) !== sauber(b)) return sauber(a);

  const passt = c => c.route.length <= target;
  if (passt(a) !== passt(b)) return passt(a);

  if (passt(a)) {
    const d = a.route.length - b.route.length;      // beide ≤ target: länger ist besser
    if (Math.abs(d) > 200) return d > 0;
  } else {
    const d = a.route.length - b.route.length;      // beide zu lang: kürzer ist besser
    if (Math.abs(d) > 200) return d < 0;
  }

  const ort = c => (c.route.quality && c.route.quality.townPct) || 0;
  if (ort(a) !== ort(b)) return ort(a) < ort(b);
  return a.doppelt.meter < b.doppelt.meter;
}

function renderRoundtrips(box, kandidaten, target) {
  box.innerHTML = '';

  const bester = kandidaten[0];
  if (bester.route.length < target * MIN_ANTEIL) {
    box.insertAdjacentHTML('beforeend',
      `<div class="muted small">Mehr als ${fmtKm(bester.route.length)} ` +
      `gibt das Wegenetz hier ohne Umkehren nicht her.</div>`);
  }

  for (const f of kandidaten) {
    const b = document.createElement('button');
    const himmel = HIMMEL[Math.round(f.dir / 45) % 8];
    const q = f.route.quality;
    const teile = [`${f.route.ascend} hm bergauf`];
    if (q && q.townPct != null) teile.push(`${q.townPct} % Ortslage`);
    if (f.doppelt.laengste > MAX_DOPPELT) {
      teile.push(`<span class="rtwarn">${fmtDistShort(f.doppelt.laengste)} am Stück doppelt</span>`);
    } else if (f.doppelt.meter > 0) {
      teile.push(`nur ${fmtDistShort(f.doppelt.laengste)} doppelt`);
    } else {
      teile.push('nichts doppelt');
    }
    b.innerHTML = `<b>${fmtKm(f.route.length)}</b> Richtung ${himmel} · ${teile.join(' · ')}`;
    b.onclick = () => {
      waypoints = f.waypoints.map(p => ({ lat: p.lat, lon: p.lon, name: p.name || null }));
      routes = [{ idx: 0, route: f.route }];
      renderWaypoints();
      showRoute(0, { fit: true });
      waypoints.forEach((_, i) => nameWaypoint(i));
      toast('Rundtour übernommen – Punkte lassen sich jetzt verschieben');
    };
    box.appendChild(b);
  }
}

const latlonOf = ([lon, lat]) => ({ lat, lon });

/* --------------------------- Adresssuche -------------------------- */

let searchTimer = null;
let searchAbort = null;

function bindSearch() {
  const input = $('#search');
  const list = $('#searchResults');

  const hide = () => { list.hidden = true; list.innerHTML = ''; };

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { hide(); return; }
    searchTimer = setTimeout(() => runSearch(q), 420);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      const first = list.querySelector('li');
      if (first) first.click();
      else runSearch(input.value.trim());
    } else if (e.key === 'Escape') hide();
  });

  $('#searchClear').onclick = () => { input.value = ''; hide(); input.focus(); };

  document.addEventListener('click', e => {
    if (!e.target.closest('.topbar')) hide();
  });

  async function runSearch(q) {
    if (q.length < 2) return;
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    busy(true);
    try {
      const hits = await G.search(q, { near: map.center(), signal: searchAbort.signal });
      list.innerHTML = '';
      if (!hits.length) {
        list.innerHTML = '<li><b>Nichts gefunden</b><span>Anderen Begriff versuchen</span></li>';
        list.hidden = false;
        return;
      }
      for (const h of hits) {
        const li = document.createElement('li');
        li.innerHTML = `<b></b><span></span>`;
        li.firstChild.textContent = h.name;
        li.lastChild.textContent = h.detail || '';
        li.onclick = () => {
          hide();
          input.value = '';
          map.panTo(h.lat, h.lon, Math.max(14, map.getView().zoom));
          addWaypoint(h, { name: h.name, autoRoute: true });
          toast(waypoints.length === 1 ? `Start: ${h.name}` : `Ziel: ${h.name}`);
        };
        list.appendChild(li);
      }
      list.hidden = false;
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast(err.message || 'Suche fehlgeschlagen');
    } finally {
      busy(false);
    }
  }
}

/* ---------------------- Übernahme aus Naviki ---------------------- *
 *  Liegt neben der App ein Ordner naviki-export mit index.json, dann
 *  lassen sich die dort abgelegten GPX-Dateien in einem Rutsch
 *  übernehmen. Jeder Weg merkt sich seinen Dateinamen, damit ein
 *  zweiter Durchlauf nichts doppelt anlegt.
 * ------------------------------------------------------------------ */

let navikiIndex = null;

async function checkNavikiExport() {
  const row = $('#navikiRow');
  if (!row) return;
  if (navikiIndex === null) {
    try {
      const r = await fetch('naviki-export/index.json', { cache: 'no-store' });
      navikiIndex = r.ok ? await r.json() : false;
    } catch { navikiIndex = false; }
  }
  if (!navikiIndex || !Array.isArray(navikiIndex.dateien)) { row.hidden = true; return; }

  const schon = new Set(wegeCache.map(w => w.navikiFile).filter(Boolean));
  const offen = navikiIndex.dateien.filter(f => !schon.has(f));

  if (!offen.length) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  $('#btnNaviki').textContent = `${offen.length} Naviki-Wege übernehmen`;
  $('#navikiInfo').textContent = schon.size
    ? `${schon.size} schon übernommen`
    : `aus ${navikiIndex.quelle || 'Naviki'}`;
}

async function importNaviki() {
  if (!navikiIndex || !Array.isArray(navikiIndex.dateien)) return;
  const btn = $('#btnNaviki');
  const info = $('#navikiInfo');
  const schon = new Set(wegeCache.map(w => w.navikiFile).filter(Boolean));
  const offen = navikiIndex.dateien.filter(f => !schon.has(f));
  if (!offen.length) return;

  btn.disabled = true;
  let ok = 0, failed = 0;
  let stapel = [];

  for (let i = 0; i < offen.length; i++) {
    const file = offen[i];
    try {
      const r = await fetch('naviki-export/' + encodeURIComponent(file), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      const base = file.replace(/^\d+_/, '').replace(/\.gpx$/i, '');
      for (const w of parseGPX(text, base)) {
        w.id = newId();
        w.navikiFile = file;
        w.source = 'Naviki';
        stapel.push(w);
        ok++;
      }
    } catch {
      failed++;
    }

    // In Portionen schreiben: ein einziger Riesen-Schreibvorgang
    // blockiert die Oberfläche spürbar.
    if (stapel.length >= 25) { await putWege(stapel); stapel = []; }
    info.textContent = `${i + 1} von ${offen.length}…`;
  }
  if (stapel.length) await putWege(stapel);

  await refreshWege();
  btn.disabled = false;
  toast(failed
    ? `${ok} Wege aus Naviki übernommen, ${failed} fehlgeschlagen`
    : `${ok} Wege aus Naviki übernommen`, 5000);
}

/* --------------------------- Meine Wege --------------------------- */

async function refreshWege() {
  wegeCache = await allWege();
  renderWege();
  checkNavikiExport();
}

function renderWege() {
  const ul = $('#wegeList');
  const q = $('#wegeFilter').value.trim().toLowerCase();
  const sort = $('#wegeSort').value;

  let list = wegeCache.filter(w => !q || (w.name || '').toLowerCase().includes(q));
  list.sort((a, b) =>
    sort === 'name' ? (a.name || '').localeCompare(b.name || '', 'de')
    : sort === 'len' ? (b.length || 0) - (a.length || 0)
    : (b.created || 0) - (a.created || 0));

  const total = wegeCache.reduce((s, w) => s + (w.length || 0), 0);
  $('#wegeStats').textContent = wegeCache.length
    ? `${wegeCache.length} Wege · ${fmtKm(total)} insgesamt`
    : 'Noch keine Wege. GPX-Dateien importieren oder eine berechnete Route speichern.';

  ul.innerHTML = '';
  for (const w of list) {
    const li = document.createElement('li');
    if (map.hasWeg(w.id)) li.classList.add('active');

    const name = document.createElement('div');
    name.className = 'w-name';
    name.textContent = w.name || 'Ohne Namen';

    const meta = document.createElement('div');
    meta.className = 'w-meta';
    const kindLabel = { planned: 'geplant', imported: 'importiert', recorded: 'aufgezeichnet' }[w.kind] || w.kind;
    const when = w.created ? new Date(w.created).toLocaleDateString('de-DE') : '';
    meta.innerHTML = `<span class="w-tag">${kindLabel}</span> ${fmtKm(w.length)}` +
      (w.ascend ? ` · ${w.ascend} hm` : '') +
      (w.duration ? ` · ${fmtDuration(w.duration)}` : '') +
      (when ? ` · ${when}` : '');

    const acts = document.createElement('div');
    acts.className = 'w-acts';

    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
      b.onclick = fn;
      return b;
    };

    acts.append(
      mk(map.hasWeg(w.id) ? '◉' : '◎', 'Auf der Karte zeigen', () => {
        if (map.hasWeg(w.id)) map.hideWeg(w.id);
        else { map.showWeg(w.id, w.coords); map.fit(w.coords); }
        renderWege();
      }),
      mk('▶', 'Diesen Weg navigieren', () => navigateWeg(w)),
      mk('⇢', 'In die Planung übernehmen und neu rechnen', () => loadWegIntoPlan(w)),
      mk('✎', 'Umbenennen', async () => {
        const n = prompt('Neuer Name:', w.name || '');
        if (n == null) return;
        await renameWeg(w.id, n.trim() || w.name);
        await refreshWege();
      }),
      mk('↓', 'Als GPX speichern', () => downloadGPX(w, w.name)),
      mk('🗑', 'Löschen', async () => {
        if (!confirm(`„${w.name}“ wirklich löschen?`)) return;
        map.hideWeg(w.id);
        await deleteWeg(w.id);
        await refreshWege();
        toast('Weg gelöscht');
      })
    );

    li.append(name, meta, acts);
    ul.appendChild(li);
  }
}

/** Gespeicherten Weg in die Planung holen. */
function loadWegIntoPlan(w) {
  if (w.waypoints && w.waypoints.length >= 2) {
    waypoints = w.waypoints.map(p => ({ lat: p.lat, lon: p.lon, name: p.name || null }));
  } else if (w.fileWaypoints && w.fileWaypoints.length >= 2) {
    waypoints = w.fileWaypoints.map(p => ({ lat: p.lat, lon: p.lon, name: p.name || null }));
  } else {
    // Aus der Linie ein paar Stützpunkte ableiten.
    const c = w.coords;
    const n = Math.min(6, Math.max(2, Math.round(w.length / 15000) + 1));
    waypoints = [];
    for (let k = 0; k < n; k++) {
      const p = c[Math.round((c.length - 1) * k / (n - 1))];
      waypoints.push({ lat: p[1], lon: p[0], name: null });
    }
  }
  renderWaypoints();
  waypoints.forEach((_, i) => nameWaypoint(i));
  switchTab('plan');
  toast('Punkte übernommen – „Route berechnen“ rechnet mit deinem Profil neu');
}

/** Gespeicherten Weg direkt navigieren, ohne neu zu rechnen. */
function navigateWeg(w) {
  if (!w.coords || w.coords.length < 2) { toast('Dieser Weg hat keine Strecke'); return; }
  const route = R.parseRoute({
    features: [{
      geometry: { coordinates: w.coords },
      properties: { 'track-length': w.length, 'filtered ascend': w.ascend, 'total-time': w.duration }
    }]
  });
  routes = [{ idx: 0, route }];
  switchTab('plan');
  showRoute(0, { fit: true });
  toast('Für Abbiegehinweise diesen Weg über „Route berechnen“ neu rechnen lassen', 5500);
  startNavigation();
}

async function importFiles(files) {
  if (!files || !files.length) return;
  busy(true);
  let ok = 0, failed = [];
  const added = [];
  for (const f of files) {
    try {
      const wege = await parseFile(f);
      for (const w of wege) { w.id = newId(); added.push(w); ok++; }
    } catch (e) {
      failed.push(`${f.name}: ${e.message}`);
    }
  }
  if (added.length) await putWege(added);
  await refreshWege();
  busy(false);

  if (ok && !failed.length) toast(`${ok} ${ok === 1 ? 'Weg' : 'Wege'} importiert`);
  else if (ok) toast(`${ok} importiert, ${failed.length} fehlgeschlagen: ${failed[0]}`, 6000);
  else toast('Import fehlgeschlagen: ' + (failed[0] || 'unbekannter Fehler'), 6000);

  if (added.length === 1) {
    map.showWeg(added[0].id, added[0].coords);
    map.fit(added[0].coords);
    renderWege();
  }
}

async function saveCurrentRoute() {
  const r = activeRoute();
  if (!r) return;
  const suggestion = (waypoints[0]?.name || 'Start') + ' – ' + (waypoints[waypoints.length - 1]?.name || 'Ziel');
  const name = prompt('Name für diese Route:', suggestion);
  if (name == null) return;
  await putWeg({
    id: newId(),
    name: name.trim() || suggestion,
    kind: 'planned',
    coords: r.coords,
    waypoints: waypoints.map(w => ({ lat: w.lat, lon: w.lon, name: w.name })),
    length: r.length, ascend: r.ascend, descend: r.descend, duration: r.duration,
    profile: S.profile,
    source: 'RadNavi'
  });
  await refreshWege();
  toast('Route gespeichert');
}

/* --------------------------- Aufzeichnung ------------------------- */

function toggleRecording() {
  const btn = $('#btnRecord');
  if (recorder && recorder.active) {
    const res = recorder.stop();
    recorder = null;
    btn.textContent = '● Fahrt aufzeichnen';
    btn.classList.remove('danger');
    if (!res) { toast('Zu kurz – nichts aufgezeichnet'); return; }
    const name = prompt('Name für die Aufzeichnung:',
      'Fahrt ' + new Date(res.startedAt).toLocaleString('de-DE'));
    if (name == null) return;
    putWeg({
      id: newId(), name: name.trim() || 'Fahrt', kind: 'recorded',
      coords: res.coords, length: res.length, duration: res.duration,
      startedAt: res.startedAt, source: 'Aufzeichnung'
    }).then(refreshWege).then(() => toast(`Aufgezeichnet: ${fmtKm(res.length)}`));
  } else {
    recorder = new Recorder({
      onUpdate: s => { btn.textContent = `■ ${fmtKm(s.length)} · ${fmtDuration(s.seconds)}`; }
    });
    recorder.start();
    btn.classList.add('danger');
    btn.textContent = '■ Aufzeichnung läuft';
    toast('Aufzeichnung gestartet');
  }
}

/* --------------------------- Navigation --------------------------- */

function startNavigation() {
  const r = activeRoute();
  if (!r) { toast('Zuerst eine Route berechnen'); return; }

  document.body.classList.add('navigating');
  $('#navView').hidden = false;
  map.invalidate();

  voice.enabled = S.voice;
  $('#btnNavVoice').setAttribute('aria-pressed', String(S.voice));

  nav = new Navigator({
    route: r, voice, settings: S,
    onUpdate: renderNavState,
    onOffRoute: onOffRoute,
    onArrive: () => toast('Ziel erreicht.', 6000),
    onError: msg => toast(msg, 5000)
  });
  nav.start();
}

function stopNavigation() {
  if (nav) { nav.stop(); nav = null; }
  document.body.classList.remove('navigating');
  $('#navView').hidden = true;
  map.invalidate();
}

function renderNavState(st) {
  const r = activeRoute();
  $('#ckSpeed').textContent = st.speedKmh != null ? st.speedKmh.toFixed(0) : '–';
  $('#ckRest').textContent = (st.remaining / 1000).toFixed(1).replace('.', ',');
  $('#ckAvg').textContent = st.avgKmh != null ? st.avgKmh.toFixed(0) : '–';
  $('#ckEta').textContent = st.etaSec != null
    ? fmtClock(new Date(Date.now() + st.etaSec * 1000)) : '–';

  if (st.arrived) {
    $('#navArrow').textContent = '⚑';
    $('#navDist').textContent = 'Ziel';
    $('#navWhat').textContent = 'Du bist angekommen';
    $('#navStreet').textContent = '';
  } else if (!st.onRoute) {
    $('#navArrow').textContent = '⚑';
    $('#navDist').textContent = fmtDistShort(st.offBy);
    $('#navWhat').textContent = 'abseits der Route';
    $('#navStreet').textContent = S.reroute ? 'wird gleich neu berechnet' : '';
  } else if (st.next) {
    $('#navArrow').textContent = st.next.arrow;
    $('#navDist').textContent = fmtDistShort(st.nextDistance);
    $('#navWhat').textContent = st.next.text;
    $('#navStreet').textContent = st.segment
      ? [st.segment.type, st.segment.surface].filter(Boolean).join(', ') : '';
  } else {
    $('#navArrow').textContent = '↑';
    $('#navDist').textContent = fmtDistShort(st.remaining);
    $('#navWhat').textContent = 'weiter bis zum Ziel';
    $('#navStreet').textContent = st.segment
      ? [st.segment.type, st.segment.surface].filter(Boolean).join(', ') : '';
  }

  map.showMe(st.fix.lat, st.fix.lon, st.fix.accuracy, st.fix.heading);
  if (r) map.showProgress(r.coords, st.index);
  map.panTo(st.fix.lat, st.fix.lon);
}

let rerouting = false;
async function onOffRoute(fix) {
  if (rerouting) return;
  rerouting = true;
  try {
    // Von der jetzigen Position zu den noch offenen Zielen.
    const rest = remainingWaypoints(fix);
    if (rest.length < 2) return;
    const resolved = await R.resolveProfile({
      server: S.server, profileKey: S.profile,
      tune: currentTune(), overrideText: S.profileOverride
    });
    const r = await R.route({
      server: S.server, waypoints: rest,
      profileName: resolved.name, alternativeIdx: 0
    });
    routes = [{ idx: 0, route: r }];
    activeIdx = 0;
    map.showRoute(r.coords, r.beeline, r.ferry);
    renderSummary(r);
    elev.setRoute(r.coords);
    if (nav) nav.replaceRoute(r);
    toast('Route neu berechnet');
  } catch (err) {
    toast('Neuberechnung fehlgeschlagen: ' + (err.message || ''), 5000);
  } finally {
    rerouting = false;
  }
}

/** Aktuelle Position plus die Ziele, die noch vor uns liegen. */
function remainingWaypoints(fix) {
  const here = { lat: fix.lat, lon: fix.lon, name: 'Standort' };
  if (waypoints.length < 2) return [here];
  const r = activeRoute();
  if (!r) return [here, waypoints[waypoints.length - 1]];

  // Ein Zwischenziel gilt als erledigt, wenn wir schon daran vorbei sind.
  const passed = new Set();
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w = waypoints[i];
    if (dist([w.lon, w.lat], [fix.lon, fix.lat]) < 120) passed.add(i);
  }
  const rest = waypoints.filter((_, i) => i > 0 && !passed.has(i));
  return [here, ...rest];
}

/* --------------------------- Standort ----------------------------- */

async function locate({ quiet = false } = {}) {
  if (!quiet) busy(true);
  try {
    const p = await locateOnce();
    map.panTo(p.lat, p.lon, Math.max(14, map.getView().zoom));
    map.showMe(p.lat, p.lon, p.accuracy);
    return p;
  } catch (err) {
    if (!quiet) toast(err.message, 6000);
    return null;
  } finally {
    if (!quiet) busy(false);
  }
}

/* --------------------------- Kartenstil / Thema ------------------- */

function buildLayerMenu() {
  const box = $('#layerList');
  box.innerHTML = '';
  for (const [key, def] of Object.entries(BASE_LAYERS)) {
    const b = document.createElement('button');
    b.textContent = def.label;
    b.setAttribute('aria-pressed', String(key === S.layer));
    b.onclick = () => {
      S.layer = key; persist();
      map.setBase(key);
      buildLayerMenu();
    };
    box.appendChild(b);
  }
}

function applyTheme() {
  const dark = S.theme === 'dark' ||
    (S.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#11150f' : '#1b3a2a');
  $('#chkDark').checked = dark;
  elev.draw();
}

/* --------------------------- Offline-Kacheln ---------------------- */

function tilesForRoute(coords, zooms = [13, 14, 15]) {
  const set = new Set();
  const def = BASE_LAYERS[S.layer] || BASE_LAYERS.cyclosm;
  const subs = (def.opts.subdomains || '').split('');
  for (const z of zooms) {
    if (def.opts.maxNativeZoom && z > def.opts.maxNativeZoom) continue;
    const step = Math.max(1, Math.floor(coords.length / 1500));
    for (let i = 0; i < coords.length; i += step) {
      const [lon, lat] = coords[i];
      const n = 2 ** z;
      const xt = Math.floor((lon + 180) / 360 * n);
      const latRad = lat * Math.PI / 180;
      const yt = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = xt + dx, y = yt + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const s = subs.length ? subs[(x + y) % subs.length] : '';
          set.add(def.url.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y));
        }
      }
    }
  }
  return [...set];
}

async function cacheRouteTiles() {
  const r = activeRoute();
  if (!r) { toast('Zuerst eine Route berechnen'); return; }
  if (!('caches' in window)) { toast('Dieser Browser kann keine Karten vorhalten'); return; }

  const urls = tilesForRoute(r.coords);
  if (urls.length > 4000) {
    if (!confirm(`Das sind ${urls.length} Kartenkacheln. Das dauert und belegt Speicher. Fortfahren?`)) return;
  }

  busy(true);
  const info = $('#cacheInfo');
  const cache = await caches.open('radnavi-tiles');
  let done = 0, failed = 0;

  // In kleinen Gruppen, um die Kachelserver nicht zu überrennen.
  const batch = 6;
  for (let i = 0; i < urls.length; i += batch) {
    await Promise.all(urls.slice(i, i + batch).map(async u => {
      try {
        const hit = await cache.match(u);
        if (hit) { done++; return; }
        const res = await fetch(u, { mode: 'cors' });
        if (res.ok) { await cache.put(u, res.clone()); done++; }
        else failed++;
      } catch { failed++; }
    }));
    info.textContent = `${done} von ${urls.length} Kacheln geladen…`;
    await new Promise(r2 => setTimeout(r2, 60));
  }

  busy(false);
  info.textContent = `${done} Kacheln vorgehalten${failed ? `, ${failed} nicht erreichbar` : ''}.`;
  toast('Karte für diese Route ist offline verfügbar');
  updateCacheInfo();
}

async function updateCacheInfo() {
  const n = await tileCacheSize();
  if (n == null) return;
  const info = $('#cacheInfo');
  if (!info.textContent.includes('Kacheln geladen')) {
    info.textContent = n ? `${n} Kartenkacheln im Speicher.` : 'Noch keine Karten vorgehalten.';
  }
}

/* --------------------------- Einstellungen ------------------------ */

function applySettingsToUI() {
  $('#selProfile').value = S.profile;
  $('#optVoice').checked = S.voice;
  $('#optReroute').checked = S.reroute;
  $('#optWake').checked = S.wakeLock;
  $('#optRotate').checked = S.rotate;
  $('#optOffRoute').value = S.offRouteMeters;
  $('#optPrewarn').value = S.prewarnMeters;
  $('#optServer').value = S.server;
  $('#chkCycleOverlay').checked = S.cycleOverlay;
  $('#btnAddMode').setAttribute('aria-pressed', String(addMode));
  updateCacheInfo();
}

function applyTuneToUI(tune) {
  const box = $('#tuning');
  const preset = R.PRESETS[S.profile] || R.PRESETS.natur;
  box.style.display = preset.custom ? '' : 'none';
  if (!tune) return;

  const pairs = [
    ['route', '#sldRoute', '#outRoute'],
    ['noise', '#sldNoise', '#outNoise'], ['traffic', '#sldTraffic', '#outTraffic'],
    ['forest', '#sldForest', '#outForest'], ['river', '#sldRiver', '#outRiver'],
    ['town', '#sldTown', '#outTown'], ['sidepath', '#sldSide', '#outSide'],
    ['unpaved', '#sldUnpaved', '#outUnpaved'], ['hill', '#sldHill', '#outHill']
  ];
  for (const [key, sld, out] of pairs) {
    const el = $(sld);
    el.value = tune[key];
    $(out).textContent = key === 'hill' ? tune[key] : Number(tune[key]).toFixed(1).replace('.', ',');
  }
  $('#chkSteps').checked = !!tune.steps;
  $('#chkPaved').checked = tune.paved !== false;
  $('#chkFerry').checked = !!tune.ferry;
}

function readTuneFromUI() {
  return {
    route: Number($('#sldRoute').value),
    noise: Number($('#sldNoise').value), traffic: Number($('#sldTraffic').value),
    forest: Number($('#sldForest').value), river: Number($('#sldRiver').value),
    town: Number($('#sldTown').value), sidepath: Number($('#sldSide').value),
    unpaved: Number($('#sldUnpaved').value), hill: Number($('#sldHill').value),
    steps: $('#chkSteps').checked, paved: $('#chkPaved').checked,
    ferry: $('#chkFerry').checked
  };
}

function updateProfileState() {
  const preset = R.PRESETS[S.profile] || R.PRESETS.natur;
  const el = $('#profileState');
  if (!preset.custom) {
    el.textContent = `Serverprofil „${preset.server}“ – ohne eigene Feinabstimmung.`;
    return;
  }
  el.textContent = lastProfileHash
    ? `Eigenes Profil auf dem Server, Kennung ${lastProfileHash}.`
    : 'Eigenes Profil wird bei der nächsten Berechnung hochgeladen.';
}

/* --------------------------- Panel und Reiter --------------------- */

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  // Die Liste kann sich seit dem letzten Blick geändert haben.
  if (name === 'wege') refreshWege();
  if (name === 'opts') updateCacheInfo();
  if (document.body.classList.contains('sheet-collapsed')) {
    document.body.classList.remove('sheet-collapsed');
    map.invalidate();
  }
}

/* --------------------------- Verdrahtung -------------------------- */

function bindUI() {
  bindSearch();

  $('#btnLocate').onclick = () => locate();
  $('#btnLayers').onclick = () => {
    const m = $('#layerMenu');
    m.hidden = !m.hidden;
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#layerMenu') && !e.target.closest('#btnLayers')) $('#layerMenu').hidden = true;
  });
  $('#btnAddMode').onclick = e => {
    addMode = !addMode;
    e.currentTarget.setAttribute('aria-pressed', String(addMode));
    toast(addMode ? 'Tippen setzt jetzt Punkte' : 'Tippen verschiebt nur die Karte');
  };

  $('#chkCycleOverlay').onchange = e => {
    S.cycleOverlay = e.target.checked; persist();
    map.setCycleOverlay(S.cycleOverlay);
  };
  $('#chkDark').onchange = e => {
    S.theme = e.target.checked ? 'dark' : 'light'; persist();
    applyTheme();
  };
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });

  // ------- Reiter und Panel -------
  $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $('#sheetGrip').onclick = () => {
    document.body.classList.toggle('sheet-collapsed');
    map.invalidate();
  };

  // ------- Planung -------
  $('#btnAddWp').onclick = () => {
    const [lat, lon] = map.center();
    addWaypoint({ lat, lon }, { autoRoute: waypoints.length >= 1 });
  };
  $('#btnReverse').onclick = () => {
    waypoints.reverse();
    renderWaypoints();
    if (waypoints.length >= 2) computeRoute();
  };
  $('#btnClear').onclick = () => {
    waypoints = [];
    renderWaypoints();
    clearRouteDisplay();
    S.lastWaypoints = null; persist();
  };
  $('#btnRoute').onclick = () => computeRoute();
  $('#btnNavStart').onclick = () => startNavigation();
  $('#btnSaveRoute').onclick = () => saveCurrentRoute();
  $('#btnExport').onclick = () => {
    const r = activeRoute();
    if (!r) return;
    const name = (waypoints[0]?.name || 'Start') + ' bis ' + (waypoints[waypoints.length - 1]?.name || 'Ziel');
    downloadGPX({
      name, coords: r.coords, length: r.length, ascend: r.ascend,
      waypoints: waypoints.map(w => ({ lat: w.lat, lon: w.lon, name: w.name }))
    }, name);
  };

  $('#selProfile').onchange = e => {
    S.profile = e.target.value;
    S.tune = null;                      // Voreinstellungen des neuen Profils
    persist();
    applyTuneToUI(currentTune());
    updateProfileState();
    if (waypoints.length >= 2) computeRoute();
  };

  // Regler: erst beim Loslassen rechnen, sonst rechnet man sich wund.
  const sliders = ['#sldRoute', '#sldNoise', '#sldTraffic', '#sldForest', '#sldRiver',
                   '#sldTown', '#sldSide', '#sldUnpaved', '#sldHill'];
  for (const sel of sliders) {
    const el = $(sel);
    el.addEventListener('input', () => {
      S.tune = readTuneFromUI();
      applyTuneToUI({ ...currentTune(), ...S.tune });
    });
    el.addEventListener('change', () => {
      S.tune = readTuneFromUI(); persist();
      updateProfileState();
      if (waypoints.length >= 2) computeRoute();
    });
  }
  for (const sel of ['#chkSteps', '#chkPaved', '#chkFerry']) {
    $(sel).onchange = () => {
      S.tune = readTuneFromUI(); persist();
      if (waypoints.length >= 2) computeRoute();
    };
  }
  $('#btnResetTune').onclick = () => {
    S.tune = null; persist();
    applyTuneToUI(currentTune());
    if (waypoints.length >= 2) computeRoute();
  };

  $('#btnRoundtrip').onclick = () => roundtrips();

  // ------- Meine Wege -------
  $('#fileGpx').onchange = e => {
    importFiles(e.target.files);
    e.target.value = '';
  };
  $('#btnNaviki').onclick = () => importNaviki();

  $('#btnBildWahl').onclick = () => $('#fileBild').click();
  $('#fileBild').onchange = e => { bildWaehlen(e.target.files[0]); e.target.value = ''; };
  $('#btnBildWeg').onclick = async () => {
    await deleteStartbild();
    await renderBildZeile();
    toast('Eigenes Bild entfernt');
  };
  renderBildZeile();

  $('#btnRecord').onclick = () => toggleRecording();
  $('#wegeFilter').oninput = () => renderWege();
  $('#wegeSort').onchange = () => renderWege();

  // Dateien einfach auf das Fenster ziehen.
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      switchTab('wege');
      importFiles(e.dataTransfer.files);
    }
  });

  // ------- Einstellungen -------
  $('#optVoice').onchange = e => {
    S.voice = e.target.checked; persist();
    voice.enabled = S.voice;
    if (!S.voice) voice.shutUp();
  };
  $('#optReroute').onchange = e => { S.reroute = e.target.checked; persist(); };
  $('#optWake').onchange = e => { S.wakeLock = e.target.checked; persist(); };
  $('#optRotate').onchange = e => { S.rotate = e.target.checked; persist(); };
  $('#optOffRoute').onchange = e => {
    S.offRouteMeters = Math.max(20, Math.min(300, Number(e.target.value) || 60));
    e.target.value = S.offRouteMeters; persist();
  };
  $('#optPrewarn').onchange = e => {
    S.prewarnMeters = Math.max(50, Math.min(500, Number(e.target.value) || 150));
    e.target.value = S.prewarnMeters; persist();
  };
  $('#optServer').onchange = e => {
    S.server = e.target.value.trim().replace(/\/+$/, '') || defaultSettings.server;
    e.target.value = S.server; persist();
    toast('Routing-Server geändert – Profil wird neu hochgeladen');
  };

  $('#btnCacheRoute').onclick = () => cacheRouteTiles();
  $('#btnCacheClear').onclick = async () => {
    await clearTileCache();
    $('#cacheInfo').textContent = 'Kartenspeicher geleert.';
    toast('Kartenspeicher geleert');
  };
  $('#btnExportAll').onclick = () => {
    if (!wegeCache.length) { toast('Keine Wege vorhanden'); return; }
    downloadGPX(wegeCache, 'radnavi-alle-wege');
  };

  $('#btnProfileUpload').onclick = async () => {
    const text = $('#profileText').value;
    S.profileOverride = text; persist();
    R.setTemplate(text);
    toast('Profil übernommen');
    if (waypoints.length >= 2) computeRoute();
  };
  $('#btnProfileReset').onclick = async () => {
    S.profileOverride = null; persist();
    R.setTemplate(null);
    try {
      const res = await fetch('profiles/naturroute.brf', { cache: 'reload' });
      const tpl = await res.text();
      R.setTemplate(tpl);
      $('#profileText').value = tpl;
      toast('Originalprofil wiederhergestellt');
    } catch { toast('Original konnte nicht geladen werden'); }
  };

  // ------- Navigation -------
  $('#btnNavStop').onclick = () => stopNavigation();
  $('#btnNavVoice').onclick = e => {
    S.voice = !S.voice; persist();
    voice.enabled = S.voice;
    if (!S.voice) voice.shutUp();
    e.currentTarget.setAttribute('aria-pressed', String(S.voice));
    $('#optVoice').checked = S.voice;
  };

  // Tastatur am PC
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape' && nav) stopNavigation();
    if (e.key === '/' ) { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'r' && waypoints.length >= 2) computeRoute();
  });

  window.addEventListener('beforeunload', e => {
    if (recorder?.active) {
      e.preventDefault();
      e.returnValue = 'Die Aufzeichnung läuft noch.';
    }
  });
}

/* --------------------------- Service Worker ----------------------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;   // dort gibt es keinen
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Ohne Service Worker läuft alles, nur eben nicht offline.
  });
}

/* --------------------------- Los ---------------------------------- */

init().catch(err => {
  console.error(err);
  toast('Start fehlgeschlagen: ' + err.message, 8000);
});
