// Display list and pen. Everything the drawings contain ends up as a few
// primitive items in drawing coordinates (model mm, or paper mm on a sheet):
//   L  polyline   {k:'L', pts, closed, layer, color?, lw?}
//   C  circle     {k:'C', c, r, layer, color?}
//   T  text       {k:'T', s, p, h, align, rot, layer, color?}
//   F  solid fill {k:'F', rings, layer, color?}
// Hatches and dimensions are exploded into lines and texts, so the screen,
// PDF and DXF renderers only need these four.

import { BIG, C, gf, inter, parts, pointsOf, polygonsOf, exterior, interiors, isEmpty } from './geo.js';
import { textEm, CAP, DESC } from './font.js';

// layer: [ACI colour, linetype, lineweight 1/100 mm]  (same as the Python tool)
export const LAYERS = {
  'A-WALL': [8, 'CONTINUOUS', 50],
  'A-HATCH': [8, 'CONTINUOUS', 9],
  'A-SLAB': [8, 'CONTINUOUS', 35],
  'S-TREAD': [7, 'CONTINUOUS', 35],
  'S-RISER': [7, 'DASH20', 18],
  'S-STRINGER': [4, 'DASH20', 18],
  'S-STRINGER-V': [4, 'CONTINUOUS', 35],
  'S-JOIST': [6, 'DASH20', 18],
  'S-NEWEL': [7, 'CONTINUOUS', 50],
  'S-GUARD': [5, 'CONTINUOUS', 25],
  'S-RAIL': [5, 'CONTINUOUS', 18],
  'S-WALKLINE': [1, 'DASHDOT20', 25],
  'S-CHECK': [1, 'CONTINUOUS', 35],
  'S-HELP': [9, 'DASH20', 13],
  'S-TEXT': [7, 'CONTINUOUS', 18],
  'S-DIMS': [7, 'CONTINUOUS', 13],
  'X-FRAME': [7, 'CONTINUOUS', 50],
  'X-TITLE': [7, 'CONTINUOUS', 25],
  'S-PART': [7, 'CONTINUOUS', 35],
  'S-OPENING': [30, 'DASHDOT20', 25],
  'T-CUT': [7, 'CONTINUOUS', 35],
  'T-MARK': [3, 'DASH1', 18],
  'T-AXIS': [1, 'DASHDOT1', 18],
  'T-TEXT': [7, 'CONTINUOUS', 18],
};

// dash patterns in drawing units (positive = dash, negative = gap, 0 = dot)
export const LINETYPES = {
  CONTINUOUS: null,
  DASH20: [60, -30],
  DASHDOT20: [130, -30, 0, -40],
  DASH1: [6, -3],
  DASHDOT1: [13, -3, 0, -4],
};

// AutoCAD colour index -> RGB (the ones the drawings use)
export const ACI = {
  1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255], 5: [0, 0, 255], 6: [255, 0, 255],
  7: [255, 255, 255], 8: [128, 128, 128], 9: [192, 192, 192], 30: [255, 127, 0], 94: [0, 127, 0],
};

