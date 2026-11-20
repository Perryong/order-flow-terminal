const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createVolumeProfile}=require('../core/volume-profile.js');
const minute=60000;
test('POC and contiguous 70% value area use executed volume, deterministic ties and row edges',()=>{
  const p=createVolumeProfile();
  [[99,1],[100,5],[101,3],[102,1]].forEach(([price,qty])=>p.trade(1000,price,qty));
  const r=p.read(2000,15,1);
  assert.equal(r.total,10);assert.equal(r.poc,100.5);assert.equal(r.val,100);assert.equal(r.vah,102);assert.equal(r.valueVolume,8);
  assert.equal(r.partial,true);
  const tie=createVolumeProfile();tie.trade(0,100,2);tie.trade(0,102,2);
  assert.equal(tie.read(1000,15,1).poc,100.5);
});
test('15/30/60-minute windows use completed seconds, exclude future and expire in silence',()=>{
  const p=createVolumeProfile();
  [[0,1],[30*minute,2],[45*minute,4],[60*minute-1,8],[60*minute,16]].forEach(([t,q])=>p.trade(t,100,q));
  assert.equal(p.read(60*minute,15,1).total,12);
  assert.equal(p.read(60*minute,30,1).total,14);
  assert.equal(p.read(60*minute,60,1).total,15);
  assert.equal(p.read(60*minute+1000,60,1).total,30);
  assert.equal(p.read(121*minute,60,1).total,0);
});
test('raw price retention permits regrouping without candle dependence',()=>{
  const p=createVolumeProfile();p.trade(100,100.1,2);p.trade(200,100.9,3);p.trade(300,102,4);
  assert.equal(p.read(1000,15,1).rows.length,2);
  assert.equal(p.read(1000,15,5).rows.length,1);
  assert.equal(p.read(1000,15,5).total,9);
});
test('known gaps, empty data and invalid values are explicit',()=>{
  const p=createVolumeProfile();p.trade(0,100,1);p.gap(500);
  assert.equal(p.read(1000,15,1).hasGap,true);
  p.trade(1000,NaN,5);p.trade(1000,100,-1);
  assert.equal(p.read(2000,15,1).total,1);
  assert.equal(p.read(61*minute,15,1).poc,null);
  assert.equal(p.read(61*minute,15,1).hasGap,true); // Disconnect has not recovered.
  assert.throws(()=>p.read(1000,10,1));assert.throws(()=>p.read(1000,15,0));
});
test('late exchange-time events invalidate a paused replay profile within the same cursor second',()=>{
  const p=createVolumeProfile();p.trade(0,100,1);
  assert.equal(p.read(1000,15,1).total,1);
  p.trade(500,102,10);p.gap(500);
  const r=p.read(1500,15,1);
  assert.equal(r.total,11);assert.equal(r.poc,102.5);assert.equal(r.hasGap,true);
  const gapOnly=createVolumeProfile();gapOnly.trade(0,100,1);gapOnly.read(1000,15,1);gapOnly.gap(500);
  assert.equal(gapOnly.read(1500,15,1).hasGap,true);
});
test('an outage longer than the range requires a full window after recovery',()=>{
 const p=createVolumeProfile();p.trade(0,100,1);p.trade(30*minute,101,1);
 p.gap(31*minute);
 assert.equal(p.read(70*minute,30,1).partial,true);
 p.trade(71*minute,100,1);p.trade(71*minute+100,101,1);p.trade(71*minute+200,102,1);
 assert.equal(p.read(71*minute+500,30,1).hasGap,true);
 const resumed=p.read(71*minute+1000,30,1);
 assert.equal(resumed.partial,true);assert.equal(resumed.hasGap,true);
 p.trade(101*minute+1000,101,1);
 assert.equal(p.read(101*minute+1000,30,1).partial,false);
 assert.equal(p.read(101*minute+1000,30,1).hasGap,false);
});
