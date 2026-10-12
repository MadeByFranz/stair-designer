// Text outputs: cut list, marking tables, markdown report, CSV (port of report.py).

import { blankSize, exterior, simplify } from './geo.js';
import { rAngle } from './geometry.js';
import { stringerMarks, treadLocal } from './frames.js';
import { summaryLine } from './rules.js';

export const CUT_HEAD = ['Part', 'Mark', 'Qty', 'Length mm', 'Width mm', 'Thickness mm', 'Notes'];

const r0 = (v) => Math.round(v);
const r1 = (v) => Math.round(v * 10) / 10;

export function rng(prefix, ks) {
  ks = [...ks].sort((a, b) => a - b);
  if (ks.length === 1) return `${prefix}${ks[0]}`;
  if (ks.every((k, i) => k === ks[0] + i)) return `${prefix}${ks[0]}–${prefix}${ks[ks.length - 1]}`;
  return ks.map((k) => `${prefix}${k}`).join(',');
}

// rows: [part, mark, qty, length, width, thickness, notes]; numbers stay numbers
export function cutlist(g, P) {
  const p = g.p;
  const tt = p.treads.thickness;
  const rows = [];
  const groups = new Map();
  for (const t of g.treads) {
    const [L, Wd] = blankSize(t.board);
    if (t.tapered) {
      rows.push(['Tread (winder)', `T${t.k}`, 1, r0(L), r0(Wd), tt, `top +${t.zTop.toFixed(1)}; cut from template T${t.k}`]);
    } else {
      const key = `${r1(L)}|${r1(Wd)}`;
      if (!groups.has(key)) groups.set(key, { L: r1(L), Wd: r1(Wd), ks: [] });
      groups.get(key).ks.push(t.k);
    }
  }
  for (const { L, Wd, ks } of groups.values()) {
    rows.push(['Tread (straight)', rng('T', ks), ks.length, L, Wd, tt, `nosing ${p.treads.nosing.toFixed(0)} incl.`]);
  }
  const rg = new Map();
  for (const rb of g.riserBoards) {
    const h = rb.z1 - rb.z0;
    let key, L, note = '';
    if (Math.abs(rb.lengthFront - rb.lengthBack) < 0.5) {
      L = r1(rb.lengthFront);
    } else {
      L = r1(Math.max(rb.lengthFront, rb.lengthBack));
      note = `bevel ends: front ${rb.lengthFront.toFixed(0)} / back ${rb.lengthBack.toFixed(0)}`;
    }
    key = `${L}|${r1(h)}|${note}`;
    if (!rg.has(key)) rg.set(key, { L, h: r1(h), note, ks: [] });
    rg.get(key).ks.push(rb.k);
  }
  for (const { L, h, note, ks } of rg.values()) rows.push(['Riser', rng('R', ks), ks.length, L, h, p.risers.thickness, note]);
  for (const st of P.stringers) {
    const { length } = stringerMarks(st);
    rows.push(['Stringer', st.key, 1, r0(length), r0(st.width), r0(st.thickness),
      `${st.name}; pitch ${st.pitchDeg.toFixed(1)}°; cut from template ${st.key}`]);
  }
  for (const j of P.joists) {
    rows.push(['Support joist', j.key, 1, r0(j.length), r0(j.z1 - j.z0), p.joists.thickness,
      `under T${j.tread} back edge, top +${j.z1.toFixed(1)}` + (j.endNote ? `; ${j.endNote}` : '')]);
  }
  if (P.newel) {
    const n = P.newel;
    rows.push(['Newel post', 'N1', 1, r0(n.zTop), r0(n.size[0]), r0(n.size[1]), `${n.housings.length} housings – see newel drawing`]);
  }
  const G = P.guard;
  if (G && G.balusters.length) {
    const lens = G.balusters.map(([, zb, zt]) => zt - zb);
    rows.push(['Baluster', 'B', G.balusters.length, r0(Math.max(...lens)), p.guard.baluster, p.guard.baluster,
      `lengths ${Math.min(...lens).toFixed(0)}–${Math.max(...lens).toFixed(0)}; gap ${G.gap.toFixed(0)}`]);
    rows.push(['Handrail (guard)', 'H1', 1, r0(G.railLength + 300), p.guard.handrail_width, p.guard.handrail_thickness,
      'incl. 300 for fitting']);
  }
  P.wallRails.forEach((wr, i) => {
    rows.push(['Handrail (wall)', `H${i + 2}`, 1, r0(wr.lengthTrue + 300), 45, 45, `${wr.name}; brackets; incl. 300`]);
  });
  return rows;
}