// text box relative to the alignment point, in units of h (text height = cap height)
const ASC = 1, DSC = DESC / CAP;
export function textWidth(s, h) {
  return (textEm(s) * h) / CAP;
}
// baseline-left start point of an aligned text
export function textOrigin(t) {
  const w = textWidth(t.s, t.h);
  const a = (t.rot * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const ha = t.align[1], va = t.align[0];
  const dx = ha === 'L' ? 0 : ha === 'C' ? -w / 2 : -w;
  const dy = va === 'B' ? DSC * t.h : va === 'M' ? -t.h / 2 : va === 'T' ? -t.h : 0;
  return [t.p[0] + ux * dx + nx * dy, t.p[1] + uy * dx + ny * dy];
}
export function textCorners(t) {
  const w = textWidth(t.s, t.h);
  const [ox, oy] = textOrigin(t);
  const a = (t.rot * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const out = [];
  for (const [x, y] of [[0, -DSC * t.h], [w, -DSC * t.h], [w, ASC * t.h], [0, ASC * t.h]]) {
    out.push([ox + ux * x + nx * y, oy + uy * x + ny * y]);
  }
  return out;
}

export function fmtDim(v) {
  const x = Math.round(v * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export class Drawing {
  constructor() {
    this.items = [];
  }
  bbox() {
    return itemsBBox(this.items);
  }
}

export function itemsBBox(items) {
  const b = [BIG, BIG, -BIG, -BIG];
  const add = (x, y) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  };
  for (const it of items) {
    if (it.k === 'L') for (const q of it.pts) add(q[0], q[1]);
    else if (it.k === 'C') { add(it.c[0] - it.r, it.c[1] - it.r); add(it.c[0] + it.r, it.c[1] + it.r); }
    else if (it.k === 'T') for (const q of textCorners(it)) add(q[0], q[1]);
    else if (it.k === 'F') for (const r of it.rings) for (const q of r) add(q[0], q[1]);
  }
  return b;
}

export class Pen {
  // Draws canonical-plan or local coordinates into a display list with an
  // offset and an optional mirror (left-turn stairs).
  constructor(dl, ox = 0, oy = 0, sx = 1, sy = 1, ts = 20) {
    this.dl = dl;
    this.ox = ox; this.oy = oy; this.sx = sx; this.sy = sy; this.ts = ts;
    this.bb = [BIG, BIG, -BIG, -BIG];
  }
  _grow(x, y) {
    const b = this.bb;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  p(q) {
    const x = this.ox + this.sx * q[0], y = this.oy + this.sy * q[1];
    this._grow(x, y);
    return [x, y];
  }
  bbox() {
    return [...this.bb];
  }
  push(it) {
    this.dl.items.push(it);
    return it;
  }
  line(a, b, layer, o = {}) {
    return this.pline([a, b], layer, false, o);
  }
  pline(pts, layer, closed = false, o = {}) {
    if (!pts || pts.length < 2) return null;
    return this.push({ k: 'L', pts: pts.map((q) => this.p(q)), closed, layer, color: o.color, lw: o.lw });
  }
  shape(geom, layer, o = {}) {
    if (isEmpty(geom)) return;
    for (const g of parts(geom)) {
      const t = g.getGeometryType();
      if (t === 'Polygon') {
        this.pline(exterior(g), layer, true, o);
        for (const r of interiors(g)) this.pline(r, layer, true, o);
      } else if (t === 'LineString' || t === 'LinearRing') {
        this.pline(pointsOf(g), layer, false, o);
      }
    }
  }
  // polygons transformed to drawing coordinates
  _rings(geom) {
    return polygonsOf(geom).map((pg) => [exterior(pg).map((q) => this.p(q)), ...interiors(pg).map((r) => r.map((q) => this.p(q)))]);
  }
  hatch(geom, layer, pattern = 'ANSI31', scale = 20, solid = false, color = undefined, angle = 0) {
    if (isEmpty(geom)) return;
    for (const rings of this._rings(geom)) {
      if (solid) {
        this.push({ k: 'F', rings, layer, color: color ?? 7 });
        continue;
      }
      // ANSI31: 45° lines, 3.175 apart (pattern units) - exploded and clipped
      const spacing = 3.175 * scale;
      const a = ((45 + angle) * Math.PI) / 180;
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
      const shell = gf().createLinearRing([...rings[0], rings[0][0]].map((q) => C(q[0], q[1])));
      const holes = rings.slice(1).map((r) => gf().createLinearRing([...r, r[0]].map((q) => C(q[0], q[1]))));
      let pg;
      try {
        pg = gf().createPolygon(shell, holes);
      } catch (e) {
        continue;
      }
      let dMin = Infinity, dMax = -Infinity, tMin = Infinity, tMax = -Infinity;
      for (const q of rings[0]) {
        const d = q[0] * nx + q[1] * ny, t = q[0] * ux + q[1] * uy;
        dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
      }
      const segs = [];
      for (let k = Math.ceil(dMin / spacing); k * spacing <= dMax; k++) {
        const d = k * spacing;
        const p0 = [nx * d + ux * (tMin - 10), ny * d + uy * (tMin - 10)];
        const p1 = [nx * d + ux * (tMax + 10), ny * d + uy * (tMax + 10)];
        segs.push(gf().createLineString([C(p0[0], p0[1]), C(p1[0], p1[1])]));
      }
      if (!segs.length) continue;
      const cut = inter(gf().createMultiLineString(segs), pg);
      for (const s of parts(cut)) {
        const t = s.getGeometryType();
        if (t === 'LineString') {
          const q = pointsOf(s);
          if (q.length >= 2) this.dl.items.push({ k: 'L', pts: q, closed: false, layer, color });
        }
      }
    }
  }
  text(s, q, h, o = {}) {
    const height = o.hPaper === false ? h : h * this.ts;
    const it = { k: 'T', s: String(s), p: this.p(q), h: height, align: o.align || 'MC', rot: o.rot || 0,
      layer: o.layer || 'S-TEXT', color: o.color };
    for (const c of textCorners(it)) this._grow(c[0], c[1]);
    return this.push(it);
  }
  circle(c, r, layer, o = {}) {
    const p = this.p(c);
    this._grow(p[0] - r, p[1] - r);
    this._grow(p[0] + r, p[1] + r);
    return this.push({ k: 'C', c: p, r, layer, color: o.color });
  }
  // linear dimension measured along `angle` (0 horizontal, 90 vertical) with the
  // dimension line through `base`; ezdxf STAIRxx style: ticks, text above the line
  dim(a, b, base, angle = 0, o = {}) {
    const S = o.scale ?? 20;
    const A = this.p(a), B = this.p(b), P = this.p(base);
    const r = (angle * Math.PI) / 180;
    const u = [Math.cos(r), Math.sin(r)], n = [-u[1], u[0]];
    const dot = (v, w) => v[0] * w[0] + v[1] * w[1];
    const D1 = [P[0] + u[0] * dot([A[0] - P[0], A[1] - P[1]], u), P[1] + u[1] * dot([A[0] - P[0], A[1] - P[1]], u)];
    const D2 = [P[0] + u[0] * dot([B[0] - P[0], B[1] - P[1]], u), P[1] + u[1] * dot([B[0] - P[0], B[1] - P[1]], u)];
    const m = Math.abs(dot([B[0] - A[0], B[1] - A[1]], u));
    const layer = 'S-DIMS', color = o.color;
    const exo = 1.0 * S, exe = 1.2 * S, tsz = 1.2 * S, gap = 0.8 * S, txt = 2.2 * S;
    const ext = (Q, D) => {
      const v = [D[0] - Q[0], D[1] - Q[1]];
      const L = Math.hypot(v[0], v[1]);
      if (L < exo + 1e-6) return;
      const e = [v[0] / L, v[1] / L];
      this.dl.items.push({ k: 'L', pts: [[Q[0] + e[0] * exo, Q[1] + e[1] * exo], [D[0] + e[0] * exe, D[1] + e[1] * exe]], closed: false, layer, color });
    };
    ext(A, D1);
    ext(B, D2);
    this.dl.items.push({ k: 'L', pts: [D1, D2], closed: false, layer, color });
    const tk = [(u[0] + n[0]) * tsz / 2, (u[1] + n[1]) * tsz / 2];
    for (const D of [D1, D2]) this.dl.items.push({ k: 'L', pts: [[D[0] - tk[0], D[1] - tk[1]], [D[0] + tk[0], D[1] + tk[1]]], closed: false, layer, color });
    // keep the text readable (left to right / bottom to top)
    let rot = angle % 360;
    if (rot > 90.01 && rot <= 270.01) rot -= 180;
    const rr = (rot * Math.PI) / 180;
    const up = [-Math.sin(rr), Math.cos(rr)];
    const mid = [(D1[0] + D2[0]) / 2 + up[0] * gap, (D1[1] + D2[1]) / 2 + up[1] * gap];
    const s = o.text && o.text !== '<>' ? o.text : fmtDim(m);
    const it = { k: 'T', s, p: mid, h: txt, align: 'BC', rot, layer, color };
    this.dl.items.push(it);
    for (const q of [A, B, D1, D2]) this._grow(q[0], q[1]);
    for (const c of textCorners(it)) this._grow(c[0], c[1]);
    return m;
  }
}
