// Thin helpers over JSTS (global `jsts`, loaded as a UMD script) so the
// stair code reads like the shapely version it was ported from.

const J = () => globalThis.jsts;
let _gf = null;
export const BIG = 1.0e5;
export const EPS = 1e-6;

export function gf() {
  if (!_gf) _gf = new (J().geom.GeometryFactory)();
  return _gf;
}
export const C = (x, y) => new (J().geom.Coordinate)(x, y);

export function poly(pts) {
  if (!pts || pts.length < 3) return gf().createPolygon();
  const ring = pts.map((p) => C(p[0], p[1]));
  const f = pts[0], l = pts[pts.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(C(f[0], f[1]));
  try {
    return gf().createPolygon(gf().createLinearRing(ring));
  } catch (e) {
    return gf().createPolygon();
  }
}
export const box = (x0, y0, x1, y1) =>
  Math.abs(x1 - x0) < 1e-9 || Math.abs(y1 - y0) < 1e-9 ? gf().createPolygon()
    : poly([[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]]);
export const line = (pts) => gf().createLineString(pts.map((p) => C(p[0], p[1])));
export const point = (x, y) => gf().createPoint(C(x, y));
export const emptyPoly = () => gf().createPolygon();

export function isEmpty(g) {
  return !g || g.isEmpty();
}

// boolean ops that survive the odd topology exception
function retry(fn, a, b) {
  try {
    return fn(a, b);
  } catch (e) {
    try {
      return fn(a.buffer(0), b.buffer(0));
    } catch (e2) {
      try {
        const pm = new (J().geom.PrecisionModel)(1000);
        const r = J().precision.GeometryPrecisionReducer;
        return fn(r.reduce(a, pm), r.reduce(b, pm));
      } catch (e3) {
        return a;
      }
    }
  }
}
export const inter = (a, b) => retry((x, y) => x.intersection(y), a, b);
export const diff = (a, b) => retry((x, y) => x.difference(y), a, b);
export const uni = (a, b) => retry((x, y) => x.union(y), a, b);

export function unionAll(geoms) {
  const gs = geoms.filter((g) => g && !g.isEmpty());
  if (!gs.length) return emptyPoly();
  try {
    return J().operation.union.UnaryUnionOp.union(gf().createGeometryCollection(gs));
  } catch (e) {
    return gs.reduce((acc, g) => uni(acc, g));
  }
}

export function parts(g) {
  if (!g || g.isEmpty()) return [];
  const n = g.getNumGeometries();
  if (n === 1 && g.getGeometryType() !== 'GeometryCollection' && !g.getGeometryType().startsWith('Multi')) return [g];
  const out = [];
  for (let i = 0; i < n; i++) out.push(...parts(g.getGeometryN(i)));
  return out;
}

export function polygonsOf(g) {
  return parts(g).filter((p) => p.getGeometryType() === 'Polygon');
}

export function largest(g) {
  if (!g || g.isEmpty()) return emptyPoly();
  if (g.getGeometryType() === 'Polygon') return g;
  const ps = polygonsOf(g);
  if (!ps.length) return emptyPoly();
  return ps.reduce((a, b) => (b.getArea() > a.getArea() ? b : a));
}

export function bufferMitre(g, d) {
  const BP = J().operation.buffer.BufferParameters;
  const p = new BP();
  p.setJoinStyle(BP.JOIN_MITRE);
  p.setEndCapStyle(BP.CAP_FLAT);
  p.setMitreLimit(5);
  try {
    return J().operation.buffer.BufferOp.bufferOp(g, d, p);
  } catch (e) {
    return g.buffer(d);
  }
}
export function bufferRound(g, d) {
  return g.buffer(d, 4);
}

export function pointsOf(g) {
  if (!g || g.isEmpty()) return [];
  return g.getCoordinates().map((c) => [c.x, c.y]);
}

export function segmentsOf(g) {
  // list of coordinate arrays of the line parts of g
  return parts(g)
    .filter((p) => p.getGeometryType() === 'LineString' || p.getGeometryType() === 'LinearRing')
    .map((p) => pointsOf(p));
}

export function exterior(pg) {
  if (!pg || pg.isEmpty()) return [];
  const c = pointsOf(pg.getExteriorRing());
  c.pop();
  return c;
}
export function interiors(pg) {
  const out = [];
  for (let i = 0; i < pg.getNumInteriorRing(); i++) {
    const c = pointsOf(pg.getInteriorRingN(i));
    c.pop();
    out.push(c);
  }
  return out;
}

export function bounds(g) {
  const e = g.getEnvelopeInternal();
  return [e.getMinX(), e.getMinY(), e.getMaxX(), e.getMaxY()];
}

export function centroid(g) {
  const c = g.getCentroid();
  return [c.getX(), c.getY()];
}
export function interiorPoint(g) {
  const c = g.getInteriorPoint();
  return [c.getX(), c.getY()];
}

export function lengthOf(g) {
  return g && !g.isEmpty() ? g.getLength() : 0;
}

export class Path {
  // linear referencing on a polyline (shapely interpolate / project)
  constructor(pts) {
    this.pts = pts;
    this.ls = line(pts);
    this.lil = new (J().linearref.LengthIndexedLine)(this.ls);
    this.length = this.ls.getLength();
  }
  interpolate(s) {
    const c = this.lil.extractPoint(Math.max(0, Math.min(this.length, s)));
    return [c.x, c.y];
  }
  project(q) {
    return this.lil.project(C(q[0], q[1]));
  }
}

export function rotate(g, deg, origin = [0, 0]) {
  const AT = J().geom.util.AffineTransformation;
  const t = AT.rotationInstance((deg * Math.PI) / 180, origin[0], origin[1]);
  return t.transform(g);
}
export function translate(g, dx, dy) {
  const AT = J().geom.util.AffineTransformation;
  return AT.translationInstance(dx, dy).transform(g);
}
export function scale(g, sx, sy, origin = [0, 0]) {
  const AT = J().geom.util.AffineTransformation;
  return AT.scaleInstance(sx, sy, origin[0], origin[1]).transform(g);
}
export function simplify(g, tol) {
  try {
    return J().simplify.TopologyPreservingSimplifier.simplify(g, tol);
  } catch (e) {
    try {
      return J().simplify.DouglasPeuckerSimplifier.simplify(g, tol);
    } catch (e2) {
      return g;
    }
  }
}
export function convexHull(g) {
  return g.convexHull();
}
export function minRect(g) {
  return new (J().algorithm.MinimumDiameter)(g).getMinimumRectangle();
}
// smallest-area enclosing rectangle (rotating calipers over the hull edges):
// returns [length, width]
export function blankSize(g) {
  const h = pointsOf(convexHull(g));
  if (h.length < 4) {
    const b = bounds(g);
    return [Math.max(b[2] - b[0], b[3] - b[1]), Math.min(b[2] - b[0], b[3] - b[1])];
  }
  let best = null;
  for (let i = 0; i + 1 < h.length; i++) {
    const dx = h[i + 1][0] - h[i][0], dy = h[i + 1][1] - h[i][1];
    const n = Math.hypot(dx, dy);
    if (n < 1e-9) continue;
    const ux = dx / n, uy = dy / n;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of h) {
      const a = x * ux + y * uy, b = -x * uy + y * ux;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best[0] - 1e-9) best = [area, a1 - a0, b1 - b0];
  }
  return [Math.max(best[1], best[2]), Math.min(best[1], best[2])];
}

