// Drawing set: model views, five A3 sheets with title blocks (port of
// outputs.py drawings_doc) and the 1:1 templates.

import { bounds, simplify, exterior } from './geo.js';
import { Drawing, Pen } from './pen.js';
import { drawPlan, drawElevation, drawDevelopment, drawNewel, drawStringerFlat, drawTread } from './drawing.js';
import { treadLocal } from './frames.js';
import { summaryLine } from './rules.js';

export const PAPER = { A3: [420, 297], A2: [594, 420], A1: [841, 594] };
export const SCALES = [10, 20, 25, 30, 40, 50, 75, 100];

export function translateItems(items, dx, dy) {
  for (const it of items) {
    if (it.k === 'L') it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
    else if (it.k === 'C' || it.k === 'T') {
      if (it.k === 'C') it.c = [it.c[0] + dx, it.c[1] + dy];
      else it.p = [it.p[0] + dx, it.p[1] + dy];
    } else if (it.k === 'F') it.rings = it.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy]));
  }
  return items;
}

function shelf(entries, x0, y0, rowW, gapX, gapY) {
  // entries: [{dl, b}] drawn at the origin; packed left to right in rows (top row first)
  const out = new Drawing();
  const bb = [1e9, 1e9, -1e9, -1e9];
  const rows = [];
  let row = [], x = x0;
  for (const e of entries) {
    const w = e.b[2] - e.b[0];
    if (row.length && x + w > x0 + rowW) {
      rows.push(row);
      row = [];
      x = x0;
    }
    row.push([e, x]);
    x += w + gapX;
  }
  if (row.length) rows.push(row);
  let yTop = y0;
  for (const r of rows) {
    const top = Math.max(...r.map(([e]) => e.b[3]));
    const bottom = Math.min(...r.map(([e]) => e.b[1]));
    for (const [e, xx] of r) {
      const dx = xx - e.b[0], dy = yTop - top;
      out.items.push(...translateItems(e.dl.items, dx, dy));
      bb[0] = Math.min(bb[0], e.b[0] + dx); bb[1] = Math.min(bb[1], e.b[1] + dy);
      bb[2] = Math.max(bb[2], e.b[2] + dx); bb[3] = Math.max(bb[3], e.b[3] + dy);
    }
    yTop -= top - bottom + gapY;
  }
  return { dl: out, bbox: bb };
}

export function ksLabel(ks) {
  if (ks.length === 1) return `T${ks[0]}`;
  const cont = ks.every((k, i) => k === ks[0] + i);
  return cont ? `T${ks[0]}–T${ks[ks.length - 1]} (×${ks.length})` : ks.map((k) => `T${k}`).join(',') + ` (×${ks.length})`;
}

export function treadGroups(g) {
  // winder treads one by one; identical straight treads grouped
  const keyOf = (t) => {
    const q = simplify(treadLocal(g, t).poly, 0.05);
    const b = bounds(q);
    return `${Math.round(q.getArea() / 50)}|${Math.round(b[2])}|${Math.round(b[3])}|${exterior(q).length}`;
  };
  const groups = [];
  for (const t of g.treads) {
    if (t.tapered) {
      groups.push({ t, ks: [t.k] });
      continue;
    }
    const key = keyOf(t);
    const hit = groups.find((gr) => !gr.t.tapered && gr.key === key);
    if (hit) hit.ks.push(t.k);
    else groups.push({ t, ks: [t.k], key });
  }
  return groups;
}

// ------------------------------------------------------------- model views
// Each view is drawn at the same model-space offsets as the Python tool, so
// they can share one DXF model space.
const VIEW_FNS = {
  plan: (dl, g, P) => drawPlan(dl, g, P, 0, 0),
  elev: (dl, g, P) => drawElevation(dl, g, P, 0, -20000),
  dev: (dl, g, P) => drawDevelopment(dl, g, P, 0, -40000),
  newel: (dl, g, P) => drawNewel(dl, P.newel, 8000, -40000, 10),
};
export const VIEW_IDS = ['plan', 'elev', 'dev', 'newel', 'stringers', 'treads'];

export function modelView(id, g, P) {
  if (id === 'newel' && !P.newel) return null;
  if (VIEW_FNS[id]) {
    const dl = new Drawing();
    const bbox = VIEW_FNS[id](dl, g, P);
    return { dl, bbox };
  }
  if (id === 'stringers') {
    const sts = P.stringers.map((st) => {
      const dl = new Drawing();
      return { dl, b: drawStringerFlat(dl, st, 0, 0, 10), key: st.key };
    }).sort((a, b) => (b.b[2] - b.b[0]) - (a.b[2] - a.b[0]));
    return shelf(sts, 0, -60000, 3800, 300, 260);
  }
  if (id === 'treads') {
    const trs = treadGroups(g).map(({ t, ks }) => {
      const dl = new Drawing();
      let b = drawTread(dl, g, P, t, 0, 0, 10);
      if (ks.length > 1) {
        const { poly } = treadLocal(g, t);
        new Pen(dl, 0, 0, 1, 1, 10).text(ksLabel(ks), [bounds(poly)[2] / 2, -60], 1.8);
        b = [b[0], Math.min(b[1], -90), b[2], b[3]];
      }
      return { dl, b };
    });
    return shelf(trs, 0, -80000, 3700, 300, 260);
  }
  throw new Error('unknown view ' + id);
}

