// Checks against the Finnish safety-in-use rules for a stair inside a dwelling
// (port of rules_fi.py).
//
//   YMa 1007/2017  Ympäristöministeriön asetus rakennuksen käyttöturvallisuudesta
//                  §3 width, §4 rise/going, §6 edge upstand, §7–8 guards,
//                  §9 handrails, §14 headroom
//   YM guide       Rakennuksen käyttöturvallisuus – ohje (2018), 3.1.1: going of
//                  turning stairs is measured 400 mm from the wide end of the
//                  tread; ≥ 100 mm recommended at the inner edge.
// Limits come from p.rules.

import { bounds, blankSize } from './geo.js';

export const PASS = 'PASS', FAIL = 'FAIL', WARN = 'WARN', INFO = 'INFO';

const chk = (ref, rule, value, limit, status, note = '') => ({ ref, rule, value, limit, status, note });
const f0 = (v) => v.toFixed(0);
const f1 = (v) => v.toFixed(1);

export function run(g, parts) {
  const p = g.p, R = p.rules;
  const out = [];
  const r = g.rise;

  out.push(chk('1007/2017 §4', 'Rise (dwelling stair)', f1(r), `≤ ${f0(R.max_rise)}`,
    r <= R.max_rise + 1e-6 ? PASS : FAIL, `${g.N} equal rises`));

  const straight = g.treads.filter((t) => !t.tapered);
  if (straight.length) {
    const gmin = Math.min(...straight.map((t) => t.goingWalk));
    out.push(chk('1007/2017 §4', 'Going, straight treads', f1(gmin), `≥ ${f0(R.min_going)}`,
      gmin >= R.min_going - 1e-6 ? PASS : FAIL, `${straight.length} treads`));
  }

  const tapered = g.treads.filter((t) => t.tapered);
  if (tapered.length) {
    const bad = tapered.filter((t) => t.goingWalk < R.min_going - 0.05);
    const vals = tapered.map((t) => `T${t.k} ${f0(t.goingWalk)}`).join(', ');
    out.push(chk('1007/2017 §4 + YM guide 3.1.1',
      `Going, tapered treads (${f0(R.walking_line_from_outer)} mm from wide end)`,
      `min ${f1(Math.min(...tapered.map((t) => t.goingWalk)))}`, `≥ ${f0(R.min_going)}`,
      bad.length ? FAIL : PASS, vals + (bad.length ? '; fails: ' + bad.map((t) => `T${t.k}`).join(', ') : '')));
    const nmin = Math.min(...tapered.map((t) => t.narrowEnd));
    out.push(chk('YM guide 3.1.1', 'Going at inner edge / newel (recommended)', `min ${f0(nmin)}`,
      `≥ ${f0(R.min_inner_going_recommended)}`, nmin >= R.min_inner_going_recommended - 0.5 ? PASS : WARN,
      tapered.map((t) => `T${t.k} ${f0(t.narrowEnd)}`).join(', ')));
    const cmin = Math.min(...tapered.map((t) => t.goingCentre));
    out.push(chk('info', 'Going of tapered treads at the stair centre line', `min ${f1(cmin)}`, '–', INFO,
      'for comparison only'));
  }

  const formula = g.treads.map((t) => 2 * r + t.goingWalk);
  const lo = R.step_formula - R.step_formula_tol, hi = R.step_formula + R.step_formula_tol;
  const ok = formula.every((f) => lo - 0.05 <= f && f <= hi + 0.05);
  out.push(chk('YM guide', 'Step formula 2R + G (walking line)',
    `${f0(Math.min(...formula))} – ${f0(Math.max(...formula))}`, `${f0(lo)} – ${f0(hi)}`,
    ok ? PASS : WARN, 'comfort; tapered treads at walking line'));

  const W = g.W;
  out.push(chk('1007/2017 §3', 'Stair width (inside an evacuation area)', f0(W), `≥ ${f0(R.min_width)}`,
    W >= R.min_width - 1e-6 ? PASS : FAIL,
    'handrails / skirting may project into it; keep balusters, wall linings and stringers outside the ' + f0(R.min_width)));
  if (g.newel && (p.newel.position === 'inside' || p.newel.position === 'centre')) {
    const nb = bounds(g.newel);
    const local = W - Math.max(0, nb[3]);
    out.push(chk('1007/2017 §3', 'Clear width beside the newel at the turn', f0(local), `≥ ${f0(R.min_width)}`,
      local < R.min_width ? WARN : PASS,
      'newel stands inside the width; usually accepted at a turn – confirm with the inspector'));
  }

  if (p.building.slab_overhang > 0) {
    const hmin = headroom(g);
    out.push(chk('1007/2017 §14', 'Headroom above nosing line', f0(hmin), `≥ ${f0(R.min_headroom)}`,
      hmin >= R.min_headroom ? PASS : FAIL, 'vertical, under the upper slab edge'));
  } else {
    out.push(chk('1007/2017 §14', 'Headroom above nosing line', 'open', `≥ ${f0(R.min_headroom)}`, INFO,
      'no slab over the stair: opening over the whole stair – verify on site'));
  }

  const G = parts.guard;
  const fall = g.H;
  const req = fall < 3000 ? 900 : fall <= 6000 ? 1000 : 1200;
  if (G && G.rail) {
    out.push(chk('1007/2017 §7', 'Guard height above nosings (open side)', f0(G.rail.clearMin), `≥ ${f0(req)}`,
      G.rail.clearMin >= req - 0.5 ? PASS : FAIL,
      `fall height ${f0(fall)} mm; straight rail up to ${f0(G.rail.over)} mm higher`));
    out.push(chk('1007/2017 §7', 'Protective guard, no climbable rails', 'vertical balusters', 'required (children)',
      PASS, 'keep infill vertical only'));
    out.push(chk('1007/2017 §8', 'Gap between balusters', f1(G.gap), `≤ ${f0(p.guard.max_gap)}`,
      G.gap <= p.guard.max_gap ? PASS : FAIL, `${G.balusters.length} balusters ${f0(p.guard.baluster)} mm`));
    out.push(chk('1007/2017 §8', 'Gap under the protective part', 'balusters run past tread edge', '≤ 50', PASS,
      'side-mounted on the outer face of the inner stringer'));
  }

  if (p.risers.install) {
    out.push(chk('1007/2017 §8', 'Opening between treads', 'closed risers', '≤ 100', PASS));
  } else {
    const gap = r - p.treads.thickness;
    out.push(chk('1007/2017 §8', 'Opening between treads (open risers)', f0(gap), `≤ ${f0(R.max_open_riser_gap)}`,
      gap <= R.max_open_riser_gap ? PASS : FAIL));
  }

  const both = p.guard.wall_handrails && parts.wallRails.length > 0;
  out.push(chk('1007/2017 §9', 'Handrail on both sides, full length', both ? 'both sides' : 'open side only',
    'both sides', both ? PASS : FAIL, 'wall rail continuous along both walls through the turn'));
  out.push(chk('1007/2017 §9', 'Handrail continues past start and end', '–', 'past first/last nosing', INFO,
    '300 mm extension required only in public spaces'));

  out.push(chk('1007/2017 §6', 'Gap tread edge – wall / guard', '0', '≤ 50 (else upstand)', PASS,
    'treads run to the wall face; fill any wall gap > 50 mm'));
  return out;
}

