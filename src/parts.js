// Construction parts (port of parts.py): cut stringers with sawtooth profiles on
// both faces, winder support joists, newel housings, guard and wall handrails.

import {
  BIG, add, box, bounds, dist, halfplane, inter, diff, isEmpty, largest, line, point, pointsOf, poly, segmentsOf,
  sideNormal, unionAll, unit, bufferMitre, lengthOf,
} from './geo.js';
import { rDir, uphillPoint } from './geometry.js';

const TOL = 1e-6;
const proj = (o, ax, q) => (q[0] - o[0]) * ax[0] + (q[1] - o[1]) * ax[1];

function makeStringer(key, name, origin, axis, normal, s0, s1, thickness, width, faceA = 'stair side', faceB = 'wall side') {
  return {
    key, name, origin, axis, normal, s0, s1, thickness, width, faceA, faceB,
    profileA: [], profileB: [], outline: null, topLine: [0, 0], bottomLine: [0, 0], throat: 0,
    seats: [], seatsB: [], pitchDeg: 0, length: 0, plan: null, warnings: [],
  };
}
export function planPoint(st, s, face = 'a') {
  const o = face === 'a' ? st.origin : add(st.origin, st.normal, st.thickness);
  return add(o, st.axis, s);
}

function envelope(g, faceLine, origin, axis) {
  const items = [];
  for (const t of g.treads) {
    for (const seg of segmentsOf(inter(t.board, faceLine))) {
      const v = seg.map((q) => proj(origin, axis, q)).sort((a, b) => a - b);
      const a = v[0], b = v[v.length - 1];
      if (b - a > 0.05) items.push([a, b, t.zBottom, t.k]);
    }
  }
  for (const rb of g.riserBoards) {
    for (const seg of segmentsOf(inter(rb.plan, faceLine))) {
      const v = seg.map((q) => proj(origin, axis, q)).sort((a, b) => a - b);
      const a = v[0], b = v[v.length - 1];
      if (b - a > 0.05) items.push([a, b, rb.z0, -rb.k]);
    }
  }
  if (!items.length) return [];
  const cuts = [...new Set(items.flatMap((it) => [it[0], it[1]]))].sort((a, b) => a - b);
  const env = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const m = 0.5 * (a + b);
    const cover = items.filter((it) => it[0] - TOL <= m && m <= it[1] + TOL);
    if (!cover.length) continue;
    let best = cover[0];
    for (const it of cover) if (it[2] < best[2]) best = it;
    const z = best[2], k = best[3];
    const last = env[env.length - 1];
    if (last && Math.abs(last[2] - z) < 1e-6 && Math.abs(last[1] - a) < 1e-6) env[env.length - 1] = [last[0], b, z, last[3]];
    else env.push([a, b, z, k]);
  }
  return env;
}

function faceLine(st, face) {
  return line([planPoint(st, st.s0 - 1, face), planPoint(st, st.s1 + 1, face)]);
}
function clipEnv(env, s0, s1) {
  const out = [];
  for (const [a, b, z, k] of env) {
    const a2 = Math.max(a, s0), b2 = Math.min(b, s1);
    if (b2 - a2 > 0.05) out.push([a2, b2, z, k]);
  }
  return out;
}
function sawtooth(env) {
  const path = [];
  for (const [a, b, z] of env) {
    if (path.length && Math.abs(path[path.length - 1][0] - a) > 0.05) path.push([a, path[path.length - 1][1]]);
    path.push([a, z], [b, z]);
  }
  return path;
}
function upperHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const hull = [];
  for (const q of pts) {
    while (hull.length >= 2) {
      const [x1, y1] = hull[hull.length - 2], [x2, y2] = hull[hull.length - 1];
      if ((x2 - x1) * (q[1] - y1) - (y2 - y1) * (q[0] - x1) >= 0) hull.pop();
      else break;
    }
    hull.push(q);
  }
  return hull;
}
function pitchFromPeaks(peaks) {
  if (peaks.length < 2) return 0;
  const hull = upperHull(peaks);
  if (hull.length < 2) return 0;
  let best = null;
  for (let i = 0; i + 1 < hull.length; i++) {
    const e = [hull[i], hull[i + 1]];
    if (!best || e[1][0] - e[0][0] > best[1][0] - best[0][0]) best = e;
  }
  const [[x1, y1], [x2, y2]] = best;
  return x2 - x1 > 1e-6 ? (y2 - y1) / (x2 - x1) : 0;
}

