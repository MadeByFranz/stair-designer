// Local frames for laying parts flat: stringer board frame (u along the top
// edge, v square in from it) and the tread frame (x along the nosing edge from
// the inner end, y into the tread).

import { bounds, rotate, scale, translate, pointsOf, point } from './geo.js';
import { rDir } from './geometry.js';

export function boardFrame(st) {
  const [c, slope] = st.topLine;
  const th = Math.atan(slope);
  const ct = Math.cos(th), sn = Math.sin(th);
  const s0 = st.s0;
  const z0 = c + slope * s0;
  return (s, z) => {
    const ds = s - s0, dz = z - z0;
    return [ds * ct + dz * sn, ds * sn - dz * ct];
  };
}

export function stringerMarks(st) {
  const f = boardFrame(st);
  const us = pointsOf(st.outline.getExteriorRing()).map((q) => f(q[0], q[1])[0]);
  const uMin = Math.min(...us), uMax = Math.max(...us);
  const rows = st.seats.map(([k, a, b, z]) => {
    const [ua, va] = f(a, z), [ub, vb] = f(b, z);
    return [k, ua - uMin, va, ub - uMin, vb, z];
  });
  return { rows, length: uMax - uMin };
}

// Tread board in its own frame. Returns { poly, tf } where tf maps any
// canonical-plan geometry into the same frame.
export function treadLocal(g, t) {
  const r = g.risers[t.k - 1];
  const d = rDir(r);
  const ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  const q0 = rotate(t.board, -ang, [0, 0]);
  const c = q0.getCentroid();
  const pin = rotate(point(r.inner[0], r.inner[1]), -ang, [0, 0]);
  let fl = c.getY() < pin.getCoordinate().y ? -1 : 1;
  if (g.p.stair.turn === 'left') fl = -fl;
  const tf = (geom) => {
    let q = rotate(geom, -ang, [0, 0]);
    if (fl < 0) q = scale(q, 1, -1, [0, 0]);
    return q;
  };
  const bx = bounds(tf(t.board));
  const tf2 = (geom) => translate(tf(geom), -bx[0], -bx[1]);
  return { poly: tf2(t.board), tf: tf2 };
}
