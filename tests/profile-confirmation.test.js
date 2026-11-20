const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProfileScanner}=require('../core/profile-confirmation.js');
const profile={poc:100,val:90,vah:110,bucket:1,total:100,rows:[{price:90},{price:100},{price:110}],partial:false,hasGap:false};
const trade=(t,price,qty=1,sell=false)=>({type:'trade',t,price,qty,sell});
const book=t=>({type:'depth',t,bids:[[99,10]],asks:[[101,10]]});
const sig=(t,dir,price,type='sweep')=>({t,dir,price,type,note:'four traded levels'});
function context(extra={}){return {profile,minutes:30,signals:[],live:false,fresh:true,...extra};}
function prime(scanner,level,dir,options={}){
 scanner.process(book(1000),context(options));
 scanner.process(trade(1000,level-dir*2,1,dir<0),context(options));
 scanner.process(trade(1100,level,5,dir<0),context(options));
}
test('long and short confirmations at POC, VAL and VAH freeze levels and retain the trigger',()=>{
 for(const name of ['poc','val','vah'])for(const dir of [1,-1]){
  const s=createProfileScanner(),level=profile[name];prime(s,level,dir);
  const out=s.process(trade(1200,level+dir*2,10,dir<0),context({signals:[sig(1200,dir,level+dir*2)]}));
  assert.equal(out.length,1);assert.equal(out[0].level,name.toUpperCase());assert.equal(out[0].dir,dir);
  assert.equal(out[0].price,level+dir*2);assert.equal(out[0].levels[name],level);assert.equal(out[0].range,30);
  assert.equal(out[0].flow.note,'four traded levels');assert.equal(out[0].mode,'Replay');
  s.process(trade(1300,level+dir*2),context({profile:{...profile,[name]:level+20}}));
  assert.equal(out[0].levels[name],level);
 }
});
test('opposing delta, unknown aggressors and no flow signal cannot confirm',()=>{
 for(const mode of ['opposed','unknown','missing']){
  const s=createProfileScanner();prime(s,100,1);
  const out=s.process(trade(1200,102,100,mode==='unknown'?null:mode==='opposed'),context({signals:mode==='missing'?[]:[sig(1200,1,102)]}));
  assert.equal(out.length,0);
 }
});
test('incomplete, gapped, stale, receipt-only and non-live samples cannot become live confirmations',()=>{
 for(const extra of [{profile:{...profile,partial:true}},{profile:{...profile,hasGap:true}},{live:true,fresh:false}]){
  const s=createProfileScanner();prime(s,100,1,extra);
  assert.equal(s.process(trade(1200,102,10),context({...extra,signals:[sig(1200,1,102)]})).length,0);
 }
 const s=createProfileScanner();prime(s,100,1);
 assert.equal(s.process(trade(5000,102,10),context({signals:[sig(5000,1,102)]})).length,0);
 const r=createProfileScanner();prime(r,100,1);
 r.process({...book(1150),timeBasis:'local receipt'},context());
 assert.equal(r.process(trade(1200,102,10),context({signals:[sig(1200,1,102)]})).length,0);
});
test('expired touches, chasing, out-of-order events and duplicate triggers are rejected',()=>{
 const s=createProfileScanner();prime(s,100,1);
 const ev=trade(1200,102,10),ctx=context({signals:[sig(1200,1,102)]});
 assert.equal(s.process(ev,ctx).length,1);assert.equal(s.process(ev,ctx).length,0);
 assert.equal(s.process(trade(1150,102,10),context({signals:[sig(1150,1,102)]})).length,0);
 for(const [time,price] of [[62000,102],[1200,105]]){
  const r=createProfileScanner();prime(r,100,1);r.process(book(time),context());
  assert.equal(r.process(trade(time,price,10),context({signals:[sig(time,1,price)]})).length,0);
 }
});
test('profile motion alone, an earlier signal and a gap cannot create a confirmation',()=>{
 const s=createProfileScanner();prime(s,100,1);
 assert.equal(s.process(trade(1200,102,10),context({signals:[sig(900,1,102)]})).length,0);
 s.process({type:'gap',t:1250},context());s.process(book(1300),context());
 assert.equal(s.process(trade(1300,102,10),context({signals:[sig(1300,1,102)]})).length,0);
 const r=createProfileScanner();r.process(book(1000),context());
 r.process(trade(1000,104,10),context());
 assert.equal(r.process(trade(1200,104,10),context({profile:{...profile,poc:102},signals:[sig(1200,1,104)]})).length,0);
});
test('late trades still count toward delta and unknown-volume gating without moving the current price',()=>{
 for(const sell of [true,null]){
  const s=createProfileScanner();prime(s,100,1);
  s.process(trade(1050,80,100,sell),context());
  assert.equal(s.process(trade(1200,102,10,false),context({signals:[sig(1200,1,102)]})).length,0);
 }
});
