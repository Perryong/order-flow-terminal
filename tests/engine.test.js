// Run: node --test tests/engine.test.js
const assert = require('assert');
const { createEngine } = require('../core/engine.js');

// Footprint cells, delta, profile
let e = createEngine({ bucket: 10, bigUsd: 1e9 });
e.trade(0, 100, 2, false); e.trade(1000, 105, 1, true); e.trade(2000, 112, 3, false);
let b = e.bars[0];
assert.deepStrictEqual(b.cells.get(10), [1, 2]);
assert.deepStrictEqual(b.cells.get(11), [0, 3]);
assert.strictEqual(b.delta, 4); assert.strictEqual(e.cvd, 4); assert.strictEqual(e.profile.get(10), 3);
e.trade(60000, 110, 1, true);
assert.strictEqual(e.bars.length, 2);

// Sweep + bot takes it and hits target
e = createEngine({ bucket: 10, bigUsd: 1000 });
e.bot.on = true; e.bot.stopPct = 1; e.bot.targetPct = 2;
let sig = [];
for (let i = 0; i < 4; i++) sig.push(...e.trade(i * 50, 100 + i * 10, 5, false));
assert.strictEqual(sig.length, 1); assert.strictEqual(sig[0].type, 'sweep'); assert.strictEqual(sig[0].dir, 1);
assert.ok(e.bot.pos);
e.trade(5000, e.bot.pos.entry * 1.03, 1, false);
assert.strictEqual(e.bot.pos, null); assert.strictEqual(e.bot.trades.length, 1);
assert.ok(Math.abs(e.bot.pnl - 20) < 1e-9); // 2% of $1000

// Stop loss
e.bot.pos = { dir: 1, entry: 100, stop: 99, target: 102, t: 0 };
e.trade(6000, 98, 1, true);
assert.ok(Math.abs(e.bot.trades[1].pnl + 10) < 1e-9);

// Absorption: 6 quiet bars, then heavy selling that closes at the high
e = createEngine({ bucket: 1, bigUsd: 1e9 }); sig = [];
for (let i = 0; i < 6; i++) { e.trade(i * 60000, 100, 1, false); e.trade(i * 60000 + 1, 100, 1, true); }
e.trade(360000, 100, 1, true); e.trade(360001, 95, 10, true); e.trade(360002, 100, 2, false);
sig.push(...e.trade(420000, 100, 1, false));
assert.ok(sig.some(s => s.type === 'absorption' && s.dir === 1), 'absorption');

// Iceberg: 10 traded into a bid showing 1 that is still there
e = createEngine({ bucket: 1, bigUsd: 100 });
e.trade(0, 100, 0.1, true);
e.depth(1, [[100, 1]], [[101, 1]]);
e.trade(2, 100, 10, true);
sig = e.depth(3, [[100, 1]], [[101, 1]]);
assert.ok(sig.some(s => s.type === 'iceberg' && s.dir === 1), 'iceberg');
assert.strictEqual(e.heat.length, 2);



// Replaying a bar-close signal can first fill on the print that reveals the close.
e = createEngine({ bucket: 1, bigUsd: 1e9 });
e.bot.on = true;
for (let i = 0; i < 6; i++) e.trade(i * 60000, 100, 1, false);
e.trade(360000, 99, 10, true);
e.trade(361000, 100, 1, false);
sig = e.trade(480000, 110, 1, false);
assert.strictEqual(sig[0].price, 100);
assert.equal(e.bot.pos?.entry, 110, 'bar-close paper entry uses next observed price');
assert.equal(e.bot.pos.t, 480000);
e.bot.usd = 5000;
e.trade(480100, 115, 1, false);
assert.ok(Math.abs(e.bot.pnl - 4) < 1e-9, 'paper position keeps its entry notional');

// Each thirty-minute bracket contributes once per traded row, across bar boundaries.
e = createEngine({ bucket: 1, barMs: 60000 });
e.trade(1, 100, 2, false);
e.trade(60001, 100, 3, true);
e.trade(61000, 101, 1, true);
e.trade(1800000, 100, 1, true);
assert.deepStrictEqual([...e.tpo], [[100, 2], [101, 1]]);
assert.equal(e.tpoMs, 1800000);

// A single jump doesn't prove that three or more intermediate levels traded.
e = createEngine({ bucket: 1, bigUsd: 100 });
e.trade(0, 100, 1, false);
assert.equal(e.trade(1, 110, 1, false).length, 0);

// A book can arrive before the first print on a live connection.
e = createEngine();
e.depth(1, [[68400, 2]], [[68401, 1]]);
assert.equal(e.heat.length, 1);
assert.ok(e.o.bucket > 0);

// For iceberg entries, a marketable buy pays the current offer.
e = createEngine({ bucket: 1, bigUsd: 100 });
e.bot.on = true;
e.depth(1, [[100, 1]], [[101, 1]]);
e.trade(2, 100, 10, true);
e.depth(3, [[100, 1]], [[101, 1]]);
assert.equal(e.signals[0].price, 100);
assert.equal(e.bot.pos.entry, 101);

// Flat bars have no directional close against the aggressors.
e = createEngine({ bucket: 1 });
for (let i = 0; i < 6; i++) e.trade(i * 60000, 100, 1, true);
e.trade(360000, 100, 5, false);
assert.equal(e.trade(420000, 101, 1, false).length, 0);

// Fees: 2% target on $1000 with 0.05% per side nets $20 - $1
e = createEngine({ bucket: 10, bigUsd: 1e9 });
e.bot.feePct = 0.05; e.bot.pos = { dir: 1, entry: 100, stop: 99, target: 102, t: 0, usd: 1000 };
e.trade(0, 102, 1, false);
assert.ok(Math.abs(e.bot.pnl - 19) < 1e-9, 'fees charged on both sides');

console.log('all engine tests passed');
