// game.js — CATFIGHT.EXCHANGE engine: two cats fight over the live BTC price.
// Player = BULL CAT (A). AI = BEAR CAT (B). Both orbit the coin in opposite
// directions; crossings are swipe windows; pounce leaps across the circle.
// Live ticks feed super energy + arena mood. Honest self-report in __game.

import * as THREE from 'three';
import { Feed } from './feed.js';
import { Cat } from './cats.js';
import {
  buildRenderer, buildScene, buildFloor, TickerBand, Coin, Sparks,
  CameraRig, SoundRig, PALETTE
} from './arena.js';

const qs = new URLSearchParams(location.search);
const DEMO = qs.get('demo') === '1';
const TEST = qs.get('test') === '1';
const TIMER = qs.get('tick') === 'timer';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = id => document.getElementById(id);
const els = {
  price: $('price'), p24: $('p24'), dot: $('dot'), srcName: $('srcName'),
  fillA: $('fillA'), fillB: $('fillB'), scoreA: $('scoreA'), scoreB: $('scoreB'),
  superFill: $('superFill'), superBar: $('superBar'), roundTag: $('roundTag'),
  boot: $('boot'), banner: $('banner'), bannerKicker: $('bannerKicker'),
  bannerKo: $('bannerKo'), bannerSnap: $('bannerSnap'), fightBtn: $('fightBtn'),
  nextBtn: $('nextBtn'), sndBtn: $('sndBtn'), feedStatus: $('feedStatus'),
  report: $('report'), body: document.body,
};

// ---------------------------------------------------------------- state
const G = {
  state: 'boot',          // boot | fight | ko | banner
  round: 1, scoreA: 0, scoreB: 0,
  hp: { A: 100, B: 100 },
  sup: { A: 0, B: 0 },
  ang: { A: Math.PI, B: 0 },          // orbit angles
  w: { A: 0.5, B: 0.5 },              // orbit angular speeds
  kb: { A: new THREE.Vector3(), B: new THREE.Vector3() },
  kbDecay: 6,
  pos: { A: new THREE.Vector3(), B: new THREE.Vector3() },
  events: [], frames: 0, fps: 0, quality: 0, errors: [],
  time: 0, timeScale: 1, hitstop: 0, koSlow: 0,
  snapPrice: null, snapPct: null,
  aiSwipeCd: 0, aiPounceCd: DEMO ? 4 : 9, aiDecide: 0, aiDodgeBoost: 0,
  lastFedDraw: 0, bannerShown: false,
};
window.__game = G;
G.log = (type, data) => {
  G.events.push({ t: +G.time.toFixed(2), type, ...data });
  if (G.events.length > 240) G.events.shift();
};
window.addEventListener('error', e => { G.errors.push(String(e.message || e)); });
window.addEventListener('unhandledrejection', e => { G.errors.push(String(e.reason || e)); });

// ---------------------------------------------------------------- three setup
const canvas = $('gl');
const renderer = buildRenderer(canvas);

let scene, bullLight, bearLight, camera, rig, ticker, coin, sparks, cats;

function initThree() {
  ({ scene, bullLight, bearLight } = buildScene());
  buildFloor(scene);
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 90);
  rig = new CameraRig(camera);
  ticker = new TickerBand(scene);
  coin = new Coin(scene);
  sparks = new Sparks(scene);
  cats = { A: new Cat(scene, 'A'), B: new Cat(scene, 'B') };
  onResize();
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (rig) rig.onResize(w, h);
}
addEventListener('resize', onResize);

// ---------------------------------------------------------------- sound
const snd = new SoundRig();
els.sndBtn.addEventListener('click', () => {
  snd.ensure();
  const on = snd.toggle();
  els.sndBtn.classList.toggle('on', on);
});

