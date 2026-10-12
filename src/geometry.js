// Plan and height geometry of a quarter-turn stair (port of geometry.py).
//
// Canonical frame (right turn, plan, millimetres):
//   X  along the upper flight (ascent after the turn)
//   Y  along the lower flight (ascent before the turn)
//   back wall X = 0, side wall Y = W, inner corner (W, 0) = newel,
//   upper flight open on Y = 0, first riser Y = W - total_run_lower,
//   top riser X = total_run. Riser lines are FRONT FACES of riser boards.
// A left turn is this geometry mirrored in Y at output time.

import {
  BIG, EPS, Path, add, box, bufferMitre, convexHull, diff, dist, halfplane, inter, isEmpty, largest, line,
  pointsOf, poly, sideNormal, translate, uni, unionAll, unit, lengthOf, point,
} from './geo.js';

export class StairError extends Error {}
const fmt0 = (v) => (Math.round(v * 10) / 10).toString();

export function rDir(r) {
  return unit([r.outer[0] - r.inner[0], r.outer[1] - r.inner[1]]);
}
export function rPerp(r) {
  const [dx, dy] = rDir(r);
  return Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9;
}
export function rAngle(r) {
  const [dx, dy] = rDir(r);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
export function rSegment(r) {
  return line([r.inner, r.outer]);
}
export function rExtendedFar(r) {
  const d = rDir(r);
  return line([add(r.inner, d, -BIG), add(r.outer, d, BIG)]);
}
function rExtended(r) {
  const d = rDir(r);
  return line([add(r.inner, d, -1), add(r.outer, d, 1)]);
}

export function houseInto(board, post, depth, sweep = null, minFeature = 0) {
  if (!post || isEmpty(board) || board.distance(post) > 0.01) return board;
  let blocker = post;
  if (sweep) blocker = convexHull(unionAll([post, translate(post, sweep[0], sweep[1])]));
  let outside = largest(diff(board, blocker));
  if (minFeature > 0 && !isEmpty(outside)) {
    const r = minFeature / 2;
    const opened = bufferMitre(bufferMitre(outside, -r), r);
    outside = largest(inter(outside, bufferMitre(opened, 0.01)));
  }
  if (isEmpty(outside) || depth <= 0) return outside;
  const tongue = inter(inter(board, post), bufferMitre(outside, depth));
  return largest(unionAll([outside, tongue]).buffer(0));
}

export function build(p) {
  const s = p.stair;
  const W = s.width;
  const H = s.floor_to_floor;
  const N = s.lower_steps + s.winders + s.upper_steps + 1;
  const rise = H / N;
  const y1 = W - s.total_run_lower;
  const xEnd = s.total_run;
  const nosing = p.treads.nosing;
  const rt = p.risers.install ? p.risers.thickness : 0;

  const footprint = unionAll([box(0, y1, W, W), box(W, 0, xEnd, W)]);
  const footprintExt = unionAll([footprint, box(0, y1 - nosing, W, y1), box(W, 0, xEnd + Math.max(rt, EPS), W)]);
  const outerPts = [[0, y1], [0, W], [xEnd, W]];
  const innerPts = y1 < -EPS ? [[W, y1], [W, 0], [xEnd, 0]] : [[W, 0], [xEnd, 0]];
  const dwl = p.rules.walking_line_from_outer;
  const c = W / 2;

  const n = p.newel.size;
  const ax = W, ay = s.lower_steps === 0 ? Math.min(0, y1) : 0;
  let newel = null;
  if (p.newel.position === 'inside') newel = box(ax - n, ay, ax, ay + n);
  else if (p.newel.position === 'centre') newel = box(ax - n / 2, ay - n / 2, ax + n / 2, ay + n / 2);
  else if (p.newel.position === 'outside') newel = box(W, -n, W + n, 0);

  const g = {
    p, W, H, N, rise, y1, xEnd, footprint, footprintExt,
    outerPath: new Path(outerPts), innerPath: new Path(innerPts),
    walkLine: new Path([[dwl, y1], [dwl, W - dwl], [xEnd, W - dwl]]),
    centreLine: new Path([[c, y1], [c, W - c], [xEnd, W - c]]),
    newel, pivot: null, risers: [], treads: [], riserBoards: [], layoutNotes: [],
  };
  if (p.layout.winder_layout === 'radial') radialRisers(g);
  else balancedRisers(g);
  locateOnLines(g);
  checkCrossings(g);
  buildTreads(g);
  buildRiserBoards(g);
  return g;
}

function rayToOuter(g, origin, through) {
  const d = unit([through[0] - origin[0], through[1] - origin[1]]);
  const far = add(origin, d, BIG);
  const hit = inter(line([origin, far]), g.outerPath.ls);
  let best = null;
  for (const q of pointsOf(hit)) {
    const t = (q[0] - origin[0]) * d[0] + (q[1] - origin[1]) * d[1];
    if (t > 1e-6 && (!best || t < best[0])) best = [t, q];
  }
  if (!best) throw new StairError('A riser line does not reach the walls. Check the run lengths.');
  return best[1];
}

function radialRisers(g) {
  const { p, W } = g;
  const s = p.stair;
  const nl = s.lower_steps, nw = s.winders, nu = s.upper_steps;
  const off = p.layout.pivot_offset || [0, 0];
  const pivot = [W + Number(off[0] || 0), Number(off[1] || 0)];
  g.pivot = pivot;
  const risers = [];
  let k = 1;
  if (nl > 0) {
    const gl = -g.y1 / nl;
    for (let j = 0; j <= nl; j++) {
      const y = g.y1 + j * gl;
      risers.push({ k: k++, inner: [W, y], outer: [0, y], kind: 'lower' });
    }
  } else {
    risers.push({ k: k++, inner: [W, g.y1], outer: [0, g.y1], kind: 'lower' });
  }
  for (let i = 1; i < nw; i++) {
    const a = ((180 - (i * 90) / nw) * Math.PI) / 180;
    const through = add(pivot, [Math.cos(a), Math.sin(a)], 10);
    risers.push({ k: k++, inner: pivot, outer: rayToOuter(g, pivot, through), kind: 'radial' });
  }
  const gu = (g.xEnd - W) / nu;
  for (let j = 0; j <= nu; j++) {
    const x = W + j * gu;
    risers.push({ k: k++, inner: [x, 0], outer: [x, W], kind: 'upper' });
  }
  g.risers = risers;
  g.layoutNotes.push(`Radial winders: ${nw} treads × ${(90 / nw).toFixed(1)}° from the pivot (${fmt0(pivot[0])}, ${fmt0(pivot[1])}); straight going ${gu.toFixed(1)}`);
  g.straightGoing = gu;
}

function balancedRisers(g) {
  const { p, W, N } = g;
  const d = p.rules.walking_line_from_outer;
  const nt = N - 1;
  const WL = g.walkLine;
  const gw = WL.length / nt;
  const s = Array.from({ length: N }, (_, i) => i * gw);
  const offset = 2 * (W - d);
  const sCorner = W - d - g.y1;
  const lowerOk = s.map((sk) => sk <= -g.y1 + 1e-6);
  const upperOk = s.map((sk) => sk >= sCorner + (W - d) - 1e-6);
  let aMax = -1, bMin = N;
  for (let i = 0; i < N; i++) if (lowerOk[i]) aMax = i;
  for (let i = N - 1; i >= 0; i--) if (upperOk[i]) bMin = i;
  if (aMax < 0 || bMin >= N) throw new StairError('No valid balanced layout for these run lengths.');
  const jc = Math.min(Math.floor(sCorner / gw), nt - 1);
  const A = p.layout.min_inner_going;

  const schedule = (a, b) => {
    const m = b - a;
    if (m <= 0) return null;
    const T = s[b] - offset - s[a];
    const dd = [];
    for (let j = a; j < b; j++) dd.push(Math.abs(j - jc));
    const sd = dd.reduce((x, y) => x + y, 0);
    if (sd === 0) return Array(m).fill(T / m);
    const B = (T - m * A) / sd;
    if (B < -1e-9) return null;
    return dd.map((v) => A + B * v);
  };

  const cands = [];
  for (let a = aMax; a >= 0; a--) for (let b = bMin; b < N; b++) if (b > a) cands.push([b - a, Math.abs(jc - a - (b - 1 - jc)), a, b]);
  cands.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]);
  const forced = p.layout.balance_treads;
  let chosen = null;
  for (const [m, , a, b] of cands) {
    if (forced && m !== forced) continue;
    const goings = schedule(a, b);
    if (!goings) continue;
    if (Math.min(...goings) < A - 1e-6 || Math.max(...goings) > gw + 1e-6) continue;
    if (!forced) {
      if (goings[goings.length - 1] < p.layout.smoothness * gw) continue;
      if (a > 0 && goings[0] < p.layout.smoothness * gw) continue;
    }
    const risers = balancedLines(g, s, a, b, goings, offset);
    if (!risers) continue;
    chosen = { a, b, goings, risers };
    break;
  }
  if (!chosen) {
    throw new StairError('No balanced layout fits. Lengthen the run before the turn (project the bottom step), ' +
      'or lower the minimum inner going.');
  }
  g.risers = chosen.risers;
  g.layoutNotes.push(`Balanced: ${gw.toFixed(1)} going on the walking line for all ${nt} treads; tapered treads ` +
    `${chosen.a + 1}–${chosen.b}; inner goings ${chosen.goings.map((x) => x.toFixed(0)).join(', ')}`);
  g.straightGoing = gw;
}

