// Parameter model, presets, form schema, validation and TOML / JSON I/O.
// Section and key names match the Python tool's .toml files, so parameter
// files move freely between the command line and the web app.

export const DEFAULTS = {
  project: { name: 'Stair', site: '', designer: '', notes: '' },
  stair: {
    floor_to_floor: 2600, total_run: 3178, total_run_lower: 850, width: 850, turn: 'right',
    lower_steps: 0, winders: 4, upper_steps: 9, end_with_riser: true,
  },
  layout: { winder_layout: 'radial', pivot_offset: [0, 0], min_inner_going: 100, balance_treads: 0, smoothness: 0.55 },
  treads: { thickness: 40, nosing: 25 },
  risers: { install: true, thickness: 18 },
  stringers: { thickness: 40, width: 300, winder_width: 400, split_side_stringer: true, min_throat: 100 },
  newel: { size: 80, position: 'inside', housing: 15, above_rail: 100 },
  joists: { mode: 'auto', thickness: 50, height: 150 },
  guard: {
    height: 900, baluster: 50, max_gap: 100, design_gap: 95, handrail_thickness: 40, handrail_width: 80,
    wall_handrails: true,
  },
  building: { wall_thickness: 200, slab_thickness: 200, slab_overhang: 0 },
  rules: {
    max_rise: 190, min_going: 250, walking_line_from_outer: 400, min_inner_going_recommended: 100,
    min_headroom: 1950, min_width: 850, step_formula: 630, step_formula_tol: 30, max_open_riser_gap: 100,
  },
  output: { drawing_scale: 20, paper: 'A3' },
};

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function merge(base, over) {
  const out = clone(base);
  for (const [sec, vals] of Object.entries(over || {})) {
    if (!(sec in out) || typeof vals !== 'object' || vals === null) continue;
    for (const [k, v] of Object.entries(vals)) {
      if (!(k in out[sec])) continue;
      const cur = out[sec][k];
      if (typeof cur === 'number') out[sec][k] = Number(v);
      else if (typeof cur === 'boolean') out[sec][k] = v === true || v === 'true' || v === 1;
      else out[sec][k] = v;
    }
  }
  return out;
}

export const PRESETS = {
  A: merge(DEFAULTS, {
    project: {
      name: "Porras - versio A (arkkitehdin kierto)", designer: 'Franz / XpressBygg',
      notes: '4 radial winders at the bottom + 9 straight, right turn',
    },
  }),
  B: merge(DEFAULTS, {
    project: {
      name: 'Porras - versio B (tasattu kierto)', designer: 'Franz / XpressBygg',
      notes: 'Balanced winders, first step projects 25 mm, right turn',
    },
    stair: { total_run_lower: 875 },
    layout: { winder_layout: 'balanced' },
    stringers: { split_side_stringer: false },
    newel: { position: 'outside' },
  }),
};