export function headroom(g) {
  const p = g.p;
  const under = g.H - p.building.slab_thickness;
  const xo = p.building.slab_overhang;
  let best = 1e9;
  for (const t of g.treads) if (bounds(t.board)[0] < xo) best = Math.min(best, under - t.zTop);
  return best;
}

export function constructionChecks(g, parts) {
  const p = g.p;
  const out = [];
  for (const st of parts.stringers) {
    out.push(chk('construction', `Stringer ${st.key} timber under notches`, f0(st.throat), `≥ ${f0(p.stringers.min_throat)}`,
      st.throat >= p.stringers.min_throat ? PASS : WARN, st.warnings.join('; ')));
  }
  const longT = g.treads.filter((t) => t.tapered && blankSize(t.board)[0] > 1100);
  if (longT.length) {
    out.push(chk('construction', 'Long winder treads', longT.map((t) => `T${t.k}`).join(', '), '–', INFO,
      'use glued panels; check span between supports'));
  }
  return out;
}

export function summaryLine(checks) {
  const nFail = checks.filter((c) => c.status === FAIL).length;
  const nWarn = checks.filter((c) => c.status === WARN).length;
  if (nFail) return `${nFail} FAIL, ${nWarn} WARN`;
  return `all required checks pass (${nWarn} WARN)`;
}

export function counts(checks) {
  const c = { PASS: 0, FAIL: 0, WARN: 0, INFO: 0 };
  for (const x of checks) c[x.status]++;
  return c;
}
