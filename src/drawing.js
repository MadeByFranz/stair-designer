// Construction drawings (port of drawing.py): plan, elevation, walking-line
// development, newel faces, stringers laid flat and treads, drawn into display
// lists in model millimetres.

import {
  BIG, add, box, bounds, centroid, diff, inter, interiorPoint, isEmpty, line, point, poly, polylabel, pointsOf,
  uni, unionAll, unit, bufferMitre, convexHull, exterior, emptyPoly, translate, largest, polygonsOf,
} from './geo.js';
import { rExtendedFar } from './geometry.js';
import { railZ } from './parts.js';
import { boardFrame, treadLocal } from './frames.js';
import { Pen } from './pen.js';

// ------------------------------------------------------------------ helpers
function segDims(pen, values, fixed, base, axis, minLen = 1, crowd = 170) {
  // chain dimension through sorted values; short segments alternate rows
  const vals = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const away = base >= fixed ? 1 : -1;
  const out = [];
  let flip = false;
  for (let i = 0; i + 1 < vals.length; i++) {
    const a = vals[i], b = vals[i + 1];
    if (b - a < minLen) continue;
    const short = b - a < crowd;
    const row = base + (short && flip ? away * 110 : 0);
    flip = short ? !flip : false;
    if (axis === 'x') pen.dim([a, fixed], [b, fixed], [a, row], 0);
    else pen.dim([fixed, a], [fixed, b], [row, a], 90);
    out.push(b - a);
  }
  return out;
}

function title(dl, pen, ttl, sub) {
  // title above a drawing's extents (drawing coordinates, never mirrored)
  const [x0, , , y1] = pen.bbox();
  const t = new Pen(dl, 0, 0, 1, 1, pen.ts);
  t.text(sub, [x0, y1 + 90], 1.8, { align: 'BL' });
  t.text(ttl, [x0, y1 + 180], 3.5, { align: 'BL' });
  const b = t.bbox();
  pen.bb[3] = Math.max(pen.bb[3], b[3]);
  pen.bb[2] = Math.max(pen.bb[2], b[2]);
}

const deg = (r) => (r * 180) / Math.PI;