function fitBoard(st, envA, envB) {
  st.s0 = envA[0][0];
  st.s1 = envA[envA.length - 1][1];
  st.profileA = sawtooth(envA);
  st.profileB = envB.length ? sawtooth(clipEnv(envB, st.s0 - 60, st.s1 + 60)) : [];
  st.seats = envA.filter((e) => e[3] > 0).map(([a, b, z, k]) => [Math.abs(k), a, b, z]);
  st.seatsB = envB.filter((e) => e[3] > 0 && e[1] > st.s0 - 60 && e[0] < st.s1 + 60).map(([a, b, z, k]) => [Math.abs(k), a, b, z]);
  const peaks = envA.map(([a, , z]) => [a, z]);
  const valleys = [];
  for (let i = 0; i + 1 < envA.length; i++) if (envA[i + 1][2] > envA[i][2]) valleys.push([envA[i][1], envA[i][2]]);
  const slope = pitchFromPeaks(peaks);
  const c = Math.max(...peaks.map(([s, z]) => z - slope * s));
  st.topLine = [c, slope];
  const cosT = Math.cos(Math.atan(slope));
  st.bottomLine = [c - st.width / cosT, slope];
  st.pitchDeg = (Math.atan(slope) * 180) / Math.PI;
  st.throat = valleys.length ? Math.min(...valleys.map(([s, z]) => (z - (st.bottomLine[0] + slope * s)) * cosT)) : st.width;
  const s0 = st.s0, s1 = st.s1;
  const band = poly([[s0, c + slope * s0 + 1], [s1, c + slope * s1 + 1],
    [s1, st.bottomLine[0] + slope * s1], [s0, st.bottomLine[0] + slope * s0]]);
  const under = poly([[s0, -BIG], ...st.profileA, [s1, -BIG]]).buffer(0);
  const floor = box(s0 - 10, 0, s1 + 10, BIG);
  st.outline = largest(inter(inter(band, under), floor));
  st.length = s1 - s0;
  const a0 = planPoint(st, s0), a1 = planPoint(st, s1);
  st.plan = poly([a0, a1, add(a1, st.normal, st.thickness), add(a0, st.normal, st.thickness)]);
  return st;
}

function solveStringer(g, st, minThroat) {
  let envA = clipEnv(envelope(g, faceLine(st, 'a'), st.origin, st.axis), st.s0, st.s1);
  const ob = add(st.origin, st.normal, st.thickness);
  let envB = clipEnv(envelope(g, faceLine(st, 'b'), ob, st.axis), st.s0 - 60, st.s1 + 60);
  envA = envA.filter((e) => e[2] > 0.5);
  envB = envB.filter((e) => e[2] > 0.5);
  if (!envA.length) {
    st.warnings.push('no treads above this stringer');
    return [];
  }
  fitBoard(st, envA, envB);
  const thin = (s) => `throat ${s.throat.toFixed(0)} mm < ${minThroat.toFixed(0)} mm - use a wider board`;
  if (st.throat >= minThroat || envA.length < 4) {
    if (st.throat < minThroat) st.warnings.push(thin(st));
    return [st];
  }
  let best = null;
  for (let i = 2; i < envA.length - 1; i++) {
    if (envA[i][2] <= envA[i - 1][2]) continue;
    const a = fitBoard(makeStringer(st.key + 'a', st.name + ' - lower piece', st.origin, st.axis, st.normal, st.s0, st.s1,
      st.thickness, st.width, st.faceA, st.faceB), envA.slice(0, i), envB);
    const b = fitBoard(makeStringer(st.key + 'b', st.name + ' - upper piece', st.origin, st.axis, st.normal, st.s0, st.s1,
      st.thickness, st.width, st.faceA, st.faceB), envA.slice(i), envB);
    const score = Math.min(a.throat, b.throat);
    if (!best || score > best[0] + 0.01) best = [score, a, b];
  }
  if (!best || best[0] <= st.throat) {
    st.warnings.push(thin(st));
    return [st];
  }
  const [, a, b] = best;
  const note = `joint at riser cut s=${b.s0.toFixed(0)}: support the joint (post, hanger or splice plate)`;
  for (const piece of [a, b]) {
    piece.warnings.push(note);
    if (piece.throat < minThroat) piece.warnings.push(thin(piece));
  }
  return [a, b];
}