// Form schema: what the sidebar shows. `adv` fields sit in the advanced group.
export const SCHEMA = [
  {
    id: 'stair', title: 'Stair and opening', fields: [
      { k: 'stair.floor_to_floor', label: 'Floor to floor', unit: 'mm', min: 500, max: 6000, step: 1,
        hint: 'Finished floor to finished floor.' },
      { k: 'stair.total_run', label: 'Total run', unit: 'mm', min: 600, max: 12000, step: 1,
        hint: 'Back wall face to the face of the top riser, along the upper flight.' },
      { k: 'stair.total_run_lower', label: 'Run before the turn', unit: 'mm', min: 300, max: 12000, step: 1,
        hint: 'Side wall face to the face of the first riser. Width + 25 projects the bottom step 25 mm.' },
      { k: 'stair.width', label: 'Width', unit: 'mm', min: 500, max: 2000, step: 1, hint: 'Tread length, wall to open edge.' },
      { k: 'stair.turn', label: 'Turn', type: 'seg', options: [['left', 'Left'], ['right', 'Right']], hint: 'Seen walking up.' },
      { k: 'stair.lower_steps', label: 'Straight treads before the turn', type: 'int', min: 0, max: 20 },
      { k: 'stair.winders', label: 'Treads in the turn', type: 'int', min: 1, max: 6,
        hint: 'Radial: the winders. Balanced: the taper is spread over neighbouring treads too.' },
      { k: 'stair.upper_steps', label: 'Straight treads after the turn', type: 'int', min: 1, max: 25,
        hint: 'The upper floor is the last step.' },
      { k: 'stair.end_with_riser', label: 'Riser up to the upper floor', type: 'bool' },
    ],
  },
  {
    id: 'layout', title: 'Winder layout', fields: [
      { k: 'layout.winder_layout', label: 'Layout', type: 'seg', options: [['radial', 'Radial'], ['balanced', 'Balanced']],
        hint: 'Radial: winder risers meet at the newel corner. Balanced: equal going on the walking line, taper spread over neighbouring treads.' },
      { k: 'layout.min_inner_going', label: 'Min. going at inner edge', unit: 'mm', min: 0, max: 250, step: 1,
        when: (p) => p.layout.winder_layout === 'balanced' },
      { k: 'layout.balance_treads', label: 'Tapered treads', type: 'int', min: 0, max: 20,
        when: (p) => p.layout.winder_layout === 'balanced', hint: '0 = automatic.' },
    ],
  },
  {
    id: 'timber', title: 'Treads, risers, stringers', fields: [
      { k: 'treads.thickness', label: 'Tread thickness', unit: 'mm', min: 15, max: 100, step: 1 },
      { k: 'treads.nosing', label: 'Nosing', unit: 'mm', min: 0, max: 60, step: 1 },
      { k: 'risers.install', label: 'Closed risers', type: 'bool' },
      { k: 'risers.thickness', label: 'Riser thickness', unit: 'mm', min: 6, max: 40, step: 1, when: (p) => p.risers.install },
      { k: 'stringers.thickness', label: 'Stringer thickness', unit: 'mm', min: 20, max: 100, step: 1 },
      { k: 'stringers.width', label: 'Stringer width, straight', unit: 'mm', min: 150, max: 600, step: 1 },
      { k: 'stringers.winder_width', label: 'Stringer width, turn', unit: 'mm', min: 150, max: 800, step: 1 },
      { k: 'stringers.split_side_stringer', label: 'Split wall stringer at the turn', type: 'bool' },
      { k: 'stringers.min_throat', label: 'Min. timber under notches', unit: 'mm', min: 40, max: 300, step: 1,
        hint: 'Warns, or splits the stringer at a riser cut, when less is left.' },
    ],
  },
  {
    id: 'newel', title: 'Newel and joists', fields: [
      { k: 'newel.position', label: 'Newel', type: 'select',
        options: [['inside', 'In the inner corner'], ['centre', 'Centred on the corner'], ['outside', 'Beside the stringer foot'], ['none', 'None']] },
      { k: 'newel.size', label: 'Newel size', unit: 'mm', min: 40, max: 200, step: 1, when: (p) => p.newel.position !== 'none' },
      { k: 'newel.housing', label: 'Housing depth', unit: 'mm', min: 0, max: 40, step: 1, when: (p) => p.newel.position !== 'none' },
      { k: 'joists.mode', label: 'Winder joists', type: 'select',
        options: [['auto', 'Where needed'], ['all_tapered', 'Under every winder'], ['none', 'None']] },
      { k: 'joists.thickness', label: 'Joist thickness', unit: 'mm', min: 20, max: 150, step: 1, when: (p) => p.joists.mode !== 'none' },
      { k: 'joists.height', label: 'Joist height', unit: 'mm', min: 50, max: 300, step: 1, when: (p) => p.joists.mode !== 'none' },
    ],
  },
  {
    id: 'guard', title: 'Guard and handrails', fields: [
      { k: 'guard.height', label: 'Handrail height', unit: 'mm', min: 700, max: 1200, step: 1,
        hint: 'Above the nosing line.' },
      { k: 'guard.baluster', label: 'Baluster size', unit: 'mm', min: 15, max: 100, step: 1 },
      { k: 'guard.design_gap', label: 'Target gap', unit: 'mm', min: 30, max: 110, step: 1 },
      { k: 'guard.wall_handrails', label: 'Wall handrails', type: 'bool' },
    ],
  },
  {
    id: 'building', title: 'Building', fields: [
      { k: 'building.wall_thickness', label: 'Wall thickness', unit: 'mm', min: 50, max: 600, step: 1 },
      { k: 'building.slab_thickness', label: 'Upper slab thickness', unit: 'mm', min: 100, max: 600, step: 1 },
      { k: 'building.slab_overhang', label: 'Slab over the stair', unit: 'mm', min: 0, max: 12000, step: 1,
        hint: 'From the back wall. 0 = the opening covers the whole stair.' },
    ],
  },
  {
    id: 'rules', title: 'Rule limits', adv: true, fields: [
      { k: 'rules.max_rise', label: 'Max. rise', unit: 'mm', min: 100, max: 250, step: 1 },
      { k: 'rules.min_going', label: 'Min. going', unit: 'mm', min: 150, max: 400, step: 1 },
      { k: 'rules.walking_line_from_outer', label: 'Walking line from wall', unit: 'mm', min: 100, max: 1000, step: 1 },
      { k: 'rules.min_inner_going_recommended', label: 'Inner edge, recommended', unit: 'mm', min: 0, max: 250, step: 1 },
      { k: 'rules.min_headroom', label: 'Min. headroom', unit: 'mm', min: 1500, max: 2500, step: 1 },
      { k: 'rules.min_width', label: 'Min. width', unit: 'mm', min: 500, max: 1500, step: 1 },
    ],
  },
  {
    id: 'project', title: 'Title block', adv: true, fields: [
      { k: 'project.name', label: 'Project', type: 'text' },
      { k: 'project.designer', label: 'Drawn by', type: 'text' },
      { k: 'project.notes', label: 'Notes', type: 'text' },
    ],
  },
];