// --------------------------------------------------------------------- plan
export function drawPlan(dl, g, P, ox = 0, oy = 0) {
  const p = g.p;
  const sy = p.stair.turn === 'right' ? 1 : -1;
  const pen = new Pen(dl, ox, oy, 1, sy);
  const W = g.W;
  const Tw = p.building.wall_thickness;
  const rt = p.risers.install ? p.risers.thickness : 0;
  const nos = p.treads.nosing;
  const xe = g.xEnd + rt;
  const ymin = Math.min(g.y1 - nos, -p.guard.baluster) - 200;

  const walls = unionAll([box(-Tw, ymin, 0, W + Tw), box(-Tw, W, xe + 500, W + Tw)]);
  pen.shape(walls, 'A-WALL');
  pen.hatch(walls, 'A-HATCH', 'ANSI31', 25);
  const upper = box(xe, 0, xe + 500, W);
  pen.shape(upper, 'A-SLAB');
  pen.hatch(upper, 'A-HATCH', 'ANSI31', 60);
  pen.text('UPPER FLOOR', [xe + 250, W / 2 + 60], 2.0);
  pen.text(`+${g.H.toFixed(0)}`, [xe + 250, W / 2 - 60], 2.0);

  // treads (visible parts), riser faces (hidden)
  g.treads.forEach((t, i) => {
    let vis = t.board;
    if (i + 1 < g.treads.length) vis = diff(vis, g.treads[i + 1].board);
    if (g.newel) vis = diff(vis, g.newel);
    pen.shape(vis, 'S-TREAD');
  });
  for (const rb of g.riserBoards) {
    const r = g.risers[rb.k - 1];
    const edge = inter(rExtendedFar(r), rb.plan.buffer(0.05));
    pen.shape(edge, rb.k === g.N ? 'S-TREAD' : 'S-RISER');
  }
  for (const st of P.stringers) {
    pen.shape(st.plan.getExteriorRing(), 'S-STRINGER');
    const c = centroid(st.plan);
    const rot = deg(Math.atan2(st.axis[1] * sy, st.axis[0]));
    const lab = add(c, st.normal, st.key.startsWith('S1') ? -60 : 70);
    pen.text(st.key, lab, 1.6, { rot: Math.abs(rot) <= 90 ? rot : rot - 180, color: 4 });
  }
  for (const j of P.joists) {
    pen.shape(j.plan, 'S-JOIST');
    pen.text(j.key, centroid(j.plan), 1.4, { color: 6 });
  }
  if (g.newel) {
    pen.shape(g.newel, 'S-NEWEL');
    const [x0, y0, x1, y1] = bounds(g.newel);
    pen.line([x0, y0], [x1, y1], 'S-NEWEL');
    pen.line([x0, y1], [x1, y0], 'S-NEWEL');
    if (p.newel.position !== 'outside') pen.text('N1', [0.5 * (x0 + x1), y0 - 90], 1.8);
    else pen.text('N1', [x0 - 30, 0.5 * (y0 + y1)], 1.8, { align: 'MR' });
  }
  const G = P.guard;
  const b = p.guard.baluster;
  if (G) {
    for (const [xc] of G.balusters) pen.shape(box(xc - b / 2, -b, xc + b / 2, 0), 'S-GUARD');
    const hw = p.guard.handrail_width;
    pen.shape(box(G.xStart, -b / 2 - hw / 2, G.xEnd, -b / 2 + hw / 2), 'S-GUARD');
    pen.text('H1', [G.xEnd - 300, -b / 2 - hw / 2 - 70], 1.6, { color: 5 });
  }
  P.wallRails.forEach((wr, i) => {
    const o = 45 + 22.5;
    const back = wr.name.startsWith('back');
    const pts = back ? [[o, wr.sFrom], [o, W - o]] : [[o, W - o], [g.xEnd, W - o]];
    pen.shape(bufferMitre(line(pts), 22.5), 'S-RAIL');
    const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    pen.text(`H${i + 2}`, [mid[0] + (back ? 70 : 0), mid[1] - (back ? 0 : 70)], 1.6, { color: 5 });
  });

  // minimum floor opening for the headroom rule
  const zlim = g.H - p.building.slab_thickness - p.rules.min_headroom;
  const need = g.treads.filter((t) => t.zTop > zlim).map((t) => t.board);
  if (need.length) {
    let opening = unionAll([...need, box(g.xEnd, 0, xe, W)]);
    opening = bufferMitre(bufferMitre(opening, 1), -1);
    const pg = opening.getGeometryType() === 'Polygon' ? opening : convexHull(opening);
    pen.shape(pg.getExteriorRing(), 'S-OPENING');
  }

  // walking line with the Finnish stair arrow (circle at the bottom, arrow at the top)
  const wl = g.walkLine.pts;
  pen.pline(wl, 'S-WALKLINE');
  pen.circle(wl[0], 35, 'S-WALKLINE');
  const tip = wl[wl.length - 1];
  pen.hatch(poly([tip, [tip[0] - 120, tip[1] + 40], [tip[0] - 120, tip[1] - 40]]), 'S-WALKLINE', 'SOLID', 1, true, 1);
  pen.text(`walking line, ${p.rules.walking_line_from_outer.toFixed(0)} from wall`, [wl[0][0], g.y1 - nos - 75], 1.4, { color: 1 });

  // tread numbers + levels, goings on the walking line
  for (const t of g.treads) {
    const reg = !isEmpty(t.region) ? t.region : t.board;
    let c;
    if (t.tapered) c = polylabel(reg, 2.0);
    else {
      const bx = bounds(reg);
      c = [0.5 * (bx[0] + bx[2]), W - 150];
    }
    pen.text(`${t.k}`, [c[0], c[1] + 35], 2.5);
    pen.text(`+${t.zTop.toFixed(1)}`, [c[0], c[1] - 45], 1.3, { color: 8 });
    const r0 = g.risers[t.k - 1], r1 = g.risers[t.k];
    const sm = 0.5 * (r0.sWalk + r1.sWalk);
    const m = g.walkLine.interpolate(sm);
    const q = g.walkLine.interpolate(Math.min(sm + 1, g.walkLine.length));
    const [tx, ty] = Math.hypot(q[0] - m[0], q[1] - m[1]) > 1e-6 ? unit([q[0] - m[0], q[1] - m[1]]) : [1, 0];
    const nOut = [-ty, tx];
    const fail = t.goingWalk < p.rules.min_going - 0.05;
    pen.text(`${t.goingWalk.toFixed(0)}`, add(m, nOut, 55), 1.5, { color: fail ? 1 : 94 });
    if (fail) pen.circle(m, 140, 'S-CHECK');
  }

  // dimensions
  const sideX = [...new Set([...g.risers.filter((r) => Math.abs(r.outer[1] - W) < 1e-6).map((r) => r.outer[0]), 0, g.xEnd])];
  segDims(pen, sideX, W + Tw, W + Tw + 230, 'x');
  pen.dim([0, W + Tw], [g.xEnd, W + Tw], [0, W + Tw + 480], 0);
  const backY = [...g.risers.filter((r) => Math.abs(r.outer[0]) < 1e-6).map((r) => r.outer[1]), W, ...(g.y1 < -1e-6 ? [0] : [])];
  segDims(pen, backY, -Tw, -Tw - 230, 'y');
  const innerX = [...g.risers.filter((r) => Math.abs(r.inner[1]) < 1e-6).map((r) => r.inner[0]), 0, W, g.xEnd];
  segDims(pen, innerX, ymin + 150, ymin - 120, 'x');
  pen.dim([xe + 500, 0], [xe + 500, W], [xe + 700, 0], 90);
  title(dl, pen, 'PLAN', `${p.stair.turn} turn, viewed from above; dashed = under the treads`);
  return pen.bbox();
}

