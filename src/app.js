// Stair designer – web app. Inputs → engine → live drawings, rules check,
// 3D model and exports. Engine modules are shared with the Node tests.

import { DEFAULTS, PRESETS, SCHEMA, clone, merge, getKey, setKey, validate, toToml, fromText } from './params.js';
import { build, StairError } from './geometry.js';
import { buildParts } from './parts.js';
import * as rules from './rules.js';
import * as report from './report.js';
import { viewCache, buildSheets, buildTemplates } from './sheets.js';
import { paintCanvas, paintSheetCanvas, PALETTES, sheetsPdf, templatesPdf } from './render.js';
import { toDxf } from './dxf.js';
import { View3D } from './view3d.js';
import { FONT_B64, FONT_FAMILY } from './font.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c);
  return el;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STORE = 'stair-designer:v1';
const CDN = {
  three: ['https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js'],
  jspdf: ['https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'],
  jszip: ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
};
const loaded = {};
function loadLib(name) {
  if (loaded[name]) return loaded[name];
  loaded[name] = CDN[name].reduce((chain, src) => chain.then(() => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = res;
    s.onerror = () => rej(new Error(`Could not load ${src.split('/npm/')[1] || src}`));
    document.head.append(s);
  })), Promise.resolve()).catch((e) => {
    delete loaded[name];
    throw e;
  });
  return loaded[name];
}

// ------------------------------------------------------------------ state
const S = {
  params: null,
  r: null,          // last good result
  error: null,
  view: 'plan',
  sheet: 0,
  canvasPalette: null,
  history: [],
  future: [],
  committed: null,
};

function store(key, val) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}');
    all[key] = val;
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) { /* storage unavailable */ }
}
function stored(key) {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}')[key];
  } catch (e) {
    return undefined;
  }
}

// --------------------------------------------------------------- theming
function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
}
function canvasPalette() {
  return S.canvasPalette || (isDark() ? 'cad' : 'paper');
}

// ------------------------------------------------------------- downloads
const ALLOWED = new Set('gif png jpg jpeg webp mp4 webm txt json md docx pptx epub csv ttf html svg pdf xlsx zip'.split(' '));
const downloadsCap = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
const inViewer = !!(window.claude && typeof window.claude.use === 'function');

async function saveFile(filename, data) {
  const ext = filename.split('.').pop().toLowerCase();
  const cap = await downloadsCap;
  if (cap) {
    if (!ALLOWED.has(ext)) {
      await loadLib('jszip');
      const zip = new JSZip();
      zip.file(filename, data);
      data = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      filename = filename + '.zip';
    }
    try {
      await cap.save({ filename, data });
      toast(`Saved ${filename}`);
    } catch (e) {
      if (e && e.code === 'declined') return;
      if (e && e.code === 'rate_limited') toast('A save is already waiting for an answer.');
      else toast('Downloads are not available in this view.');
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(framed() && inViewer ? 'Downloads are not available in this view.' : `Saved ${filename}`);
}
function framed() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('on');
    setTimeout(() => (t.hidden = true), 250);
  }, 2600);
}

// ----------------------------------------------------------------- form
const fields = [];
function buildForm() {
  const host = $('#form');
  host.textContent = '';
  const openIds = stored('openGroups') || ['stair', 'layout'];
  for (const sec of SCHEMA) {
    const body = h('div', { class: 'grp-body' });
    for (const f of sec.fields) body.append(fieldRow(f));
    const det = h('details', { class: 'grp' + (sec.adv ? ' adv' : ''), 'data-id': sec.id, open: openIds.includes(sec.id) },
      h('summary', {}, h('span', { text: sec.title })), body);
    det.addEventListener('toggle', () => store('openGroups', $$('#form details[open]').map((d) => d.dataset.id)));
    host.append(det);
  }
}

