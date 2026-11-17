const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setImmediate: flush} = require('node:timers/promises');
const {openSpotFeed, spotFeedStatus} = require('../core/spot-feed.js');

const friday = Date.parse('2026-11-13T22:00:00Z');
const spot = {type: 'spot', provider: 'goldprice.dev', t: friday, price: 3881.55};

test('weekend reference uses Friday source time and labels the 15-minute delay', () => {
  assert.match(spotFeedStatus(spot, friday + 12 * 3600000), /15 min delayed · weekend closure · 2026-11-13 22:00:00 UTC/);
  const monday = Date.parse('2026-11-16T15:00:00Z');
  assert.match(spotFeedStatus(spot, monday), /stale/);
  assert.match(spotFeedStatus({...spot, provider: 'OANDA practice', t: monday}, monday), /OANDA practice · Bid\/ask midpoint/);
  assert.match(spotFeedStatus({...spot, provider: 'OANDA live', tradeable: false}, monday), /non-tradeable/);
});

test('polls serially, deduplicates quotes, rejects backward time and stops on close', async t => {
  let resume;
  t.mock.method(global, 'setTimeout', callback => { resume = callback; return 1; });
  t.mock.method(global, 'clearTimeout', () => {});
  const rows = [spot, spot, {...spot, t: friday - 1}, {...spot, t: friday + 1, price: 3881.60}];
  let i = 0;
  t.mock.method(global, 'fetch', async () => ({ok: true, json: async () => rows[i++]}));
  const events = [], states = [];
  const feed = openSpotFeed(q => events.push(q), s => states.push(s));
  await flush();
  await resume();
  await resume();
  await resume();
  feed.close();
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], spot);
  assert.equal(events[1].t, friday + 1);
  assert.ok(states.some(s => s.includes('cached, provider unavailable')));
});

test('an unfinished request cannot emit after closing', async t => {
  let resolve;
  t.mock.method(global, 'fetch', () => new Promise(r => {resolve = r;}));
  const events = [], states = [];
  const feed = openSpotFeed(q => events.push(q), s => states.push(s));
  feed.close();
  resolve({ok: true, json: async () => spot});
  await flush();
  assert.deepEqual(states, ['Connecting']);
  assert.equal(events.length, 0);
});

test('OANDA preserves the two quoted sides, its source timestamp, and account environment', async t => {
  const raw = {type: 'spot', t: friday, provider: 'OANDA practice', bid: 3880, ask: 3882, price: 3881, tradeable: false};
  let delay;
  t.mock.method(global, 'setTimeout', (f, ms) => { delay = ms; return 1; });
  t.mock.method(global, 'clearTimeout', () => {});
  t.mock.method(global, 'fetch', async () => ({ok: true, json: async () => raw}));
  const events = [], states = [];
  const feed = openSpotFeed(q => events.push(q), s => states.push(s));
  await flush();
  feed.close();
  assert.deepEqual(events[0], {type: 'spot', t: friday, provider: 'OANDA practice', bid: 3880, ask: 3882, price: 3881});
  assert.ok(states.some(s => s.includes('non-tradeable')));
  assert.equal(delay, 2000);
});

test('Gold-API.com displays the source time and flags a stale quote', () => {
  const q={type:'spot',provider:'Gold-API.com',price:3800,t:Date.parse('2026-11-16T12:30:00Z')};
  assert.match(spotFeedStatus(q,q.t),/Gold-API.com · Spot price · 2026-11-16 12:30:00 UTC/);
  assert.match(spotFeedStatus(q,q.t+120000),/stale/);
});