// ---------------------------------------------------------------- elevation
export function drawElevation(dl, g, P, ox = 0, oy = 0) {
  // view from the open side, hidden parts removed (painter's algorithm)
  const p = g.p;
  const sx = p.stair.turn === 'right' ? 1 : -1;
  const pen = new Pen(dl, ox, oy, sx, 1);
  const W = g.W, H = g.H;
  const Tw = p.building.wall_thickness;
  const rt = p.risers.install ? p.risers.thickness : 0;
  const xe = g.xEnd + rt;
  const slab = p.building.slab_thickness;
  const items = [];
  const addItem = (depth, pg, layer, hatch = null) => {
    if (pg && !isEmpty(pg) && pg.getArea() > 0.5) items.push([depth, pg, layer, hatch]);
  };
  addItem(-1e9, box(-Tw, 0, 0, H + 300), 'A-WALL', 'ANSI31');
  addItem(-1e9, box(xe, H - slab, xe + 600, H), 'A-SLAB', 'ANSI31');
  if (p.building.slab_overhang > 0) addItem(-1e9, box(0, H - slab, p.building.slab_overhang, H), 'A-SLAB', 'ANSI31');
  const G = P.guard;
  const b = p.guard.baluster;
  if (G) {
    const rp = G.rail.pts;
    addItem(5e4, poly([...rp, ...[...rp].reverse().map(([s, z]) => [s, z - p.guard.handrail_thickness])]), 'S-GUARD');
    for (const [xc, zb, zt] of G.balusters) addItem(5e4 + 1, box(xc - b / 2, zb, xc + b / 2, zt), 'S-GUARD');
  }
  if (g.newel && P.newel) {
    const [x0, y0, x1, y1] = bounds(g.newel);
    addItem(0.5 * (y0 + y1) - 1e3 * (y0 < -1 ? 1 : 0), box(x0, 0, x1, P.newel.zTop), 'S-NEWEL');
  }
  for (const st of P.stringers) {
    const depth = centroid(st.plan)[1];
    if (Math.abs(st.axis[0]) > 0.5) addItem(depth, st.outline, 'S-STRINGER-V');
    else {
      const zb = bounds(st.outline), xs = bounds(st.plan);
      addItem(depth, box(xs[0], zb[1], xs[2], zb[3]), 'S-STRINGER-V');
    }
  }
  for (const t of g.treads) {
    const bx = bounds(t.board);
    addItem(centroid(t.board)[1], box(bx[0], t.zBottom, bx[2], t.zTop), 'S-TREAD');
  }
  for (const rb of g.riserBoards) {
    const bx = bounds(rb.plan);
    addItem(centroid(rb.plan)[1], box(bx[0], rb.z0, bx[2], rb.z1), 'S-TREAD');
  }
  for (const j of P.joists) {
    const bx = bounds(j.plan);
    addItem(centroid(j.plan)[1], box(bx[0], j.z0, bx[2], j.z1), 'S-JOIST');
  }
  items.sort((a, c) => a[0] - c[0]);
  let covered = emptyPoly();
  for (const [, pg, layer, hatch] of items) {
    const vis = isEmpty(covered) ? pg : diff(pg, covered);
    if (!isEmpty(vis)) {
      pen.shape(vis, layer);
      if (hatch) pen.hatch(vis, 'A-HATCH', hatch, 25);
    }
    covered = isEmpty(covered) ? pg : uni(covered, pg);
  }
  // floor lines
  pen.line([-Tw - 200, 0], [xe + 800, 0], 'A-WALL');
  pen.line([xe + 600, H], [xe + 800, H], 'A-SLAB');
  pen.text('±0', [xe + 700, 60], 1.8);
  pen.text(`+${H.toFixed(0)}`, [xe + 700, H + 60], 1.8);
  // pitch label on the straight flight
  const straight = g.treads.filter((t) => !t.tapered);
  if (straight.length >= 2) {
    const nos = p.treads.nosing;
    const t0 = straight[0], t1 = straight[straight.length - 1];
    const x0n = g.risers[t0.k - 1].inner[0] - nos;
    const x1n = g.risers[t1.k - 1].inner[0] - nos;
    const ang = deg(Math.atan2(t1.zTop - t0.zTop, x1n - x0n));
    pen.text(`pitch ${ang.toFixed(1)}°`, [0.5 * (x0n + x1n) + 150, 0.5 * (t0.zTop + t1.zTop) - 520], 1.8, { rot: sx * ang });
  }
  // headroom: the upper slab may only be above treads lower than this level
  const zlim = H - slab - p.rules.min_headroom;
  pen.line([-Tw, H - slab], [xe, H - slab], 'S-HELP');
  pen.text(`slab underside +${(H - slab).toFixed(0)}: no slab above treads higher than +${zlim.toFixed(0)} ` +
    `(headroom ${p.rules.min_headroom.toFixed(0)}) – see min. opening in plan`,
  [60, H - slab + 50], 1.5, { align: sx > 0 ? 'BL' : 'BR', color: 8 });
  // guard height at the middle baluster
  if (G && G.balusters.length) {
    const xc = G.balusters[Math.floor(G.balusters.length / 2)][0];
    let nz = null;
    for (const [s_, z_] of G.nosings) if (s_ <= xc) nz = [s_, z_];
    if (nz) {
      const ztop = railZ(G.rail, nz[0]);
      pen.dim([nz[0], nz[1]], [nz[0], ztop], [nz[0] - 160, nz[1]], 90);
    }
  }
  // tread levels at the open side
  for (const t of g.treads) {
    const bx = bounds(t.board);
    pen.text(`+${t.zTop.toFixed(1)}`, [bx[0] - 20, t.zTop + 50], 1.4, { align: 'BR', color: 8 });
  }
  // overall dims
  pen.dim([-Tw, 0], [-Tw, H], [-Tw - 380, 0], 90);
  pen.text(`${g.N} × ${g.rise.toFixed(2)}`, [-Tw - 520, H / 2], 1.8, { rot: 90 });
  pen.dim([0, 0], [g.xEnd, 0], [0, -320], 0);
  if (g.newel && P.newel) {
    const nb = bounds(g.newel);
    pen.text('N1', [(nb[0] + nb[2]) / 2, P.newel.zTop + 80], 1.8);
  }
  for (const s of P.stringers.filter((st) => st.key.startsWith('S1'))) {
    const mx = 0.5 * (s.s0 + s.s1);
    const mz = s.bottomLine[0] + s.bottomLine[1] * mx;
    pen.text(s.key, [mx, mz - 90], 1.8, { color: 4 });
  }
  if (G) pen.text('H1', [G.xEnd - 200, railZ(G.rail, G.xEnd - 200) + 80], 1.8, { color: 5 });
  title(dl, pen, 'ELEVATION', 'view from the open side; hidden parts not shown; guard drawn behind the stair for clarity');
  return pen.bbox();
}

