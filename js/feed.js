// feed.js — live BTC price layer for CATFIGHT.EXCHANGE
// Normalizes Bybit -> Gate -> replay into ONE internal shape.
// Rules (censored-network-live-data): order by failure domain, cap the handshake,
// seed after first open, drive every UI label from the live provider.

const SYMBOL = 'BTCUSDT';
const HANDSHAKE_MS = 6000;   // a black-holed host must not freeze rotation
const POLL_MS = 3000;

export class Feed {
  constructor({ onTick, onState } = {}) {
    this.onTick = onTick || (() => {});
    this.onState = onState || (() => {});
    this.price = null;          // last trade price
    this.prev = null;           // previous price (for dir)
    this.pct24 = null;          // 24h change, PERCENT (already x100)
    this.src = 'BOOT';
    this.live = false;
    this.ticks = 0;             // trade prints received
    this.buyVol = 0;            // aggressor-side volume, last 60s window
    this.sellVol = 0;
    this.trend = 0;            // 30-print EMA slope, usd/print
    this._ema = null;
    this._vol = [];             // [ts, side, size]
    this._hist = [];            // recent prices for the ticker band
    this._ws = null;
    this._pollTimer = null;
    this._pingTimer = null;
    this._idx = 0;              // provider index
    this._dead = false;
    this._replayPrice = 67000 + Math.floor(Math.random() * 400);
    this._replayTimer = null;
  }

  // ---------- public ----------
  start() {
    this._tryProvider();
    // heartbeat: if nothing produced a price in 25s, rotate
    this._watch = setInterval(() => {
      if (this._dead) return;
      if (this.price === null) this._rotate();
      else if (!this.live && this.src === 'REPLAY') { /* replay is terminal until a real provider lands; retry every watch */ this._idx = 0; this._tryProvider(); }
    }, 25000);
  }

  recent() { return this._hist.slice(-64); }

  pressure() { // -1..+1  aggressor imbalance, sampled over a 45s window
    const now = Date.now();
    this._vol = this._vol.filter(v => now - v[0] < 45000);
    let b = 0, s = 0;
    for (const v of this._vol) { if (v[1] === 'buy') b += v[2]; else s += v[2]; }
    const tot = b + s;
    if (tot < 1e-9) return 0;
    return (b - s) / tot;
  }

  destroy() {
    this._dead = true;
    clearInterval(this._watch);
    this._closeSocket();
    clearTimeout(this._pollTimer);
    clearInterval(this._replayTimer);
  }

  // ---------- provider chain ----------
  _rotate() {
    this._idx++;
    this._closeSocket();
    this._tryProvider();
  }

  _tryProvider() {
    const chain = [this._bybitWS, this._gateWS, this._gateREST, this._replay];
    const fn = chain[this._idx % chain.length];
    fn.call(this);
  }

  _setState(src, live, note) {
    this.src = src; this.live = live;
    this.onState({ src, live, note, price: this.price });
  }

  _ingest(price, side, size, ts) {
    const p = parseFloat(price);
    if (!isFinite(p) || p <= 0) return;
    this.prev = this.price;
    this.price = p;
    if (this.prev === null) this.prev = p;
    this.ticks++;
    if (this._ema === null) this._ema = p;
    const slope = p - this._ema;
    this._ema = this._ema + 0.15 * (p - this._ema);
    this.trend = p - this._ema; // signed: positive = price above ema (up momentum)
    if (side) {
      const s = parseFloat(size) || 0.001;
      this._vol.push([ts || Date.now(), side === 'buy' ? 'buy' : 'sell', s]);
      this.buyVol = this._vol.filter(v => v[1] === 'buy').reduce((a, v) => a + v[2], 0);
      this.sellVol = this._vol.filter(v => v[1] === 'sell').reduce((a, v) => a + v[2], 0);
    }
    this._hist.push(p);
    if (this._hist.length > 512) this._hist.shift();
    this.onTick({ price: p, dir: p >= (this.prev || p) ? 1 : -1, side: side || null, ts: ts || Date.now(), src: this.src });
  }

  _ingestTicker(price, pctFraction) {
    const p = parseFloat(price);
    if (isFinite(p) && p > 0) this._ingest(p);
    if (pctFraction !== undefined && pctFraction !== null) {
      const f = parseFloat(pctFraction);
      if (isFinite(f)) this.pct24 = f * 100; // Bybit sends a FRACTION
    }
  }

  _closeSocket() {
    if (this._ws) { try { this._ws.onclose = null; this._ws.close(); } catch (e) {} }
    this._ws = null;
    clearInterval(this._pingTimer);
    clearTimeout(this._pollTimer);
    clearInterval(this._replayTimer);
  }

