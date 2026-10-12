// 3D model of the stair (three.js r147, UMD global THREE + THREE.OrbitControls).
// World axes: X = plan x, Y = height, Z = −plan y (mirrored for a left turn).

import { exterior, bounds } from './geo.js';
import { railZ } from './parts.js';
import { rDir } from './geometry.js';

const WOOD = { treads: '#d6b07a', stringers: '#c99d63', newel: '#b98a52', rail: '#c08f55', joists: '#b39469' };

function woodCanvas(base = '#d6b07a', seed = 1) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 512, 512);
  let s = seed * 9973;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const y0 = rnd() * 512, amp = 2 + rnd() * 7, f = 0.004 + rnd() * 0.012, ph = rnd() * 6.28;
    const dark = rnd() < 0.7;
    x.strokeStyle = dark ? `rgba(110,70,30,${0.05 + rnd() * 0.12})` : `rgba(255,240,215,${0.05 + rnd() * 0.1})`;
    x.lineWidth = 0.6 + rnd() * 2.2;
    x.beginPath();
    for (let u = -10; u <= 522; u += 8) {
      const v = y0 + Math.sin(u * f + ph) * amp + Math.sin(u * f * 3.1 + ph * 2) * amp * 0.25;
      if (u === -10) x.moveTo(u, v);
      else x.lineTo(u, v);
    }
    x.stroke();
  }
  return c;
}

export class View3D {
  constructor(host) {
    this.host = host;
    this.ready = false;
    this.visible = false;
    this.opts = { walls: true, guard: true, walkline: true };
  }