export function buildStringers(g) {
  const p = g.p;
  const t = p.stringers.thickness, W = g.W;
  const rt = p.risers.install ? p.risers.thickness : 0;
  const xe = g.xEnd + rt;
  const out = [];
  let s0 = W;
  if (g.newel) {
    const nb = bounds(g.newel);
    if (nb[1] < t && nb[3] > 0 && nb[0] <= W + 1 && nb[2] >= W - 1 && p.newel.position !== 'outside') s0 = Math.max(W, nb[2]);
  }
  out.push(makeStringer('S1', 'upper flight - inner (open side)', [0, t], [1, 0], [0, -1], s0, xe, t, p.stringers.width, 'stair side', 'open side'));
  if (p.stair.lower_steps > 0) {
    const e = g.newel ? bounds(g.newel)[1] : 0;
    out.push(makeStringer('S2', 'lower flight - inner (open side)', [W - t, 0], [0, 1], [1, 0], g.y1, e, t, p.stringers.width, 'stair side', 'open side'));
  }
  out.push(makeStringer('S3', 'back wall (turn)', [t, 0], [0, 1], [-1, 0], g.y1, W, t, p.stringers.winder_width));
  if (p.stringers.split_side_stringer) {
    out.push(makeStringer('S4', 'side wall (turn)', [0, W - t], [1, 0], [0, 1], t, W, t, p.stringers.winder_width));
    out.push(makeStringer('S5', 'side wall (upper flight)', [0, W - t], [1, 0], [0, 1], W, xe, t, p.stringers.width));
  } else {
    out.push(makeStringer('S4', 'side wall', [0, W - t], [1, 0], [0, 1], t, xe, t, p.stringers.winder_width));
  }
  return out.flatMap((st) => solveStringer(g, st, p.stringers.min_throat));
}

export function buildJoists(g, stringers) {
  const p = g.p;
  const mode = p.joists.mode;
  if (mode === 'none') return [];
  const rt = p.risers.install ? p.risers.thickness : 0;
  const jt = p.joists.thickness, jh = p.joists.height;
  const blockers = stringers.filter((s) => s.plan).map((s) => s.plan);
  if (g.newel) blockers.push(g.newel);
  const blocked = unionAll(blockers);
  const out = [];
  for (const t of g.treads) {
    if (!t.tapered) continue;
    const r1 = g.risers[t.k];
    if (mode === 'auto') {
      let nearPivot = false;
      if (g.pivot) {
        let lim = 1;
        if (g.newel) {
          const b = bounds(g.newel);
          lim += Math.hypot(b[2] - b[0], b[3] - b[1]);
        }
        nearPivot = t.region.distance(point(g.pivot[0], g.pivot[1])) < lim;
      }
      if (!(t.touchesBackWall || nearPivot)) continue;
    }
    const d = rDir(r1);
    const dn = uphillPoint(g, r1, -1);
    const n = sideNormal(r1.inner, d, dn);
    const backEdge = add(r1.inner, n, -rt);
    const hA = halfplane(backEdge, d, add(backEdge, n, 1));
    const front = add(backEdge, n, jt);
    const hB = halfplane(front, d, add(front, n, -1));
    const plan = largest(diff(inter(inter(g.footprint, hA), hB), blocked));
    if (isEmpty(plan)) continue;
    const mid = add(backEdge, n, jt / 2);
    const length = lengthOf(inter(plan, line([add(mid, d, -BIG), add(mid, d, BIG)])));
    const z1 = t.zBottom, z0 = Math.max(0, z1 - jh);
    out.push({
      key: `J${t.k}`, tread: t.k, plan, z0, z1, length, angleDeg: (Math.atan2(d[1], d[0]) * 180) / Math.PI,
      endNote: z0 <= 0 ? 'floor block' : '',
    });
  }
  return out;
}