export function fmtNum(v) {
  if (typeof v !== 'number') return String(v);
  const x = Math.round(v * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function csv(rows) {
  const esc = (v) => {
    const s = fmtNum(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CUT_HEAD, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

export function treadCorners(g, t) {
  const { poly } = treadLocal(g, t);
  return exterior(simplify(poly, 0.05));
}

export function markdown(g, P, checks, cons, rows, meta = {}) {
  const p = g.p, s = p.stair;
  const L = [];
  const date = meta.date || new Date().toISOString().slice(0, 10);
  L.push(`# ${p.project.name}`, '');
  if (p.project.notes) L.push(`${p.project.notes}  `);
  L.push(`${p.project.designer ? `Drawn by ${p.project.designer}, g` : 'G'}enerated ${date} with the stair designer${meta.source ? ` from \`${meta.source}\`` : ''}.`, '');
  L.push('## Key dimensions', '');
  L.push(`- Floor to floor ${g.H.toFixed(0)} mm, ${g.N} rises × **${g.rise.toFixed(2)} mm**, ${g.N - 1} treads`);
  L.push(`- Width ${g.W.toFixed(0)} mm, ${s.turn} turn, layout: **${p.layout.winder_layout}**`);
  L.push(`- Total run ${s.total_run.toFixed(0)} (back wall → top riser), first riser ${g.y1 >= 0 ? '+' : ''}${g.y1.toFixed(0)} from the newel line`);
  for (const n of g.layoutNotes) L.push(`- ${n}`);
  L.push(p.risers.install
    ? `- Treads ${p.treads.thickness.toFixed(0)} mm, nosing ${p.treads.nosing.toFixed(0)}; risers ${p.risers.thickness.toFixed(0)} mm`
    : `- Treads ${p.treads.thickness.toFixed(0)} mm, nosing ${p.treads.nosing.toFixed(0)}; open risers`);
  L.push('');
  L.push(`## Rules check – ${summaryLine(checks)}`, '');
  L.push('| Status | Rule | Value | Limit | Ref | Note |', '|---|---|---|---|---|---|');
  for (const c of checks) L.push(`| **${c.status}** | ${c.rule} | ${c.value} | ${c.limit} | ${c.ref} | ${c.note} |`);
  L.push('');
  L.push(`Going on tapered treads is measured on the walking line ${p.rules.walking_line_from_outer.toFixed(0)} mm from the wide (wall) end, ` +
    'as in the YM guide. The decree itself sets the 250 mm minimum; how it is measured is the guide\'s. ' +
    'Confirm the interpretation with the local building control (rakennusvalvonta).', '');
  if (cons.length) {
    L.push('## Construction checks', '');
    L.push('| Status | Check | Value | Limit | Note |', '|---|---|---|---|---|');
    for (const c of cons) L.push(`| ${c.status} | ${c.rule} | ${c.value} | ${c.limit} | ${c.note} |`);
    L.push('');
  }
  L.push('## Steps', '');
  L.push('| Tread | Top +mm | Going walking line | Going centre | Inner end | Wall end | 2R+G |', '|---|---|---|---|---|---|---|');
  for (const t of g.treads) {
    const flag = t.goingWalk < p.rules.min_going - 0.05 ? ' ⚠' : '';
    L.push(`| T${t.k}${t.tapered ? ' (tapered)' : ''} | ${t.zTop.toFixed(1)} | ${t.goingWalk.toFixed(1)}${flag} | ` +
      `${t.goingCentre.toFixed(1)} | ${t.tapered ? t.narrowEnd.toFixed(0) : '–'} | ${t.tapered ? t.wideEnd.toFixed(0) : '–'} | ${(2 * g.rise + t.goingWalk).toFixed(0)} |`);
  }
  L.push('');
  L.push('## Winder tread corners (for marking without templates)', '');
  L.push('Each tread in its own frame: x along the nosing edge from the inner end, y square into the tread ' +
    '(nosing edge = y 0). Corners listed counter-clockwise; small steps at the inner end are the ' +
    `${p.newel.housing.toFixed(0)} mm newel housings.`);
  for (const t of g.treads) {
    if (!t.tapered) continue;
    const pts = treadCorners(g, t);
    L.push('', `**T${t.k}** (top +${t.zTop.toFixed(1)}): ` + pts.map(([x, y]) => `(${x.toFixed(1)}, ${y.toFixed(1)})`).join(', '));
  }
  L.push('');
  L.push('## Riser set-out (front faces, plan coordinates)', '');
  L.push('Origin = corner of back wall and the newel line (first-riser line extended); X along the upper ' +
    'flight, Y along the lower flight. Wall points are where each riser face meets the wall.', '');
  L.push('| Riser | Inner end (x, y) | Wall end (x, y) | Angle | Walking line s |', '|---|---|---|---|---|');
  for (const r of g.risers) {
    L.push(`| R${r.k} | ${r.inner[0].toFixed(1)}, ${r.inner[1].toFixed(1)} | ${r.outer[0].toFixed(1)}, ${r.outer[1].toFixed(1)} | ` +
      `${rAngle(r).toFixed(1)}° | ${r.sWalk.toFixed(1)} |`);
  }
  L.push('');
  L.push('## Stringer marking', '');
  L.push('Measured on face A (stair side) along the top edge of the board from the bottom end (u), ' +
    'and square in from that edge (v). Seat = where the tread sits.');
  for (const st of P.stringers) {
    const { rows: rm, length } = stringerMarks(st);
    L.push('', `### ${st.key} – ${st.name}`, '');
    L.push(`Board ${length.toFixed(0)} × ${st.width.toFixed(0)} × ${st.thickness.toFixed(0)}, pitch ${st.pitchDeg.toFixed(1)}°, ` +
      `throat ${st.throat.toFixed(0)} mm. Face A = ${st.faceA}, face B = ${st.faceB}.`);
    if (st.warnings.length) {
      L.push('');
      for (const w of st.warnings) L.push(`- ⚠ ${w}`);
    }
    L.push('', '| Seat | Front u | Front v | Back u | Back v | Seat height |', '|---|---|---|---|---|---|');
    for (const [k, ua, va, ub, vb, z] of rm) {
      L.push(`| T${k} | ${ua.toFixed(1)} | ${va.toFixed(1)} | ${ub.toFixed(1)} | ${vb.toFixed(1)} | +${z.toFixed(1)} |`);
    }
  }
  if (P.newel) {
    const n = P.newel;
    L.push('', '## Newel post N1', '');
    L.push(`${n.size[0].toFixed(0)} × ${n.size[1].toFixed(0)} mm, height ${n.zTop.toFixed(0)} from floor. ` +
      'u = from the left edge of the face (looking at the face).', '');
    L.push('| Face | Element | u from–to | Height from–to | Depth | Joint |', '|---|---|---|---|---|---|');
    for (const h of [...n.housings].sort((a, b) => a.face - b.face || a.z0 - b.z0)) {
      L.push(`| ${h.face} | ${h.element} | ${h.u0.toFixed(0)}–${h.u1.toFixed(0)} | ${h.z0.toFixed(1)}–${h.z1.toFixed(1)} | ` +
        `${h.depth.toFixed(0)} | ${h.kind} |`);
    }
    L.push('');
    for (const [fno, , , , lab] of n.faces) L.push(`- Face ${fno}: ${lab}`);
  }
  const G = P.guard;
  if (G) {
    L.push('', '## Guard and handrails', '');
    L.push(`- Open side: ${G.balusters.length} balusters ${p.guard.baluster.toFixed(0)} mm, clear gap ${G.gap.toFixed(1)} mm, ` +
      `from x=${G.xStart.toFixed(0)} to ${G.xEnd.toFixed(0)}`);
    L.push('- Handrail top (open side): ' + G.rail.pts.map(([x, z]) => `x ${x.toFixed(0)} z ${z.toFixed(0)}`).join(' → '));
    for (const wr of P.wallRails) {
      L.push(`- Wall rail, ${wr.name}: ` + wr.rail.pts.map(([x, z]) => `s ${x.toFixed(0)} z ${z.toFixed(0)}`).join(' → ') +
        ` (min ${wr.rail.clearMin.toFixed(0)} above nosings)`);
    }
  }
  L.push('', '## Cut list', '');
  L.push('| Part | Mark | Qty | Length | Width | Thick | Notes |', '|---|---|---|---|---|---|---|');
  for (const r of rows) L.push('| ' + r.map(fmtNum).join(' | ') + ' |');
  L.push('');
  return L.join('\n');
}

// Minimal markdown → HTML for the report tab (headings, lists, tables, bold, code).
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^#{1,4} /.test(ln)) {
      const n = ln.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(ln.slice(n + 1))}</h${n}>`);
      i++;
    } else if (ln.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.slice(1, -1).split(' | ').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<div class="tbl"><table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
    } else if (ln.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>');
    } else if (!ln.trim()) {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}