// --- small vector helpers
export function unit(v) {
  const n = Math.hypot(v[0], v[1]);
  return [v[0] / n, v[1] / n];
}
export function add(a, b, t = 1) {
  return [a[0] + t * b[0], a[1] + t * b[1]];
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function halfplane(p0, d, sidePt) {
  d = unit(d);
  let n = [-d[1], d[0]];
  if ((sidePt[0] - p0[0]) * n[0] + (sidePt[1] - p0[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const a = add(p0, d, -BIG), b = add(p0, d, BIG);
  return poly([a, b, add(b, n, BIG), add(a, n, BIG)]);
}
export function sideNormal(p0, d, sidePt) {
  d = unit(d);
  let n = [-d[1], d[0]];
  if ((sidePt[0] - p0[0]) * n[0] + (sidePt[1] - p0[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return n;
}

// polylabel (pole of inaccessibility), after mapbox/polylabel (ISC)
export function polylabel(pg, precision = 2.0) {
  const ext = exterior(pg);
  if (ext.length < 3) return interiorPoint(pg);
  const rings = [ext, ...interiors(pg)];
  const [minX, minY, maxX, maxY] = bounds(pg);
  const w = maxX - minX, h = maxY - minY;
  const cellSize = Math.min(w, h);
  if (cellSize === 0) return [minX, minY];
  let hh = cellSize / 2;
  const queue = [];
  const cell = (x, y, hc) => {
    const d = pointToPolygonDist(x, y, rings);
    return { x, y, h: hc, d, max: d + hc * Math.SQRT2 };
  };
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) queue.push(cell(x + hh, y + hh, hh));
  const c = centroid(pg);
  let best = cell(c[0], c[1], 0);
  const bb = cell(minX + w / 2, minY + h / 2, 0);
  if (bb.d > best.d) best = bb;
  let guard = 0;
  while (queue.length && guard++ < 20000) {
    queue.sort((a, b) => a.max - b.max);
    const cl = queue.pop();
    if (cl.d > best.d) best = cl;
    if (cl.max - best.d <= precision) continue;
    hh = cl.h / 2;
    queue.push(cell(cl.x - hh, cl.y - hh, hh), cell(cl.x + hh, cl.y - hh, hh),
      cell(cl.x - hh, cl.y + hh, hh), cell(cl.x + hh, cl.y + hh, hh));
  }
  return [best.x, best.y];
}
function pointToPolygonDist(x, y, rings) {
  let inside = false, minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  }
  return minSq === 0 ? 0 : (inside ? 1 : -1) * Math.sqrt(minSq);
}
function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
}
