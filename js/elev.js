/* ------------------------------------------------------------------ *
 *  elev.js – Höhenprofil als Canvas.
 *
 *  Keine Diagrammbibliothek: ein Flächenzug, zwei Achsenbeschriftungen
 *  und ein Fadenkreuz beim Überfahren. Das ist alles, was ein
 *  Höhenprofil braucht, und es funktioniert offline.
 * ------------------------------------------------------------------ */

import { simplify, cumulative } from './geo.js';

export class ElevationChart {
  constructor(canvas, { onHover, onLeave } = {}) {
    this.canvas = canvas;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.data = null;
    this.hoverX = null;

    canvas.addEventListener('pointermove', e => this.pointer(e));
    canvas.addEventListener('pointerdown', e => this.pointer(e));
    canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.draw();
      if (this.onLeave) this.onLeave();
    });

    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas);
  }

  /** @param coords [[lon,lat,ele], …] */
  setRoute(coords) {
    if (!coords || coords.length < 2) { this.data = null; this.draw(); return false; }

    const withEle = coords.filter(c => c[2] != null && !Number.isNaN(c[2]));
    if (withEle.length < coords.length * 0.5) { this.data = null; this.draw(); return false; }

    // Für die Darstellung reichen ein paar hundert Punkte.
    const pts = coords.length > 900 ? simplify(coords, 12) : coords.slice();
    const cum = cumulative(pts);
    const eles = pts.map(c => (c[2] == null || Number.isNaN(c[2])) ? null : c[2]);

    // Lücken linear schließen, damit die Fläche nicht zerfällt.
    // Gegen das Original gerechnet, nicht gegen schon gefüllte Werte.
    const src = eles.slice();
    for (let i = 0; i < eles.length; i++) {
      if (src[i] != null) continue;
      let a = i - 1; while (a >= 0 && src[a] == null) a--;
      let b = i + 1; while (b < src.length && src[b] == null) b++;
      const va = a >= 0 ? src[a] : (b < src.length ? src[b] : 0);
      const vb = b < src.length ? src[b] : va;
      eles[i] = b - a > 0 ? va + (vb - va) * ((i - a) / (b - a)) : va;
    }

    const valid = eles.filter(e => e != null);
    this.data = {
      coords: pts, cum, eles,
      total: cum[cum.length - 1],
      min: Math.min(...valid), max: Math.max(...valid)
    };
    this.draw();
    return true;
  }

  pointer(e) {
    if (!this.data) return;
    const r = this.canvas.getBoundingClientRect();
    this.hoverX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    this.draw();
    if (this.onHover) {
      const d = this.data;
      const target = this.hoverX * d.total;
      let i = 0;
      while (i < d.cum.length - 1 && d.cum[i + 1] < target) i++;
      this.onHover({
        lat: d.coords[i][1], lon: d.coords[i][0],
        ele: Math.round(d.eles[i]),
        along: target,
        xFraction: this.hoverX
      });
    }
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    const h = cv.clientHeight || 110;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#2f6b4a';
    const line = css.getPropertyValue('--line').trim() || '#d6d3c8';
    const dim = css.getPropertyValue('--text-dim').trim() || '#5d665f';

    if (!this.data) {
      g.fillStyle = dim;
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Kein Höhenprofil verfügbar', w / 2, h / 2 + 4);
      return;
    }

    const d = this.data;
    const padL = 34, padR = 8, padT = 10, padB = 16;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);

    // Höhenachse mit etwas Luft, mindestens 40 m Spanne.
    let lo = d.min, hi = d.max;
    if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;

    const x = frac => padL + frac * plotW;
    const y = ele => padT + plotH - ((ele - lo) / (hi - lo)) * plotH;

    // Gitter
    g.strokeStyle = line; g.lineWidth = 1; g.fillStyle = dim;
    g.font = '10px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let k = 0; k <= 2; k++) {
      const ele = lo + (hi - lo) * (k / 2);
      const yy = Math.round(y(ele)) + 0.5;
      g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - padR, yy); g.stroke();
      g.fillText(Math.round(ele) + ' m', padL - 5, yy);
    }

    // Fläche
    g.beginPath();
    g.moveTo(x(0), padT + plotH);
    for (let i = 0; i < d.cum.length; i++) g.lineTo(x(d.cum[i] / d.total), y(d.eles[i]));
    g.lineTo(x(1), padT + plotH);
    g.closePath();
    const grad = g.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexA(accent, 0.38));
    grad.addColorStop(1, hexA(accent, 0.05));
    g.fillStyle = grad;
    g.fill();

    // Linie
    g.beginPath();
    for (let i = 0; i < d.cum.length; i++) {
      const px = x(d.cum[i] / d.total), py = y(d.eles[i]);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.strokeStyle = accent; g.lineWidth = 1.8; g.lineJoin = 'round';
    g.stroke();

    // Längenachse
    g.fillStyle = dim; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const km = d.total / 1000;
    g.fillText('0', x(0), h - 4);
    g.fillText(km.toFixed(km < 20 ? 1 : 0).replace('.', ',') + ' km', x(1) - 12, h - 4);

    // Fadenkreuz
    if (this.hoverX != null) {
      const xx = Math.round(x(this.hoverX)) + 0.5;
      g.strokeStyle = accent; g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(xx, padT); g.lineTo(xx, padT + plotH); g.stroke();
      g.setLineDash([]);
    }
  }
}

function hexA(hex, a) {
  const h = hex.replace('#', '').trim();
  if (h.length < 3) return `rgba(47,107,74,${a})`;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