  init() {
    if (this.ready) return;
    const T = globalThis.THREE;
    this.T = T;
    const r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    r.outputEncoding = T.sRGBEncoding;
    this.renderer = r;
    this.host.appendChild(r.domElement);
    r.domElement.className = 'gl';
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(35, 1, 10, 200000);
    this.controls = new T.OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => (this.dirty = true));
    const hemi = new T.HemisphereLight(0xffffff, 0xb8b0a2, 0.75);
    this.scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 2;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.group = new T.Group();
    this.scene.add(this.group);
    this.woodTex = {};
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.ready = true;
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.visible) return;
      const moved = this.controls.update();
      if (moved || this.dirty) {
        this.fadeWalls();
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    loop();
  }

  setTheme(bg, dark = false) {
    if (!this.ready) return;
    this.dark = dark;
    this.scene.background = new this.T.Color(bg);
    this.tintBuilding();
    this.dirty = true;
  }
  tintBuilding() {
    const m = this.mats || {};
    const d = !!this.dark;
    if (m.wall) for (const w of m.wall) w.color.set(d ? 0x8e9493 : 0xe1e3df);
    if (m.slab) for (const w of m.slab) w.color.set(d ? 0x7d8382 : 0xd5d8d3);
    if (m.floor) m.floor.color.set(d ? 0x585e5d : 0xcfd2cc);
  }

  resize() {
    if (!this.ready) return;
    const w = this.host.clientWidth || 300, h = this.host.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  show(on) {
    this.visible = on;
    if (on) {
      this.resize();
      this.dirty = true;
    }
  }

  wood(key, rotation = 0) {
    const T = this.T;
    if (!this.woodTex[key]) {
      const tex = new T.CanvasTexture(woodCanvas(WOOD[key] || WOOD.treads, key.length * 7 + 3));
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = 4;
      this.woodTex[key] = tex;
    }
    const t = this.woodTex[key].clone();
    t.needsUpdate = true;
    t.repeat.set(1 / 900, 1 / 900);
    t.rotation = rotation;
    return new T.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0, side: T.DoubleSide });
  }

  // ------------------------------------------------------------- model
  setModel(g, P) {
    if (!this.ready) {
      this.pending = [g, P];
      return;
    }
    const T = this.T;
    for (const ch of [...this.group.children]) {
      this.group.remove(ch);
      ch.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    }
    this.walls = [];
    const p = g.p;
    const sy = p.stair.turn === 'right' ? 1 : -1;
    this.sy = sy;
    const edgeMat = new T.LineBasicMaterial({ color: 0x3a3026, transparent: true, opacity: 0.28 });
    const add = (geo, mat, M, opt = {}) => {
      geo.applyMatrix4(M);
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, mat);
      m.castShadow = opt.cast !== false;
      m.receiveShadow = true;
      this.group.add(m);
      if (opt.edges !== false) {
        const e = new T.LineSegments(new T.EdgesGeometry(geo, 25), edgeMat);
        this.group.add(e);
        m.userData.edges = e;
      }
      return m;
    };
    // plan polygon extruded from z0 to z1
    const planM = (z0) => new T.Matrix4().set(1, 0, 0, 0, 0, 0, 1, z0, 0, -sy, 0, 0, 0, 0, 0, 1);
    const shapeOf = (pts) => new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)));
    const extrudePlan = (pg, z0, z1, mat, opt) => {
      const pts = exterior(pg);
      if (pts.length < 3 || z1 - z0 < 0.1) return null;
      const geo = new T.ExtrudeGeometry(shapeOf(pts), { depth: z1 - z0, bevelEnabled: false });
      return add(geo, mat, planM(z0), opt);
    };
    const extrudeRect = (x0, y0, x1, y1, z0, z1, mat, opt) => {
      const geo = new T.ExtrudeGeometry(shapeOf([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), { depth: z1 - z0, bevelEnabled: false });
      return add(geo, mat, planM(z0), opt);
    };
    // elevation polygon (s, z) extruded across: s along a, thickness along c
    const extrudeSide = (pts, origin, a, c, t, mat, opt) => {
      const geo = new T.ExtrudeGeometry(shapeOf(pts), { depth: t, bevelEnabled: false });
      const M = new T.Matrix4().set(a[0], 0, c[0], origin[0], 0, 1, 0, 0, -sy * a[1], 0, -sy * c[1], -sy * origin[1], 0, 0, 0, 1);
      return add(geo, mat, M, opt);
    };

    // treads, grain along the nosing edge
    for (const t of g.treads) {
      const d = rDir(g.risers[t.k - 1]);
      extrudePlan(t.board, t.zBottom, t.zTop, this.wood('treads', Math.atan2(d[1], d[0])));
    }
    const paint = new T.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8, side: T.DoubleSide });
    for (const rb of g.riserBoards) extrudePlan(rb.plan, rb.z0, rb.z1, paint);
    for (const st of P.stringers) {
      if (!st.outline) continue;
      extrudeSide(exterior(st.outline), st.origin, st.axis, st.normal, st.thickness, this.wood('stringers'));
    }
    for (const j of P.joists) extrudePlan(j.plan, j.z0, j.z1, this.wood('joists'));
    if (P.newel) extrudePlan(P.newel.plan, 0, P.newel.zTop, this.wood('newel', Math.PI / 2));
    const G = P.guard;
    this.guardMeshes = [];
    if (G) {
      const b = p.guard.baluster, hw = p.guard.handrail_width, ht = p.guard.handrail_thickness;
      const rp = G.rail.pts;
      const railPoly = [...rp, ...[...rp].reverse().map(([s, z]) => [s, z - ht])];
      this.guardMeshes.push(extrudeSide(railPoly, [0, -b / 2 - hw / 2], [1, 0], [0, 1], hw, this.wood('rail')));
      const white = new T.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.7, side: T.DoubleSide });
      for (const [xc, zb, zt] of G.balusters) this.guardMeshes.push(extrudeRect(xc - b / 2, -b, xc + b / 2, 0, zb, zt, white));
    }
    // wall handrails on brackets
    const W = g.W;
    for (const wr of P.wallRails) {
      const back = wr.name.startsWith('back');
      const s0 = back ? wr.sFrom : 67.5, s1 = back ? W - 67.5 : g.xEnd;
      if (s1 - s0 < 50) continue;
      const n = 12;
      const top = [];
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        top.push([s, railZ(wr.rail, s)]);
      }
      const pts = [...top, ...[...top].reverse().map(([s, z]) => [s, z - 45])];
      if (back) extrudeSide(pts, [45, 0], [0, 1], [1, 0], 45, this.wood('rail'));
      else extrudeSide(pts, [0, W - 45], [1, 0], [0, -1], 45, this.wood('rail'));
    }
    // building: floor, walls, upper slab
    const H = g.H, Tw = p.building.wall_thickness, slab = p.building.slab_thickness;
    const rt = p.risers.install ? p.risers.thickness : 0;
    const xe = g.xEnd + rt;
    const ymin = Math.min(g.y1 - p.treads.nosing, -p.guard.baluster) - 400;
    const wallMat = () => new T.MeshStandardMaterial({ color: 0xe1e3df, roughness: 0.95, transparent: true, opacity: 1, side: T.DoubleSide });
    const wm1 = wallMat(), wm2 = wallMat();
    this.mats = { wall: [wm1, wm2], slab: [] };
    const back = extrudeRect(-Tw, ymin, 0, W + Tw, 0, H + 400, wm1, { edges: false });
    const side = extrudeRect(-Tw, W, xe + 1200, W + Tw, 0, H + 400, wm2, { edges: false });
    back.userData.plane = { axis: 'x', at: 0, keep: 1 };
    side.userData.plane = { axis: 'y', at: W, keep: -1 };
    this.walls.push(back, side);
    const slabMat = new T.MeshStandardMaterial({ color: 0xd5d8d3, roughness: 0.9, side: T.DoubleSide });
    this.mats.slab.push(slabMat);
    extrudeRect(xe, ymin, xe + 1200, W, H - slab, H, slabMat, { edges: true });
    if (p.building.slab_overhang > 0) {
      const ov = new T.MeshStandardMaterial({ color: 0xd5d8d3, roughness: 0.9, transparent: true, opacity: 0.45, side: T.DoubleSide });
      this.mats.slab.push(ov);
      extrudeRect(0, 0, Math.min(p.building.slab_overhang, xe), W, H - slab, H, ov, { cast: false });
    }
    const floorMat = new T.MeshStandardMaterial({ color: 0xcfd2cc, roughness: 1 });
    this.mats.floor = floorMat;
    const floor = new T.Mesh(new T.PlaneGeometry(1, 1), floorMat);
    const fx0 = -Tw - 600, fx1 = xe + 1800, fy0 = ymin - 1200, fy1 = W + Tw;
    floor.scale.set(fx1 - fx0, fy1 - fy0, 1);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((fx0 + fx1) / 2, -0.5, -sy * (fy0 + fy1) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);
    // walking line on the treads
    this.walk = null;
    {
      const pts = [];
      for (const t of g.treads) {
        const r0 = g.risers[t.k - 1], r1 = g.risers[t.k];
        for (let i = 0; i <= 6; i++) {
          const s = r0.sWalk + ((r1.sWalk - r0.sWalk) * i) / 6;
          const q = g.walkLine.interpolate(s);
          pts.push(new T.Vector3(q[0], t.zTop + 1.5, -sy * q[1]));
        }
      }
      const geo = new T.BufferGeometry().setFromPoints(pts);
      const line = new T.Line(geo, new T.LineDashedMaterial({ color: 0xd42a1e, dashSize: 120, gapSize: 50 }));
      line.computeLineDistances();
      this.group.add(line);
      this.walk = line;
    }
    // light + shadow camera around the model
    const bb = new T.Box3().setFromObject(this.group);
    const c = bb.getCenter(new T.Vector3());
    const size = bb.getSize(new T.Vector3()).length();
    this.sun.position.set(c.x - size * 0.35, c.y + size * 0.9, c.z + size * 0.6);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -size * 0.6;
    sc.right = sc.top = size * 0.6;
    sc.near = 10;
    sc.far = size * 3;
    sc.updateProjectionMatrix();
    this.stairBox = new T.Box3();
    for (const t of g.treads) {
      const b = bounds(t.board);
      this.stairBox.expandByPoint(new T.Vector3(b[0], t.zBottom, -sy * b[1]));
      this.stairBox.expandByPoint(new T.Vector3(b[2], t.zTop, -sy * b[3]));
    }
    this.stairBox.expandByPoint(new T.Vector3(xe, H, 0));
    this.stairBox.expandByPoint(new T.Vector3(0, 0, 0));
    this.tintBuilding();
    this.applyOpts();
    if (!this.framed) {
      this.view('front');
      this.framed = true;
    }
    this.dirty = true;
  }

  applyOpts() {
    if (!this.ready) return;
    for (const w of this.walls || []) w.visible = this.opts.walls;
    for (const m of this.guardMeshes || []) {
      m.visible = this.opts.guard;
      if (m.userData.edges) m.userData.edges.visible = this.opts.guard;
    }
    if (this.walk) this.walk.visible = this.opts.walkline;
    this.dirty = true;
  }

  // fade a wall when the camera is behind it
  fadeWalls() {
    const cam = this.camera.position;
    for (const w of this.walls || []) {
      const pl = w.userData.plane;
      let behind;
      if (pl.axis === 'x') behind = cam.x < pl.at;
      else behind = -this.sy * cam.z > pl.at;
      const op = behind ? 0.12 : 1;
      if (w.material.opacity !== op) {
        w.material.opacity = op;
        w.material.depthWrite = op === 1;
        w.castShadow = op === 1;
      }
    }
  }

  view(kind) {
    if (!this.ready || !this.stairBox) return;
    const T = this.T;
    const c = this.stairBox.getCenter(new T.Vector3());
    const r = this.stairBox.getSize(new T.Vector3()).length() / 2;
    const dist = (r / Math.sin((this.camera.fov * Math.PI) / 360)) * (kind === 'top' ? 1.05 : 1.34);
    let dir;
    if (kind === 'top') dir = new T.Vector3(0.0001, 1, 0.0001);
    else if (kind === 'side') dir = new T.Vector3(0.0, 0.25, this.sy * 1);
    else dir = new T.Vector3(-0.55, 0.55, this.sy * 0.85);
    dir.normalize();
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
    this.dirty = true;
  }

  snapshot() {
    if (!this.ready) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
