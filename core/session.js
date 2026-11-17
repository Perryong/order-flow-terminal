// Portable event recording format. Quantities are shares, contracts or base units, timestamps are UTC milliseconds.
(function (root) {
  'use strict';
  const positive = x => Number.isFinite(x) && x > 0;
  const timestamp = x => Number.isSafeInteger(x) && x >= 0 && x <= 8.64e15;
  const levels = rows => Array.isArray(rows) &&
    rows.every(row => Array.isArray(row) && row.length === 2 && positive(row[0]) && positive(row[1]));

  function recording(symbol, events) {
    if (typeof symbol !== 'string' || !/^[a-z0-9]{2,30}$/i.test(symbol))
      throw new Error('Use an alphanumeric market symbol such as BTCUSDT.');
    if (!events.length) throw new Error('The session contains no events.');
    return { version: 1, symbol: symbol.toUpperCase(), events: events.sort((a, b) => a.t - b.t) };
  }

  const stockMarkets = ['NVDA', 'AMD', 'INTC', 'GLD'];
  const gcContract = /^GC[FGHJKMNQUVXZ](?:[0-9]{1,2}|[0-9]{4})$/;

  function marketMetadata(data) {
    if (data.market === undefined && data.contract === undefined) return {};
    if (data.market === 'GC') {
      if (typeof data.contract !== 'string' || !gcContract.test(data.contract) || !['GC',data.contract].includes(data.symbol))
        throw new Error('GC recordings require a matching dated contract such as GCZ26.');
      return { market: 'GC', contract: data.contract };
    }
    if (!stockMarkets.includes(data.market) || data.symbol !== data.market ||
        (data.contract !== undefined && data.contract !== data.market))
      throw new Error('Recording instrument and market must match.');
    return data.contract ? { market:data.market, contract:data.contract } : { market:data.market };
  }

  function parse(text) {
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!data || data.version !== 1 || !Array.isArray(data.events))
      throw new Error('Expected a version 1 session with an events array.');
    const metadata = marketMetadata(data);
    const datasets = data.market === 'GC' ? ['GLBX.MDP3'] : ['XNAS.ITCH','Moomoo US'];
    for (const [i, ev] of data.events.entries()) {
      if (!ev || !timestamp(ev.t) || (ev.exchangeTime !== undefined && !timestamp(ev.exchangeTime))) throw new Error('Invalid timestamp at event ' + (i + 1));
      let valid;
      switch (ev.type) {
        case 'trade': valid = positive(ev.price) && positive(ev.qty) && (typeof ev.sell === 'boolean' || ev.sell === null); break;
        case 'depth': valid = levels(ev.bids) && levels(ev.asks); break;
        case 'liquidation': valid = !metadata.market && positive(ev.price) && positive(ev.qty) && ['BUY', 'SELL'].includes(ev.side); break;
        case 'spot': valid = (data.market === 'GC' || data.market === 'GLD') && positive(ev.price) && typeof ev.provider === 'string' && !!ev.provider.trim(); break;
        case 'gap': valid = true; break;
        default: valid = false;
      }
      if (ev.type !== 'spot' && metadata.market) {
        if (ev.dataset !== undefined && !datasets.includes(ev.dataset)) valid = false;
        const instrument = metadata.contract || data.symbol;
        if (ev.contract !== undefined && ev.contract !== instrument) valid = false;
        if (ev.symbol !== undefined && ev.symbol !== instrument && ev.symbol !== data.market) valid = false;
      }
      if (!valid) throw new Error('Invalid session event ' + (i + 1));
    }
    const result = Object.assign(recording(data.symbol, data.events), metadata);
    if (positive(data.rowSize)) result.rowSize = data.rowSize;
    if (data.synthetic === true) result.synthetic = true;
    return result;
  }

  function parseSide(value) {
    switch (value.trim().toLowerCase()) {
      case '1': case 'true': return true;
      case '0': case 'false': return false;
      case '': case 'unknown': return null;
      default: return undefined;
    }
  }

  function fromCSV(text, symbol = 'BTCUSDT') {
    const events = [];
    const lines = text.trim().split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      if (!line.trim()) continue;
      const fields = line.split(',').map(s => s.trim());
      if (i === 0 && fields.join(',').toLowerCase() === 'time_ms,price,qty,sell') continue;
      const [t, price, qty] = fields.slice(0, 3).map(Number);
      const sell = parseSide(fields[3] ?? '');
      if (fields.length !== 4 || !fields[0] || !timestamp(t) || !positive(price) || !positive(qty) ||
          sell === undefined) throw new Error('Invalid trade on CSV line ' + (i + 1));
      events.push({ type: 'trade', t, price, qty, sell });
    }
    const result = recording(symbol, events);
    if (stockMarkets.includes(result.symbol)) result.market = result.symbol;
    if (gcContract.test(result.symbol)) Object.assign(result, {market:'GC', contract:result.symbol});
    return result;
  }

  function apply(engine, event) {
    const time = event.exchangeTime ?? event.t;
    const venue = event.venue ?? event.dataset;
    switch (event.type) {
      case 'trade': return engine.trade(time, event.price, event.qty, event.sell, venue);
      case 'depth': return engine.depth(time, event.bids, event.asks, venue);
      case 'liquidation': engine.liquidation(time, event.side, event.price, event.qty); return [];
      case 'gap': engine.resetContinuity(); return [];
      case 'spot': return [];
      default: throw new Error('Unknown event type');
    }
  }

  function demo() {
    const events = [];
    const start = Date.UTC(2026, 10, 13, 13, 0);
    let seed = 68754;
    const rand = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
    const cents = x => Math.round(x * 100) / 100;
    const anchors = [68360, 68435, 68384, 68482, 68552, 68441, 68492, 68602, 68518, 68580, 68550, 68618, 68592];
    const shelves = [68340, 68410, 68480, 68540, 68630, 68690];
    let last = anchors[0];

    for (let bar = 0; bar < 96; bar++) {
      const t = start + bar * 60000;
      const leg = Math.floor(bar / 8), weight = (bar % 8 + 1) / 8;
      const close = anchors[leg] + (anchors[leg + 1] - anchors[leg]) * weight + (rand() - 0.5) * 19;
      const open = last;
      const absorption = [21, 43, 67, 84, 93].includes(bar);
      const rising = bar % 2 === 1;
      for (let n = 0; n < 24; n++) {
        const x = n / 23, wave = Math.sin(x * Math.PI);
        const drift = open + (close - open) * x;
        const price = cents(drift + wave * (absorption ? (rising ? -32 : 32) : Math.sin(x * 7 + bar * 1.7) * 15) + (rand() - 0.5) * 5);
        const sell = absorption ? (n < 21 ? rising : !rising) : rand() < (price < last ? 0.69 : 0.31);
        const qty = cents(absorption ? 0.75 + 1.35 * rand() : 0.04 + rand() ** 3 * 1.9);
        events.push({ type: 'trade', t: t + n * 2450, price, qty, sell });
        last = price;
        if (n % 8 !== 0) continue;
        const mid = Math.floor(price / 10) * 10;
        const ladder = (side) => Array.from({ length: 16 }, (_, j) => {
          const p = mid + (side > 0 ? j + 1 : -j) * 10;
          const shelf = shelves.includes(p) ? 14 + 6 * Math.sin(bar / 17 + p) : 0;
          return [p, cents(0.23 + rand() * 2.1 + shelf)];
        });
        const snapshot = { type: 'depth', t: t + n * 2450 + 16, bids: ladder(-1), asks: ladder(1) };
        events.push(snapshot);
        // A large sell hits an unchanged bid that replenishes before the next snapshot.
        if (bar === 88 && n === 16) {
          const [bid, displayed] = snapshot.bids[0];
          events.push({ type: 'trade', t: snapshot.t + 100, price: bid, qty: 4 * displayed, sell: true });
          events.push({ ...snapshot, t: snapshot.t + 200 });
        }
      }
      if ([15, 34, 53, 71, 80, 89, 94].includes(bar)) {
        const sell = bar % 2 === 0, base = Math.round(last / 10) * 10;
        for (let j = 0; j < 5; j++) {
          last = base + (sell ? -1 : 1) * j * 10;
          events.push({ type: 'trade', t: t + 58000 + j * 48, price: last, qty: cents(1.4 + rand()), sell });
        }
      }
      if (bar % 13 === 5)
        events.push({ type: 'liquidation', t: t + 59200, side: bar % 2 ? 'SELL' : 'BUY', price: last, qty: cents(0.6 + rand() * 3) });
    }
    return recording('BTCUSDT', events);
  }

  const api = { demo, fromCSV, parse, parseSide, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlowSession = api;
})(globalThis);
