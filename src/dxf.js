// DXF R12 (AC1009) writer for display lists: opens in AutoCAD, BricsCAD,
// LibreCAD, QCAD, DraftSight, Fusion and most CAM software. Model space,
// millimetres, layers / colours / linetypes as in the Python tool.
// Dimensions and hatches arrive already exploded (lines + texts).

import { LAYERS, LINETYPES, itemsBBox, textOrigin } from './pen.js';

const LT_DESC = {
  CONTINUOUS: 'Solid line',
  DASH20: 'hidden __ __ (1:20)',
  DASHDOT20: 'centre __ . __ (1:20)',
  DASH1: 'hidden (1:1)',
  DASHDOT1: 'centre (1:1)',
};

// text to plain ASCII: AutoCAD control codes and \U+ escapes
export function dxfText(s) {
  const map = { '°': '%%d', '±': '%%p', '×': 'x', '–': '-', '—': '-', '≤': '<=', '≥': '>=', '→': '->', '←': '<-',
    '⚠': '!', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '−': '-', '·': '.', '§': 's.' };
  let out = '';
  for (const ch of String(s)) {
    if (map[ch] !== undefined) out += map[ch];
    else {
      const cp = ch.codePointAt(0);
      if (cp < 32) continue;
      out += cp < 127 ? ch : `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return out;
}

const num = (v) => {
  if (!Number.isFinite(v)) return '0.0';
  const r = Math.round(v * 1e6) / 1e6;
  const s = String(r);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};

class W {
  constructor() {
    this.out = [];
  }
  g(code, v) {
    this.out.push(String(code).padStart(3, ' '), typeof v === 'number' ? num(v) : String(v));
    return this;
  }
  i(code, v) {
    this.out.push(String(code).padStart(3, ' '), String(Math.round(v)));
    return this;
  }
  text() {
    return this.out.join('\r\n') + '\r\n';
  }
}

const VALIGN = { A: 0, B: 1, M: 2, T: 3 };
const HALIGN = { L: 0, C: 1, R: 2 };

export function toDxf(items, opts = {}) {
  const w = new W();
  const bb = itemsBBox(items);
  const ok = bb[0] < bb[2];
  const [x0, y0, x1, y1] = ok ? bb : [0, 0, 1000, 1000];
  // ---- header
  w.g(0, 'SECTION').g(2, 'HEADER');
  w.g(9, '$ACADVER').g(1, 'AC1009');
  w.g(9, '$DWGCODEPAGE').g(3, 'ANSI_1252');
  w.g(9, '$INSBASE').g(10, 0).g(20, 0).g(30, 0);
  w.g(9, '$EXTMIN').g(10, x0).g(20, y0).g(30, 0);
  w.g(9, '$EXTMAX').g(10, x1).g(20, y1).g(30, 0);
  w.g(9, '$LIMMIN').g(10, x0).g(20, y0);
  w.g(9, '$LIMMAX').g(10, x1).g(20, y1);
  w.g(9, '$LTSCALE').g(40, 1);
  w.g(9, '$TEXTSTYLE').g(7, 'STAIR');
  w.g(9, '$CLAYER').g(8, '0');
  w.g(9, '$LUNITS').i(70, 2);
  w.g(9, '$LUPREC').i(70, 1);
  w.g(0, 'ENDSEC');
  // ---- tables
  w.g(0, 'SECTION').g(2, 'TABLES');
  // viewport zoomed to the extents
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vh = Math.max(y1 - y0, (x1 - x0) / 1.6) * 1.05;
  w.g(0, 'TABLE').g(2, 'VPORT').i(70, 1);
  w.g(0, 'VPORT').g(2, '*ACTIVE').i(70, 0).g(10, 0).g(20, 0).g(11, 1).g(21, 1).g(12, cx).g(22, cy)
    .g(13, 0).g(23, 0).g(14, 10).g(24, 10).g(15, 10).g(25, 10).g(16, 0).g(26, 0).g(36, 1).g(17, 0).g(27, 0).g(37, 0)
    .g(40, vh).g(41, 1.6).g(42, 50).g(43, 0).g(44, 0).g(50, 0).g(51, 0)
    .i(71, 0).i(72, 1000).i(73, 1).i(74, 3).i(75, 0).i(76, 0).i(77, 0).i(78, 0);
  w.g(0, 'ENDTAB');
  // linetypes
  const lts = Object.keys(LINETYPES);
  w.g(0, 'TABLE').g(2, 'LTYPE').i(70, lts.length);
  for (const name of lts) {
    const pat = LINETYPES[name] || [];
    const total = pat.reduce((a, v) => a + Math.abs(v), 0);
    w.g(0, 'LTYPE').g(2, name).i(70, 0).g(3, LT_DESC[name] || name).i(72, 65).i(73, pat.length).g(40, total);
    for (const v of pat) w.g(49, v);
  }
  w.g(0, 'ENDTAB');
  // layers
  const used = new Set(items.map((it) => it.layer));
  const layers = Object.entries(LAYERS).filter(([n]) => used.has(n) || opts.allLayers);
  w.g(0, 'TABLE').g(2, 'LAYER').i(70, layers.length + 1);
  w.g(0, 'LAYER').g(2, '0').i(70, 0).i(62, 7).g(6, 'CONTINUOUS');
  for (const [name, [col, lt]] of layers) w.g(0, 'LAYER').g(2, name).i(70, 0).i(62, col).g(6, lt);
  w.g(0, 'ENDTAB');
  // text styles
  w.g(0, 'TABLE').g(2, 'STYLE').i(70, 2);
  w.g(0, 'STYLE').g(2, 'STANDARD').i(70, 0).g(40, 0).g(41, 1).g(50, 0).i(71, 0).g(42, 2.5).g(3, 'txt').g(4, '');
  w.g(0, 'STYLE').g(2, 'STAIR').i(70, 0).g(40, 0).g(41, 1).g(50, 0).i(71, 0).g(42, 2.5).g(3, 'arial.ttf').g(4, '');
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE').g(2, 'VIEW').i(70, 0).g(0, 'ENDTAB');
  w.g(0, 'TABLE').g(2, 'UCS').i(70, 0).g(0, 'ENDTAB');
  w.g(0, 'TABLE').g(2, 'APPID').i(70, 1).g(0, 'APPID').g(2, 'ACAD').i(70, 0).g(0, 'ENDTAB');
  w.g(0, 'TABLE').g(2, 'DIMSTYLE').i(70, 0).g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');
  w.g(0, 'SECTION').g(2, 'BLOCKS').g(0, 'ENDSEC');
  // ---- entities
  w.g(0, 'SECTION').g(2, 'ENTITIES');
  for (const it of items) {
    const head = (type) => {
      w.g(0, type).g(8, it.layer || '0');
      if (it.color !== undefined && it.color !== null) w.i(62, it.color);
    };
    if (it.k === 'L') {
      if (it.pts.length === 2 && !it.closed) {
        head('LINE');
        w.g(10, it.pts[0][0]).g(20, it.pts[0][1]).g(30, 0).g(11, it.pts[1][0]).g(21, it.pts[1][1]).g(31, 0);
      } else {
        head('POLYLINE');
        w.i(66, 1).g(10, 0).g(20, 0).g(30, 0).i(70, it.closed ? 1 : 0);
        for (const q of it.pts) {
          w.g(0, 'VERTEX').g(8, it.layer || '0');
          w.g(10, q[0]).g(20, q[1]).g(30, 0);
        }
        w.g(0, 'SEQEND').g(8, it.layer || '0');
      }
    } else if (it.k === 'C') {
      head('CIRCLE');
      w.g(10, it.c[0]).g(20, it.c[1]).g(30, 0).g(40, it.r);
    } else if (it.k === 'T') {
      const s = dxfText(it.s);
      if (!s.trim()) continue;
      head('TEXT');
      const [bx, by] = textOrigin(it);
      const h = HALIGN[it.align[1]] ?? 0, v = VALIGN[it.align[0]] ?? 0;
      w.g(10, bx).g(20, by).g(30, 0).g(40, it.h).g(1, s);
      if (it.rot) w.g(50, it.rot);
      w.g(7, 'STAIR');
      if (h || v) {
        if (h) w.i(72, h);
        w.g(11, it.p[0]).g(21, it.p[1]).g(31, 0);
        if (v) w.i(73, v);
      }
    } else if (it.k === 'F') {
      for (const ring of it.rings) {
        // fan triangulation (the fills used are small convex shapes)
        for (let i = 1; i + 1 < ring.length; i++) {
          const a = ring[0], b = ring[i], c = ring[i + 1];
          head('SOLID');
          w.g(10, a[0]).g(20, a[1]).g(30, 0).g(11, b[0]).g(21, b[1]).g(31, 0)
            .g(12, c[0]).g(22, c[1]).g(32, 0).g(13, c[0]).g(23, c[1]).g(33, 0);
        }
      }
    }
  }
  w.g(0, 'ENDSEC').g(0, 'EOF');
  return w.text();
}