function fieldRow(f) {
  const id = 'f_' + f.k.replace('.', '_');
  const row = h('div', { class: 'fld fld-' + (f.type || 'num'), 'data-key': f.k });
  const set = (v, commitNow = false) => {
    setKey(S.params, f.k, v);
    if (f.type === 'seg') read(v);
    refreshWhen();
    schedule(commitNow ? 0 : 140);
    if (commitNow) commit();
  };
  let ctl, read;
  if (f.type === 'seg') {
    ctl = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': id + '_l' },
      f.options.map(([v, lab]) => h('button', {
        type: 'button', role: 'radio', 'data-v': v, text: lab,
        onclick: () => set(v, true),
      })));
    read = (v) => $$('button', ctl).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    row.append(h('span', { class: 'lab', id: id + '_l', text: f.label }), ctl);
  } else if (f.type === 'bool') {
    const inp = h('input', { type: 'checkbox', id, class: 'sw', onchange: (e) => set(e.target.checked, true) });
    ctl = inp;
    read = (v) => (inp.checked = !!v);
    row.append(h('label', { class: 'lab', for: id, text: f.label }), h('span', { class: 'ctl' }, inp));
  } else if (f.type === 'select') {
    const sel = h('select', { id, onchange: (e) => set(e.target.value, true) }, f.options.map(([v, lab]) => h('option', { value: v, text: lab })));
    ctl = sel;
    read = (v) => (sel.value = v);
    row.append(h('label', { class: 'lab', for: id, text: f.label }), h('span', { class: 'ctl' }, sel));
  } else if (f.type === 'text') {
    const inp = h('input', { type: 'text', id, spellcheck: 'false', oninput: (e) => set(e.target.value), onchange: () => commit() });
    ctl = inp;
    read = (v) => (inp.value = v);
    row.append(h('label', { class: 'lab', for: id, text: f.label }), h('span', { class: 'ctl' }, inp));
  } else {
    const isInt = f.type === 'int';
    const inp = h('input', {
      type: 'number', id, inputmode: isInt ? 'numeric' : 'decimal', step: f.step || 1, min: f.min, max: f.max,
      oninput: (e) => {
        const v = Number(e.target.value);
        const bad = e.target.value === '' || !Number.isFinite(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max);
        row.classList.toggle('bad', bad);
        if (!bad) set(isInt ? Math.round(v) : v);
      },
      onchange: () => commit(),
    });
    ctl = inp;
    read = (v) => {
      inp.value = v;
      row.classList.remove('bad');
    };
    row.append(h('label', { class: 'lab', for: id, text: f.label }),
      h('span', { class: 'ctl num' }, inp, f.unit ? h('span', { class: 'unit', text: f.unit }) : null));
  }
  if (f.hint) row.append(h('p', { class: 'hint', text: f.hint }));
  fields.push({ f, row, ctl, read });
  return row;
}

