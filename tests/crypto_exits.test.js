const {test}=require('node:test');
const assert=require('node:assert/strict');
const {trackSignal,trackTrade,exitText}=require('../alerts/crypto_exits.js');
const t=Date.UTC(2026,10,14,12);
function signal(dir,at=t,price=100){return {dir,t:at,price,type:'sweep',note:'$150k through 4 levels'};}
for(const dir of [1,-1]){
  const direction=dir===1?'LONG':'SHORT';
  const trend=dir===1?'bullish':'bearish';
  const context={trend,asOf:t-1,expiresAt:t+43200000,support:dir===1?100:90,resistance:dir===1?110:100,tolerance:2};
  function active(){
    const state={};
    trackSignal(state,signal(dir),{...signal(dir),level:100},context);
    return JSON.parse(JSON.stringify(state));
  }
  test(direction+' day reversal closes the original setup once, independent of swing',()=>{
    const state=active();
    trackSignal(state,signal(dir,t+1),null,context);
    assert.equal(state.day.t,t);
    const reversal=signal(-dir,t+20,100-dir);
    const [exit]=trackSignal(state,reversal,null,context);
    assert.equal(exit.mode,'DAY');
    assert.equal(exit.dir,dir);
    assert.equal(exit.price,reversal.price);
    assert.match(exitText('BTCUSDT',exit),new RegExp('DAY EXIT '+direction+' · BTCUSDT.*sweep.*4 levels'));
    assert.equal(state.day.dir,-dir);
    assert.equal(state.swing.dir,dir);
    assert.deepEqual(trackSignal(state,reversal,null,context),[]);
    assert.deepEqual(trackSignal(state,signal(dir,t+10),null,context),[]);
    assert.equal(state.day.dir,-dir);
  });
  test(direction+' swing exits once at the observed trade price for target, zone break or trend loss',()=>{
    for(const [price,next,reason] of [[100+dir*12,context,/target/],[100-dir*3,context,/zone/],[100,{...context,trend:'neutral'},/neutral/]]){
      const state=active();
      assert.deepEqual(trackTrade(state,price,t-1,next),[]);
      const [exit]=trackTrade(state,price,t+1,next);
      assert.equal(exit.mode,'SWING');
      assert.equal(exit.dir,dir);
      assert.equal(exit.price,price);
      assert.match(exit.reason,reason);
      assert.equal(state.day.dir,dir);
      assert.deepEqual(trackTrade(JSON.parse(JSON.stringify(state)),price,t+2,next),[]);
    }
  });
}
test('first fresh trade of new UTC day ends the day setup even with missing daily context',()=>{
  const state={};
  trackSignal(state,signal(1),null,null);
  const [exit]=trackTrade(state,97,t+86400000,null);
  assert.match(exit.reason,/UTC/);
  assert.equal(exit.price,97);
  assert.deepEqual(trackSignal(state,signal(-1,t+1),null,null),[]);
  assert.equal(state.day,null);
});