export function getKey(p, key) {
  const [s, k] = key.split('.');
  return p[s][k];
}
export function setKey(p, key, v) {
  const [s, k] = key.split('.');
  p[s][k] = v;
}

export function validate(p) {
  const errors = [], warnings = [];
  const s = p.stair;
  if (!['right', 'left'].includes(s.turn)) errors.push('Turn must be left or right.');
  if (s.total_run_lower < s.width) errors.push('Run before the turn must be at least the stair width.');
  if (s.total_run <= s.width) errors.push('Total run must be longer than the stair width.');
  if (s.winders < 1 && p.layout.winder_layout === 'radial') errors.push('A radial layout needs at least one winder.');
  if (s.upper_steps < 1) errors.push('At least one straight tread after the turn.');
  if (s.floor_to_floor <= 0) errors.push('Floor to floor must be positive.');
  if (s.lower_steps === 0 && s.total_run_lower > s.width + 200)
    warnings.push('The bottom step projects more than 200 mm past the newel line.');
  return { errors, warnings };
}

// ---------------------------------------------------------------- TOML I/O
export function toToml(p) {
  const out = ['# Stair designer parameters (mm)', ''];
  for (const [sec, vals] of Object.entries(p)) {
    out.push(`[${sec}]`);
    for (const [k, v] of Object.entries(vals)) out.push(`${k} = ${tomlValue(v)}`);
    out.push('');
  }
  return out.join('\n');
}
function tomlValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(tomlValue).join(', ') + ']';
  return String(v);
}

export function parseToml(text) {
  const out = {};
  let sec = null;
  for (let raw of text.split(/\r?\n/)) {
    let line = stripComment(raw).trim();
    if (!line) continue;
    const m = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (m) {
      sec = m[1];
      out[sec] = out[sec] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv || !sec) continue;
    out[sec][kv[1]] = parseValue(kv[2].trim());
  }
  return out;
}
function stripComment(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === '#' && !q) return line.slice(0, i);
  }
  return line;
}
function parseValue(v) {
  if (v.startsWith('"')) return JSON.parse(v);
  if (v === 'true' || v === 'false') return v === 'true';
  if (v.startsWith('[')) return v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).map(parseValue);
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

export function fromText(text) {
  const t = text.trim();
  const data = t.startsWith('{') ? JSON.parse(t) : parseToml(t);
  return merge(DEFAULTS, data);
}
