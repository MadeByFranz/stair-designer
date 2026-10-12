# Stair designer

Quarter-turn timber stair with winders, in the browser. Change a dimension and
the plan, elevation, 3D model and the Finnish rules check update live. Export
the A3 drawing set, 1:1 cut templates, DXF, cut list and report.

Same engine as the Python tool (`stair_tool/`): results match it to 0.25 mm,
and the `.toml` parameter files open in both.

## Use

- Inputs on the left. **Version A** = architect's radial winders, **Version B** = balanced winders.
- Header: rise, minimum going on the walking line, pitch, rules verdict (click it for the details).
- Views: Plan, Elevation, 3D, Walking line, Stringers, Treads, Newel, A3 sheets, Cut list, Report.
- Drawings: drag to pan, scroll / pinch to zoom, double-click to fit. *Dark* switches the drawing to a CAD background.
- **Export**: drawings PDF (5 × A3), templates 1:1 PDF, DXF (R12, mm, CAD layers), cut list CSV, report MD, parameters TOML, everything as ZIP.
- **Open parameters…** reads `.toml` (from the Python tool) or `.json`.
- Undo / redo: buttons or Ctrl+Z / Ctrl+Shift+Z. The last design is kept in the browser.

## Rules checked

YMa 1007/2017: rise ≤ 190 and going ≥ 250 inside a dwelling (§4), width ≥ 850 (§3), edge upstand (§6),
guard 900 when the fall is < 3 m and vertical infill (§7), 100 mm cube (§8), handrails on both sides (§9), headroom 1950 (§14).
YM guide 3.1.1: tapered treads measured on the walking line 400 mm from the wide end; ≥ 100 mm recommended at the inner edge.
Limits are editable under *Rule limits*. Confirm the walking-line interpretation with the local rakennusvalvonta.

## Put it on GitHub Pages

1. Create a repository, e.g. `stair-designer`, and upload everything in this folder.
2. *Settings → Pages → Build and deployment*: **Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
3. After a minute it is live at `https://<user>.github.io/stair-designer/`.

No build step: `index.html` loads `src/app.js` as an ES module, the libraries come from jsDelivr.
`dist/index.html` is the same app as one self-contained file (open it directly or host it anywhere).

## Develop

```
python -m http.server 8000        # or: npx serve .   (ES modules need http://, not file://)
npm install
npm test                          # presets A/B vs the Python tool + 29 odd-input variants
npm run build                     # rebuild dist/index.html
```

| File | |
|---|---|
| `src/params.js` | parameters, presets A/B, form schema, TOML / JSON |
| `src/geometry.js` | riser set-out (radial / balanced), treads, riser boards, walking line |
| `src/parts.js` | cut stringers (split when the throat gets thin), joists, newel housings, guard, wall rails |
| `src/rules.js` | Finnish rules check |
| `src/report.js`, `src/frames.js` | cut list, report, marking tables, part frames |
| `src/pen.js`, `src/drawing.js` | display list, layers, dimensions; plan, elevation, development, newel, stringers, treads |
| `src/sheets.js` | model views, A3 sheets with title blocks, 1:1 templates |
| `src/render.js`, `src/dxf.js` | canvas and PDF painters, DXF R12 writer |
| `src/view3d.js` | three.js model |
| `src/app.js`, `index.html` | the app |
| `src/font.js` | DejaVu Sans Condensed subset, embedded in drawings and PDFs |

Libraries: JSTS 2.12 (EPL/EDL), three.js r147 (MIT), jsPDF 2.5 (MIT), JSZip 3.10 (MIT). Fonts: Barlow (OFL), DejaVu (Bitstream Vera licence).

## Limits

One 90° turn with winders (no half-landing, U or spiral stair yet); cut stringers only;
structural sizes are not calculated.