// ---------------------------------------------------------------- feed
const feed = new Feed({
  onTick: t => {
    if (G.state === 'fight') {
      // shards rise on buy prints at the bull arc, fall on sell at the bear arc
      const buy = t.side ? t.side === 'buy' : t.dir > 0;
      const side = buy ? -1 : 1;
      const p = new THREE.Vector3(side * 8.6, 1.5, (Math.random() - 0.5) * 6);
      sparks.shard(p, buy);
      snd.tick(buy);
    }
    G.log('tick', { p: t.price, side: t.side, src: t.src });
  },
  onState: s => {
    els.dot.className = s.live ? 'live' : (s.src === 'REPLAY' ? 'replay' : 'dead');
    els.srcName.textContent = s.live ? s.src + ' · LIVE' : (s.src === 'REPLAY' ? 'OFFLINE REPLAY' : s.src);
    if (G.state === 'boot') {
      els.feedStatus.textContent = s.live
        ? 'market feed live — the fight is real'
        : (s.src === 'REPLAY' ? 'exchange unreachable from your line — fighting on honest local replay' : 'connecting…');
    }
    G.log('feed', { src: s.src, live: s.live });
  },
});

// ---------------------------------------------------------------- helpers
const R_ORBIT = 3.4, R_MAX = 8.2;
function orbitPos(side, out) {
  const a = G.ang[side];
  out.set(Math.cos(a) * R_ORBIT, 0, Math.sin(a) * R_ORBIT);
  return out;
}
function catDist() { return G.pos.A.distanceTo(G.pos.B); }
function fmtPrice(p) {
  return p == null ? '—' : '$' + p.toLocaleString('en-US', { maximumFractionDigits: p > 9999 ? 1 : 2 });
}
function faceYaw(me, other) {
  return Math.atan2(other.x - me.x, other.z - me.z);
}

// ---------------------------------------------------------------- combat
function damage(victim, dmg, from, kind) {
  const V = victim === 'A' ? cats.A : cats.B;
  const hpBefore = G.hp[victim];
  G.hp[victim] = Math.max(0, G.hp[victim] - dmg);
  const atk = victim === 'A' ? 'B' : 'A';
  G.sup[atk] = Math.min(100, G.sup[atk] + (kind === 'pounce' ? 22 : 14));
  // knockback away from attacker
  const dir = new THREE.Vector3().subVectors(G.pos[victim], G.pos[atk]);
  if (dir.lengthSq() < 1e-4) dir.set(victim === 'A' ? -1 : 1, 0, 0);
  dir.y = 0; dir.normalize();
  const power = kind === 'super' ? 2.6 : kind === 'pounce' ? 2.0 : 1.15;
  G.kb[victim].addScaledVector(dir, power);
  V.applyHurt();
  const paw = V.pawWorldPos();
  sparks.burst(paw, kind === 'super' ? 0xff5a1f : 0xf0b429, kind === 'swipe' ? 9 : 16, kind === 'super' ? 5 : 3.4);
  if (kind === 'super') snd.superHit(); else snd.hit();
  rig.addShake(kind === 'swipe' ? 0.18 : 0.4);
  G.hitstop = REDUCED ? 0 : 0.06;
  G.log('hit', { victim, dmg, hp: G.hp[victim], kind, by: atk });
  if (G.hp[victim] <= 0 && hpBefore > 0) onKO(victim);
}

function trySwipe(side) {
  const C = cats[side];
  const other = side === 'A' ? 'B' : 'A';
  if (!C.startSwipe()) return false;
  if (side === 'A') G.log('act', { side, verb: 'swipe' });
  snd.swipe();
  // resolution happens when C.swipeHits window opens
  return true;
}

function tryPounce(side) {
  const C = cats[side];
  const other = side === 'A' ? 'B' : 'A';
  const isSuper = G.sup[side] >= 100;
  if (!C.startPounce(() => {
    // land callback
    const landPos = G.pos[side];
    sparks.dust(landPos, 7);
    snd.land();
    rig.addShake(0.15);
    const O = cats[other];
    if (G.pos[other].distanceTo(landPos) < 1.75 && !O.air) {
      damage(other, isSuper ? 44 : 21 + Math.floor(Math.random() * 5), C.root.position, isSuper ? 'super' : 'pounce');
    } else {
      G.log('whiff', { side, verb: 'pounce' });
    }
    // re-anchor to orbit at landing point
    G.ang[side] = Math.atan2(G.pos[side].z, G.pos[side].x);
    if (side === 'B') G.aiPounceCd = DEMO ? 5 : 10 + Math.random() * 8;
  })) return false;
  if (isSuper) G.sup[side] = 0;
  // lock leap data
  G.leap = G.leap || {};
  G.leap[side] = {
    from: G.pos[side].clone(),
    to: new THREE.Vector3().copy(G.pos[other]).add(new THREE.Vector3((Math.random() - .5) * .6, 0, (Math.random() - .5) * .6)),
    t: 0, super: isSuper,
  };
  snd.crouch();
  if (side === 'A') G.log('act', { side, verb: 'pounce', super: isSuper });
  if (side === 'B' && Math.random() < 0.55 && !DEMO) G.aiDodgeBoost = 0.95; // player learns to read it
  return true;
}