function balancedLines(g, s, a, b, goings, offset) {
  const { W, N } = g;
  const u = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    if (k <= a) u[k] = s[k];
    else if (k >= b) u[k] = s[k] - offset;
  }
  for (let j = a; j < b - 1; j++) u[j + 1] = u[j] + goings[j - a];
  const risers = [];
  for (let k = 0; k < N; k++) {
    const P = g.walkLine.interpolate(s[k]);
    if (k <= a) risers.push({ k: k + 1, inner: [W, P[1]], outer: [0, P[1]], kind: 'lower' });
    else if (k >= b) risers.push({ k: k + 1, inner: [P[0], 0], outer: [P[0], W], kind: 'upper' });
    else {
      const I = g.innerPath.interpolate(u[k]);
      let O;
      try {
        O = rayToOuter(g, I, P);
      } catch (e) {
        return null;
      }
      risers.push({ k: k + 1, inner: I, outer: O, kind: 'balanced' });
    }
  }
  for (let i = 0; i + 1 < risers.length; i++) {
    if (!isEmpty(inter(rSegment(risers[i]), rSegment(risers[i + 1])))) return null;
  }
  return risers;
}

function locateOnLines(g) {
  for (const r of g.risers) {
    for (const [path, attr] of [[g.walkLine, 'sWalk'], [g.centreLine, 'sCentre']]) {
      const pts = pointsOf(inter(rExtended(r), path.ls));
      if (!pts.length) throw new StairError(`Riser ${r.k} misses the ${attr === 'sWalk' ? 'walking' : 'centre'} line.`);
      r[attr] = path.project(pts[0]);
      if (attr === 'sWalk') r.walkPt = pts[0];
    }
  }
}