function syncForm() {
  for (const { f, read } of fields) read(getKey(S.params, f.k));
  refreshWhen();
  $$('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === presetOf(S.params))));
}
function refreshWhen() {
  for (const { f, row, ctl } of fields) {
    const on = !f.when || f.when(S.params);
    row.classList.toggle('off', !on);
    if (ctl.tagName === 'DIV') $$('button', ctl).forEach((b) => (b.disabled = !on));
    else ctl.disabled = !on;
  }
}
function presetOf(p) {
  const j = JSON.stringify(p);
  for (const [k, v] of Object.entries(PRESETS)) if (JSON.stringify(v) === j) return k;
  return null;
}

// --------------------------------------------------------------- history
function commit() {
  const j = JSON.stringify(S.params);
  if (j === S.committed) return;
  if (S.committed) S.history.push(S.committed);
  if (S.history.length > 80) S.history.shift();
  S.committed = j;
  S.future = [];
  updateUndo();
  $$('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === presetOf(S.params))));
}
function undo() {
  if (!S.history.length) return;
  S.future.push(JSON.stringify(S.params));
  S.committed = S.history.pop();
  S.params = JSON.parse(S.committed);
  syncForm();
  rebuild();
  updateUndo();
}
function redo() {
  if (!S.future.length) return;
  S.history.push(JSON.stringify(S.params));
  S.committed = S.future.pop();
  S.params = JSON.parse(S.committed);
  syncForm();
  rebuild();
  updateUndo();
}
function updateUndo() {
  $('#undo').disabled = !S.history.length;
  $('#redo').disabled = !S.future.length;
}
function loadParams(p, note) {
  S.params = merge(DEFAULTS, p);
  commit();
  syncForm();
  rebuild();
  if (note) toast(note);
}

// --------------------------------------------------------------- pipeline
let timer = null;
function schedule(delay = 140) {
  clearTimeout(timer);
  timer = setTimeout(rebuild, delay);
}

function rebuild() {
  clearTimeout(timer);
  const v = validate(S.params);
  $('#formMsg').hidden = !(v.errors.length || v.warnings.length);
  $('#formMsg').innerHTML = [...v.errors.map((e) => `<p class="m-fail">${esc(e)}</p>`), ...v.warnings.map((w) => `<p class="m-warn">${esc(w)}</p>`)].join('');
  if (v.errors.length) return fail(v.errors.join(' '));
  let r;
  try {
    const t0 = performance.now();
    const g = build(S.params);
    const P = buildParts(g);
    const checks = rules.run(g, P);
    const cons = rules.constructionChecks(g, P);
    const rows = report.cutlist(g, P);
    const V = viewCache(g, P);
    r = { g, P, checks, cons, rows, V, sheets: null, md: null, t0 };
  } catch (e) {
    console.error(e);
    return fail(e instanceof StairError ? e.message : `Could not build this stair (${e.message}).`);
  }
  const prev = S.r;
  S.r = r;
  S.error = null;
  document.body.classList.remove('has-error');
  $('#stageError').hidden = true;
  renderHeader(prev);
  renderRules();
  renderView(true);
  if (window.__stairDebug) console.debug(`rebuild ${(performance.now() - r.t0).toFixed(0)} ms`);
  store('params', S.params);
}

function fail(msg) {
  S.error = msg;
  document.body.classList.add('has-error');
  const el = $('#stageError');
  el.hidden = false;
  el.innerHTML = `<strong>This stair can't be built yet.</strong> ${esc(msg)}`;
  $('#tbVerdict').className = 'tb-cell tb-verdict v-fail';
  $('#tbVerdictVal').textContent = 'Not buildable';
  $('#tbVerdictSub').textContent = 'see the message under the tabs';
}

// ---------------------------------------------------------------- header
function keyNumbers(r) {
  const g = r.g;
  const straight = g.treads.filter((t) => !t.tapered);
  const tapered = g.treads.filter((t) => t.tapered);
  const gs = straight.length ? Math.min(...straight.map((t) => t.goingWalk)) : null;
  const gt = tapered.length ? Math.min(...tapered.map((t) => t.goingWalk)) : null;
  const pitch = gs ? (Math.atan(g.rise / gs) * 180) / Math.PI : null;
  const c = rules.counts(r.checks);
  return { gs, gt, pitch, c };
}

function renderHeader(prev) {
  const r = S.r, g = r.g, p = g.p;
  const k = keyNumbers(r);
  const set = (id, val, sub, cls) => {
    const el = $('#' + id);
    const v = $('.val', el), s = $('.sub', el);
    if (v.textContent !== val && prev) flash(el);
    v.textContent = val;
    if (s) s.textContent = sub;
    if (cls !== undefined) el.dataset.state = cls;
  };
  $('#tbProject').textContent = p.project.name || 'Stair';
  $('#tbProjectSub').textContent = `${p.stair.turn === 'left' ? 'Left' : 'Right'} turn, ${p.layout.winder_layout} winders`;
  set('tbRise', `${g.N} × ${g.rise.toFixed(1)}`, `rises, floor to floor ${g.H.toFixed(0)}`, g.rise <= p.rules.max_rise + 1e-6 ? 'ok' : 'bad');
  const minG = p.rules.min_going;
  const all = g.treads.map((t) => t.goingWalk);
  const gmin = Math.min(...all);
  const goingBad = gmin < minG - 0.05;
  const sub = k.gt !== null && k.gs !== null ? `minimum; straight ${k.gs.toFixed(1)}` : 'minimum';
  set('tbGoing', gmin.toFixed(1), sub, goingBad ? 'bad' : 'ok');
  set('tbPitch', k.pitch !== null ? `${k.pitch.toFixed(1)}°` : '–', `width ${g.W.toFixed(0)}`);
  const v = $('#tbVerdict');
  const nf = k.c.FAIL, nw = k.c.WARN;
  v.className = 'tb-cell tb-verdict ' + (nf ? 'v-fail' : nw ? 'v-warn' : 'v-pass');
  const val = nf ? `${nf} rule${nf > 1 ? 's' : ''} fail` : 'Rules pass';
  if ($('#tbVerdictVal').textContent !== val && prev) flash(v);
  $('#tbVerdictVal').textContent = val;
  $('#tbVerdictSub').textContent = nw ? `${nw} warning${nw > 1 ? 's' : ''}, YMa 1007/2017` : 'YMa 1007/2017 + YM guide';
}

function flash(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ------------------------------------------------------------ rules panel
const STATUS_TXT = { PASS: 'Pass', FAIL: 'Fail', WARN: 'Warn', INFO: 'Info' };
function renderRules() {
  const r = S.r, g = r.g, p = g.p;
  const k = keyNumbers(r);
  const head = k.c.FAIL
    ? `<p class="verdict v-fail"><strong>${k.c.FAIL} required check${k.c.FAIL > 1 ? 's' : ''} fail${k.c.FAIL > 1 ? '' : 's'}</strong>${k.c.WARN ? `, ${k.c.WARN} warning${k.c.WARN > 1 ? 's' : ''}` : ''}</p>`
    : `<p class="verdict v-pass"><strong>All required checks pass</strong>${k.c.WARN ? `, ${k.c.WARN} warning${k.c.WARN > 1 ? 's' : ''}` : ''}</p>`;
  const item = (c, ref = true) => `<li class="chk s-${c.status.toLowerCase()}">
      <span class="badge">${STATUS_TXT[c.status]}</span>
      <span class="rule">${esc(c.rule)}</span>
      <span class="vl"><span class="v">${esc(c.value)}</span><span class="l">${esc(c.limit)}</span></span>
      ${c.note ? `<span class="note">${esc(c.note)}</span>` : ''}
      ${ref && c.ref !== 'info' && c.ref !== 'construction' ? `<span class="ref">${esc(c.ref)}</span>` : ''}
    </li>`;
  const order = { FAIL: 0, WARN: 1, PASS: 2, INFO: 3 };
  const sorted = [...r.checks].sort((a, b) => order[a.status] - order[b.status]);
  const steps = g.treads.map((t) => {
    const bad = t.goingWalk < p.rules.min_going - 0.05;
    return `<tr class="${bad ? 'bad' : ''}"><td>T${t.k}${t.tapered ? '<span class="tap" title="tapered">◢</span>' : ''}</td><td>${t.zTop.toFixed(1)}</td>` +
      `<td>${t.goingWalk.toFixed(1)}</td><td>${t.tapered ? t.narrowEnd.toFixed(0) : '–'}</td><td>${(2 * g.rise + t.goingWalk).toFixed(0)}</td></tr>`;
  }).join('');
  $('#rulesBody').innerHTML = `${head}
    <ul class="chks">${sorted.map((c) => item(c)).join('')}</ul>
    <h3>Construction</h3>
    <ul class="chks">${r.cons.map((c) => item(c, false)).join('')}</ul>
    <h3>Steps</h3>
    <div class="tbl"><table class="steps"><thead><tr><th>Tread</th><th>Top +</th><th>Going</th><th>Inner</th><th>2R+G</th></tr></thead><tbody>${steps}</tbody></table></div>
    <p class="fine">Going on the walking line ${p.rules.walking_line_from_outer.toFixed(0)} mm from the wall (YM guide 3.1.1). ${g.layoutNotes.map(esc).join(' ')}</p>`;
  $('#rulesTabCount').textContent = k.c.FAIL ? String(k.c.FAIL) : '';
}

// --------------------------------------------------------------- canvas
class CanvasView {
  constructor(host) {
    this.host = host;
    this.cv = h('canvas', { class: 'cv', tabindex: '0', 'aria-label': 'Drawing. Drag to pan, scroll or pinch to zoom, double-click to fit.' });
    host.append(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.content = null;
    this.zoom = 1;
    this.cx = 0;
    this.cy = 0;
    this.fitted = true;
    this.ptrs = new Map();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.bind();
  }
  bind() {
    const cv = this.cv;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.zoomAt(e.offsetX, e.offsetY, f);
    }, { passive: false });
    // mouse / pen: drag pans. Touch: one finger scrolls the page, two fingers pan + zoom
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.readout(e.offsetX, e.offsetY);
      const prev = this.ptrs.get(e.pointerId);
      if (!prev) return;
      const cur = [e.offsetX, e.offsetY];
      this.cx -= (cur[0] - prev[0]) / this.zoom;
      this.cy += (cur[1] - prev[1]) / this.zoom;
      this.fitted = false;
      this.paint();
      this.ptrs.set(e.pointerId, cur);
    });
    const two = (e) => {
      const r = cv.getBoundingClientRect();
      const [a, b] = [e.touches[0], e.touches[1]];
      return { m: [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top], d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    };
    cv.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        this.pinch = two(e);
      }
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !this.pinch) return;
      e.preventDefault();
      const t = two(e);
      this.cx -= (t.m[0] - this.pinch.m[0]) / this.zoom;
      this.cy += (t.m[1] - this.pinch.m[1]) / this.zoom;
      if (this.pinch.d > 2) this.zoomAt(t.m[0], t.m[1], t.d / this.pinch.d);
      else this.paint();
      this.fitted = false;
      this.pinch = t;
    }, { passive: false });
    cv.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) this.pinch = null;
    });
    const up = (e) => this.ptrs.delete(e.pointerId);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => ($('#coords').textContent = ''));
    cv.addEventListener('dblclick', () => this.fit());
    cv.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') this.zoomAt(this.w / 2, this.h / 2, 1.25);
      else if (e.key === '-') this.zoomAt(this.w / 2, this.h / 2, 0.8);
      else if (e.key === '0') this.fit();
      else return;
      e.preventDefault();
    });
  }
  readout(x, y) {
    if (!this.content) return;
    const X = this.cx + (x - this.w / 2) / this.zoom, Y = this.cy - (y - this.h / 2) / this.zoom;
    const u = this.content.kind === 'sheet' ? ' mm on the sheet' : '';
    $('#coords').textContent = `x ${X.toFixed(0)}   y ${Y.toFixed(0)}${u}`;
  }
  zoomAt(x, y, f) {
    const X = this.cx + (x - this.w / 2) / this.zoom, Y = this.cy - (y - this.h / 2) / this.zoom;
    this.zoom = Math.min(Math.max(this.zoom * f, this.minZoom || 1e-4), 60);
    this.cx = X - (x - this.w / 2) / this.zoom;
    this.cy = Y + (y - this.h / 2) / this.zoom;
    this.fitted = false;
    this.paint();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.cv.style.width = this.w + 'px';
    this.cv.style.height = this.h + 'px';
    this.dpr = dpr;
    if (this.fitted) this.fit(false);
    this.paint();
  }
  set(content, keep) {
    const same = this.content && this.content.key === content.key;
    this.content = content;
    if (!same || this.fitted || !keep) this.fit(false);
    this.paint();
  }
  fit(paint = true) {
    if (!this.content || !this.w || this.w < 80 || this.h < 80) return;
    const b = this.content.bbox;
    const pad = Math.min(28, this.w / 10);
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    this.zoom = Math.min((this.w - 2 * pad) / bw, (this.h - 2 * pad) / bh);
    this.minZoom = this.zoom / 8;
    this.cx = (b[0] + b[2]) / 2;
    this.cy = (b[1] + b[3]) / 2;
    this.fitted = true;
    if (paint) this.paint();
  }
  paint() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  }
  draw() {
    const { ctx } = this;
    if (!(this.zoom > 0) || this.w < 2) return;
    const pal = canvasPalette();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.content) return;
    if (this.content.kind === 'sheet') {
      ctx.fillStyle = isDark() ? '#0d1012' : '#d9ddd8';
      ctx.fillRect(0, 0, this.w, this.h);
      const sh = this.content.sheet;
      const k = this.zoom;
      const ox = this.w / 2 - this.cx * k, oy = this.h / 2 + this.cy * k - k * sh.size[1];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#fff';
      ctx.fillRect(ox, oy, sh.size[0] * k, sh.size[1] * k);
      ctx.restore();
      paintSheetCanvas(ctx, sh, k, ox, oy, { palette: 'paper', lwMin: 0.4 });
      return;
    }
    ctx.fillStyle = PALETTES[pal].bg;
    ctx.fillRect(0, 0, this.w, this.h);
    paintCanvas(ctx, this.content.items, { a: this.w / 2 - this.cx * this.zoom, b: this.h / 2 + this.cy * this.zoom, k: this.zoom },
      { palette: pal, lwScale: 2.6, lwMin: 0.55 });
  }
}

