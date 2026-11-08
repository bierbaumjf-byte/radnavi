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
  }
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

    this.wpMarkers = [];
    this.routeLine = null;
    this.routeCasing = null;
    this.altLines = [];
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
    this.baseLayer = L.tileLayer(def.url, { ...def.opts, crossOrigin: true }).addTo(this.map);
    this.baseLayer.setZIndex(1);
    this.baseKey = key;
  }

  setCycleOverlay(on) {
    if (on && !this.overlay) {
      this.overlay = L.tileLayer(CYCLE_OVERLAY.url, CYCLE_OVERLAY.opts).addTo(this.map);
      this.overlay.setZIndex(2);
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

  showRoute(coords) {
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
  }

  clearRoute() {
    for (const l of [this.routeLine, this.routeCasing, this.progressLine]) {
      if (l) this.map.removeLayer(l);
    }
    this.routeLine = this.routeCasing = this.progressLine = null;
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
