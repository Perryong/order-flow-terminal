// Runs the paper bot over a tick file, one setup type at a time, and prints results per setup.
// Usage: node scripts/backtest.js ticks.csv [stopPct targetPct feePct [market]]
// Accepts the terminal's export (time_ms,price,qty,sell) or Binance's aggTrades dump.
// Icebergs need order book history, which neither file has, so they are not tested.
const fs = require('fs'), readline = require('readline');
const { createEngine } = require('../core/engine.js');
const { parseSide } = require('../core/session.js');
const { basename } = require('node:path');

const [file, stopPct = 0.2, targetPct = 0.4, feePct = 0.05, marketArg] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/backtest.js ticks.csv [stopPct targetPct feePct [market]]'); process.exit(1); }

// Tapescope exports begin with the raw instrument symbol. A renamed file can supply it explicitly.
const symbol = (marketArg || basename(file).split(/[-.]/)[0]).toUpperCase();
const gold = /^GC(?:[FGHJKMNQUVXZ](?:[0-9]{1,2}|[0-9]{4}))?$/.test(symbol);
const bucket = gold ? 0.1 : ['NVDA','AMD','INTC'].includes(symbol) ? 0.01 : 0;
const types = ['absorption', 'sweep', 'exhaustion'];
const runs = types.map(type => {
  const e = createEngine({market:gold?'GC':symbol, bucket, recordTicks:false});
  Object.assign(e.bot, { on: true, types: new Set([type]), stopPct: +stopPct, targetPct: +targetPct, feePct: +feePct });
  return { type, e, fired: 0, long: 0, n: 0, wins: 0, last: undefined };
});

(async () => {
  let binance = false, rows = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
    const f = line.split(',');
    if (!rows++ && isNaN(+f[0])) { binance = f[0] === 'agg_trade_id'; continue; }
    if (f.length !== 7 && f.length !== 4) continue;
    const isBinance = binance || f.length === 7;
    const t = Number(f[isBinance ? 5 : 0]), price = Number(f[1]), qty = Number(f[2]);
    const sell = parseSide(f[isBinance ? 6 : 3]);
    if (!(Number.isSafeInteger(t) && t >= 0 && price > 0 && qty > 0) || sell === undefined) continue;
    for (const r of runs) {
      for (const s of r.e.trade(t, price, qty, sell)) if (s.type === r.type) { r.fired++; if (s.dir > 0) r.long++; }
      const done = r.e.bot.trades.at(-1);
      if (done !== r.last) { r.last = done; r.n++; if (done.pnl > 0) r.wins++; }
    }
  }
  const even = (+stopPct + 2 * feePct) / (+stopPct + +targetPct) * 100;
  console.log(`${rows} rows · stop ${stopPct}% · target ${targetPct}% · fee ${feePct}%/side · $1000 per trade · break-even win rate ${even.toFixed(0)}%`);
  console.table(runs.map(r => ({
    setup: r.type, signals: r.fired, 'long/short': `${r.long}/${r.fired - r.long}`, trades: r.n,
    'win %': r.n ? +(100 * r.wins / r.n).toFixed(1) : 0, 'P&L $': +r.e.bot.pnl.toFixed(2),
  })));
})();