// -------------------------------------------------------------- development
export function drawDevelopment(dl, g, P, ox = 0, oy = 0) {
  const p = g.p;
  const pen = new Pen(dl, ox, oy);
  const H = g.H, r = g.rise;
  const s = g.risers.map((rr) => rr.sWalk);
  const prof = [[-300, 0], [s[0], 0]];
  for (let k = 1; k < g.N; k++) prof.push([s[k - 1], k * r], [s[k], k * r]);
  prof.push([s[s.length - 1], H], [s[s.length - 1] + 400, H]);
  pen.pline(prof, 'S-TREAD', false, { lw: 50 });
  pen.line([s[0] - 300, 0], [s[0], 0], 'A-WALL');
  const nose = [];
  for (let k = 1; k < g.N; k++) nose.push([s[k - 1], k * r]);
  nose.push([s[s.length - 1], H]);
  pen.pline(nose, 'S-HELP');
  for (const t of g.treads) {
    const a = s[t.k - 1], b = s[t.k];
    const fail = t.goingWalk < p.rules.min_going - 0.05;
    pen.dim([a, t.zTop], [b, t.zTop], [a, t.zTop + 130], 0, { color: fail ? 1 : undefined });
    pen.text(`T${t.k}`, [0.5 * (a + b), t.zTop - 70], 1.5, { color: 8 });
    const f = 2 * r + t.goingWalk;
    pen.text(`${f.toFixed(0)}`, [0.5 * (a + b), t.zTop - 150], 1.3, { color: fail ? 1 : 94 });
    if (fail) pen.circle([0.5 * (a + b), t.zTop + 60], 160, 'S-CHECK');
  }
  const sl = s[s.length - 1];
  pen.dim([sl + 400, 0], [sl + 400, H], [sl + 650, 0], 90);
  pen.dim([s[0], 0], [sl, 0], [s[0], -300], 0);
  pen.text(`rise ${g.rise.toFixed(2)} × ${g.N}`, [sl + 820, H / 2], 1.8, { rot: 90 });
  pen.text('small numbers = 2R + G', [s[0], -560], 1.5, { align: 'BL', color: 94 });
  pen.text('DEVELOPMENT ALONG THE WALKING LINE', [s[0] - 300, H + 520], 3.5, { align: 'BL' });
  pen.text(`${p.rules.walking_line_from_outer.toFixed(0)} mm from the wall (wide end) – goings measured here`,
    [s[0] - 300, H + 430], 1.8, { align: 'BL' });
  return pen.bbox();
}

