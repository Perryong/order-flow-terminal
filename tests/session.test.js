const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEngine } = require('../core/engine.js');
const Session = require('../core/session.js');

test('CSV accepts the terminal export and preserves execution side', () => {
  const events = Session.fromCSV('\ufefftime_ms,price,qty,sell\r\n12,99,2,1\r\n10,100,1,false\r\n', 'btcusdt').events;
  assert.deepEqual(events, [
    { type: 'trade', t: 10, price: 100, qty: 1, sell: false },
    { type: 'trade', t: 12, price: 99, qty: 2, sell: true }
  ]);
  for (const row of ['0,1,2,X', '1,0,2,0', '1,10,,0', '1,10,1,0,extra'])
    assert.throws(() => Session.fromCSV(row, 'BTCUSDT'), /line 1/i);
});

test('export round trip includes all event types and rejects corrupt sessions', () => {
  const events = [
    { type: 'trade', t: 1, price: 100, qty: 2, sell: false },
    { type: 'depth', t: 1, bids: [[99, 1]], asks: [[101, 2]] },
    { type: 'liquidation', t: 2, price: 101, qty: 3, side: 'SELL' },
  ];
  const data = { version: 1, symbol: 'BTCUSDT', events };
  assert.deepEqual(Session.parse(JSON.stringify(data)), data);
  for (const event of [{ ...events[0], sell: 'false' }, { ...events[1], bids: [[99, -2]] },
                       { ...events[2], side: 'other' }, { ...events[0], t: -1 }])
    assert.throws(() => Session.parse(JSON.stringify({ ...data, events: [event] })));
  assert.throws(() => Session.parse(JSON.stringify({ ...data, version: 2 })));
  const e = createEngine({ bucket: 1 });
  for (const event of events) assert.deepEqual(Session.apply(e, event), []);
  assert.equal(e.cvd, 2);
  assert.equal(e.heat[0].levels.get(101), 2);
  assert.equal(e.liqs[0].usd, 303);
});

test('demo produces deterministic detected events and varied prices under normal defaults', () => {
  const sample = Session.demo();
  assert.deepEqual(sample, Session.demo());
  assert.deepEqual(Session.parse(JSON.stringify(sample)), sample);
  const e = createEngine({ bucket: 10, bigUsd: 100000 });
  for (const event of sample.events) Session.apply(e, event);
  assert.ok(e.bars.length >= 60);
  assert.ok(e.prints.length && e.liqs.length && e.heat.length);
  const endSignals = e.signals.filter(s => s.t > e.bars[Math.floor(e.bars.length * 2 / 3)].t);
  for (const type of ['sweep', 'absorption', 'iceberg']) assert.ok(endSignals.some(s => s.type === type), type);
  assert.ok(Math.max(...e.tpo.values()) >= 2);
  assert.ok([...e.heat.at(-1).levels.values()].some(v => v > 10));
});

test('dated gold sessions preserve instrument identity and never mix spot into futures flow', () => {
  const record = { version: 1, symbol: 'GCZ6', market: 'GC', contract: 'GCZ6', events: [
    {type:'trade', t:1, price:4010, qty:2, sell:null, dataset:'GLBX.MDP3', contract:'GCZ6'},
    {type:'spot', t:2, price:3990, provider:'Broker X'},
    {type:'gap', t:3}
  ]};
  assert.deepEqual(Session.parse(JSON.stringify(record)), record);
  const e = createEngine({market:record.market});
  for (const ev of record.events) Session.apply(e,ev);
  assert.equal(e.last, 4010);
  assert.equal(e.vol, 2);
  assert.equal(e.cvd, 0);
  assert.equal(e.prints[0].qty, 2);
  assert.equal(e.prints[0].usd, 802000);
  for (const changes of [{contract:'GC.c.0'}, {contract:'GCG7'}, {market:'AMD'}, {contract:undefined}])
    assert.throws(() => Session.parse(JSON.stringify({...record,...changes})));
  for (const bad of [{...record.events[0], contract:'GCG7'}, {...record.events[0], dataset:'XNAS.ITCH'}, {...record.events[1], provider:''}])
    assert.throws(() => Session.parse(JSON.stringify({...record,events:[bad]})));
});

test('unknown sides round-trip through tick CSV and fill only nondirectional volume', () => {
  const csv = 'time_ms,price,qty,sell\n0,100,3,\n1,101,2,unknown\n2,100,1,0\n';
  const data = Session.fromCSV(csv,'NVDA');
  assert.deepEqual(data.events.map(x=>x.sell),[null,null,false]);
  const e = createEngine({bucket:1,bigUsd:1});
  for(const ev of data.events) Session.apply(e,ev);
  assert.deepEqual(e.ticks.map(x=>x[3]),[null,null,0]);
  assert.deepEqual(e.bars[0].cells.get(100),[0,1,3]);
  assert.equal(e.profile.get(100),4);
  assert.equal(e.pv,602);
  assert.equal(e.vol,6);
  assert.equal(e.unknownVol,5);
  assert.equal(e.cvd,1);
});