// lazy view cache: V.get('plan') draws on first use
export function viewCache(g, P) {
  const cache = {};
  return {
    get(id) {
      if (!(id in cache)) cache[id] = modelView(id, g, P);
      return cache[id];
    },
    all() {
      const o = {};
      for (const id of VIEW_IDS) o[id] = this.get(id);
      return o;
    },
  };
}

export function modelViews(g, P) {
  return viewCache(g, P).all();
}

// -------------------------------------------------------------------- sheets
function pickScale(bbox, aw, ah) {
  const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1];
  for (const s of SCALES) if (w / s <= aw && h / s <= ah) return s;
  return SCALES[SCALES.length - 1];
}

class Sheet {
  constructor(name, size) {
    this.name = name;
    this.size = size;
    this.paper = new Drawing();
    this.vps = [];
  }
  place(view, scale, xLeft, yTop, pad = 3) {
    const b = view.bbox;
    const w = (b[2] - b[0]) / scale + 2 * pad;
    const h = (b[3] - b[1]) / scale + 2 * pad;
    this.vps.push({ view, bbox: b, scale, cx: xLeft + w / 2, cy: yTop - h / 2, w, h });
    return [w, h];
  }
}

function frameAndTitle(sh, p, ttl, no, n, scaleTxt, date) {
  const [Wp, Hp] = sh.size;
  const pen = new Pen(sh.paper, 0, 0, 1, 1, 1);
  pen.pline([[10, 10], [Wp - 10, 10], [Wp - 10, Hp - 10], [10, Hp - 10]], 'X-FRAME', true);
  const tbW = 175, tbH = 30;
  const x0 = Wp - 10 - tbW, y0 = 10;
  pen.pline([[x0, y0], [x0 + tbW, y0], [x0 + tbW, y0 + tbH], [x0, y0 + tbH]], 'X-TITLE', true);
  pen.line([x0, y0 + 12], [x0 + tbW, y0 + 12], 'X-TITLE');
  pen.line([x0 + 125, y0], [x0 + 125, y0 + 12], 'X-TITLE');
  pen.text(p.project.name.slice(0, 58), [x0 + 3, y0 + 24], 3.5, { align: 'ML' });
  pen.text(ttl, [x0 + 3, y0 + 16], 2.5, { align: 'ML' });
  pen.text(`${p.project.designer ? p.project.designer + '   ' : ''}${date}`, [x0 + 3, y0 + 6], 2.0, { align: 'ML' });
  pen.text(`${scaleTxt}   sheet ${no}/${n}`, [x0 + 128, y0 + 6], 2.0, { align: 'ML' });
  pen.text('dimensions in mm', [x0 + 128, y0 + 2.5], 1.5, { align: 'ML' });
}

function textBlock(sh, lines, x, y, h = 2.2, dy = null, colorFn = null) {
  const pen = new Pen(sh.paper, 0, 0, 1, 1, 1);
  dy = dy || h * 1.6;
  lines.forEach((s, i) => pen.text(s, [x, y - i * dy], h, { align: 'TL', color: colorFn ? colorFn(s) : undefined }));
  return y - lines.length * dy;
}

const STATUS_COLOR = { FAIL: 1, WARN: 30, PASS: 94, INFO: 8 };