// --------------------------------------------------------------- newel post
const HOUSING_COLORS = { tread: 7, riser: 3, stringer: 4, joist: 6 };
export function housingLabel(element) {
  const [kind, id] = element.split(' ');
  return /^[A-Za-z]/.test(id) ? id : kind[0].toUpperCase() + id;
}

export function drawNewel(dl, NP, ox = 0, oy = 0, ts = 20, layerCut = 'S-NEWEL', layerMark = 'S-TEXT') {
  const pen = new Pen(dl, ox, oy, 1, 1, ts);
  if (!NP) return pen.bbox();
  const w = NP.size[0];
  const gap = 6 * ts;
  NP.faces.forEach(([fno], i) => {
    const fx = i * (w + gap);
    pen.pline([[fx, 0], [fx + w, 0], [fx + w, NP.zTop], [fx, NP.zTop]], layerCut, true);
    pen.text(`face ${fno}`, [fx + w / 2, NP.zTop + 2.5 * ts], 1.8);
    for (const h of NP.housings.filter((hh) => hh.face === fno)) {
      const rect = box(fx + h.u0, h.z0, fx + h.u1, h.z1);
      const col = HOUSING_COLORS[h.element.split(' ')[0]] ?? 7;
      pen.shape(rect, layerMark, { color: col });
      if (h.kind === 'housed') pen.hatch(rect, layerMark, 'ANSI31', 0.25 * ts, false, col);
      pen.text(housingLabel(h.element), [fx + w + 0.6 * ts, 0.5 * (h.z0 + h.z1)], 1.1, { align: 'ML', color: col });
    }
  });
  pen.text('NEWEL POST N1 – faces', [0, NP.zTop + 7 * ts], 3.0, { align: 'BL' });
  pen.text(`${NP.size[0].toFixed(0)}×${NP.size[1].toFixed(0)}, height ${NP.zTop.toFixed(0)}; hatched = housed ` +
    `${(NP.housings.length ? NP.housings[0].depth : 0).toFixed(0)} mm, outline = butt/tenon`, [0, NP.zTop + 5 * ts], 1.5, { align: 'BL' });
  const kx = 4 * (w + gap) + 1.5 * gap;
  const sq = box(kx, NP.zTop - 6 * ts - w, kx + w, NP.zTop - 6 * ts);
  pen.shape(sq, layerCut);
  const c = centroid(sq);
  for (const [fno, , , nrm] of NP.faces) {
    pen.text(String(fno), [c[0] + nrm[0] * (w / 2 + 1.5 * ts), c[1] + nrm[1] * (w / 2 + 1.5 * ts)], 1.4);
  }
  pen.text('key (plan)', [c[0], bounds(sq)[1] - 3 * ts], 1.3);
  return pen.bbox();
}

