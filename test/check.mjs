// Engine regression + robustness test:  npm install && npm test
// Loads JSTS (UMD) into the global scope, runs presets A and B against the
// numbers of the Python tool, then sweeps odd inputs through the whole
// pipeline (geometry → parts → rules → report → drawings → sheets → DXF).
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const jstsPath = process.env.JSTS || path.join(here, '..', 'node_modules', 'jsts', 'dist', 'jsts.min.js');
vm.runInThisContext(fs.readFileSync(jstsPath, 'utf8'));
if (!globalThis.jsts) throw new Error('JSTS did not load from ' + jstsPath);

const S = '../src/';
const { PRESETS, clone, validate } = await import(S + 'params.js');
const { build, StairError } = await import(S + 'geometry.js');
const { buildParts } = await import(S + 'parts.js');
const rules = await import(S + 'rules.js');
const report = await import(S + 'report.js');
const sheets = await import(S + 'sheets.js');
const { toDxf } = await import(S + 'dxf.js');

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fails++;
    console.log('  FAIL', msg);
  }
};
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

function run(p) {
  const g = build(p);
  const P = buildParts(g);
  const checks = rules.run(g, P);
  const cons = rules.constructionChecks(g, P);
  const rows = report.cutlist(g, P);
  const md = report.markdown(g, P, checks, cons, rows, { date: '2026-01-01' });
  const V = sheets.modelViews(g, P);
  const sh = sheets.buildSheets(g, P, checks, V, '2026-01-01');
  const tpl = sheets.buildTemplates(g, P);
  const dxf = toDxf(Object.values(V).filter(Boolean).flatMap((v) => v.dl.items));
  report.csv(rows);
  return { g, P, checks, cons, rows, md, V, sh, tpl, dxf };
}

// ---- presets against the Python tool
console.log('Preset A (architect, radial)');
{
  const r = run(clone(PRESETS.A));
  near(r.g.rise, 185.714, 0.01, 'rise');
  near(r.g.treads[0].goingWalk, 186.4, 0.1, 'T1 going');
  near(r.g.treads[3].goingWalk, 186.4, 0.1, 'T4 going');
  near(r.g.treads[5].goingWalk, 258.7, 0.1, 'straight going');
  const s1 = r.P.stringers.find((s) => s.key === 'S1');
  near(s1.pitchDeg, 35.7, 0.05, 'S1 pitch');
  near(s1.throat, 149, 1, 'S1 throat');
  near(r.P.newel.zTop, 1920, 0.5, 'newel top');
  ok(r.P.guard.balusters.length === 16, 'balusters ' + r.P.guard.balusters.length);
  near(r.P.guard.gap, 90.9, 0.1, 'baluster gap');
  ok(rules.counts(r.checks).FAIL === 1, 'one FAIL');
  ok(r.sh.length === 5, 'five sheets');
}
console.log('Preset B (balanced)');
{
  const r = run(clone(PRESETS.B));
  near(r.g.treads[0].goingWalk, 250.2, 0.1, 'going');
  const inner = r.g.layoutNotes[0].match(/inner goings (.*)$/)[1];
  ok(inner === '109, 100, 109, 119, 128, 138, 147', 'inner goings ' + inner);
  ok(rules.counts(r.checks).FAIL === 0, 'no FAIL');
}

// ---- robustness sweep
const variants = [
  ['left turn', (p) => (p.stair.turn = 'left')],
  ['open risers', (p) => (p.risers.install = false)],
  ['no newel', (p) => (p.newel.position = 'none')],
  ['centre newel', (p) => (p.newel.position = 'centre')],
  ['outside newel', (p) => (p.newel.position = 'outside')],
  ['2 lower steps', (p) => { p.stair.lower_steps = 2; p.stair.total_run_lower = 1375; p.stair.upper_steps = 7; }],
  ['3 winders', (p) => (p.stair.winders = 3)],
  ['2 winders', (p) => (p.stair.winders = 2)],
  ['6 winders', (p) => (p.stair.winders = 6)],
  ['1 winder', (p) => (p.stair.winders = 1)],
  ['no end riser', (p) => (p.stair.end_with_riser = false)],
  ['slab overhang 2000', (p) => (p.building.slab_overhang = 2000)],
  ['no wall rails', (p) => (p.guard.wall_handrails = false)],
  ['joists none', (p) => (p.joists.mode = 'none')],
  ['joists all', (p) => (p.joists.mode = 'all_tapered')],
  ['wide 1200', (p) => { p.stair.width = 1200; p.stair.total_run_lower = 1200; p.stair.total_run = 3800; }],
  ['narrow 700', (p) => { p.stair.width = 700; p.stair.total_run_lower = 700; }],
  ['tall 3200', (p) => { p.stair.floor_to_floor = 3200; p.stair.upper_steps = 12; p.stair.total_run = 4000; }],
  ['no split', (p) => (p.stringers.split_side_stringer = false)],
  ['nosing 0', (p) => (p.treads.nosing = 0)],
  ['pivot offset', (p) => (p.layout.pivot_offset = [60, 40])],
  ['upper 1', (p) => { p.stair.upper_steps = 1; p.stair.total_run = 1200; }],
  ['balanced left', (p) => { Object.assign(p, clone(PRESETS.B)); p.stair.turn = 'left'; }],
  ['balanced lower 2', (p) => { Object.assign(p, clone(PRESETS.B)); p.stair.lower_steps = 2; p.stair.total_run_lower = 1375; p.stair.upper_steps = 7; p.stair.total_run = 2700; }],
  ['balanced forced 5', (p) => { Object.assign(p, clone(PRESETS.B)); p.layout.balance_treads = 5; }],
  ['balanced open risers', (p) => { Object.assign(p, clone(PRESETS.B)); p.risers.install = false; }],
  ['balanced inside newel', (p) => { Object.assign(p, clone(PRESETS.B)); p.newel.position = 'inside'; }],
  ['balanced short (should refuse)', (p) => { Object.assign(p, clone(PRESETS.B)); p.stair.total_run = 1500; }],
  ['run too short (should refuse)', (p) => (p.stair.total_run = 900)],
];
for (const [name, fn] of variants) {
  const p = clone(PRESETS.A);
  fn(p);
  const v = validate(p);
  if (v.errors.length) {
    console.log(`  ${name}: rejected by validation – ${v.errors.join(' ')}`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = run(p);
    const c = rules.counts(r.checks);
    console.log(`  ${name}: ok ${Date.now() - t0} ms  N=${r.g.N} fail=${c.FAIL} warn=${c.WARN} stringers=${r.P.stringers.map((s) => s.key).join(',')} templates=${r.tpl.length}`);
    ok(r.dxf.includes('EOF'), name + ' dxf');
  } catch (e) {
    if (e instanceof StairError) console.log(`  ${name}: refused – ${e.message}`);
    else {
      fails++;
      console.log(`  FAIL ${name}: ${e.stack}`);
    }
  }
}
console.log(fails ? `\n${fails} problem(s)` : '\nall good');
process.exit(fails ? 1 : 0);