function stringerZAtNewel(st, newel) {
  if (!st.outline || isEmpty(st.outline)) return null;
  const e0 = planPoint(st, st.s0), e1 = planPoint(st, st.s1);
  const near0 = point(...e0).distance(newel) <= point(...e1).distance(newel);
  const s = near0 ? st.s0 + 0.5 : st.s1 - 0.5;
  const pts = pointsOf(inter(st.outline, line([[s, -BIG], [s, BIG]])));
  if (!pts.length) return null;
  const zs = pts.map((q) => q[1]);
  return [Math.min(...zs), Math.max(...zs)];
}

export function buildNewel(g, stringers, joists, railTopAt) {
  if (!g.newel) return null;
  const p = g.p;
  const [x0, y0, x1, y1] = bounds(g.newel);
  const faces = [
    [1, [x0, y0], [x1, y0], [0, -1], 'towards the entry / first riser (-Y)'],
    [2, [x1, y0], [x1, y1], [1, 0], 'towards the upper flight (+X)'],
    [3, [x1, y1], [x0, y1], [0, 1], 'towards the side wall (+Y)'],
    [4, [x0, y1], [x0, y0], [-1, 0], 'towards the back wall (-X)'],
  ];
  const rail = railTopAt ? railTopAt(0.5 * (x0 + x1)) : g.H;
  const zTop = Math.ceil((rail + p.newel.above_rail) / 10) * 10;
  const post = { plan: g.newel, zTop, size: [x1 - x0, y1 - y0], housings: [], faces };
  const elems = [];
  for (const t of g.treads) elems.push([`tread ${t.k}`, t.board, t.zBottom, t.zTop]);
  for (const rb of g.riserBoards) elems.push([`riser ${rb.k}`, rb.plan, rb.z0, rb.z1]);
  for (const st of stringers) {
    if (st.plan && st.plan.distance(g.newel) < 0.5) {
      const zz = stringerZAtNewel(st, g.newel);
      if (zz) elems.push([`stringer ${st.key}`, st.plan, zz[0], zz[1]]);
    }
  }
  for (const j of joists) if (j.plan.distance(g.newel) < 0.5) elems.push([`joist ${j.key}`, j.plan, j.z0, j.z1]);
  const hd = p.newel.housing;
  for (const [name, pg, z0, z1] of elems) {
    if (isEmpty(pg) || pg.distance(g.newel) > 0.5) continue;
    const tongue = inter(pg, g.newel);
    const housed = !isEmpty(tongue) && tongue.getArea() > 1;
    const contact = housed ? tongue : inter(pg.buffer(0.6), g.newel);
    if (isEmpty(contact) || contact.getArea() < 0.5) continue;
    const outside = diff(pg, g.newel);
    for (const [fno, a, b, nrm] of faces) {
      const inn = [-nrm[0], -nrm[1]];
      const band = poly([a, b, add(b, inn, hd + 0.7), add(a, inn, hd + 0.7)]);
      const part = inter(contact, band);
      if (isEmpty(part) || part.getArea() < 0.5) continue;
      const seg = line([a, b]);
      if (isEmpty(outside) || lengthOf(inter(outside.getBoundary(), bufferMitre(seg, 0.3))) < 2) continue;
      const ax = unit([b[0] - a[0], b[1] - a[1]]);
      const pts = pointsOf(part.getBoundary());
      const us = pts.map((q) => proj(a, ax, q));
      const flen = dist(a, b);
      const u0 = Math.max(0, Math.min(...us)), u1 = Math.min(flen, Math.max(...us));
      if (u1 - u0 < 1.5) continue;
      const depth = housed ? Math.max(...pts.map((q) => proj(a, inn, q))) : hd;
      post.housings.push({ face: fno, element: name, u0, u1, z0, z1, depth: Math.min(depth, hd), kind: housed ? 'housed' : 'butt' });
    }
  }
  return post;
}