function checkCrossings(g) {
  for (let i = 0; i + 1 < g.risers.length; i++) {
    const r0 = g.risers[i], r1 = g.risers[i + 1];
    const x = inter(rSegment(r0), rSegment(r1));
    if (isEmpty(x)) continue;
    const pts = pointsOf(x);
    if (pts.every((q) => dist(q, r0.inner) < 1e-6 && dist(q, r1.inner) < 1e-6)) continue;
    throw new StairError(`Riser lines ${r0.k} and ${r1.k} cross inside the stair.`);
  }
}

export function uphillPoint(g, r, sign = 1) {
  if (r.k === g.N && sign > 0) return [r.walkPt[0] + 1, r.walkPt[1]];
  if (r.k === 1 && sign < 0) return [r.walkPt[0], r.walkPt[1] - 1];
  return g.walkLine.interpolate(Math.min(Math.max(r.sWalk + sign, 0), g.walkLine.length));
}

function boundaryLenWithin(pg, zone) {
  if (isEmpty(pg)) return 0;
  return lengthOf(inter(pg.getBoundary(), zone));
}

function buildTreads(g) {
  const { p } = g;
  const nosing = p.treads.nosing;
  const rt = p.risers.install ? p.risers.thickness : 0;
  const tt = p.treads.thickness;
  const housing = p.newel.housing;
  let innerZone = bufferMitre(g.innerPath.ls, 0.05);
  if (g.newel) innerZone = uni(innerZone, bufferMitre(g.newel.getExteriorRing(), 0.05));
  const outerZone = bufferMitre(g.outerPath.ls, 0.05);
  const backZone = bufferMitre(line([[0, g.y1], [0, g.W - 1]]), 0.05);
  const treads = [];
  for (let k = 1; k < g.N; k++) {
    const r0 = g.risers[k - 1], r1 = g.risers[k];
    const d0 = rDir(r0), d1 = rDir(r1);
    const up0 = uphillPoint(g, r0, 1), dn1 = uphillPoint(g, r1, -1);
    const h0 = halfplane(r0.inner, d0, up0), h1 = halfplane(r1.inner, d1, dn1);
    const region = largest(inter(inter(g.footprint, h0), h1));
    const n0 = sideNormal(r0.inner, d0, up0), n1 = sideNormal(r1.inner, d1, dn1);
    const p0 = add(r0.inner, n0, -nosing), p1 = add(r1.inner, n1, -rt);
    let board = largest(inter(inter(g.footprintExt, halfplane(p0, d0, up0)), halfplane(p1, d1, dn1)));
    const sweep = rPerp(r0) ? [-n0[0] * nosing, -n0[1] * nosing] : null;
    board = houseInto(board, g.newel, housing, sweep, 20);
    const regionNet = g.newel ? largest(diff(region, g.newel)) : region;
    const tapered = !(rPerp(r0) && rPerp(r1) && Math.abs(d0[0] - d1[0]) < 1e-9 && Math.abs(d0[1] - d1[1]) < 1e-9);
    treads.push({
      k, zTop: k * g.rise, zBottom: k * g.rise - tt, region: regionNet, board, tapered,
      goingWalk: r1.sWalk - r0.sWalk, goingCentre: r1.sCentre - r0.sCentre,
      narrowEnd: boundaryLenWithin(regionNet, innerZone),
      wideEnd: boundaryLenWithin(regionNet, outerZone),
      touchesBackWall: boundaryLenWithin(regionNet, backZone) > 1,
    });
  }
  g.treads = treads;
}