export function buildSheets(g, P, checks, V, date) {
  const p = g.p;
  const size = PAPER[p.output.paper] || PAPER.A3;
  const [Wp, Hp] = size;
  const base = p.output.drawing_scale || 20;
  const n = 5;
  const top = Hp - 13;
  const sc = (bbox, aw, ah, minimum) => Math.max(pickScale(bbox, aw - 6, ah - 6), minimum);
  const sheets = [];

  // 1 plan + rules
  let sh = new Sheet('01 Plan', size);
  let s = sc(V.plan.bbox, Wp - 26, Hp * 0.55, base);
  let [, vh] = sh.place(V.plan, s, 13, top);
  frameAndTitle(sh, p, 'Plan + rules check', 1, n, `1:${s}`, date);
  const lines = [`RULES CHECK – YMa 1007/2017 + YM guide:  ${summaryLine(checks)}`];
  for (const c of checks) lines.push(`${c.status.padEnd(5)} ${c.rule}: ${c.value}   (limit ${c.limit})`);
  textBlock(sh, lines, 15, top - vh - 4, 2.0, 3.3, (t) => STATUS_COLOR[t.split(' ')[0]] ?? 7);
  const zl = g.H - p.building.slab_thickness - p.rules.min_headroom;
  const notes = [
    `${g.N} rises × ${g.rise.toFixed(2)} = ${g.H.toFixed(0)};  width ${g.W.toFixed(0)};  ${p.stair.turn} turn`,
    ...g.layoutNotes.map((x) => x.slice(0, 95)),
    'Legend: solid = visible edge, dashed = riser faces / stringers / joists below,',
    'red dash-dot = walking line (going measured here), red circle = fails the going rule,',
    'green numbers = going on the walking line, grey = tread top level,',
    `orange dash-dot = minimum floor opening for ${p.rules.min_headroom.toFixed(0)} headroom ` +
      `(no slab above treads higher than +${zl.toFixed(0)}).`,
  ];
  textBlock(sh, notes, Wp - 190, 46 + 3.3 * notes.length, 1.9, 3.3);
  sh.title = 'Plan + rules check';
  sheets.push(sh);

  // 2 elevation
  sh = new Sheet('02 Elevation', size);
  s = sc(V.elev.bbox, Wp - 26, Hp - 26 - 32, base);
  sh.place(V.elev, s, 13, top);
  frameAndTitle(sh, p, 'Elevation from the open side', 2, n, `1:${s}`, date);
  sh.title = 'Elevation';
  sheets.push(sh);

  // 3 development + newel
  sh = new Sheet('03 Walking line + newel', size);
  let sn = 10, nw = 0;
  if (V.newel) {
    const bn = V.newel.bbox;
    sn = sc(bn, 140, Hp - 26 - 32, 10);
    [nw] = sh.place(V.newel, sn, Wp - 13 - ((bn[2] - bn[0]) / sn + 6), top);
  }
  s = sc(V.dev.bbox, Wp - 26 - nw - 8, Hp - 26 - 32, base);
  sh.place(V.dev, s, 13, top);
  frameAndTitle(sh, p, V.newel ? `Walking-line development 1:${s} + newel post 1:${sn}` : `Walking-line development 1:${s}`,
    3, n, V.newel ? `1:${s} / 1:${sn}` : `1:${s}`, date);
  sh.title = 'Walking line + newel';
  sheets.push(sh);

  // 4 stringers
  sh = new Sheet('04 Stringers', size);
  s = sc(V.stringers.bbox, Wp - 26, Hp - 26 - 32 - 30, 10);
  [, vh] = sh.place(V.stringers, s, 13, top);
  frameAndTitle(sh, p, 'Stringers laid flat on the board', 4, n, `1:${s}`, date);
  const jl = ['SUPPORT JOISTS (under the back edge of winder treads)',
    ...P.joists.map((j) => `${j.key}: ${j.length.toFixed(0)} long × ${(j.z1 - j.z0).toFixed(0)} high, top +${j.z1.toFixed(1)}, ` +
      `plan angle ${j.angleDeg.toFixed(1)}°` + (j.endNote ? ` – ${j.endNote}` : '')),
    'Marking: see report – u along the top edge from the bottom end, v square in from the edge.'];
  if (!P.joists.length) jl.splice(1, 0, 'none');
  textBlock(sh, jl, 15, top - vh - 4, 2.0, 3.3);
  sh.title = 'Stringers';
  sheets.push(sh);

  // 5 treads
  sh = new Sheet('05 Treads', size);
  s = sc(V.treads.bbox, Wp - 26, Hp - 26 - 32 - 10, 10);
  sh.place(V.treads, s, 13, top);
  frameAndTitle(sh, p, 'Treads – outlines and edge lengths', 5, n, `1:${s}`, date);
  textBlock(sh, ['Nosing edge at the bottom of each outline. Green dashed = riser faces (front riser under the nosing, next riser on top).',
    'Red dash-dot = walking line. Cut from the 1:1 templates or the corner coordinates in the report.'], 15, 45, 2.0, 3.3);
  sh.title = 'Treads';
  sheets.push(sh);
  return sheets;
}

// ----------------------------------------------------------------- templates
export function buildTemplates(g, P) {
  const ts = 4;
  const out = [];
  let x = 0;
  for (const { t, ks } of treadGroups(g)) {
    const dl = new Drawing();
    const { poly } = treadLocal(g, t);
    let b = drawTread(dl, g, P, t, x, 0, ts, true, 'T-CUT');
    const name = ksLabel(ks);
    if (ks.length > 1) {
      const pb = bounds(poly);
      new Pen(dl, 0, 0, 1, 1, ts).text(name, [x + pb[2] / 2, pb[3] + 9 * ts], 3.0);
      b = [b[0], b[1], b[2], Math.max(b[3], pb[3] + 12 * ts)];
    }
    out.push({ name, dl, bbox: b, kind: 'tread' });
    x = b[2] + 150;
  }
  let y = -2500, maxL = 0;
  for (const st of P.stringers) {
    const dl = new Drawing();
    const b = drawStringerFlat(dl, st, 0, y, ts, 'T-CUT', 'T-MARK', true);
    out.push({ name: st.key, dl, bbox: b, kind: 'stringer' });
    y = b[1] - 300;
    maxL = Math.max(maxL, b[2]);
  }
  if (P.newel) {
    const dl = new Drawing();
    const b = drawNewel(dl, P.newel, Math.max(6000, maxL + 1000), -2500 - P.newel.zTop, ts, 'T-CUT', 'T-TEXT');
    out.push({ name: 'N1', dl, bbox: b, kind: 'newel' });
  }
  return out;
}
