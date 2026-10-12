// Painters for display lists: HTML canvas (screen) and jsPDF (export).
// A transform maps drawing coordinates (y up) to device coordinates (y down):
//   X = a + k·x,  Y = b − k·y        (k = device units per drawing unit)

import { ACI, LAYERS, LINETYPES, textOrigin } from './pen.js';
import { CAP, FONT_FAMILY, FONT_B64 } from './font.js';

export const PALETTES = {
  // plotted on white paper: ACI 7 is black (as in the Python tool's PDFs)
  paper: { bg: '#ffffff', 7: [0, 0, 0], 9: [150, 150, 150], 2: [190, 160, 0], 3: [0, 200, 0], 4: [0, 190, 210] },
  // dark model space, CAD style
  cad: { bg: '#1b1f24', 7: [236, 238, 240], 8: [150, 156, 162], 5: [92, 140, 255], 94: [64, 190, 90], 250: [255, 255, 255] },
  // print exactly like the Python tool (pure ACI colours)
  print: { bg: '#ffffff', 7: [0, 0, 0] },
};

export function rgbOf(aci, palette) {
  const pal = PALETTES[palette] || PALETTES.paper;
  return pal[aci] || ACI[aci] || [0, 0, 0];
}

export function styleOf(it, palette) {
  const L = LAYERS[it.layer] || [7, 'CONTINUOUS', 25];
  const aci = it.color ?? L[0];
  return { rgb: rgbOf(aci, palette), lw: (it.lw ?? L[2]) / 100, dash: LINETYPES[L[1]] || null };
}

const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

