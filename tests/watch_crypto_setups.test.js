const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cryptoScanner,alertText}=require('../alerts/watch_crypto_setups.js');
const time=1780000000000;
function book(symbol,t){
  return {s:symbol,e:'depthUpdate',T:t,u:101,b:[['99','50']],a:[['101','50']]};
}
function trade(symbol,i,sell=false){
  return {s:symbol,e:'aggTrade',T:time+i,a:200+i,p:String(100+(sell?-i:i)*0.02),q:'600',m:sell};
}
for(const sell of [false,true])test('fresh '+(sell?'short':'long')+' gives one priced alert with trigger',()=>{
  const s='ETHUSDT',scanner=cryptoScanner(s);
  scanner.receive(book(s,time),time);
  const signals=[0,1,2,3,3].flatMap(i=>scanner.receive(trade(s,i,sell),time+i));
  assert.equal(signals.length,1);
  assert.match(alertText(s,signals[0]),sell?/ETHUSDT SHORT @ 99.94 USDT.*sweep.*4 levels/:/ETHUSDT LONG @ 100.06 USDT.*sweep.*4 levels/);
});
test('a stale book, a different instrument or a disconnect cannot complete a sweep',()=>{
  for(const mode of ['stale','wrong','gap']){
    const scanner=cryptoScanner('BTCUSDT');
    scanner.receive(book(mode==='wrong'?'SOLUSDT':'BTCUSDT',time-(mode==='stale'?2000:0)),time);
    for(const i of [0,1,2])scanner.receive(trade('BTCUSDT',i),time+i);
    if(mode==='gap')scanner.reset();
    assert.deepEqual(scanner.receive(trade('BTCUSDT',3),time+3),[]);
  }
});
test('exit evaluation receives only accepted live trades with fresh depth',()=>{
  const scanner=cryptoScanner('SOLUSDT'), observed=[];
  const read=(event,now)=>scanner.receive(event,now,(price,t)=>observed.push([price,t]));
  read(trade('SOLUSDT',0),time);
  read(book('SOLUSDT',time),time);
  read(trade('SOLUSDT',1),time+1);
  read(trade('SOLUSDT',1),time+1);
  read(trade('BTCUSDT',2),time+2);
  read(trade('SOLUSDT',2),time+3000);
  read(trade('SOLUSDT',3001),time+3001);
  assert.deepEqual(observed,[[100.02,time+1]]);
});