function resolveSwipes(dt) {
  for (const side of ['A', 'B']) {
    const C = cats[side];
    if (!C.swipeHits || C._swipeDone) continue;
    const other = side === 'A' ? 'B' : 'A';
    C._swipeDone = true;
    const O = cats[other];
    if (catDist() < 2.75 && !O.air) {
      damage(other, 9 + Math.floor(Math.random() * 5), C.root.position, 'swipe');
    } else {
      G.log('whiff', { side, verb: 'swipe', dist: +catDist().toFixed(2) });
    }
  }
}

// ---------------------------------------------------------------- KO / rounds
function onKO(loser) {
  const winner = loser === 'A' ? 'B' : 'A';
  G.state = 'ko';
  G.koSlow = 1.2;
  G.snapPrice = feed.price;
  G.snapPct = feed.pct24;
  cats[loser].setKO();
  cats[winner].setWin();
  snd.ko();
  rig.addShake(0.8);
  rig.push = 1;
  if (winner === 'A') G.scoreA++; else G.scoreB++;
  const head = new THREE.Vector3().copy(G.pos[winner]); head.y = 2.1;
  coin.claimTo(head, () => snd.coin());
  G.log('ko', { loser, winner, price: G.snapPrice, scoreA: G.scoreA, scoreB: G.scoreB });
  setTimeout(() => showBanner(winner), REDUCED ? 400 : 1500);
}

function showBanner(winner) {
  if (G.state !== 'ko') return;
  G.state = 'banner';
  G.bannerShown = true;
  const bullWon = winner === 'A';
  els.bannerKicker.textContent = 'round ' + G.round + ' — ' + fmtPrice(G.snapPrice);
  els.bannerKo.textContent = bullWon ? 'BULL TAKES THE COIN' : 'BEAR TAKES THE COIN';
  els.bannerKo.className = 'ko ' + (bullWon ? 'win' : 'lose');
  let agree = 'the market is undecided';
  if (G.snapPct !== null && G.snapPct !== undefined && Math.abs(G.snapPct) >= 0.05) {
    const up = G.snapPct > 0;
    agree = (bullWon === up) ? 'the market agrees' : 'the market disagrees';
  }
  els.bannerSnap.innerHTML = 'coin claimed @ <b class="mono">' + fmtPrice(G.snapPrice) + '</b> · ' + agree;
  els.banner.classList.remove('hidden');
  els.body.dataset.state = 'banner';
  G.log('banner', { winner });
}

function nextRound() {
  if (G.state !== 'banner') return;
  els.banner.classList.add('hidden');
  G.round++;
  G.hp.A = 100; G.hp.B = 100;
  G.sup.A = 0; G.sup.B = 0;
  G.ang.A = Math.PI; G.ang.B = 0;
  G.kb.A.set(0, 0, 0); G.kb.B.set(0, 0, 0);
  cats.A.reset(); cats.B.reset();
  coin.respawn();
  rig.push = 0;
  G.bannerShown = false;
  G.state = 'fight';
  els.body.dataset.state = 'fight';
  els.roundTag.textContent = 'R' + G.round;
  G.log('round', { n: G.round });
}
els.nextBtn.addEventListener('click', () => { snd.ensure(); nextRound(); });

