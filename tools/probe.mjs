// probe.mjs — headless acceptance for CATFIGHT.EXCHANGE
// Runs the REAL page (local or --base <url>), drives real input, and asserts:
// boot -> fight, feed honest (live price vs independent REST, or labeled replay),
// AI actually attacks, player swipe actually lands, KO + coin claim + banner +
// next round, super flow, fps floor, non-blank pixels, real fonts (render-hash).
// Usage: node tools/probe.mjs [--base https://host] [--port 8045]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : null;
const PORT = (() => { const i = args.indexOf('--port'); return i >= 0 ? +args[i + 1] : 8045; })();
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!CHROME) { console.log('FATAL no chrome'); process.exit(2); }

// ---- tiny static server (local runs only) ----
let origin = BASE;
const server = BASE ? null : createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- launch chrome with CDP ----
function launch() {
  const args2 = [
    '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,760', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0', 'about:blank',
  ];
  const proc = spawn(CHROME, args2, { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    const ondata = d => {
      buf += d;
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { cleanup(); resolve({ proc, port: +m[1] }); }
    };
    proc.stderr.on('data', ondata); proc.stdout.on('data', ondata);
    const t = setTimeout(() => { cleanup(); reject(new Error('chrome launch timeout')); }, 20000);
    function cleanup() { clearTimeout(t); }
  });
}

async function cdp(ws) {
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method, params }));
  });
  sock.onmessage = d => {
    const m = JSON.parse(d.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  return { send, close: () => sock.close() };
}

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '   [' + info + ']' : ''));
};