test('unknown volume, crossed feeds and data gaps cannot manufacture directional setups', () => {
  for (const interrupt of ['unknown','gap','venue']) {
    const e = createEngine({bucket:1,bigUsd:1});
    const apply = (type,t,fields={})=>Session.apply(e,{type,t,venue:'XNAS',...fields});
    for(let t=0;t<3;t++)apply('trade',t,{price:100+t,qty:1,sell:false});
    if(interrupt==='unknown') apply('trade',3,{price:103,qty:1,sell:null});
    if(interrupt==='gap') apply('gap',3);
    apply('trade',4,{price:104,qty:10,sell:false,venue:interrupt==='venue'?'OTHER':'XNAS'});
    assert.equal(e.signals.length,0,interrupt);
    const book={bids:[[100,1]],asks:[[101,1]]};
    apply('depth',10,book);
    apply('trade',11,{price:100,qty:10,sell:interrupt==='unknown'?null:true,venue:interrupt==='venue'?'OTHER':'XNAS'});
    if(interrupt==='gap') apply('gap',12);
    apply('depth',13,book);
    assert.ok(!e.signals.some(s=>s.type==='iceberg'),interrupt);
  }
  const e = createEngine({bucket:1});
  for(let i=0;i<6;i++) e.trade(i*60000,100,1,false);
  e.trade(360000,104,0.01,null);e.trade(360001,100,12,false);
  assert.deepEqual(e.trade(420000,100,1,true),[]);
});

test('GC dollar threshold applies to accumulated sweeps and displayed-liquidity checks', () => {
  const e = createEngine({market:'GC',bucket:0.1,bigUsd:1000000});
  for(let n=0;n<4;n++) e.trade(n,4000+n/10,1,false);
  assert.equal(e.signals[0].type,'sweep');
  e.depth(10,[[4000,1]],[[4001,1]]);
  e.trade(11,4000,5,true);
  assert.equal(e.depth(12,[[4000,1]],[[4001,1]])[0].type,'iceberg');
});

test('equity sessions accept explicit same-symbol contracts and reject wrong instruments and liquidations', () => {
  const trade = {type:'trade',t:1,price:100,qty:2,sell:false,symbol:'NVDA',contract:'NVDA'};
  const session = {version:1, market:'NVDA', symbol:'NVDA', contract:'NVDA', events:[trade]};
  assert.deepEqual(Session.parse(JSON.stringify(session)),session);
  assert.deepEqual(Session.parse(JSON.stringify({...session,contract:undefined})).events,[trade]);
  for (const event of [{...trade,symbol:'AMD'}, {...trade,contract:'AMD'}, {type:'liquidation',t:1,price:100,qty:1,side:'SELL'}])
    assert.throws(() => Session.parse(JSON.stringify({...session,events:[event]})));
  assert.throws(() => Session.parse(JSON.stringify({...session,contract:'INTC'})));
});

test('one-sided and empty replacement books invalidate the old quotes on live and replay', () => {
  const metadata = {version:1,market:'NVDA',symbol:'NVDA'};
  for (const replacement of [{bids:[], asks:[[101,1]]}, {bids:[], asks:[]}]) {
    const events = [
      {type:'depth',t:1,bids:[[100,1]],asks:[[101,1]]},
      {type:'depth',t:2,...replacement},
      {type:'trade',t:3,price:100,qty:10,sell:true},
      {type:'depth',t:4,bids:[[100,1]],asks:[[101,1]]}
    ];
    const parsed=Session.parse(JSON.stringify({...metadata,events}));
    const engine=createEngine({market:'NVDA',bucket:1,bigUsd:100});
    for (const event of parsed.events) Session.apply(engine,event);
    assert.equal(engine.signals.length,0);
    assert.equal(engine.heat[1].levels.size,replacement.asks.length);
  }
});

test('listed markets cannot infer replenishment after a stale book', () => {
  const e=createEngine({market:'NVDA',bucket:1,bigUsd:100});
  e.depth(1,[[100,1]],[[101,1]]);
  e.trade(60000,100,5,true);
  assert.deepEqual(e.depth(60001,[[100,1]],[[101,1]]),[]);
});

test('GLD replay keeps the ounce quote separate from share executions', () => {
  const recording=Session.fromCSV('1000,342,3,0','GLD');
  assert.equal(recording.market,'GLD');
  recording.events.push({type:'spot',price:3800,t:1010,provider:'Gold-API.com'});
  const e=createEngine({market:'GLD',bucket:.01});
  for(const ev of Session.parse(JSON.stringify(recording)).events) Session.apply(e,ev);
  assert.equal(e.vol,3);
  assert.equal(e.last,342);
  assert.equal(e.cvd,3);
});
