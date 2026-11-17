// Order flow engine: pure logic, no DOM. Loaded by index.html (global) and by the Node.js watchers and tests (require).
// Prices are stored as integer bucket indexes (price / bucket) to avoid float keys.
function createEngine(opt) {
  const listed = ['NVDA','AMD','INTC','GLD','GC'].includes(opt?.market);
  const bookMaxAge = listed ? 5000 : Infinity;
  const o = Object.assign({ multiplier: opt?.market === 'GC' ? 100 : 1, barMs: 60000, bucket: 0, bigUsd: 100000 }, opt);
  const e = {
    o, bars: [], profile: new Map(), tpo: new Map(), tpoMs: 30 * 60000, cvd: 0, pv: 0, vol: 0, unknownVol: 0, last: 0,
    signals: [], prints: [], liqs: [], heat: [], ticks: [],
    bot: { on: false, types: new Set(['absorption', 'sweep', 'exhaustion', 'iceberg']),
           stopPct: 0.2, targetPct: 0.4, feePct: 0, usd: 1000, pos: null, trades: [], pnl: 0 },
  };
  let burst = null, best = null, tpoPeriod = -1, segment = 0;
  const visited = new Set();
  const hit = { b: 0, a: 0 }; // aggressor volume at the previous best bid/ask

  const nice = x => { const p = 10 ** Math.floor(Math.log10(x)); return (x / p >= 5 ? 5 : x / p >= 2 ? 2 : 1) * p; };
  e.idx = price => Math.floor(price / o.bucket + 1e-9);

  function signal(t, type, dir, price, note, fillTime = t, entry = price) {
    const s = { t, type, dir, price, note };
    e.signals.push(s);
    if (e.signals.length > 1000) e.signals.shift();
    const b = e.bot;
    if (b.on && !b.pos && b.types.has(type))
      b.pos = { dir, entry, t: fillTime, usd: b.usd, stop: entry * (1 - dir * b.stopPct / 100), target: entry * (1 + dir * b.targetPct / 100) };
    return s;
  }

  function closeBar(b, out, fillTime, entry) {
    if (b.unknownVol || b.interrupted) return;
    const prev = e.bars.slice(-21, -1).filter(x => x.segment === segment && !x.interrupted);
    if (prev.length < 5) return;
    const avg = prev.reduce((s, x) => s + x.vol, 0) / prev.length;
    const pos = (b.c - b.l) / (b.h - b.l || 1);
    // Absorption: heavy one-sided aggression, but the bar closes against it.
    if (b.h > b.l && b.vol > 1.5 * avg && Math.abs(b.delta) / b.vol > 0.25) {
      if (b.delta < 0 && pos > 0.6) out.push(signal(b.t + o.barMs, 'absorption', 1, b.c, 'sellers absorbed', fillTime, entry));
      if (b.delta > 0 && pos < 0.4) out.push(signal(b.t + o.barMs, 'absorption', -1, b.c, 'buyers absorbed', fillTime, entry));
    }
    // Exhaustion: new 10-bar extreme where almost nothing traded at the extreme level.
    const p10 = prev.slice(-10);
    let maxCell = 0;
    for (const [bid, ask] of b.cells.values()) maxCell = Math.max(maxCell, bid + ask);
    const at = i => { const v = b.cells.get(i); return v ? v[0] + v[1] : 0; };
    if (b.h > Math.max(...p10.map(x => x.h)) && at(e.idx(b.h)) < 0.1 * maxCell && e.idx(b.c) < e.idx(b.h))
      out.push(signal(b.t + o.barMs, 'exhaustion', -1, b.c, 'buying dried up at high', fillTime, entry));
    if (b.l < Math.min(...p10.map(x => x.l)) && at(e.idx(b.l)) < 0.1 * maxCell && e.idx(b.c) > e.idx(b.l))
      out.push(signal(b.t + o.barMs, 'exhaustion', 1, b.c, 'selling dried up at low', fillTime, entry));
  }

  // sell = true when the aggressor sold (hit the bid). Returns any new signals.
  e.trade = (t, price, qty, sell, venue) => {
    const known = sell === true || sell === false;
    const out = [];
    if (!o.bucket) o.bucket = nice(price * 0.0001);
    if (o.recordTicks !== false && e.ticks.length < 1e6) e.ticks.push([t, price, qty, known ? Number(sell) : null]);
    e.last = price;

    const bt = Math.floor(t / o.barMs) * o.barMs;
    let b = e.bars[e.bars.length - 1];
    if (!b || b.t !== bt) {
      if (b) closeBar(b, out, t, price);
      b = { t: bt, o: price, h: price, l: price, c: price, vol: 0, delta: 0, unknownVol: 0, segment, cells: new Map() };
      e.bars.push(b);
      if (e.bars.length > 500) e.bars.shift();
    }
    const i = e.idx(price), d = known ? (sell ? -qty : qty) : 0;
    b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); b.c = price;
    b.vol += qty; b.delta += d; e.cvd += d; b.cvd = e.cvd;
    const c = b.cells.get(i) || [0, 0];
    if (known) c[sell ? 0 : 1] += qty;
    else {
      c[2] = (c[2] || 0) + qty;
      b.unknownVol += qty; e.unknownVol += qty;
    }
    b.cells.set(i, c);
    e.profile.set(i, (e.profile.get(i) || 0) + qty);
    const period = Math.floor(t / e.tpoMs);
    if (period !== tpoPeriod) { visited.clear(); tpoPeriod = period; }
    if (!visited.has(i)) { visited.add(i); e.tpo.set(i, (e.tpo.get(i) || 0) + 1); }
    e.pv += price * qty; e.vol += qty;
    const side = sell ? 'b' : 'a';
    if (known && best && best.venue === venue && t >= best.t && price === best[side][0]) hit[side] += qty;

    const usd = price * qty * o.multiplier;
    if (usd >= o.bigUsd) { e.prints.push({ t, price, qty, usd, sell: known ? sell : null }); if (e.prints.length > 500) e.prints.shift(); }

    // Four observed rows in the aggressor's direction within a 300 ms burst.
    if (!known) burst = null;
    else if (!burst || burst.venue !== venue || burst.sell !== sell || t < burst.start || t - burst.start > 300)
      burst = { venue, sell, start: t, first: i, rows: new Set(), usd: 0, fired: false };
    if (burst && !burst.fired) {
      burst.rows.add(i); burst.usd += usd;
      if (burst.rows.size >= 4 && (sell ? i < burst.first : i > burst.first) && burst.usd >= o.bigUsd) {
        burst.fired = true;
        out.push(signal(t, 'sweep', sell ? -1 : 1, price, `$${Math.round(burst.usd / 1000)}k through ${burst.rows.size} levels`));
      }
    }

    const p = e.bot.pos;
    if (p) {
      const stop = p.dir * (price - p.stop) <= 0, tgt = p.dir * (price - p.target) >= 0;
      if (stop || tgt) {
        // shortcut: fills exactly at stop/target with no slippage, model it before trusting the P&L
        // feePct is charged on entry and on exit, on the position's notional.
        const exit = stop ? p.stop : p.target, size = p.usd ?? e.bot.usd;
        const pnl = p.dir * (exit - p.entry) / p.entry * size - 2 * size * e.bot.feePct / 100;
        e.bot.trades.push({ ...p, exit, tExit: t, pnl });
        if (e.bot.trades.length > 1000) e.bot.trades.shift();
        e.bot.pnl += pnl; e.bot.pos = null;
      }
    }
    return out;
  };

  // bids/asks: arrays of [price, size], best first. Returns any new signals.
  e.depth = (t, bids, asks, venue) => {
    const out = [];
    const twoSided = bids.length > 0 && asks.length > 0 && bids[0][0] < asks[0][0];
    if (!o.bucket && (bids.length || asks.length)) {
      const price = twoSided ? (bids[0][0] + asks[0][0]) / 2 : (bids[0] || asks[0])[0];
      o.bucket = nice(price * 0.0001);
    }
    const levels = new Map();
    for (const [p, s] of bids.concat(asks)) { const i = e.idx(p); levels.set(i, (levels.get(i) || 0) + s); }
    e.heat.push({ t, levels }); if (e.heat.length > 720) e.heat.shift();

    // Iceberg: far more traded at the best price than was ever displayed there, and it is still standing.
    // shortcut: only checks the best bid/ask between snapshots, use a full diff book feed for real detection
    if (twoSided && best && best.venue === venue && t >= best.t && t - best.t <= bookMaxAge) for (const [side, book, dir] of [['b', bids, 1], ['a', asks, -1]]) {
      const [bp, bs] = best[side], traded = hit[side], now = book.find(l => l[0] === bp);
      if (traded > 3 * bs && traded * bp * o.multiplier >= o.bigUsd / 2 && now && now[1] >= bs * 0.5)
        out.push(signal(t, 'iceberg', dir, bp, `${+traded.toFixed(3)} traded vs ${bs} shown`, t, dir > 0 ? asks[0][0] : bids[0][0]));
    }
    best = twoSided ? { b: bids[0], a: asks[0], t, venue } : null; hit.b = 0; hit.a = 0;
    return out;
  };

  e.resetContinuity = () => {
    burst = best = null;
    hit.b = hit.a = 0;
    segment++;
    const bar = e.bars.at(-1);
    if (bar) bar.interrupted = true;
  };

  // side: 'SELL' = a long was force-closed, 'BUY' = a short was.
  e.liquidation = (t, side, price, qty) => { e.liqs.push({ t, price, qty, usd: price * qty * o.multiplier, sell: side === 'SELL' }); if (e.liqs.length > 500) e.liqs.shift(); };

  return e;
}
if (typeof module !== 'undefined') module.exports = { createEngine };
