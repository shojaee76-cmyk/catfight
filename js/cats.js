// cats.js — toy-like squash & stretch cats for CATFIGHT.EXCHANGE
// Construction: smooth-shaded primitive parts (NOT flat low-poly), springy
// procedural layers (breath, squash impulses, tail segment chain, gaze, ears).
// Anim: readable action phrases — windup / swing / hold / settle for swipes.

import * as THREE from 'three';

const MAT = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.82, metalness: 0.02, ...opts
});

function sphere(r, mat, sx = 1, sy = 1, sz = 1, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(10, seg - 4)), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true;
  return m;
}

export class Cat {
  // side: 'A' (bull, player) or 'B' (bear, AI)
  constructor(scene, side) {
    this.side = side;
    const bull = side === 'A';
    this.root = new THREE.Group();
    scene.add(this.root);

    const fur = MAT(bull ? 0xe8853a : 0x3a3d46);
    const dark = MAT(bull ? 0x8a4a1d : 0x23252c);
    const cream = MAT(bull ? 0xf6d8ad : 0xe8e6df);
    const pink = MAT(0xd97b8f, { roughness: 0.6 });
    const white = MAT(0xf5f3ec, { roughness: 0.4 });
    const black = MAT(0x14151a, { roughness: 0.5 });
    this.mats = { fur, dark, cream };

    // ---- body (bean) ----
    this.bodyG = new THREE.Group();
    this.bodyG.position.y = 0.88;
    this.root.add(this.bodyG);
    this.body = sphere(0.78, fur, 1.06, 0.92, 1.18);
    this.bodyG.add(this.body);
    // chest patch
    const chest = sphere(0.42, cream, 1, 0.85, 0.55);
    chest.position.set(0, 0.08, 0.56);
    this.bodyG.add(chest);
    if (bull) { // tabby stripes: 3 curved bands on the back
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.075, 8, 20, Math.PI * 0.7), dark);
        band.rotation.set(Math.PI / 2 + 0.35, 0, 0);
        band.rotation.y = (i - 1) * 0.28;
        band.position.set(0, 0.34, -0.14 - i * 0.3);
        band.castShadow = false;
        this.bodyG.add(band);
      }
    }

    // ---- head ----
    this.headG = new THREE.Group();
    this.headG.position.set(0, 0.72, 0.62);
    this.bodyG.add(this.headG);
    const head = sphere(0.5, fur, 1.08, 0.95, 1.0);
    this.headG.add(head);
    // muzzle + nose
    const muzzle = sphere(0.24, cream, 1.2, 0.8, 0.8, 14);
    muzzle.position.set(0, -0.14, 0.42);
    this.headG.add(muzzle);
    const nose = sphere(0.055, pink, 1, 0.7, 1, 8);
    nose.position.set(0, -0.04, 0.62);
    this.headG.add(nose);
    // whiskers
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const w = cyl(0.008, 0.008, 0.34, white, 5);
      w.rotation.z = s * (Math.PI / 2 + 0.14 + i * 0.13);
      w.rotation.y = s * 0.5;
      w.position.set(s * 0.24, -0.12 - i * 0.05, 0.5);
      w.castShadow = false;
      this.headG.add(w);
    }
    // ears (cones with inner pink)
    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.34, 5), fur);
      cone.castShadow = true;
      ear.add(cone);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.2, 5), pink);
      inner.position.set(0, 0.02, 0.05);
      ear.add(inner);
      ear.position.set(s * 0.3, 0.42, -0.02);
      ear.rotation.z = -s * 0.35;
      this.headG.add(ear);
      this.ears.push(ear);
    }
    // eyes: white + pupil + X pair (hidden)
    this.eyes = [];
    this.xEyes = [];
    for (const s of [-1, 1]) {
      const eye = sphere(0.115, white, 1, 1, 0.6, 12);
      eye.position.set(s * 0.19, 0.08, 0.4);
      this.headG.add(eye);
      const pupil = sphere(0.055, black, 1, 1, 0.5, 10);
      pupil.position.set(s * 0.19, 0.08, 0.47);
      this.headG.add(pupil);
      this.eyes.push({ eye, pupil });
      const xg = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const bar = cyl(0.016, 0.016, 0.16, black, 5);
        bar.rotation.z = Math.PI / 4 + k * Math.PI / 2;
        xg.add(bar);
      }
      xg.position.set(s * 0.19, 0.08, 0.48);
      xg.visible = false;
      this.headG.add(xg);
      this.xEyes.push(xg);
    }
    this.blinkT = 2 + Math.random() * 3;

    // ---- legs + paws ----
    this.legs = [];
    this.frontPaws = [];
    const legGeo = () => new THREE.CapsuleGeometry(0.13, 0.34, 4, 10);
    for (const [sx, sz, front] of [[-1, 0.42, 1], [1, 0.42, 1], [-1, -0.4, 0], [1, -0.4, 0]]) {
      const leg = new THREE.Group();
      const limb = new THREE.Mesh(legGeo(), fur);
      limb.castShadow = true;
      leg.add(limb);
      const paw = sphere(0.16, cream, 1.15, 0.8, 1.3, 12);
      paw.position.set(0, -0.34, 0.08);
      leg.add(paw);
      leg.position.set(sx * 0.42, -0.5, sz * 0.78);
      this.bodyG.add(leg);
      this.legs.push(leg);
      if (front) this.frontPaws.push(leg);
    }

    // ---- contact shadow (grounds the cat; fades when airborne) ----
    this.decal = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    );
    this.decal.rotation.x = -Math.PI / 2;
    this.decal.position.y = 0.03;
    this.root.add(this.decal);

    // ---- tail (segment chain) ----
    this.tail = [];
    let tp = new THREE.Vector3(0, 0.3, -0.86);
    for (let i = 0; i < 9; i++) {
      const seg = sphere(0.115 - i * 0.006, i > 5 ? dark : fur, 1, 1, 1.6, 10);
      seg.castShadow = false;
      this.root.add(seg);
      this.tail.push(seg);
    }
    this.tailPhase = Math.random() * 9;

    // ---- anim state ----
    this.action = 'idle';
    this.actionT = 0;
    this.squash = 0;          // -1 flat .. +1 stretched (spring)
    this.squashV = 0;
    this.gaze = new THREE.Vector3(0, 1.4, 4);
    this.mood = 0;            // 0 chill .. 1 battle-tense
    this.earBack = 0;
    this.koRoll = 0;
    this.walkPhase = Math.random() * 9;
    this.hurtFlash = 0;
  }

  // ---------- actions ----------
  startSwipe() { if (this.action === 'idle') { this.action = 'swipe'; this.actionT = 0; this.earBack = 1; return true; } return false; }
  startPounce(onLand) {
    if (this.action === 'idle') { this.action = 'pounce'; this.actionT = 0; this.onLand = onLand || null; this.earBack = 1; return true; }
    return false;
  }
  applyHurt() {
    this.action = 'hurt'; this.actionT = 0;
    this.squashV = -7; this.earBack = 1;
    this.hurtFlash = 1;
  }
  setKO() {
    this.action = 'ko'; this.actionT = 0;
    for (const x of this.xEyes) x.visible = true;
    for (const e of this.eyes) { e.eye.visible = false; e.pupil.visible = false; }
  }
  setWin() { if (this.action !== 'ko') { this.action = 'win'; this.actionT = 0; } }
  reset() {
    this.action = 'idle'; this.actionT = 0;
    for (const x of this.xEyes) x.visible = false;
    for (const e of this.eyes) { e.eye.visible = true; e.pupil.visible = true; }
    this.koRoll = 0; this.squash = 0; this.squashV = 0; this.earBack = 0;
  }
  // swipe contact window: mid-swing
  get swipeHits() { return this.action === 'swipe' && this.actionT > 0.16 && this.actionT < 0.30; }
  get busy() { return this.action !== 'idle' && this.action !== 'hurt'; }
  get air() { return this.action === 'pounce' && this.actionT > 0.26 && this.actionT < 0.72; }

  // ---------- pose ----------
  update(dt, ctx) {
    const t = ctx.time;
    this.actionT += dt;

    // squash spring (jelly)
    this.squashV += (-this.squash * 90 - this.squashV * 11) * dt;
    this.squash += this.squashV * dt;
    this.squash = Math.max(-0.6, Math.min(0.6, this.squash));

    let bodySY = 1 + 0.028 * Math.sin(t * 3.1 + this.tailPhase) + this.squash * 0.35;
    let bodySXZ = 1 - this.squash * 0.22;
    let lean = 0, bob = 0, pawAngle = 0, crouch = 0;

    // action phrases
    if (this.action === 'swipe') {
      const a = this.actionT;
      if (a < 0.16) { lean = -0.18 * (a / 0.16); pawAngle = -1.2 * (a / 0.16); }        // windup
      else if (a < 0.30) { const k = (a - 0.16) / 0.14; lean = 0.34 * k; pawAngle = -1.2 + 2.4 * k; } // swing
      else if (a < 0.38) { lean = 0.34; pawAngle = 1.2; }                                 // hold
      else { const k = Math.min(1, (a - 0.38) / 0.28); lean = 0.34 * (1 - k); pawAngle = 1.2 * (1 - k); } // settle
      if (a > 0.66) { this.action = 'idle'; }
    } else if (this.action === 'pounce') {
      const a = this.actionT;
      if (a < 0.26) { const k = a / 0.26; crouch = 0.45 * k; bodySY = 1 - 0.3 * k; }      // crouch
      else if (a < 0.72) { const k = (a - 0.26) / 0.46; bodySY = 1.28 - 0.28 * k; lean = 0.5; } // stretch in air
      else if (a < 0.84) { const k = (a - 0.72) / 0.12; bodySY = 0.72 + 0.3 * k; if (this.onLand) { this.onLand(); this.onLand = null; } }
      else if (a < 1.18) { crouch = 0.12 * (1 - (a - 0.84) / 0.34); }                     // recover
      else { this.action = 'idle'; this.earBack = 0.4; }
    } else if (this.action === 'hurt') {
      lean = -0.3 * Math.max(0, 1 - this.actionT / 0.35);
      if (this.actionT > 0.42) this.action = 'idle';
    } else if (this.action === 'ko') {
      this.koRoll = Math.min(1, this.actionT / 0.55);
    } else if (this.action === 'win') {
      bob = Math.abs(Math.sin(this.actionT * 6)) * 0.5;
      this.root.position.y = Math.max(0, bob - 0.2);
      pawAngle = 1.4 + Math.sin(this.actionT * 6) * 0.25;
    }

    // battle mood: crouch when tense
    crouch = Math.max(crouch, this.mood * 0.16);
    this.bodyG.position.y = 0.88 - crouch * 0.55 + bob;
    this.bodyG.scale.set(bodySXZ, bodySY, bodySXZ);
    this.bodyG.rotation.x = lean;

    // front paw arc (swipe) — drive both front legs from shoulder
    for (const leg of this.frontPaws) leg.rotation.x = pawAngle * -1;
    // walk cycle when moving (front legs skip while a swipe arc drives them)
    const walking = ctx.moving || false;
    this.walkPhase += dt * (walking ? 9 : 0);
    for (let i = 0; i < this.legs.length; i++) {
      if (i < 2 && pawAngle) continue;
      const off = (i < 2 ? 0 : Math.PI) + (i % 2 ? Math.PI : 0);
      this.legs[i].rotation.x = walking ? Math.sin(this.walkPhase + off) * 0.55 : (this.legs[i].rotation.x * 0.9);
    }

    // ears: mood + flattening spring
    const earT = (this.action === 'swipe' || this.action === 'pounce' || this.hurtFlash > 0) ? 1 : this.earBack * 0.5 + this.mood * 0.3;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      this.ears[i].rotation.x = -earT * 0.7;
      this.ears[i].rotation.z = -s * (0.35 + earT * 0.5);
    }
    this.earBack = Math.max(0, this.earBack - dt * 0.8);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);

    // gaze: head looks toward opponent (clamped)
    const gz = new THREE.Vector3().subVectors(ctx.target, this.root.position);
    const yaw = Math.atan2(gz.x, gz.z) - this.root.rotation.y;
    let nyaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    nyaw = Math.max(-0.7, Math.min(0.7, nyaw));
    const pitch = Math.max(-0.45, Math.min(0.35, -gz.y * 0.08 + 0.05));
    this.headG.rotation.y += (nyaw - this.headG.rotation.y) * Math.min(1, dt * 7);
    this.headG.rotation.x += (pitch - this.headG.rotation.x) * Math.min(1, dt * 6);
    // pupils dart to target
    for (const e of this.eyes) {
      e.pupil.position.x = e.eye.position.x + Math.max(-0.04, Math.min(0.04, nyaw * 0.08));
      e.pupil.position.y = e.eye.position.y + Math.max(-0.03, Math.min(0.03, -pitch * 0.08));
    }
    // blink
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      const b = this.blinkT > -0.12 ? 0.1 : 1;
      for (const e of this.eyes) { e.eye.scale.y = b; e.pupil.scale.y = b; }
      if (this.blinkT < -0.14) this.blinkT = 2 + Math.random() * 3.5;
    }

    // tail: segment chain sway (droops on KO, stiff when tense)
    const swayAmp = this.action === 'ko' ? 0.15 : (0.34 - this.mood * 0.14);
    const speed = this.action === 'win' ? 10 : 3.2;
    const baseY = this.action === 'ko' ? 0.25 : 0.9;
    for (let i = 0; i < this.tail.length; i++) {
      const k = i / this.tail.length;
      const sway = Math.sin(t * speed + this.tailPhase - k * 2.4) * swayAmp * k;
      const lift = this.action === 'ko' ? k * 0.5 : (1 - k) * (0.55 + this.mood * 0.45) + k * 0.18;
      this.tail[i].position.set(
        sway * 0.6,
        baseY + lift,
        -0.9 - k * 1.15
      );
      this.tail[i].rotation.y = sway;
    }

    // KO roll: fall onto back
    if (this.action === 'ko') {
      this.root.rotation.z = (this.side === 'A' ? 1 : -1) * this.koRoll * Math.PI * 0.52;
      this.root.position.y = -this.koRoll * 0.35;
      this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.actionT * 3 + i) * 0.2 + 0.9; });
    } else {
      this.root.rotation.z *= (1 - Math.min(1, dt * 8));
    }

    // contact shadow: stick to the floor plane, counter the KO roll, fade in air
    this.decal.position.y = 0.03 - this.root.position.y;
    this.decal.rotation.z = -this.root.rotation.z;
    const airborne = this.air || (this.action === 'pounce' && this.actionT > 0.26);
    const wantOp = airborne ? 0.10 : (this.action === 'ko' ? 0.42 : 0.34);
    this.decal.material.opacity += (wantOp - this.decal.material.opacity) * Math.min(1, dt * 8);
  }

  pawWorldPos() {
    const p = new THREE.Vector3();
    this.frontPaws[0].getWorldPosition(p);
    return p;
  }
  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