function startFight() {
  if (G.state !== 'boot') return;
  snd.ensure();
  snd.start();
  els.boot.classList.add('hidden');
  G.state = 'fight';
  els.body.dataset.state = 'fight';
  G.log('round', { n: 1 });
}
els.fightBtn.addEventListener('click', startFight);

// ---------------------------------------------------------------- input
const ptr = { down: false, x: 0, y: 0, t0: 0, drag: false, fired: false };
const keys = {};
canvas.addEventListener('pointerdown', e => {
  ptr.down = true; ptr.drag = false; ptr.fired = false;
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.t0 = performance.now();
});
canvas.addEventListener('pointermove', e => {
  if (!ptr.down) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  if (Math.hypot(dx, dy) > 12) ptr.drag = true;
  if (ptr.drag) { rig.drag(dx, dy); ptr.x = e.clientX; ptr.y = e.clientY; }
});
const upHandler = () => {
  if (ptr.down && !ptr.drag && !ptr.fired && G.state === 'fight') {
    const held = performance.now() - ptr.t0;
    if (held < 300) trySwipe('A');
  }
  ptr.down = false; keys._spaceHold = null;
};
canvas.addEventListener('pointerup', upHandler);
canvas.addEventListener('pointercancel', () => { ptr.down = false; });

addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (G.state === 'fight') {
    if (e.code === 'KeyJ') trySwipe('A');
    if (e.code === 'Space' || e.code === 'KeyK') { keys._spaceHold = performance.now(); }
    if (e.code === 'Enter' && G.state === 'banner') nextRound();
  } else if (G.state === 'banner' && (e.code === 'Space' || e.code === 'Enter')) nextRound();
  if (G.state === 'boot' && e.code === 'Enter') startFight();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if ((e.code === 'Space' || e.code === 'KeyK') && keys._spaceHold) {
    if (G.state === 'fight' && performance.now() - keys._spaceHold < 300 && !ptr.down) trySwipe('A');
    keys._spaceHold = null;
  }
});
function playerHoldUpdate() {
  // pointer held ≥ 0.45s → pounce; keyboard space same
  if (G.state !== 'fight') return;
  const now = performance.now();
  if (ptr.down && !ptr.drag && !ptr.fired && now - ptr.t0 > 450) { ptr.fired = true; tryPounce('A'); }
  if (keys._spaceHold && !ptr.down && now - keys._spaceHold > 450) { tryPounce('A'); keys._spaceHold = null; }
}

// ---------------------------------------------------------------- AI (bear)
function aiUpdate(dt) {
  if (G.state !== 'fight') return;
  G.aiSwipeCd -= dt; G.aiPounceCd -= dt; G.aiDecide -= dt;
  G.aiDodgeBoost = Math.max(0, G.aiDodgeBoost - dt);
  const pressure = feed.pressure();
  const aggression = DEMO ? 1 : Math.min(1, 0.42 + Math.max(0, -pressure) * 0.55 + (1 - G.hp.A / 100) * 0.25 + Math.max(0, -(feed.trend || 0)) / 40);
  G.w.B = 0.5 * (1 + aggression * 0.55) + (G.aiDodgeBoost > 0 ? 1.5 : 0);
  // super energy from downticks
  if ((feed.trend || 0) < -6) G.sup.B = Math.min(100, G.sup.B + 5 * dt);
  if (G.aiDecide > 0) return;
  G.aiDecide = DEMO ? 0.25 : 0.55 + Math.random() * 0.4;
  const d = catDist();
  const swipeCdBase = DEMO ? 0.35 : 2.3 - aggression * 1.3;
  if (d < 2.5 && G.aiSwipeCd <= 0) {
    if (DEMO || Math.random() < 0.8) { trySwipe('B'); G.aiSwipeCd = swipeCdBase; }
  } else if (d > 3.6 && G.aiPounceCd <= 0) {
    const want = (G.sup.B >= 100 ? 0.6 : 0.22) + (DEMO ? 0.5 : 0);
    if (Math.random() < want) tryPounce('B');
  }
}

