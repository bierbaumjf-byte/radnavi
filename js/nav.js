/* ------------------------------------------------------------------ *
 *  nav.js – Navigation und Aufzeichnung.
 *
 *  Zwei getrennte Dinge, die dieselbe GPS-Quelle nutzen:
 *  Navigator  – folgt einer berechneten Route, sagt Abbiegungen an
 *               und merkt, wenn man sie verlassen hat.
 *  Recorder   – schreibt mit, wo man wirklich gefahren ist.
 * ------------------------------------------------------------------ */

import { dist, locateOnLine, bearing, bearingDelta, fmtDistShort } from './geo.js';

/* --------------------------- GPS-Quelle --------------------------- */

/**
 * Eine Positionsquelle, die mehrere Abnehmer versorgt. Zwei parallele
 * watchPosition-Aufrufe kosten doppelt Strom, deshalb nur einer.
 */
class GeoSource {
  constructor() {
    this.watchId = null;
    this.listeners = new Set();
    this.last = null;
  }

  add(fn) {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    this.start();
    return () => this.remove(fn);
  }

  remove(fn) {
    this.listeners.delete(fn);
    if (!this.listeners.size) this.stop();
  }

  start() {
    if (this.watchId != null || !navigator.geolocation) return;
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        const fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,            // m/s oder null
          heading: pos.coords.heading,        // Grad oder null
          altitude: pos.coords.altitude,
          at: pos.timestamp || Date.now()
        };
        this.last = fix;
        this.listeners.forEach(fn => { try { fn(fix); } catch (e) { console.error(e); } });
      },
      err => {
        this.listeners.forEach(fn => { try { fn(null, err); } catch (e) { console.error(e); } });
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  stop() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

export const geoSource = new GeoSource();

/** Einmalige Standortbestimmung. */
export function locateOnce({ timeout = 15000, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Dieses Gerät liefert keinen Standort'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(geoErrorText(e))),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 8000 }
    );
  });
}

export function geoErrorText(err) {
  if (!err) return 'Standort nicht verfügbar';
  switch (err.code) {
    case 1: return 'Zugriff auf den Standort wurde abgelehnt. In den Browser-Einstellungen für diese Seite erlauben.';
    case 2: return 'Standort nicht ermittelbar – kein GPS-Empfang?';
    case 3: return 'Standortbestimmung hat zu lange gedauert.';
    default: return err.message || 'Standort nicht verfügbar';
  }
}

/* ---------------------------- Sprachausgabe ----------------------- */

export class Voice {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.ready = false;
    if ('speechSynthesis' in window) {
      const pick = () => {
        const list = speechSynthesis.getVoices();
        this.voice = list.find(v => /^de[-_]DE/i.test(v.lang)) ||
                     list.find(v => /^de/i.test(v.lang)) || null;
        this.ready = list.length > 0;
      };
      pick();
      speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  get available() { return 'speechSynthesis' in window; }

  say(text, { force = false } = {}) {
    if (!this.enabled && !force) return;
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      speechSynthesis.speak(u);
    } catch { /* stumm weiter */ }
  }

  shutUp() {
    try { speechSynthesis.cancel(); } catch { /* ignorieren */ }
  }
}

/* ------------------------------ Navigator ------------------------- */

/**
 * Begleitet eine Route. Meldet über `onUpdate` fortlaufend den Zustand
 * und über `onOffRoute` den Wunsch nach einer neuen Berechnung.
 */
export class Navigator {
  constructor({ route, voice, settings, onUpdate, onOffRoute, onArrive, onError }) {
    this.route = route;
    this.voice = voice || new Voice();
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.onOffRoute = onOffRoute;
    this.onArrive = onArrive;
    this.onError = onError;

    this.unsub = null;
    this.wakeLock = null;

    this.segIndex = 0;
    this.along = 0;
    this.offSince = null;
    this.announced = new Map();   // Hinweis-Index -> letzte Stufe
    this.startedAt = Date.now();
    this.distanceRidden = 0;
    this.lastFix = null;
    this.arrived = false;
    this.speedSmooth = null;
  }