// ----------------------------------------------------------------- views
const VIEWS = [
  { id: 'plan', label: 'Plan' },
  { id: 'elev', label: 'Elevation' },
  { id: '3d', label: '3D' },
  { id: 'dev', label: 'Walking line' },
  { id: 'stringers', label: 'Stringers' },
  { id: 'treads', label: 'Treads' },
  { id: 'newel', label: 'Newel' },
  { id: 'sheets', label: 'A3 sheets' },
  { id: 'rules', label: 'Rules', narrow: true },
  { id: 'cut', label: 'Cut list' },
  { id: 'report', label: 'Report' },
];
let canvasView = null, view3d = null;

function buildTabs() {
  const nav = $('#tabs');
  nav.textContent = '';
  for (const v of VIEWS) {
    nav.append(h('button', {
      type: 'button', role: 'tab', id: 'tab_' + v.id, class: 'tab' + (v.narrow ? ' narrow-only' : ''), 'data-view': v.id,
      'aria-controls': 'stage', onclick: () => setView(v.id),
    }, h('span', { text: v.label }), v.id === 'rules' ? h('span', { class: 'cnt', id: 'rulesTabCount' }) : null));
  }
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = $$('.tab', nav).filter((t) => t.offsetParent !== null);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    n.click();
  });
}

