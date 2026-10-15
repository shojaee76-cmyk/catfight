// arena.js — scene, lights, floor, LED price band, BTC coin, particles, camera rig, sound
// All procedural. No external assets. Dark ember palette: charcoal + ONE ember accent
// + gold coin; green/red exist ONLY as semantic price colors.

import * as THREE from 'three';

const BG = 0x0e0f12;
const EMBER = 0xff5a1f;
const GOLD = 0xf0b429;
const UP = 0x35d07f;
const DOWN = 0xe5484d;

export const PALETTE = { BG, EMBER, GOLD, UP, DOWN };

// ---------------------------------------------------------------- scene
export function buildRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 20, 58);

  scene.add(new THREE.HemisphereLight(0x3d434e, 0x101216, 0.5));

  const key = new THREE.DirectionalLight(0xfff1de, 1.85);
  key.position.set(7, 11, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -13; key.shadow.camera.right = 13;
  key.shadow.camera.top = 13; key.shadow.camera.bottom = -13;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const ember = new THREE.PointLight(EMBER, 5.5, 16, 1.6);
  ember.position.set(0, 2.6, -8.6);
  scene.add(ember);

  // rim light: separates the cats' silhouettes from the void (no new hue, cool white)
  const rim = new THREE.DirectionalLight(0xdfe6f2, 0.95);
  rim.position.set(-7, 6, -9);
  scene.add(rim);

  const coinLight = new THREE.SpotLight(GOLD, 3.2, 16, 0.55, 0.65, 1.2);
  coinLight.position.set(0, 9, 0);
  coinLight.target.position.set(0, 2, 0);
  scene.add(coinLight, coinLight.target);

  // mood lights: green feeds the bull side, red the bear side (semantic, subtle)
  const bullLight = new THREE.PointLight(UP, 0.4, 10, 1.8);
  bullLight.position.set(-6, 2.4, 0);
  const bearLight = new THREE.PointLight(DOWN, 0.4, 10, 1.8);
  bearLight.position.set(6, 2.4, 0);
  scene.add(bullLight, bearLight);

  return { scene, bullLight, bearLight };
}

// ---------------------------------------------------------------- floor
export function buildFloor(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c22';
  g.fillRect(0, 0, 512, 512);
  // faint concentric rings + radial ticks (trading-floor etch)
  g.strokeStyle = 'rgba(232,230,223,0.05)';
  g.lineWidth = 2;
  for (let r = 40; r < 256; r += 40) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 248, 256 + Math.sin(a) * 248);
    g.lineTo(256 + Math.cos(a) * (i % 4 === 0 ? 236 : 244), 256 + Math.sin(a) * (i % 4 === 0 ? 236 : 244));
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9.5, 72),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(9.35, 9.8, 72),
    new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.6, emissive: EMBER, emissiveIntensity: 0.22 })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  scene.add(rim);

  // far skyline: dim candlestick silhouettes ring the void
  const sky = new THREE.Group();
  const upM = new THREE.MeshBasicMaterial({ color: 0x17352a });
  const dnM = new THREE.MeshBasicMaterial({ color: 0x3a1f24 });
  for (let i = 0; i < 46; i++) {
    const a = i / 46 * Math.PI * 2;
    const h = 2 + Math.abs(Math.sin(i * 3.7)) * 6;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), i % 2 ? upM : dnM);
    m.position.set(Math.cos(a) * 17, h / 2 - 0.5, Math.sin(a) * 17);
    m.rotation.y = a;
    sky.add(m);
  }
  scene.add(sky);

  return { floor, rim, sky };
}