  async start() {
    this.startedAt = Date.now();
    if (this.settings.wakeLock) await this.acquireWakeLock();
    this.unsub = geoSource.add((fix, err) => {
      if (err) { if (this.onError) this.onError(geoErrorText(err)); return; }
      if (fix) this.handle(fix);
    });
    this.voice.say('Navigation gestartet.');
  }

  stop() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.releaseWakeLock();
    this.voice.shutUp();
  }

  /** Nach einer Neuberechnung dieselbe Fahrt mit neuer Route weiterführen. */
  replaceRoute(route) {
    this.route = route;
    this.segIndex = 0;
    this.along = 0;
    this.announced.clear();
    this.offSince = null;
    this.arrived = false;
  }

  async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      }
    } catch { /* nicht überall erlaubt */ }
  }

  releaseWakeLock() {
    try { if (this.wakeLock) this.wakeLock.release(); } catch { /* ignorieren */ }
    this.wakeLock = null;
  }

  handle(fix) {
    const r = this.route;
    if (!r || !r.coords || r.coords.length < 2) return;

    const p = [fix.lon, fix.lat];

    // Gefahrene Strecke mitzählen, aber Ausreißer aussortieren.
    if (this.lastFix) {
      const d = dist([this.lastFix.lon, this.lastFix.lat], p);
      const dt = (fix.at - this.lastFix.at) / 1000;
      if (d > 2 && d < 400 && dt > 0 && d / dt < 30) this.distanceRidden += d;
    }
    this.lastFix = fix;

    // Position auf der Route: erst im Fenster vorwärts suchen, bei
    // großem Abstand noch einmal über die ganze Linie.
    let loc = locateOnLine(p, r.coords, r.cum, this.segIndex, 120);
    if (loc.dist > 80) {
      const full = locateOnLine(p, r.coords, r.cum);
      if (full.dist < loc.dist) loc = full;
    }
    this.segIndex = loc.index;
    this.along = loc.along;

    const remaining = Math.max(0, r.length - loc.along);

    // Ankunft
    const toEnd = dist(p, r.coords[r.coords.length - 1]);
    if (!this.arrived && (toEnd < 35 || remaining < 25)) {
      this.arrived = true;
      this.voice.say('Du bist am Ziel.');
      if (this.onArrive) this.onArrive();
    }

    // Abweichung
    const limit = Number(this.settings.offRouteMeters) || 60;
    const tolerance = limit + Math.min(40, (fix.accuracy || 0));
    if (loc.dist > tolerance) {
      if (this.offSince == null) this.offSince = fix.at;
      else if (fix.at - this.offSince > 12000 && !this.arrived) {
        this.offSince = null;
        if (this.settings.reroute && this.onOffRoute) {
          this.voice.say('Route wird neu berechnet.');
          this.onOffRoute(fix);
        } else {
          this.voice.say('Du bist von der Route abgekommen.');
        }
      }
    } else {
      this.offSince = null;
    }

    // Nächster Abbiegehinweis
    const next = this.nextHint(loc.along);
    if (next && !this.arrived) this.announce(next, fix);

    // Geschwindigkeit glätten – der rohe GPS-Wert springt zu stark.
    let kmh = null;
    if (fix.speed != null && fix.speed >= 0) kmh = fix.speed * 3.6;
    if (kmh != null) {
      this.speedSmooth = this.speedSmooth == null ? kmh : this.speedSmooth * 0.7 + kmh * 0.3;
    }

    const avgKmh = this.distanceRidden > 300
      ? (this.distanceRidden / 1000) / ((Date.now() - this.startedAt) / 3600000)
      : null;

    // Restzeit: lieber aus dem Routingmodell als aus Wunschdenken.
    let etaSec = null;
    if (r.times && r.times.length === r.coords.length) {
      const doneSec = r.times[Math.min(this.segIndex, r.times.length - 1)];
      const totalSec = r.times[r.times.length - 1];
      etaSec = Math.max(0, totalSec - doneSec);
    } else if (r.duration) {
      etaSec = Math.max(0, r.duration * (remaining / Math.max(1, r.length)));
    }

    if (this.onUpdate) {
      this.onUpdate({
        fix,
        onRoute: loc.dist <= tolerance,
        offBy: Math.round(loc.dist),
        index: loc.index,
        along: loc.along,
        remaining,
        next,
        nextDistance: next ? Math.max(0, next.along - loc.along) : null,
        speedKmh: this.speedSmooth,
        avgKmh,
        etaSec,
        arrived: this.arrived,
        segment: this.segmentAt(loc.along)
      });
    }
  }

  nextHint(along) {
    const hints = this.route.hints || [];
    for (const h of hints) {
      if (h.along > along + 8) return h;
    }
    return null;
  }

  segmentAt(along) {
    const segs = this.route.segments || [];
    for (const s of segs) {
      if (along >= s.along && along < s.along + s.length) return s;
    }
    return segs.length ? segs[segs.length - 1] : null;
  }

  /**
   * Ansagen in zwei Stufen: Vorwarnung und direkt davor. Jede Stufe
   * nur einmal je Abbiegung – nichts ist lästiger als eine App, die
   * sich wiederholt.
   */
  announce(hint, fix) {
    const d = hint.along - this.along;
    if (d < 0) return;

    const pre = Number(this.settings.prewarnMeters) || 150;
    const speed = Math.max(3, (this.speedSmooth || 18)) / 3.6;   // m/s
    const nearDist = Math.max(25, Math.min(90, speed * 5));

    const stage = d <= nearDist ? 2 : (d <= pre ? 1 : 0);
    if (stage === 0) return;

    const done = this.announced.get(hint.index) || 0;
    if (stage <= done) return;
    this.announced.set(hint.index, stage);

    if (hint.cmd === 1 && stage === 1) return;   // "geradeaus" braucht keine Vorwarnung

    if (stage === 1) {
      this.voice.say(`In ${fmtDistShort(Math.round(d / 10) * 10)} ${hint.say}.`);
    } else {
      this.voice.say(`Jetzt ${hint.say}.`);
    }
  }
}