function chord(pg, p0, d) {
  const ln = line([add(p0, d, -BIG), add(p0, d, BIG)]);
  return lengthOf(inter(pg.buffer(1e-6), ln));
}

function buildRiserBoards(g) {
  const { p } = g;
  if (!p.risers.install) {
    g.riserBoards = [];
    return;
  }
  const rt = p.risers.thickness, tt = p.treads.thickness, housing = p.newel.housing;
  const boards = [];
  for (const r of g.risers) {
    if (r.k === g.N && !p.stair.end_with_riser) continue;
    const d = rDir(r);
    const up = uphillPoint(g, r, 1);
    const n = sideNormal(r.inner, d, up);
    const back = add(r.inner, n, rt);
    let strip = inter(halfplane(r.inner, d, up), halfplane(back, d, add(r.inner, n, -1)));
    const ch = inter(g.footprintExt, rExtendedFar(r));
    const ts = pointsOf(ch).map((q) => (q[0] - r.inner[0]) * d[0] + (q[1] - r.inner[1]) * d[1]);
    const tMin = ts.length ? Math.min(...ts) : 0;
    if (tMin < -1) strip = inter(strip, halfplane(r.inner, [-d[1], d[0]], add(r.inner, d, 1)));
    let plan = largest(inter(g.footprintExt, strip));
    plan = houseInto(plan, g.newel, housing);
    if (isEmpty(plan) || plan.getArea() < 1) continue;
    boards.push({
      k: r.k, z0: (r.k - 1) * g.rise, z1: r.k === g.N ? g.H : r.k * g.rise - tt, plan,
      lengthFront: chord(plan, r.inner, d), lengthBack: chord(plan, back, d),
    });
  }
  g.riserBoards = boards;
}

export { point, poly };