// ---------------------------------------------------------------- LED price band
export class TickerBand {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048; this.canvas.height = 128;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.anisotropy = 4;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.repeat.x = -1; // cylinder UVs mirror when viewed from outside
    this.scroll = 0;
    this.band = new THREE.Mesh(
      new THREE.CylinderGeometry(9.9, 10.35, 1.42, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide })
    );
    this.band.position.y = 0.72;
    this.band.renderOrder = 2;
    scene.add(this.band);
    this.state = { price: null, pct: null, src: 'BOOT', recent: [] };
    this._dirty = true;
  }
  update(price, pct, src, recent) {
    this.state = { price, pct, src, recent: recent || [] };
    this._dirty = true;
  }
  tick(dt) {
    this.scroll += dt * 34; // px/s drift
    this.tex.offset.x = (this.scroll / 2048) % 1;
    if (this._dirty) { this._draw(); this._dirty = false; }
  }
  _draw() {
    const g = this.g, W = 2048, H = 128;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,15,18,0.82)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,90,31,0.25)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(W, 2); g.moveTo(0, H - 2); g.lineTo(W, H - 2); g.stroke();
    g.font = '700 78px "Numo", monospace';
    g.textBaseline = 'middle';
    const p = this.state.price;
    const s = p ? '$' + p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '· · ·';
    const pct = this.state.pct;
    const pctS = pct === null || pct === undefined ? '' : (pct >= 0 ? ' ▲ +' : ' ▼ ') + pct.toFixed(2) + '%';
    const col = pct >= 0 ? '#35d07f' : '#e5484d';
    let x = 24;
    g.fillStyle = '#f0b429';
    g.fillText('CATFIGHT.EXCHANGE', x, H / 2); x += g.measureText('CATFIGHT.EXCHANGE').width + 64;
    g.fillStyle = '#e8e6df';
    g.fillText(s, x, H / 2); x += g.measureText(s).width + 48;
    if (pctS) { g.fillStyle = col; g.fillText(pctS, x, H / 2); x += g.measureText(pctS).width + 64; }
    g.fillStyle = 'rgba(232,230,223,0.55)';
    g.font = '600 52px "Numo", monospace';
    g.fillText(this.state.src, x, H / 2); x += g.measureText(this.state.src + '   ').width + 56;
    g.font = '600 54px "Numo", monospace';
    const rec = this.state.recent.slice(-14);
    for (const r of rec) {
      g.fillStyle = 'rgba(232,230,223,0.38)';
      const rs = r.toFixed(0) + ' ';
      g.fillText(rs, x, H / 2);
      x += g.measureText(rs).width + 34;
    }
    if (x < W + 400) { // fill remainder with dim brand mark
      g.fillStyle = 'rgba(255,90,31,0.35)';
      g.font = '700 78px "Numo", monospace';
      while (x < W + 400) { g.fillText('· BTC ', x, H / 2); x += g.measureText('· BTC ').width; }
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the coin
export class Coin {
  constructor(scene) {
    this.group = new THREE.Group();
    const face = this._faceTexture();
    const side = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.9, roughness: 0.24, emissive: 0x6b4d08, emissiveIntensity: 0.35 });
    const faceM = new THREE.MeshStandardMaterial({ map: face, metalness: 0.55, roughness: 0.3, emissive: 0x4a3506, emissiveIntensity: 0.28 });
    this.faceM = faceM;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 44), [side, faceM, faceM]);
    cyl.castShadow = true;
    this.group.add(cyl);
    this.cyl = cyl;
    // ridged edge (two thin torus rails top and bottom)
    for (const dy of [0.105, -0.105]) {
      const rail = new THREE.Mesh(
        new THREE.TorusGeometry(0.615, 0.028, 8, 44),
        new THREE.MeshStandardMaterial({ color: 0xffd469, metalness: 0.95, roughness: 0.18, emissive: 0x5a4004, emissiveIntensity: 0.3 })
      );
      rail.rotation.x = Math.PI / 2;
      rail.position.y = dy;
      this.group.add(rail);
    }
    // glow sprite: tight gold core, not a white blob
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    const gg = gc.getContext('2d');
    let grad = gg.createRadialGradient(64, 64, 2, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255,214,120,0.75)');
    grad.addColorStop(0.35, 'rgba(240,180,41,0.28)');
    grad.addColorStop(1, 'rgba(240,180,41,0)');
    gg.fillStyle = grad; gg.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false }));
    glow.scale.set(3.1, 3.1, 1);
    this.group.add(glow);
    // gold light pool on the floor under the coin
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const pg = pc.getContext('2d');
    grad = pg.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(240,180,41,0.30)');
    grad.addColorStop(1, 'rgba(240,180,41,0)');
    pg.fillStyle = grad; pg.fillRect(0, 0, 128, 128);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.035;
    scene.add(pool);
    this.pool = pool;
    this.group.position.set(0, 2.35, 0);
    scene.add(this.group);
    this.t = 0;
    this.state = 'idle'; // idle | claimed | gone
  }
  _faceTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f0b429'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,80,10,0.55)'; g.lineWidth = 10;
    g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.stroke();
    g.setLineDash([4, 18]); g.lineWidth = 6;
    g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    // bitcoin mark: bold B + two prong bars (font-independent, always reads as ₿)
    g.fillStyle = '#3a2a08';
    g.font = '700 148px "Numo", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('B', 132, 138);
    g.fillRect(86, 44, 13, 26);   // top prong
    g.fillRect(86, 186, 13, 26);  // bottom prong
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    this._faceTex = t;
    return t;
  }
  redrawFace() {
    if (!this.faceM) return;
    const old = this.faceM.map;
    this.faceM.map = this._faceTexture();
    this.faceM.needsUpdate = true;
    if (old) old.dispose();
  }
  tick(dt) {
    this.t += dt;
    this.cyl.rotation.y += dt * 0.9;
    if (this.state === 'idle') {
      this.group.position.y = 2.35 + Math.sin(this.t * 1.5) * 0.14;
      if (this.pool) {
        this.pool.visible = true;
        this.pool.material.opacity = 0.8 + Math.sin(this.t * 1.5) * 0.2;
      }
    } else if (this.pool) {
      this.pool.visible = this.state === 'claimed';
      this.pool.material.opacity = 0.5;
    }
  }
  claimTo(headPos, onDone) {
    this.state = 'claimed';
    this._from = this.group.position.clone();
    this._to = headPos.clone(); this._to.y += 0.5;
    this._t = 0; this._onDone = onDone;
  }
  updateClaim(dt) {
    if (this.state !== 'claimed') return;
    this._t = Math.min(1, this._t + dt / 0.65);
    const k = this._t;
    this.group.position.lerpVectors(this._from, this._to, k);
    this.group.position.y += Math.sin(k * Math.PI) * 1.6;
    this.group.scale.setScalar(1 - k * 0.92);
    this.cyl.rotation.y += dt * 9;
    if (k >= 1) { this.state = 'gone'; this.group.visible = false; if (this._onDone) this._onDone(); }
  }
  respawn() {
    this.state = 'idle';
    this.group.visible = true;
    this.group.scale.setScalar(0.01);
    this.group.position.set(0, 2.35, 0);
    this._pop = 0;
  }
  updatePop(dt) {
    if (this._pop === undefined || this._pop >= 1) return;
    this._pop = Math.min(1, this._pop + dt / 0.4);
    const k = this._pop;
    this.group.scale.setScalar(0.01 + (1 - Math.pow(1 - k, 3)) * 0.99);
  }
}