function setView(id) {
  if (id === 'newel' && S.r && !S.r.P.newel) id = 'plan';
  S.view = id;
  store('view', id);
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === id)));
  document.body.dataset.view = id;
  renderView(false);
}

function renderView(dataChanged) {
  const id = S.view;
  const r = S.r;
  const isCanvas = ['plan', 'elev', 'dev', 'stringers', 'treads', 'newel', 'sheets'].includes(id);
  $('#cvHost').hidden = !isCanvas;
  $('#glHost').hidden = id !== '3d';
  $('#docHost').hidden = !['cut', 'report', 'rules'].includes(id);
  $('#sheetBar').hidden = id !== 'sheets';
  $('#glBar').hidden = id !== '3d';
  $('#cvBar').hidden = !isCanvas;
  $('#palBtn').hidden = id === 'sheets';
  const how = $('#howto');
  how.hidden = !(isCanvas || id === '3d');
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  how.textContent = id === '3d' ? (coarse ? 'One finger orbits, two fingers pan and zoom' : 'Drag to orbit, right-drag or two fingers to pan, scroll to zoom')
    : (coarse ? 'Two fingers pan and zoom' : 'Drag to pan, scroll or pinch to zoom, double-click to fit');
  $('#tab_newel').hidden = !!(r && !r.P.newel);
  if (view3d) view3d.show(id === '3d');
  if (!r) return;
  if (isCanvas) {
    if (!canvasView) canvasView = new CanvasView($('#cvHost'));
    if (id === 'sheets') {
      ensureSheets();
      const sh = r.sheets[Math.min(S.sheet, r.sheets.length - 1)];
      canvasView.set({ kind: 'sheet', sheet: sh, bbox: [0, 0, sh.size[0], sh.size[1]], key: 'sheet' + S.sheet }, dataChanged);
      $$('#sheetBar .pg').forEach((b, i) => b.setAttribute('aria-pressed', String(i === S.sheet)));
    } else {
      const v = r.V.get(id);
      canvasView.set({ kind: 'model', items: v.dl.items, bbox: v.bbox, key: id }, dataChanged);
    }
  } else if (id === '3d') {
    show3d();
  } else if (id === 'cut') {
    renderCut();
  } else if (id === 'report') {
    renderReport();
  } else if (id === 'rules') {
    const c = $('#rulesBody').cloneNode(true);
    c.removeAttribute('id');
    $('#docHost').textContent = '';
    $('#docHost').append(h('div', { class: 'doc rules-doc' }, h('h2', { text: 'Rules check' }), c));
  }
}

