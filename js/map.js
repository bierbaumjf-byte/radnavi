/* ------------------------------------------------------------------ *
 *  map.js – Karte, Marken, Linien.
 *
 *  Kapselt Leaflet, damit der Rest der App nur noch von Wegpunkten
 *  und Koordinaten weiß.
 * ------------------------------------------------------------------ */

import { boundsOf } from './geo.js';

export const BASE_LAYERS = {
  // Dieselbe Karte, die Naviki unter "OpenStreetMap" anbietet:
  // die Standardkacheln von tile.openstreetmap.org.
  osm: {
    label: 'OpenStreetMap (wie Naviki)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 19, maxNativeZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
  },
  cyclosm: {
    label: 'Fahrradkarte (CyclOSM)',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 20, maxNativeZoom: 20,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.cyclosm.org/">CyclOSM</a>' }
  },
  topo: {
    label: 'Gelände (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 19, maxNativeZoom: 17,
            attribution: 'Kartendaten &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · Darstellung <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }
  },
  hot: {
    label: 'Kontrastreich',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    opts: { subdomains: 'ab', maxZoom: 20, maxNativeZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Humanitarian OSM Team' }
  },
  // Googles Satellitenbild. lyrs=y ist die Mischung aus Luftbild und
  // Beschriftung, die Google selbst "Hybrid" nennt – Orts- und Straßennamen
  // sind also schon im Bild und brauchen keine zweite Ebene.
  //
  // Diese Adresse ist von Google nicht für fremde Karten vorgesehen. Sie
  // kann jederzeit versiegen, und dann bleibt die Karte leer. Deshalb steht
  // das Esri-Luftbild darunter als Ausweichmöglichkeit.
  gsat: {
    label: 'Luftbild (Google)',
    url: 'https://mt{s}.google.com/vt/lyrs=y&hl=de&x={x}&y={y}&z={z}',
    opts: { subdomains: '0123', maxZoom: 21, maxNativeZoom: 20,
            attribution: 'Luftbild &copy; Google' }
  },
  // Luftbild von Esri – frei nutzbar, wenn die Herkunft dabeisteht.
  // In Deutschland oft dieselben Befliegungen wie bei Google.
  sat: {
    label: 'Luftbild (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 20, maxNativeZoom: 19,
            attribution: 'Luftbild &copy; Esri, Maxar, Earthstar Geographics, GIS-Community' }
  }
};

/**
 * Beschriftungen fürs Esri-Luftbild. Ein Satellitenbild ohne Namen ist zum
 * Hinsehen schön und zum Zurechtfinden unbrauchbar – deshalb legt sich
 * über das Luftbild eine durchsichtige Ebene mit Orten und Straßen.
 * Googles Hybrid-Kachel bringt ihre Beschriftung schon mit.
 */
const LABEL_OVERLAY = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  opts: { maxZoom: 20, maxNativeZoom: 19, attribution: 'Beschriftung &copy; Esri' }
};

const CYCLE_OVERLAY = {
  url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
  opts: { maxZoom: 18, maxNativeZoom: 18, opacity: 0.75,
          attribution: '<a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>' }
};