// ---------------------------------------------------------------- particles (pooled)
export class Sparks {
  constructor(scene) {
    this.pool = [];
    const geo = new THREE.OctahedronGeometry(0.09);
    for (let i = 0; i < 110; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, v: new THREE.Vector3(), life: 0, kind: 0 });
    }
  }
  _get(kind) {
    for (const p of this.pool) if (!p.m.visible && p.kind === kind) return p;
    for (const p of this.pool) if (!p.m.visible) { p.kind = kind; return p; }
    return null;
  }
  burst(pos, color, n = 10, speed = 3.2, up = 1.4) {
    for (let i = 0; i < n; i++) {
      const p = this._get(0);
      if (!p) return;
      p.m.visible = true;
      p.m.position.copy(pos);
      p.m.material.color.set(color);
      p.m.material.opacity = 1;
      p.m.scale.setScalar(0.7 + Math.random() * 0.9);
      p.v.set((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed);
      p.life = 0.5 + Math.random() * 0.4;
      p.grav = 6.5;
    }
  }
  dust(pos, n = 6) {
    for (let i = 0; i < n; i++) {
      const p = this._get(1);
      if (!p) return;
      p.m.visible = true;
      p.m.position.copy(pos); p.m.position.y = 0.1;
      p.m.material.color.set(0x8d8a80);
      p.m.material.opacity = 0.5;
      p.m.scale.setScalar(1.4 + Math.random() * 1.6);
      p.v.set((Math.random() - 0.5) * 2.4, 0.6 + Math.random(), (Math.random() - 0.5) * 2.4);
      p.life = 0.55; p.grav = 1.2;
    }
  }
  shard(pos, up) {
    const p = this._get(2);
    if (!p) return;
    p.m.visible = true;
    p.m.position.copy(pos);
    p.m.material.color.set(up ? UP : DOWN);
    p.m.material.opacity = 0.95;
    p.m.scale.setScalar(0.6 + Math.random() * 0.5);
    p.v.set((Math.random() - 0.5) * 1.2, (up ? 1 : -1) * (1.2 + Math.random() * 2), (Math.random() - 0.5) * 1.2);
    p.life = 0.9; p.grav = up ? 1.5 : 3.5;
  }
  trail(pos) {
    const p = this._get(3);
    if (!p) return;
    p.m.visible = true;
    p.m.position.copy(pos);
    p.m.material.color.set(EMBER);
    p.m.material.opacity = 0.9;
    p.m.scale.setScalar(0.5 + Math.random() * 0.8);
    p.v.set(0, 0.2, 0);
    p.life = 0.42; p.grav = 0;
  }
  tick(dt) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.v.y -= p.grav * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.material.opacity = Math.min(1, p.life * 2.2);
      p.m.rotation.x += dt * 7; p.m.rotation.y += dt * 5;
    }
  }
}