async function show3d() {
  const host = $('#glHost');
  try {
    if (!globalThis.THREE || !globalThis.THREE.OrbitControls) {
      $('#glMsg').hidden = false;
      $('#glMsg').textContent = 'Loading the 3D viewer…';
      await loadLib('three');
    }
    $('#glMsg').hidden = true;
    if (!view3d) {
      view3d = new View3D(host);
      view3d.init();
      view3d.opts = { ...view3d.opts, ...(stored('opts3d') || {}) };
      syncGlBar();
    }
    view3d.setTheme(isDark() ? '#15191c' : '#eef0ec', isDark());
    if (view3d.modelFor !== S.r) {
      view3d.setModel(S.r.g, S.r.P);
      view3d.modelFor = S.r;
    }
    view3d.show(S.view === '3d');
  } catch (e) {
    console.error(e);
    $('#glMsg').hidden = false;
    $('#glMsg').textContent = `The 3D viewer could not start: ${e.message}`;
  }
}
function syncGlBar() {
  if (!view3d) return;
  for (const k of ['walls', 'guard', 'walkline']) $(`#gl_${k}`).setAttribute('aria-pressed', String(!!view3d.opts[k]));
}

function ensureSheets() {
  const r = S.r;
  if (!r.sheets) r.sheets = buildSheets(r.g, r.P, r.checks, r.V.all(), today());
}
function ensureReport() {
  const r = S.r;
  if (!r.md) r.md = report.markdown(r.g, r.P, r.checks, r.cons, r.rows, { date: today() });
}
function today() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function renderCut() {
  const r = S.r;
  const rows = r.rows.map((row) => '<tr>' + row.map((c, i) => `<td class="${i >= 2 && i <= 5 ? 'n' : ''}">${esc(report.fmtNum(c))}</td>`).join('') + '</tr>').join('');
  $('#docHost').innerHTML = `<div class="doc">
    <div class="doc-head"><h2>Cut list</h2><button class="btn" id="cutCsv" type="button">Download CSV</button></div>
    <div class="tbl"><table class="cut"><thead><tr>${report.CUT_HEAD.map((x, i) => `<th class="${i >= 2 && i <= 5 ? 'n' : ''}">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="fine">Blank sizes are the smallest rectangle each part fits in. Winder treads and stringers: cut from the 1:1 templates.</p></div>`;
  $('#cutCsv').addEventListener('click', () => exportOne('csv'));
}
function renderReport() {
  ensureReport();
  $('#docHost').innerHTML = `<div class="doc report">
    <div class="doc-head"><h2>Report</h2><button class="btn" id="mdDl" type="button">Download .md</button></div>
    ${report.mdToHtml(S.r.md.split('\n').slice(1).join('\n'))}</div>`;
  $('#mdDl').addEventListener('click', () => exportOne('md'));
}

// ---------------------------------------------------------------- export
function stem() {
  const n = (S.params.project.name || 'stair').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return n || 'stair';
}
async function pdfDrawings() {
  await loadLib('jspdf');
  ensureSheets();
  const doc = sheetsPdf(window.jspdf.jsPDF, S.r.sheets, { title: S.params.project.name });
  return doc.output('blob');
}
async function pdfTemplates() {
  await loadLib('jspdf');
  const doc = templatesPdf(window.jspdf.jsPDF, buildTemplates(S.r.g, S.r.P), { title: S.params.project.name + ' – templates 1:1' });
  return doc.output('blob');
}
function dxfDrawings() {
  return toDxf(Object.values(S.r.V.all()).filter(Boolean).flatMap((v) => v.dl.items));
}
function dxfTemplates() {
  return toDxf(buildTemplates(S.r.g, S.r.P).flatMap((t) => t.dl.items));
}

async function exportOne(kind, btn) {
  if (!S.r || S.error) {
    toast('Fix the inputs first – the stair can’t be built yet.');
    return;
  }
  const s = stem();
  if (btn) btn.classList.add('busy');
  try {
    if (kind === 'pdf') await saveFile(`${s}_drawings.pdf`, await pdfDrawings());
    else if (kind === 'tpl') await saveFile(`${s}_templates_1to1.pdf`, await pdfTemplates());
    else if (kind === 'dxf') await saveFile(`${s}_drawings.dxf`, dxfDrawings());
    else if (kind === 'tdxf') await saveFile(`${s}_templates_1to1.dxf`, dxfTemplates());
    else if (kind === 'csv') await saveFile(`${s}_cutlist.csv`, '﻿' + report.csv(S.r.rows));
    else if (kind === 'md') {
      ensureReport();
      await saveFile(`${s}_report.md`, S.r.md);
    } else if (kind === 'toml') await saveFile(`${s}.toml`, toToml(S.params));
    else if (kind === 'json') await saveFile(`${s}.json`, JSON.stringify(S.params, null, 2));
    else if (kind === 'zip') {
      await Promise.all([loadLib('jszip'), loadLib('jspdf')]);
      ensureReport();
      const zip = new JSZip();
      const dir = zip.folder(s);
      dir.file(`${s}_drawings.pdf`, await pdfDrawings());
      dir.file(`${s}_templates_1to1.pdf`, await pdfTemplates());
      dir.file(`${s}_drawings.dxf`, dxfDrawings());
      dir.file(`${s}_templates_1to1.dxf`, dxfTemplates());
      dir.file(`${s}_report.md`, S.r.md);
      dir.file(`${s}_cutlist.csv`, '﻿' + report.csv(S.r.rows));
      dir.file(`${s}.toml`, toToml(S.params));
      await saveFile(`${s}.zip`, await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
    }
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`);
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