// ----------------------------------------------------------------- canvas
// opts: { palette, lwScale: px per paper-mm of lineweight, lwMin, dashScale }
export function paintCanvas(ctx, items, T, opts = {}) {
  const palette = opts.palette || 'paper';
  const lwScale = opts.lwScale ?? 3;
  const lwMin = opts.lwMin ?? 0.6;
  const { a, b, k } = T;
  const X = (x) => a + k * x, Y = (y) => b - k * y;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  for (const it of items) {
    const st = styleOf(it, palette);
    const col = css(st.rgb);
    if (it.k === 'L' || it.k === 'C') {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(lwMin, st.lw * lwScale);
      if (st.dash) {
        const d = st.dash.map((v) => Math.max(Math.abs(v) * k, v === 0 ? 1 : 0.5));
        ctx.setLineDash(d);
      } else ctx.setLineDash([]);
      ctx.beginPath();
      if (it.k === 'L') {
        const p = it.pts;
        ctx.moveTo(X(p[0][0]), Y(p[0][1]));
        for (let i = 1; i < p.length; i++) ctx.lineTo(X(p[i][0]), Y(p[i][1]));
        if (it.closed) ctx.closePath();
      } else {
        ctx.arc(X(it.c[0]), Y(it.c[1]), it.r * k, 0, Math.PI * 2);
      }
      ctx.stroke();
    } else if (it.k === 'F') {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const r of it.rings) {
        ctx.moveTo(X(r[0][0]), Y(r[0][1]));
        for (let i = 1; i < r.length; i++) ctx.lineTo(X(r[i][0]), Y(r[i][1]));
        ctx.closePath();
      }
      ctx.fill('evenodd');
    } else if (it.k === 'T') {
      const size = (it.h * k) / CAP;
      if (size < 0.8) continue;
      const [ox, oy] = textOrigin(it);
      ctx.fillStyle = col;
      ctx.font = `${size}px ${FONT_FAMILY}, "DejaVu Sans Condensed", "Arial Narrow", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      if (it.rot) {
        ctx.save();
        ctx.translate(X(ox), Y(oy));
        ctx.rotate((-it.rot * Math.PI) / 180);
        ctx.fillText(it.s, 0, 0);
        ctx.restore();
      } else ctx.fillText(it.s, X(ox), Y(oy));
    }
  }
  ctx.setLineDash([]);
}

// a sheet on a canvas: paper items + model viewports; k = px per paper mm
export function paintSheetCanvas(ctx, sheet, k, ox = 0, oy = 0, opts = {}) {
  const [Wp, Hp] = sheet.size;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox, oy, Wp * k, Hp * k);
  const o = { palette: 'paper', lwScale: k, lwMin: 0.35, ...opts };
  for (const vp of sheet.vps) {
    const mx = (vp.bbox[0] + vp.bbox[2]) / 2, my = (vp.bbox[1] + vp.bbox[3]) / 2;
    // paper X = cx + (x - mx)/s ; device = ox + k*X, oy + k*(Hp - Y)
    const kk = k / vp.scale;
    paintCanvas(ctx, vp.view.dl.items, { a: ox + k * (vp.cx - mx / vp.scale), b: oy + k * (Hp - vp.cy + my / vp.scale), k: kk }, o);
  }
  paintCanvas(ctx, sheet.paper.items, { a: ox, b: oy + k * Hp, k }, o);
}

// -------------------------------------------------------------------- PDF
let fontAdded = new WeakSet();
export function pdfFont(doc) {
  if (!fontAdded.has(doc)) {
    doc.addFileToVFS('DejaVuSansCondensed.ttf', FONT_B64);
    doc.addFont('DejaVuSansCondensed.ttf', FONT_FAMILY, 'normal');
    fontAdded.add(doc);
  }
  doc.setFont(FONT_FAMILY, 'normal');
}

// jsPDF in mm; T maps drawing units to page mm (y down)
export function paintPdf(doc, items, T, opts = {}) {
  const palette = opts.palette || 'print';
  const lwScale = opts.lwScale ?? 1;   // lineweights are paper mm already
  const { a, b, k } = T;
  const X = (x) => a + k * x, Y = (y) => b - k * y;
  let lastDash = 'none', lastLw = -1, lastCol = '';
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
  for (const it of items) {
    const st = styleOf(it, palette);
    const [r, g, bl] = st.rgb;
    const ck = `${r},${g},${bl}`;
    if (it.k === 'L' || it.k === 'C') {
      if (ck !== lastCol) { doc.setDrawColor(r, g, bl); lastCol = ck; }
      const lw = Math.max(0.05, st.lw * lwScale);
      if (lw !== lastLw) { doc.setLineWidth(lw); lastLw = lw; }
      const dk = st.dash ? st.dash.map((v) => (v === 0 ? Math.max(lw, 0.1) : Math.abs(v) * k)) : null;
      const key = dk ? dk.map((v) => v.toFixed(3)).join(',') : 'none';
      if (key !== lastDash) {
        doc.setLineDashPattern(dk || [], 0);
        lastDash = key;
      }
      if (it.k === 'L') {
        const p = it.pts;
        doc.moveTo(X(p[0][0]), Y(p[0][1]));
        for (let i = 1; i < p.length; i++) doc.lineTo(X(p[i][0]), Y(p[i][1]));
        if (it.closed) doc.close();
        doc.stroke();
      } else {
        doc.circle(X(it.c[0]), Y(it.c[1]), it.r * k, 'S');
      }
    } else if (it.k === 'F') {
      doc.setFillColor(r, g, bl);
      for (const ring of it.rings) {
        doc.moveTo(X(ring[0][0]), Y(ring[0][1]));
        for (let i = 1; i < ring.length; i++) doc.lineTo(X(ring[i][0]), Y(ring[i][1]));
        doc.close();
      }
      doc.fill();
    } else if (it.k === 'T') {
      const sizeMm = (it.h * k) / CAP;
      const [tx, ty] = textOrigin(it);
      doc.setTextColor(r, g, bl);
      doc.setFontSize((sizeMm * 72) / 25.4);
      doc.text(it.s, X(tx), Y(ty), it.rot ? { angle: it.rot } : undefined);
    }
  }
  doc.setLineDashPattern([], 0);
}

export function paintSheetPdf(doc, sheet, opts = {}) {
  const [, Hp] = sheet.size;
  for (const vp of sheet.vps) {
    const mx = (vp.bbox[0] + vp.bbox[2]) / 2, my = (vp.bbox[1] + vp.bbox[3]) / 2;
    paintPdf(doc, vp.view.dl.items, { a: vp.cx - mx / vp.scale, b: Hp - vp.cy + my / vp.scale, k: 1 / vp.scale }, opts);
  }
  paintPdf(doc, sheet.paper.items, { a: 0, b: Hp, k: 1 }, opts);
}

// jsPDF constructor comes from the UMD global (browser) or is passed in (Node)
export function sheetsPdf(jsPDF, sheets, meta = {}) {
  const [Wp, Hp] = sheets[0].size;
  const doc = new jsPDF({ orientation: Wp > Hp ? 'landscape' : 'portrait', unit: 'mm', format: [Wp, Hp], compress: true });
  pdfFont(doc);
  sheets.forEach((sh, i) => {
    if (i) doc.addPage([sh.size[0], sh.size[1]], sh.size[0] > sh.size[1] ? 'landscape' : 'portrait');
    pdfFont(doc);
    paintSheetPdf(doc, sh);
  });
  doc.setProperties({ title: meta.title || 'Stair drawings', creator: 'Stair designer', subject: meta.subject || '' });
  return doc;
}

export function templatesPdf(jsPDF, templates, meta = {}) {
  const margin = 15;
  let doc = null;
  for (const t of templates) {
    const [x0, y0, x1, y1] = [t.bbox[0] - margin, t.bbox[1] - margin, t.bbox[2] + margin, t.bbox[3] + margin];
    const w = x1 - x0, h = y1 - y0;
    const orient = w > h ? 'landscape' : 'portrait';
    if (!doc) doc = new jsPDF({ orientation: orient, unit: 'mm', format: [w, h], compress: true });
    else doc.addPage([w, h], orient);
    pdfFont(doc);
    paintPdf(doc, t.dl.items, { a: -x0, b: y1, k: 1 });
    // 100 mm check bar so the print scale can be verified
    paintPdf(doc, checkBar(x0 + 5, y0 + 5), { a: -x0, b: y1, k: 1 });
  }
  doc.setProperties({ title: meta.title || 'Stair templates 1:1', creator: 'Stair designer' });
  return doc;
}

function checkBar(x, y) {
  const L = [];
  L.push({ k: 'L', pts: [[x, y], [x + 100, y]], closed: false, layer: 'T-TEXT' });
  for (const dx of [0, 50, 100]) L.push({ k: 'L', pts: [[x + dx, y], [x + dx, y + (dx === 50 ? 3 : 5)]], closed: false, layer: 'T-TEXT' });
  L.push({ k: 'T', s: '100 mm – check the print scale', p: [x + 104, y], h: 2.5, align: 'BL', rot: 0, layer: 'T-TEXT', color: 8 });
  return L;
}