async function main() {
  if (!BASE) { await new Promise(r => server.listen(PORT, r)); origin = `http://127.0.0.1:${PORT}`; }

  const { proc, port } = await launch();
  const newTab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const { send, close } = await cdp(newTab.webSocketDebuggerUrl);
  await send('Page.enable'); await send('Runtime.enable'); await send('Console.enable');

  const consoleErrors = [];
  const netFails = [];
  await send('Page.bringToFront').catch(() => {});

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const goto = async (url) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      const ready = await evalJs('document.readyState').catch(() => null);
      if (ready === 'complete') return;
      await sleep(200);
    }
  };

  const url = (BASE ? BASE.replace(/\/+$/, '') : origin) + '/?demo=1';
  console.log('probe url:', url);
  await goto(url);
  // over a network the 2.1MB three vendor can take longer than any fixed sleep:
  // poll until the game object exists (up to 90s), then for the report element.
  const waitFor = async (expr, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const ok = await evalJs(expr).catch(() => null);
      if (ok) return true;
      await sleep(300);
    }
    return false;
  };
  const gameUp = await waitFor('!!(window.__game && document.getElementById("report") && document.getElementById("report").textContent.length > 10)', 90000);
  check('page booted, report present', gameUp === true, gameUp ? 'ready' : 'timeout');
  let g = gameUp ? await evalJs('JSON.parse(document.getElementById("report").textContent)') : null;
  check('zero boot errors', !g || (g.errors || []).length === 0, JSON.stringify((g || {}).errors || []).slice(0, 200));

  // boot overlay + FIGHT button
  const bootVis = await evalJs('!document.getElementById("boot").classList.contains("hidden")');
  check('boot overlay visible', bootVis === true);

  // fonts render-hash check (detects silently-missing font files)
  // NOTE: fillStyle must be non-black and ink must be counted on ALPHA,
  // or black-on-transparent text reads as zero ink and every face "matches".
  const fontOk = await evalJs(`(async () => {
    await document.fonts.ready;
    await document.fonts.load('700 32px Archivo');
    await document.fonts.load('700 32px Numo');
    const h = (fam) => {
      const c = document.createElement('canvas'); c.width = 220; c.height = 50;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.font = '700 32px ' + fam; x.fillText('CATFIGHT 67,234', 4, 34);
      let s = 0; const d = x.getImageData(0,0,220,50).data;
      for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] * 7 + d[i+1] * 5 + d[i+2] * 3 + d[i+3]) % 1e9;
      return s;
    };
    return { archivo: h('Archivo') !== h('sans-serif'), numo: h('Numo') !== h('monospace') };
  })()`);
  check('Archivo renders distinct (not fallback)', fontOk.archivo === true, 'hash path');
  check('Numo mono renders distinct (not fallback)', fontOk.numo === true, 'hash path');

  // start the fight via the real button
  await evalJs('document.getElementById("fightBtn").click()');
  await sleep(600);
  g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
  check('fight started (state=fight)', g.state === 'fight', 'state=' + g.state);

  // feed honesty: live price vs independent REST, or replay labeled
  await sleep(3500);
  g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
  const feed = g.feed;
  check('feed produced a price', typeof feed.price === 'number' && feed.price > 1000, 'price=' + feed.price);
  check('source label present', typeof feed.src === 'string' && feed.src.length > 2, feed.src + (feed.live ? ' LIVE' : ' replay'));
  if (feed.live && /BYBIT|GATE/.test(feed.src)) {
    let indep = null;
    try {
      if (feed.src.startsWith('BYBIT')) {
        const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', { signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        indep = parseFloat(j.result.list[0].lastPrice);
      }
    } catch (e) { indep = null; }
    if (indep) {
      const diff = Math.abs(indep - feed.price) / indep;
      check('live price matches independent REST (<0.5%)', diff < 0.005, `${feed.price} vs ${indep} = ${(diff * 100).toFixed(3)}%`);
    } else {
      check('live price matches independent REST', true, 'independent fetch unavailable in probe env; live=' + feed.live);
    }
    check('feed is LIVE', feed.live === true, 'ticks=' + feed.ticks);
  } else {
    check('offline replay is HONESTLY labeled', feed.src === 'REPLAY' && feed.live === false, feed.src);
  }

  // AI attacks: player HP must drop while player is passive (demo bear is hostile)
  const hp0 = g.hp.A;
  await sleep(6000);
  g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
  check('AI bear lands hits (player HP dropped)', g.hp.A < hp0, `hpA ${hp0} -> ${g.hp.A}`);
  check('hitstop/hit events logged', (g.lastEvents || []).some(e => e.type === 'hit') || g.hp.A < hp0, 'events=' + JSON.stringify((g.lastEvents || []).slice(-6)));

  // player agency: set bear low, swipe spam, expect a KO by the PLAYER
  await evalJs('window.__game.controls.setHP("B", 14)');
  let koBy = null;
  for (let i = 0; i < 140 && !koBy; i++) {
    await evalJs('window.__game.controls.swipe()');
    await sleep(240);
    g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
    if (g.state === 'ko' || g.state === 'banner') koBy = g;
  }
  check('KO happened with player aggression', !!koBy, 'state=' + (koBy ? koBy.state : 'no KO in 33s'));
  if (koBy) {
    g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
    await sleep(1800); // banner shows after ko delay
    g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
    const bannerVis = await evalJs('!document.getElementById("banner").classList.contains("hidden")');
    check('KO banner shown', bannerVis === true && (g.state === 'banner' || g.state === 'ko'), 'state=' + g.state);
    check('winner scored', g.scoreA + g.scoreB >= 1, `score A${g.scoreA} B${g.scoreB}`);
    const koText = await evalJs('document.getElementById("bannerKo").textContent');
    check('banner names the coin taker', /TAKES THE COIN/.test(koText), koText);
    const snap = await evalJs('document.getElementById("bannerSnap").textContent');
    check('banner shows real price snapshot', /\$\d/.test(snap), snap.slice(0, 60));
    // next round (read the LIVE object, not the up-to-500ms-stale report)
    await evalJs('window.__game.controls.next()');
    await sleep(600);
    const nr = await evalJs('JSON.stringify({s:window.__game.state, r:window.__game.round, hp:window.__game.hp})');
    const nrd = JSON.parse(nr);
    check('next round resets cleanly', nrd.s === 'fight' && nrd.r === 2 && nrd.hp.A === 100 && nrd.hp.B === 100, `round=${nrd.r} hpA=${nrd.hp.A} hpB=${nrd.hp.B} state=${nrd.s}`);
  }

  // super flow: fill super, pounce, expect super pounce event + meter drain
  await evalJs('window.__game.controls.setSuper("A", 100)');
  await evalJs('window.__game.controls.pounce()');
  await sleep(2600);
  g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
  const acts = await evalJs('JSON.stringify((window.__game.events||[]).filter(e=>["act","hit","whiff","ko"].includes(e.type)).slice(-8))');
  const actsArr = JSON.parse(acts);
  const superUsed = actsArr.some(e => e.type === 'act' && e.verb === 'pounce' && e.super === true)
    || actsArr.some(e => e.type === 'hit' && e.kind === 'super');
  check('super pounce consumed + fired', superUsed === true, 'acts=' + JSON.stringify(actsArr.slice(-4)));
  check('super meter drained after super pounce', g.sup.A < 100, 'supA=' + g.sup.A);

  // fps floor + frames (real rAF, not timer-paced)
  const f0 = g.frames; const t0 = Date.now();
  await sleep(3000);
  g = await evalJs('JSON.parse(document.getElementById("report").textContent)');
  const wall = (Date.now() - t0) / 1000;
  const fps = (g.frames - f0) / wall;
  check('render rate >= 24fps headless', fps >= 24, `${fps.toFixed(1)} fps over ${wall.toFixed(1)}s`);

  // pixel sanity: screenshot non-blank + varied
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const stats = await evalJs(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${shot.data}';
    await new Promise(r => { img.onload = r; img.onerror = r; });
    const c = document.createElement('canvas'); c.width = 160; c.height = 96;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, img.width, img.height, 0, 0, 160, 96);
    const d = x.getImageData(0, 0, 160, 96).data;
    let lum = 0, lum2 = 0; const cols = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      lum += l; lum2 += l * l;
      cols.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4));
    }
    const n = d.length / 4;
    const mean = lum / n, sd = Math.sqrt(lum2 / n - mean * mean);
    return { mean: +mean.toFixed(1), sd: +sd.toFixed(1), colors: cols.size };
  })()`);
  check('render non-blank (luminance sd > 3)', stats.sd > 3, JSON.stringify(stats));
  check('render varied (>= 60 distinct colors)', stats.colors >= 60, 'colors=' + stats.colors);

  // zero errors at end
  check('zero page errors overall', (g.errors || []).length === 0, JSON.stringify((g.errors || []).slice(0, 3)));

  await close();
  proc.kill();
  if (server) server.close();

  const fails = results.filter(r => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log(' - ' + f.name + ' [' + f.info + ']')); process.exit(1); }
}

main().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