// ------------------------------------------------------- stringers (flat)
export function stringerFlatGeom(st) {
  // outline and face-B profile in the board frame (u along the top edge, y = -v)
  const f = boardFrame(st);
  const tr = (q) => {
    const [u, v] = f(q[0], q[1]);
    return [u, -v];
  };
  let outline = poly(exterior(st.outline).map(tr));
  const umin = bounds(outline)[0];
  outline = translate(outline, -umin, 0);
  const pb = st.profileB.map(tr).map(([u, v]) => [u - umin, v]);
  const seats = st.seats.map(([k, a, b, z]) => {
    const [ua, va] = tr([a, z]), [ub, vb] = tr([b, z]);
    return [k, ua - umin, va, ub - umin, vb, z];
  });
  let floor = null;
  if (bounds(st.outline)[1] <= 0.01) {
    const p0 = tr([st.s0 - 5000, 0]), p1 = tr([st.s1 + 5000, 0]);
    floor = inter(line([[p0[0] - umin, p0[1]], [p1[0] - umin, p1[1]]]), outline.buffer(0.5));
  }
  return { outline, pb, seats, floor };
}

export function drawStringerFlat(dl, st, ox, oy, ts = 10, layerCut = 'S-PART', layerMark = 'S-HELP', detail = false) {
  const pen = new Pen(dl, ox, oy, 1, 1, ts);
  const { outline, pb, seats, floor } = stringerFlatGeom(st);
  pen.shape(outline, layerCut);
  const L = bounds(outline)[2];
  pen.pline([[0, 0], [L, 0], [L, -st.width], [0, -st.width]], layerMark, true);
  if (pb.length >= 2) {
    const clip = box(-10, -st.width - 10, L + 10, 10);
    pen.shape(inter(line(pb), clip), detail ? 'T-MARK' : 'S-HELP', { color: 3 });
  }
  for (const [k, ua, va, ub, , z] of seats) {
    pen.text(`T${k}`, [0.5 * (ua + ub), va - 2.2 * ts], 1.6);
    pen.text(`+${z.toFixed(1)}`, [0.5 * (ua + ub), va - 4.4 * ts], 1.1, { color: 8 });
    if (detail) pen.text(`u${ua.toFixed(1)} v${(-va).toFixed(1)}`, [ua, va + 1.2 * ts], 0.9, { align: 'BL', color: 3 });
  }
  if (floor && !isEmpty(floor)) pen.text('floor', centroid(floor), 1.2, { color: 8 });
  pen.text(`${st.key}  ${st.name}`, [0, 3.2 * ts], 2.2, { align: 'BL' });
  pen.text(`board ${L.toFixed(0)} × ${st.width.toFixed(0)} × ${st.thickness.toFixed(0)}   pitch ${st.pitchDeg.toFixed(1)}°   ` +
    `throat ${st.throat.toFixed(0)}   solid = face A (${st.faceA}), dashed green = face B (${st.faceB})`,
  [0, 1.2 * ts], 1.3, { align: 'BL', color: 8 });
  st.warnings.forEach((w, i) => pen.text('! ' + w, [0, -st.width - (2.2 + 1.8 * i) * ts], 1.3, { align: 'TL', color: 1 }));
  return pen.bbox();
}