// ---------------------------------------------------------------- camera
export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.theta = 0;         // user orbit offset
    this.thetaV = 0;
    this.baseR = 13.8;
    this.basePhi = 1.18;    // from y axis
    this.push = 0;          // 0..1 KO push-in
    this.shake = 0;
    this._breathe = 0;
    this.aspect = innerWidth / innerHeight;
  }
  onResize(w, h) { this.aspect = w / h; }
  addShake(a) { this.shake = Math.min(1, this.shake + a); }
  impulse() { this.thetaV += (Math.random() - 0.5) * 0; }
  drag(dx, dy) { this.thetaV = 0; this.theta = Math.max(-1.2, Math.min(1.2, this.theta + dx * 0.005)); this._phiOff = (this._phiOff || 0) + dy * 0.002; }
  release() { /* spring back slowly */ }
  update(dt, time, koTarget) {
    this._breathe = time;
    // spring user orbit back toward 0
    this.theta += (0 - this.theta) * Math.min(1, dt * 0.25);
    this._phiOff = (this._phiOff || 0) * (1 - Math.min(1, dt * 0.4));
    this.shake = Math.max(0, this.shake - dt * 2.2);

    const portrait = this.aspect < 0.78;
    let r = (portrait ? 16.4 : this.baseR) * (1 - this.push * 0.32);
    const phi = (portrait ? 1.05 : this.basePhi) - (this._phiOff || 0);
    const th = this.theta + Math.sin(time * 0.11) * 0.055;

    const target = koTarget && this.push > 0.02 ? koTarget : new THREE.Vector3(0, portrait ? 0.9 : 1.25, 0);
    const sh = this.shake * this.shake;
    this.cam.position.set(
      Math.sin(phi) * Math.sin(th) * r + sh * (Math.random() - 0.5) * 0.7,
      Math.cos(phi) * r + sh * (Math.random() - 0.5) * 0.7,
      Math.sin(phi) * Math.cos(th) * r + sh * (Math.random() - 0.5) * 0.7
    );
    this.cam.lookAt(target.x, target.y, target.z);
    this.cam.fov = (portrait ? 57 : 50) - this.push * 6;
    this.cam.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- sound
export class SoundRig {
  constructor() {
    this.ctx = null;
    this.on = true;
    this._lastTick = 0;
  }
  ensure() {
    if (this.ctx || !this.on) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.on = false; }
  }
  toggle() { this.on = !this.on; if (!this.on && this.ctx) this.ctx.suspend(); else if (this.ctx) this.ctx.resume(); return this.on; }
  _env(type, f0, f1, dur, vol, when = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(dur, vol, freq = 1400, when = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + when;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  }
  swipe() { this._noise(0.09, 0.5, 1600); }
  hit() { this._env('sine', 110, 48, 0.16, 0.8); this._noise(0.05, 0.35, 2400); }
  superHit() { this._env('sawtooth', 200, 55, 0.3, 0.55); this._env('sine', 90, 40, 0.34, 0.8); this._noise(0.16, 0.4, 900); }
  crouch() { this._env('sine', 130, 240, 0.24, 0.16); }
  land() { this._env('sine', 82, 40, 0.2, 0.7); this._noise(0.09, 0.3, 500); }
  coin() { this._env('sine', 880, 880, 0.3, 0.35); this._env('sine', 1318, 1318, 0.42, 0.28, 0.1); }
  ko() { this._env('sine', 55, 30, 0.8, 0.9); this._noise(0.4, 0.4, 300, 0.05); }
  tick(up) {
    const now = performance.now();
    if (now - this._lastTick < 260) return;
    this._lastTick = now;
    this._env('triangle', up ? 720 : 480, up ? 900 : 380, 0.06, 0.06);
  }
  start() { this._env('sawtooth', 150, 420, 0.5, 0.2); this._noise(0.3, 0.25, 700, 0.1); }
}
