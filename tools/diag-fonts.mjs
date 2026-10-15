// diag-fonts.mjs — inspect font loading inside the real page
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 8047;
const ROOT = 'C:/Users/capit/catfight/';
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

const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', 'about:blank'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const port = await new Promise((res) => {
  proc.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)/); if (m) res(+m[1]); });
});
const tab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const sock = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => sock.onopen = r);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
sock.onmessage = d => { const m = JSON.parse(d.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await send('Page.enable'); await send('Runtime.enable');
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise(r => setTimeout(r, 2500));

const out = await evalJs(`(async () => {
  const r = await fetch('./fonts/archivo-var.woff2');
  const buf = await r.arrayBuffer();
  const magic = new TextDecoder().decode(new Uint8Array(buf.slice(0,4)));
  const faces = Array.from(document.fonts).map(f => f.family + '|' + f.weight + '|' + f.status);
  await document.fonts.ready;
  const h = (spec) => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 60;
    const x = c.getContext('2d');
    x.font = spec; x.fillText('CATFIGHT 67,234.5', 4, 40);
    const d = x.getImageData(0,0,300,60).data;
    let s = 0, ink = 0;
    for (let i = 0; i < d.length; i += 4) { s = (s * 31 + d[i] * 7 + d[i+1] * 5 + d[i+2] * 3) % 1e9; if (d[i] > 10) ink++; }
    return { h: s, ink };
  };
  await document.fonts.load('700 32px Archivo');
  await document.fonts.load('700 32px Numo');
  const a1 = h('700 32px Archivo'), a2 = h('700 32px sans-serif'), a3 = h('700 32px "No Such Font", sans-serif');
  const n1 = h('700 32px Numo'), n2 = h('700 32px monospace');
  return {
    fetchStatus: r.status, ct: r.headers.get('content-type'), magic, size: buf.byteLength,
    faces,
    checkArchivo: document.fonts.check('700 20px Archivo'),
    checkNumo: document.fonts.check('700 20px Numo'),
    a1: a1.h, a2: a2.h, a3: a3.h, a1ink: a1.ink, a2ink: a2.ink,
    n1: n1.h, n2: n2.h, n1ink: n1.ink, n2ink: n2.ink,
  };
})()`);
console.log(JSON.stringify(out, null, 1));
proc.kill(); server.close();
process.exit(0);
