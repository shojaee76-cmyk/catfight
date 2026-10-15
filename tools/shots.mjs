// shots.mjs — capture real renders: desktop fight, phone fight, KO banner
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 8046;
const ROOT = 'C:/Users/capit/catfight/';
const OUT = ROOT + 'qa/shots/';
await mkdir(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    const data = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(w, h, tag, cb) {
  const proc = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--window-size=' + w + ',' + h, '--remote-debugging-port=0', 'about:blank'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const port = await new Promise(res => { proc.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)/); if (m) res(+m[1]); }); });
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const sock = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => sock.onopen = r);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  sock.onmessage = d => { const m = JSON.parse(d.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(OUT + name + '.png', Buffer.from(r.data, 'base64'));
    console.log('shot:', name + '.png');
  };
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?demo=1` });
  await sleep(2500);
  await cb({ evalJs, shot, send });
  proc.kill();
}

// desktop pass
await run(1280, 760, 'desktop', async ({ evalJs, shot }) => {
  await shot('01-boot-desktop');
  await evalJs('document.getElementById("fightBtn").click()');
  await sleep(4200);
  await shot('02-fight-desktop');
  await sleep(2500);
  await shot('03-fight-desktop-b');
  // force KO by player for the banner shot
  await evalJs('window.__game.controls.setHP("B", 8)');
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) {
    await evalJs('window.__game.controls.swipe()');
    await sleep(220);
    const s = await evalJs('window.__game.state');
    if (s === 'ko' || s === 'banner') ok = true;
  }
  await sleep(2200); // banner + coin claim animation
  await shot('04-ko-banner-desktop');
});

// phone portrait pass
await run(390, 760, 'phone', async ({ evalJs, shot }) => {
  await shot('05-boot-phone');
  await evalJs('document.getElementById("fightBtn").click()');
  await sleep(4500);
  await shot('06-fight-phone');
});

server.close();
console.log('done');
process.exit(0);