export class MapView {
  constructor(elId, { onMapClick, onWaypointMoved, onWaypointClick } = {}) {
    this.onMapClick = onMapClick;
    this.onWaypointMoved = onWaypointMoved;
    this.onWaypointClick = onWaypointClick;

    this.map = L.map(elId, {
      zoomControl: false,
      attributionControl: true,
      tap: true,
      doubleClickZoom: false,
      worldCopyJump: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    this.baseKey = null;
    this.baseLayer = null;
    this.overlay = null;
    this.labels = null;

    this.wpMarkers = [];
    this.routeLine = null;
    this.routeCasing = null;
    this.altLines = [];
    this.beelineLines = [];
    this.wegLines = new Map();
    this.meMarker = null;
    this.meAccuracy = null;
    this.hoverMarker = null;
    this.progressLine = null;

    this.map.on('click', e => {
      if (this.onMapClick) this.onMapClick(e.latlng.lat, e.latlng.lng);
    });
  }

  /* ---------------------------- Kartenstil ------------------------ */

  setBase(key) {
    if (key === this.baseKey) return;
    const def = BASE_LAYERS[key] || BASE_LAYERS.osm;
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);
    // crossOrigin nur, wo der Server es auch erlaubt. Wo nicht, lädt das
    // Bild zwar – aber als undurchsichtige Antwort, die sich nicht
    // offline vorhalten lässt. Siehe das Feld im Kartenverzeichnis.
    const opts = { ...def.opts };
    if (def.crossOrigin !== false) opts.crossOrigin = true;
    this.baseLayer = L.tileLayer(def.url, opts).addTo(this.map);
    this.baseLayer.setZIndex(1);
    this.baseKey = key;
    this.setLabels(key === 'sat');
  }

  /** Ortsnamen über dem Luftbild – nur dort, sonst stören sie. */
  setLabels(on) {
    if (on && !this.labels) {
      this.labels = L.tileLayer(LABEL_OVERLAY.url, { ...LABEL_OVERLAY.opts, crossOrigin: true })
        .addTo(this.map);
      this.labels.setZIndex(2);
    } else if (!on && this.labels) {
      this.map.removeLayer(this.labels);
      this.labels = null;
    }
  }

  setCycleOverlay(on) {
    if (on && !this.overlay) {
      this.overlay = L.tileLayer(CYCLE_OVERLAY.url, CYCLE_OVERLAY.opts).addTo(this.map);
      this.overlay.setZIndex(3);
    } else if (!on && this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
  }

  /* ----------------------------- Ansicht -------------------------- */

  setView(lat, lon, zoom) { this.map.setView([lat, lon], zoom); }
  getView() {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng, zoom: this.map.getZoom() };
  }
  center() {
    const c = this.map.getCenter();
    return [c.lat, c.lng];
  }
  fit(coords, padding = 0.14) {
    if (!coords || !coords.length) return;
    this.map.fitBounds(boundsOf(coords), { padding: [30, 30], maxZoom: 16 });
  }
  panTo(lat, lon, zoom) {
    this.map.setView([lat, lon], zoom || this.map.getZoom(), { animate: true });
  }
  invalidate() { setTimeout(() => this.map.invalidateSize(), 230); }

  /* --------------------------- Streckenpunkte --------------------- */

  renderWaypoints(waypoints) {
    this.wpMarkers.forEach(m => this.map.removeLayer(m));
    this.wpMarkers = [];

    waypoints.forEach((wp, i) => {
      if (wp.lat == null || wp.lon == null) return;
      const last = i === waypoints.length - 1;
      const cls = i === 0 ? 'start' : (last && waypoints.length > 1 ? 'end' : '');
      const label = i === 0 ? 'S' : (last && waypoints.length > 1 ? 'Z' : String(i));

      const icon = L.divIcon({
        className: '',
        html: `<div class="wp-marker ${cls}">${label}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13]
      });

      const m = L.marker([wp.lat, wp.lon], { icon, draggable: true, autoPan: true,
                                             keyboard: false, zIndexOffset: 400 });
      m.addTo(this.map);
      m.bindTooltip(wp.name || label, { direction: 'top', offset: [0, -14] });

      m.on('dragend', () => {
        const p = m.getLatLng();
        if (this.onWaypointMoved) this.onWaypointMoved(i, p.lat, p.lng);
      });
      m.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        if (this.onWaypointClick) this.onWaypointClick(i);
      });

      this.wpMarkers.push(m);
    });
  }

  /* ------------------------------ Route --------------------------- */

  /**
   * @param coords    [[lon, lat], …]
   * @param luftlinie Index-Bereiche [[von, bis], …], die nicht aus dem
   *                  Wegenetz stammen. Die werden grau gestrichelt
   *                  darübergelegt – eine Luftlinie soll nicht aussehen
   *                  wie eine Strecke, die man fahren kann.
   * @param faehre    Ebenso für Fährstrecken, in Blau.
   */
  showRoute(coords, luftlinie = [], faehre = []) {
    this.clearRoute();
    if (!coords || coords.length < 2) return;
    const latlngs = coords.map(c => [c[1], c[0]]);
    this.routeCasing = L.polyline(latlngs, {
      color: '#ffffff', weight: 9, opacity: 0.85, lineJoin: 'round', lineCap: 'round'
    }).addTo(this.map);
    this.routeLine = L.polyline(latlngs, {
      color: getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#e00f1c',
      weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round'
    }).addTo(this.map);
    // Linien liegen alle im selben Leaflet-Pane; die Reihenfolge
    // ergibt sich aus dem Hinzufügen, erst Kontur, dann Route.

    // Erst das Rot wegnehmen, dann die gestrichelte Linie darauf. Ohne
    // das Weiß darunter blitzt die rote Route durch die Lücken, und es
    // sieht aus wie eine Strecke, die man fahren kann.
    const streifen = (bereiche, stil) => {
      for (const [von, bis] of bereiche) {
        const teil = latlngs.slice(von, bis + 1);
        if (teil.length < 2) continue;
        this.beelineLines.push(L.polyline(teil, {
          color: '#ffffff', weight: 7, opacity: 1, lineJoin: 'round', lineCap: 'round'
        }).addTo(this.map));
        this.beelineLines.push(L.polyline(teil, stil).addTo(this.map));
      }
    };
    streifen(faehre,    { color: '#1f6fb2', weight: 5, opacity: 0.95,
                          dashArray: '14 8', lineCap: 'butt' });
    streifen(luftlinie, { color: '#6b7680', weight: 5, opacity: 0.95,
                          dashArray: '2 10', lineCap: 'round' });
  }

  clearRoute() {
    for (const l of [this.routeLine, this.routeCasing, this.progressLine]) {
      if (l) this.map.removeLayer(l);
    }
    this.routeLine = this.routeCasing = this.progressLine = null;
    this.beelineLines.forEach(l => this.map.removeLayer(l));
    this.beelineLines = [];
    this.clearAlternatives();
  }

  showAlternatives(list) {
    this.clearAlternatives();
    for (const coords of list) {
      if (!coords || coords.length < 2) continue;
      const l = L.polyline(coords.map(c => [c[1], c[0]]), {
        color: getComputedStyle(document.documentElement).getPropertyValue('--route-alt').trim() || '#9aa7b4',
        weight: 4, opacity: 0.7, dashArray: '7 7', lineJoin: 'round'
      }).addTo(this.map);
      this.altLines.push(l);
    }
  }

  clearAlternatives() {
    this.altLines.forEach(l => this.map.removeLayer(l));
    this.altLines = [];
  }

  /** Bereits gefahrener Teil, während der Navigation. */
  showProgress(coords, uptoIndex) {
    if (this.progressLine) { this.map.removeLayer(this.progressLine); this.progressLine = null; }
    if (!coords || uptoIndex < 1) return;
    this.progressLine = L.polyline(coords.slice(0, uptoIndex + 1).map(c => [c[1], c[0]]), {
      color: '#8e9aa6', weight: 5, opacity: 0.9, lineJoin: 'round'
    }).addTo(this.map);
  }

  /* -------------------------- Gespeicherte Wege ------------------- */

  showWeg(id, coords, color = '#8a5fd0') {
    this.hideWeg(id);
    if (!coords || coords.length < 2) return;
    const l = L.polyline(coords.map(c => [c[1], c[0]]), {
      color, weight: 4, opacity: 0.85, lineJoin: 'round'
    }).addTo(this.map);
    this.wegLines.set(id, l);
  }

  hideWeg(id) {
    const l = this.wegLines.get(id);
    if (l) { this.map.removeLayer(l); this.wegLines.delete(id); }
  }

  hideAllWege() {
    for (const id of [...this.wegLines.keys()]) this.hideWeg(id);
  }

  hasWeg(id) { return this.wegLines.has(id); }

  /* --------------------------- Eigener Standort ------------------- */

  showMe(lat, lon, accuracy, heading) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="me-marker${heading != null ? ' heading' : ''}"${
        heading != null ? ` style="transform:rotate(${heading}deg)"` : ''}></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    if (!this.meMarker) {
      this.meMarker = L.marker([lat, lon], { icon, interactive: false, zIndexOffset: 500 }).addTo(this.map);
    } else {
      this.meMarker.setLatLng([lat, lon]);
      this.meMarker.setIcon(icon);
    }
    if (accuracy != null && accuracy > 12) {
      if (!this.meAccuracy) {
        this.meAccuracy = L.circle([lat, lon], { radius: accuracy, color: '#1f6feb',
          weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }).addTo(this.map);
      } else {
        this.meAccuracy.setLatLng([lat, lon]);
        this.meAccuracy.setRadius(accuracy);
      }
    } else if (this.meAccuracy) {
      this.map.removeLayer(this.meAccuracy); this.meAccuracy = null;
    }
  }

  /** Punkt auf der Route beim Überfahren des Höhenprofils. */
  showHover(lat, lon) {
    if (!this.hoverMarker) {
      this.hoverMarker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2,
        fillColor: '#1f6feb', fillOpacity: 1, interactive: false }).addTo(this.map);
    } else {
      this.hoverMarker.setLatLng([lat, lon]);
      if (!this.map.hasLayer(this.hoverMarker)) this.hoverMarker.addTo(this.map);
    }
  }

  hideHover() {
    if (this.hoverMarker && this.map.hasLayer(this.hoverMarker)) this.map.removeLayer(this.hoverMarker);
  }
}