// ---------------------------------------------------------------- HUD
let lastHud = 0;
function hudUpdate(now) {
  if (now - lastHud < 250) return;
  lastHud = now;
  const p = feed.price;
  const up = feed.pct24 !== null && feed.pct24 !== undefined ? feed.pct24 >= 0 : true;
  els.price.textContent = fmtPrice(p);
  els.price.className = 'mono ' + (feed.prev !== null && p !== null ? (p >= feed.prev ? 'up' : 'down') : '');
  const pctS = feed.pct24 === null || feed.pct24 === undefined ? '—' : (up ? '+' : '') + feed.pct24.toFixed(2) + '%';
  els.p24.textContent = pctS + ' 24H';
  els.p24.className = 'mono ' + (up ? 'up' : 'down');
  els.fillA.style.width = G.hp.A + '%';
  els.fillB.style.width = G.hp.B + '%';
  els.fillA.classList.toggle('low', G.hp.A < 30);
  els.fillB.classList.toggle('low', G.hp.B < 30);
  els.superFill.style.width = G.sup.A + '%';
  els.superBar.classList.toggle('full', G.sup.A >= 100);
  els.scoreA.textContent = G.scoreA;
  els.scoreB.textContent = G.scoreB;
}

// ---------------------------------------------------------------- main update
function applyKnockback(side, dt) {
  const kb = G.kb[side];
  if (kb.lengthSq() < 1e-6) return;
  G.pos[side].addScaledVector(kb, dt);
  kb.multiplyScalar(Math.exp(-G.kbDecay * dt));
  const r = Math.hypot(G.pos[side].x, G.pos[side].z);
  if (r > R_MAX) {
    G.pos[side].x *= R_MAX / r; G.pos[side].z *= R_MAX / r;
    kb.set(0, 0, 0);
  }
  G.ang[side] = Math.atan2(G.pos[side].z, G.pos[side].x);
}

function update(dt, now) {
  G.time += dt;
  // timescale: hit-stop + KO slow-mo (real-time timers)
  if (G.hitstop > 0) { G.hitstop -= dt; G.timeScale = 0.08; }
  else if (G.koSlow > 0) { G.koSlow -= dt; G.timeScale = 0.32; }
  else G.timeScale = 1;
  const sdt = dt * G.timeScale;

  playerHoldUpdate();
  aiUpdate(sdt);

  // orbit motion + knockback
  const nudgeA = (keys.KeyA || keys.ArrowLeft ? -0.4 : 0) + (keys.KeyD || keys.ArrowRight ? 0.4 : 0);
  G.w.A = 0.52 + nudgeA;
  if (G.state === 'fight') {
    G.ang.A += G.w.A * sdt;
    G.ang.B -= G.w.B * sdt;
  }
  orbitPos('A', G.pos.A);
  orbitPos('B', G.pos.B);
  applyKnockback('A', sdt);
  applyKnockback('B', sdt);

  // pounce flight: override orbit while airborne
  for (const side of ['A', 'B']) {
    const C = cats[side];
    const L = G.leap && G.leap[side];
    if (C.air && L) {
      L.t = Math.min(1, L.t + sdt / 0.46);
      const k = L.t;
      G.pos[side].lerpVectors(L.from, L.to, k);
      G.pos[side].y = Math.sin(k * Math.PI) * 1.9;
      if (L.super && Math.random() < 0.8) {
        sparks.trail(new THREE.Vector3().copy(G.pos[side]).add(new THREE.Vector3(0, 0.6, 0)));
      }
    } else {
      G.pos[side].y = 0;
      if (L && !C.air && L.t >= 1) { L.t = 0; }
    }
  }

  // place cats + face each other
  for (const side of ['A', 'B']) {
    const C = cats[side];
    C.root.position.copy(G.pos[side]);
    const other = G.pos[side === 'A' ? 'B' : 'A'];
    const want = faceYaw(G.pos[side], other);
    // shortest-arc smoothing
    let d = want - C.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    C.root.rotation.y += d * Math.min(1, sdt * 9);
    C.mood = Math.min(1, 0.45 + (1 - Math.max(G.hp.A, G.hp.B) / 100) * 0.55);
    C._swipeDone = C.action === 'swipe' && C.actionT < 0.1 ? false : C._swipeDone;
    if (C.action !== 'swipe') C._swipeDone = false;
  }
  cats.A.update(sdt, { time: G.time, target: G.pos.B, moving: true });
  cats.B.update(sdt, { time: G.time, target: G.pos.A, moving: true });

  resolveSwipes(sdt);

  // player super from live uptrend
  if (G.state === 'fight' && (feed.trend || 0) > 6) G.sup.A = Math.min(100, G.sup.A + 5 * sdt);

  // mood lights by real aggressor flow
  const pr = feed.pressure();
  bullLight.intensity = 0.25 + Math.max(0, pr) * 1.15;
  bearLight.intensity = 0.25 + Math.max(0, -pr) * 1.15;

  // arena pieces
  if (now - G.lastFedDraw > 250) {
    G.lastFedDraw = now;
    ticker.update(feed.price, feed.pct24, feed.src, feed.recent());
  }
  ticker.tick(dt);
  coin.tick(dt);
  coin.updateClaim(dt);
  coin.updatePop(dt);
  sparks.tick(dt);

  // camera
  if (G.state === 'fight') rig.push = 0;
  rig.update(dt, G.time, G.state === 'ko' ? new THREE.Vector3().copy(G.pos[G.hp.A <= 0 ? 'B' : 'A']) : null);

  hudUpdate(now);

  // quality governor
  G._fpsAcc = (G._fpsAcc || 0) + 1;
  if (now - (G._fpsT || 0) > 3000) {
    G.fps = Math.round(G._fpsAcc / ((now - G._fpsT) / 1000));
    G._fpsAcc = 0; G._fpsT = now;
    if (G.fps < 28 && G.quality < 2) {
      G.quality++;
      applyQuality();
      G.log('quality', { tier: G.quality, fps: G.fps });
    }
  }
}