// ------------------------------------------------------------------- treads
export function drawTread(dl, g, P, t, ox, oy, ts = 10, detail = false, layerCut = 'S-PART') {
  const pen = new Pen(dl, ox, oy, 1, 1, ts);
  const { poly: pg, tf } = treadLocal(g, t);
  pen.shape(pg, layerCut);
  const mk = detail ? 'T-MARK' : 'S-HELP';
  for (const r of [g.risers[t.k - 1], g.risers[t.k]]) {
    pen.shape(inter(tf(rExtendedFar(r)), pg.buffer(0.5)), mk, { color: 3 });
  }
  pen.shape(inter(tf(g.walkLine.ls), pg), detail ? 'T-AXIS' : 'S-WALKLINE');
  const bx = bounds(pg);
  const c = interiorPoint(pg);
  pen.text(`T${t.k}`, [c[0], c[1] + 1.5 * ts], detail ? 3.0 : 2.4);
  pen.text(`top +${t.zTop.toFixed(1)}`, [c[0], c[1] - 1.5 * ts], 1.4, { color: 8 });
  if (detail) {
    pen.text(`going ${t.goingWalk.toFixed(1)} on walking line`, [c[0], c[1] - 3.5 * ts], 1.1, { color: 8 });
    const y = bx[1] + 0.25 * (bx[3] - bx[1]);
    const x0 = bx[0] + 0.3 * (bx[2] - bx[0]), x1 = bx[0] + 0.7 * (bx[2] - bx[0]);
    pen.line([x0, y], [x1, y], 'T-TEXT');
    pen.line([x1, y], [x1 - 2 * ts, y + 0.8 * ts], 'T-TEXT');
    pen.line([x1, y], [x1 - 2 * ts, y - 0.8 * ts], 'T-TEXT');
    pen.text('grain', [0.5 * (x0 + x1), y + 1.2 * ts], 1.0);
  }
  const pts = exterior(pg);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < (detail ? 6 : 40)) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let ang = deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const inside = pg.contains(point(mid[0] + nx * 3, mid[1] + ny * 3));
    const off = (inside ? -1 : 1) * 1.3 * ts;
    if (ang > 90 || ang < -90) ang -= 180;
    pen.text(L.toFixed(1), [mid[0] + nx * off, mid[1] + ny * off], detail ? 1.4 : 1.8, { rot: ang, color: 94 });
  }
  pen.text('nosing edge', [0.5 * (bx[0] + bx[2]), bx[1] - 2.6 * ts], 1.0, { color: 8 });
  return pen.bbox();
}