  // ---------- Bybit WS (primary; answers CORS from the raw IR line) ----------
  _bybitWS() {
    let settled = false;
    this._setState('BYBIT', false, 'connecting');
    let ws;
    try { ws = new WebSocket('wss://stream.bybit.com/v5/public/spot'); }
    catch (e) { return this._rotate(); }
    this._ws = ws;
    const cap = setTimeout(() => { if (!settled) { this._rotate(); } }, HANDSHAKE_MS);
    ws.onopen = () => {
      settled = true;
      clearTimeout(cap);
      ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${SYMBOL}`, `tickers.${SYMBOL}`] }));
      this._pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ op: 'ping' })); } catch (e) {} }, 20000);
      this._seedFromREST('https://api.bybit.com/v5/market/tickers?category=spot&symbol=' + SYMBOL, d => {
        const r = d && d.result && d.result.list && d.result.list[0];
        if (r) this._ingestTicker(r.lastPrice, r.price24hPcnt);
      });
      this._setState('BYBIT', true, 'live');
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      const topics = m.topic || '';
      if (m.data === undefined) return;
      if (topics.startsWith('publicTrade')) {
        const arr = Array.isArray(m.data) ? m.data : [m.data];
        for (const t of arr) this._ingest(t.p, t.S === 'Buy' ? 'buy' : 'sell', t.v, t.T);
      } else if (topics.startsWith('tickers')) {
        this._ingestTicker(m.data.lastPrice, m.data.price24hPcnt);
      }
    };
    ws.onerror = () => { if (!settled) { clearTimeout(cap); this._rotate(); } };
    ws.onclose = () => { if (!this._dead && this.src === 'BYBIT') this._rotate(); };
  }

  // ---------- Gate WS (secondary provider, different failure domain) ----------
  _gateWS() {
    let settled = false;
    this._setState('GATE', false, 'connecting');
    let ws;
    try { ws = new WebSocket('wss://api.gateio.ws/ws/v4/'); }
    catch (e) { return this._rotate(); }
    this._ws = ws;
    const cap = setTimeout(() => { if (!settled) this._rotate(); }, HANDSHAKE_MS);
    ws.onopen = () => {
      settled = true; clearTimeout(cap);
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'spot.trades', event: 'subscribe', payload: [SYMBOL] }));
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'spot.book_ticker', event: 'subscribe', payload: [SYMBOL] }));
      this._pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ channel: 'spot.trades', event: 'ping' })); } catch (e) {} }, 20000);
      this._setState('GATE', true, 'live');
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.channel === 'spot.trades' && m.event !== 'pong') {
        this._ingest(m.result.price, m.result.side === 'buy' ? 'sell' : 'buy', m.result.amount, m.result.time_ms);
        // gate trade side is the MAKER side; aggressor is the opposite
      }
    };
    ws.onerror = () => { if (!settled) { clearTimeout(cap); this._rotate(); } };
    ws.onclose = () => { if (!this._dead && this.src === 'GATE') this._rotate(); };
  }

  // ---------- Gate REST polling (no WS path) ----------
  _gateREST() {
    this._setState('GATE·REST', false, 'polling');
    const tick = async () => {
      if (this._dead) return;
      try {
        const r = await fetch('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=' + SYMBOL, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        const d = Array.isArray(j) ? j[0] : null;
        if (d && d.last) {
          this._ingest(d.last);
          if (d.change_percentage) this.pct24 = parseFloat(d.change_percentage);
          if (!this.live) this._setState('GATE·REST', true, 'live');
        }
      } catch (e) { /* one bad poll is not fatal */ }
      this._pollTimer = setTimeout(tick, POLL_MS);
    };
    tick();
  }

  // ---------- honest local replay (labeled, never pretends to be live) ----------
  _replay() {
    this._setState('REPLAY', false, 'offline simulation');
    let drift = 0;
    const step = () => {
      if (this._dead) return;
      drift += (Math.random() - 0.5) * 18 - drift * 0.05;
      this._replayPrice = Math.max(1000, this._replayPrice + drift);
      const side = drift > 0 ? 'buy' : 'sell';
      this._ingest(this._replayPrice.toFixed(2), side, 0.02 + Math.random() * 0.5);
      if (this.pct24 === null) this.pct24 = (Math.sin(Date.now() / 90000) * 1.8);
      this._replayTimer = setTimeout(step, 250 + Math.random() * 750);
    };
    step();
  }

  // ---------- helpers ----------
  async _seedFromREST(url, apply) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      apply(j);
    } catch (e) { /* seed is best-effort */ }
  }
}