/* ------------------------------ Recorder -------------------------- */

/** Zeichnet die gefahrene Strecke auf. */
export class Recorder {
  constructor({ onUpdate } = {}) {
    this.onUpdate = onUpdate;
    this.coords = [];
    this.times = [];
    this.unsub = null;
    this.startedAt = null;
    this.length = 0;
    this.paused = false;
  }

  get active() { return this.unsub != null; }

  start() {
    if (this.unsub) return;
    this.startedAt = Date.now();
    this.unsub = geoSource.add((fix, err) => {
      if (err || !fix || this.paused) return;
      // Punkte mit schlechter Genauigkeit verfälschen die Länge.
      if (fix.accuracy != null && fix.accuracy > 50) return;
      const p = fix.altitude != null && !Number.isNaN(fix.altitude)
        ? [fix.lon, fix.lat, Math.round(fix.altitude * 10) / 10]
        : [fix.lon, fix.lat];
      const prev = this.coords[this.coords.length - 1];
      if (prev) {
        const d = dist(prev, p);
        if (d < 4) return;                 // Stillstand nicht aufzeichnen
        if (d > 500) return;               // Sprung verwerfen
        this.length += d;
      }
      this.coords.push(p);
      this.times.push(fix.at);
      if (this.onUpdate) this.onUpdate({
        points: this.coords.length,
        length: this.length,
        seconds: Math.round((Date.now() - this.startedAt) / 1000)
      });
    });
  }

  stop() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    return this.result();
  }

  result() {
    if (this.coords.length < 2) return null;
    return {
      coords: this.coords.slice(),
      times: this.times.slice(),
      length: Math.round(this.length),
      startedAt: this.startedAt,
      duration: Math.round((this.times[this.times.length - 1] - this.times[0]) / 1000)
    };
  }

  reset() {
    this.coords = []; this.times = []; this.length = 0; this.startedAt = null;
  }
}

export { bearing, bearingDelta };