// ------------------------------------------------------------------ boot
async function loadFont() {
  try {
    const bin = Uint8Array.from(atob(FONT_B64), (c) => c.charCodeAt(0));
    const face = new FontFace(FONT_FAMILY, bin.buffer);
    document.fonts.add(face);
    await face.load();
  } catch (e) { /* falls back to system sans */ }
  if (canvasView) canvasView.paint();
}

function bindChrome() {
  $$('.preset').forEach((b) => b.addEventListener('click', () => {
    loadParams(clone(PRESETS[b.dataset.preset]), `Loaded ${$('b', b).textContent} (${$('small', b).textContent})`);
  }));
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        loadParams(fromText(String(rd.result)), `Loaded ${f.name}`);
      } catch (err) {
        toast(`Could not read ${f.name}: ${err.message}`);
      }
      e.target.value = '';
    };
    rd.readAsText(f);
  });
  $$('[data-export]').forEach((b) => b.addEventListener('click', () => {
    const m = b.closest('details');
    if (m) m.open = false;
    exportOne(b.dataset.export, b);
  }));
  document.addEventListener('click', (e) => {
    const m = $('#exportMenu');
    if (m.open && !m.contains(e.target)) m.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#exportMenu').open = false;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing || !(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });
  $('#tbVerdict').addEventListener('click', () => {
    const panel = $('#rulesPanel');
    if (panel && panel.offsetParent !== null) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.classList.remove('flash');
      void panel.offsetWidth;
      panel.classList.add('flash');
    } else setView('rules');
  });
  $('#fitBtn').addEventListener('click', () => canvasView && canvasView.fit());
  $('#palBtn').addEventListener('click', () => {
    S.canvasPalette = canvasPalette() === 'cad' ? 'paper' : 'cad';
    store('canvasPalette', S.canvasPalette);
    $('#palBtn').textContent = S.canvasPalette === 'cad' ? 'Paper' : 'Dark';
    if (canvasView) canvasView.paint();
  });
  $$('#sheetBar .pg').forEach((b, i) => b.addEventListener('click', () => {
    S.sheet = i;
    renderView(false);
  }));
  $('#sheetPdf').addEventListener('click', (e) => exportOne('pdf', e.currentTarget));
  for (const k of ['walls', 'guard', 'walkline']) {
    $(`#gl_${k}`).addEventListener('click', () => {
      if (!view3d) return;
      view3d.opts[k] = !view3d.opts[k];
      store('opts3d', view3d.opts);
      view3d.applyOpts();
      syncGlBar();
    });
  }
  $$('[data-cam]').forEach((b) => b.addEventListener('click', () => view3d && view3d.view(b.dataset.cam)));
  const themeChanged = () => {
    if (!S.canvasPalette) $('#palBtn').textContent = isDark() ? 'Paper' : 'Dark';
    if (canvasView) canvasView.paint();
    if (view3d) view3d.setTheme(isDark() ? '#15191c' : '#eef0ec', isDark());
  };
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  themeChanged();
}

function boot() {
  buildForm();
  buildTabs();
  bindChrome();
  const saved = stored('params');
  S.canvasPalette = stored('canvasPalette') || null;
  if (S.canvasPalette) $('#palBtn').textContent = S.canvasPalette === 'cad' ? 'Paper' : 'Dark';
  S.params = saved ? merge(DEFAULTS, saved) : clone(PRESETS.A);
  S.committed = JSON.stringify(S.params);
  updateUndo();
  syncForm();
  const v = stored('view');
  setView(VIEWS.some((x) => x.id === v) ? v : 'plan');
  rebuild();
  loadFont();
  document.body.classList.add('ready');
}

if (!globalThis.jsts) {
  document.addEventListener('DOMContentLoaded', () => {
    $('#stageError').hidden = false;
    $('#stageError').textContent = 'The geometry library (JSTS) did not load. Check the connection and reload.';
  });
} else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