function applyQuality() {
  if (G.quality === 1) renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
  else if (G.quality === 2) { renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; }
  else renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
}

// ---------------------------------------------------------------- report
function writeReport() {
  G.feed = {
    src: feed.src, live: feed.live, price: feed.price, pct: feed.pct24,
    ticks: feed.ticks, trend: feed.trend, pressure: +feed.pressure().toFixed(3),
    buyVol: +feed.buyVol.toFixed(3), sellVol: +feed.sellVol.toFixed(3),
  };
  G.controls = {
    swipe: () => trySwipe('A'),
    pounce: () => tryPounce('A'),
    next: () => nextRound(),
    // test hooks (demo/QA only)
    setHP: (side, v) => { G.hp[side] = Math.max(0, Math.min(100, v)); if (G.hp[side] <= 0 && G.state === 'fight') onKO(side); },
    setSuper: (side, v) => { G.sup[side] = Math.max(0, Math.min(100, v)); },
    state: () => G.state,
  };
  els.report.textContent = JSON.stringify({
    state: G.state, round: G.round, scoreA: G.scoreA, scoreB: G.scoreB,
    hp: G.hp, sup: G.sup, feed: G.feed, frames: G.frames, fps: G.fps,
    quality: G.quality, errors: G.errors.slice(-8),
    lastEvents: G.events.slice(-12),
  });
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    update(dt, now);
    renderer.render(scene, camera);
    G.frames++;
    G._frames2 = (G._frames2 || 0) + 1;
    if (now - (G._repT || 0) > 500) { G._repT = now; G.fpsLive = Math.round(G._frames2 / ((now - (G._repT0 || now) || 1) / 1000)) || 0; G._frames2 = 0; G._repT0 = now; writeReport(); }
  } catch (err) {
    G.errors.push('loop: ' + String(err && err.message || err));
    console.error(err);
  }
}

function boot() {
  initThree();
  // rebuild the LED band + coin face once real fonts are in (first draw may fall back)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      try { ticker._dirty = true; coin.redrawFace(); } catch (e) { G.errors.push('fontredraw: ' + String(e && e.message || e)); }
    });
  }
  feed.start();
  els.roundTag.textContent = 'R1';
  writeReport();
  if (TIMER) {
    setInterval(() => frame(performance.now()), 16);
  } else {
    const loop = now => { frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
}

boot();