// ------------------------------------------------------------------- rails
export function nosingPoints(g, ln, origin, axis) {
  const out = [];
  const nos = g.p.treads.nosing;
  for (const t of g.treads) {
    const r = g.risers[t.k - 1];
    const d = rDir(r);
    const up = uphillPoint(g, r, 1);
    const n = sideNormal(r.inner, d, up);
    const p0 = add(r.inner, n, -nos);
    const pts = pointsOf(inter(line([add(p0, d, -BIG), add(p0, d, BIG)]), ln));
    if (!pts.length) continue;
    const q = pts[0];
    if (t.board.buffer(1).contains(point(q[0], q[1]))) out.push([proj(origin, axis, q), t.zTop, t.k]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return out;
}

export function railZ(rail, s) {
  const p = rail.pts;
  let s0, z0, s1, z1;
  if (s <= p[0][0]) [[s0, z0], [s1, z1]] = [p[0], p[1]];
  else if (s >= p[p.length - 1][0]) [[s0, z0], [s1, z1]] = [p[p.length - 2], p[p.length - 1]];
  else {
    for (let i = 0; i + 1 < p.length; i++) {
      [[s0, z0], [s1, z1]] = [p[i], p[i + 1]];
      if (s0 <= s && s <= s1) break;
    }
  }
  return Math.abs(s1 - s0) > 1e-9 ? z0 + ((z1 - z0) * (s - s0)) / (s1 - s0) : z0;
}

function lineThrough(points, h) {
  const [s0, z0] = points[0], [s1, z1] = points[points.length - 1];
  const b = Math.abs(s1 - s0) > 1 ? (z1 - z0) / (s1 - s0) : 0;
  const a = Math.max(...points.map(([s, z]) => z + h - b * s));
  return [a, b];
}

export function fitRail(points, h, taperedKs, sFrom = null, sTo = null) {
  if (!points.length) return null;
  sFrom = sFrom ?? points[0][0];
  sTo = sTo ?? points[points.length - 1][0];
  if (points.length === 1) {
    const z = points[0][1];
    return { pts: [[sFrom, z + h], [sTo, z + h]], over: 0, clearMin: h };
  }
  const g1 = points.filter((q) => taperedKs.has(q[2]));
  const g2 = points.filter((q) => !taperedKs.has(q[2]));
  const cands = [['single', lineThrough(points, h), null]];
  if (g1.length >= 2 && g2.length >= 2) {
    const A = lineThrough(g2, h), B = lineThrough(g1, h);
    cands.push(['max', A, B], ['min', A, B]);
  }
  let best = null;
  for (const [kind, A, B] of cands) {
    const f = B === null ? (s) => A[0] + A[1] * s
      : kind === 'max' ? (s) => Math.max(A[0] + A[1] * s, B[0] + B[1] * s)
        : (s) => Math.min(A[0] + A[1] * s, B[0] + B[1] * s);
    const clear = points.map(([s, z]) => f(s) - z);
    if (Math.min(...clear) < h - 0.01) continue;
    const over = Math.max(...clear) - h;
    if (!best || over < best.over - 0.5) best = { over, kind, A, B, f, cmin: Math.min(...clear) };
  }
  const { A, B, f } = best;
  const pts = [[sFrom, f(sFrom)]];
  if (B && Math.abs(A[1] - B[1]) > 1e-9) {
    const sk = (B[0] - A[0]) / (A[1] - B[1]);
    if (sFrom < sk && sk < sTo) pts.push([sk, f(sk)]);
  }
  pts.push([sTo, f(sTo)]);
  return { pts, over: best.over, clearMin: best.cmin };
}

export function buildGuard(g, stringers) {
  const p = g.p, W = g.W;
  const rt = p.risers.install ? p.risers.thickness : 0;
  let pts = nosingPoints(g, line([[-BIG, 0], [BIG, 0]]), [0, 0], [1, 0]);
  pts = pts.filter((q) => q[0] >= W - p.treads.nosing - 1);
  const xStart = g.newel ? bounds(g.newel)[2] : W;
  const xEnd = g.xEnd + rt;
  const tapered = new Set(g.treads.filter((t) => t.tapered).map((t) => t.k));
  const rail = fitRail(pts, p.guard.height, tapered, xStart, xEnd);
  if (!rail) return null;
  const s1s = stringers.filter((s) => s.key.startsWith('S1'));
  const bottomAt = (x) => {
    let s = s1s.find((st) => st.s0 - 1 <= x && x <= st.s1 + 1);
    if (!s) s = s1s.reduce((a, b) => (Math.min(Math.abs(x - b.s0), Math.abs(x - b.s1)) < Math.min(Math.abs(x - a.s0), Math.abs(x - a.s1)) ? b : a));
    return s.bottomLine[0] + s.bottomLine[1] * x;
  };
  const bal = p.guard.baluster, gapD = p.guard.design_gap;
  const L = xEnd - xStart;
  const n = Math.max(1, Math.ceil((L - gapD) / (bal + gapD)));
  const gap = (L - n * bal) / (n + 1);
  const balusters = [];
  for (let i = 0; i < n; i++) {
    const xc = xStart + gap * (i + 1) + bal * i + bal / 2;
    const zTop = railZ(rail, xc) - p.guard.handrail_thickness;
    const zBot = s1s.length ? Math.max(0, bottomAt(xc) + 20) : 0;
    balusters.push([xc, zBot, zTop]);
  }
  let railLength = 0;
  for (let i = 0; i + 1 < rail.pts.length; i++) railLength += dist(rail.pts[i], rail.pts[i + 1]);
  return { xStart, xEnd, rail, balusters, gap, railLength, nosings: pts };
}

export function buildWallRails(g) {
  const p = g.p, W = g.W;
  const tapered = new Set(g.treads.filter((t) => t.tapered).map((t) => t.k));
  const rails = [];
  const railLen = (r) => r.pts.slice(1).reduce((acc, q, i) => acc + dist(r.pts[i], q), 0);
  let pts = nosingPoints(g, line([[0, g.y1 - 500], [0, W]]), [0, 0], [0, 1]);
  if (pts.length >= 2) {
    const r = fitRail(pts, p.guard.height, tapered, pts[0][0], W);
    rails.push({ name: 'back wall', origin: [0, 0], axis: [0, 1], sFrom: pts[0][0], sTo: W, rail: r, lengthTrue: railLen(r), nosings: pts });
  }
  pts = nosingPoints(g, line([[0, W], [g.xEnd + 1000, W]]), [0, W], [1, 0]);
  if (pts.length >= 2) {
    const r = fitRail(pts, p.guard.height, tapered, 0, g.xEnd);
    rails.push({ name: 'side wall', origin: [0, W], axis: [1, 0], sFrom: 0, sTo: g.xEnd, rail: r, lengthTrue: railLen(r), nosings: pts });
  }
  return rails;
}

export function buildParts(g) {
  const stringers = buildStringers(g);
  const joists = buildJoists(g, stringers);
  const guard = buildGuard(g, stringers);
  const newel = buildNewel(g, stringers, joists, guard ? (x) => railZ(guard.rail, x) : null);
  const wallRails = g.p.guard.wall_handrails ? buildWallRails(g) : [];
  return { stringers, joists, newel, guard, wallRails };
}
