const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setupDetector,formatAlert}=require('../alerts/watch_equity_setups.js');
const t=Date.UTC(2026,10,16,14,30);

function sweep(receive,start){
  return [100,100.01,100.02,100.03].flatMap((price,i)=>
    receive({type:'trade',t:start+i,price,qty:500,sell:false,dataset:'Moomoo US'},start+i));
}
test('one priced long alert for a fresh sweep, including the actual trigger',()=>{
  const receive=setupDetector('NVDA');
  receive({type:'depth',t,bids:[[99,50],[98,50]],asks:[[101,50],[102,50]],timeBasis:'Moomoo server receipt',dataset:'Moomoo US'},t);
  const signals=sweep(receive,t);
  assert.equal(signals.length,1);
  assert.match(formatAlert('NVDA',signals[0]),/NVDA LONG @ \$100\.03.*sweep.*4 levels/);
});
test('missing depth time, stale events and interrupted feeds suppress live alerts',()=>{
  for(const mode of ['receipt only','stale','gap']){
    const receive=setupDetector('INTC');
    const time=mode==='stale'?t-5000:t;
    receive({type:'depth',t:time,bids:[[99,50],[98,50]],asks:[[101,50],[102,50]],timeBasis:mode==='receipt only'?'local receipt':'Moomoo server receipt',dataset:'Moomoo US'},t);
    if(mode==='gap')receive({type:'gap',t},t);
    assert.deepEqual(sweep(receive,t),[]);
  }
});
