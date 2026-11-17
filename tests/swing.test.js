const {test}=require('node:test');
const assert=require('node:assert/strict');
const {dailyContext,confirmSwing}=require('../core/swing');

const day=86_400_000;
const today=Date.UTC(2026,10,14);
function history(descending=false){
  return Array.from({length:90},(_,i)=>{
    const open=today-(90-i)*day;
    const close=descending?200-i:100+i;
    return [open,String(close),String(close+2),String(close-2),String(close),'100',open+day-1];
  });
}
test('closed UTC candles determine trend, levels and volatility even during an unfinished candle',()=>{
  const rows=history();
  rows[84][3]='179'; // Confirmed 5-bar pivot, closer to the last close than the 20-day low.
  rows.push([today,'1','99000','.001','2','1',today+day-1]);
  const c=dailyContext(rows,today+12345);
  assert.equal(c.trend,'bullish');
  assert.equal(c.close,189);
  assert.equal(c.sma20,179.5);
  assert.equal(c.sma50,164.5);
  assert.equal(c.support,179);
  assert.equal(c.resistance,191);
  assert.equal(c.expiresAt,today+day);
  assert.equal(c.asOf,today-1);
  assert.equal(c.candles.length,90);
  assert.equal(c.atr14,59/14);
  assert.equal(c.tolerance,c.atr14/4);
  assert.equal(dailyContext(history(true),today).trend,'bearish');
});
test('incomplete, invalid and stale histories cannot produce swing levels',()=>{
  const rows=history();
  assert.throws(()=>dailyContext(rows.slice(0,-1),today));
  assert.throws(()=>dailyContext(rows.filter((_,i)=>i!==72),today));
  rows[87][2]='100'; // Below the candle close.
  assert.throws(()=>dailyContext(rows,today));
});
test('only fresh aligned flow within a daily level zone confirms and cooldown survives saved state',()=>{
  const c=dailyContext(history(),today);
  const at=today+10000;
  const signal={t:at,dir:1,price:c.support+c.tolerance,type:'sweep',note:'aggressive buys'};
  const first=confirmSwing(c,signal,null,at);
  assert.equal(first.level,c.support);
  assert.equal(first.type,'sweep');
  assert.equal(first.trend,c.trend);
  assert.equal(confirmSwing(c,signal,JSON.parse(JSON.stringify(first)),at),null);
  assert.equal(confirmSwing(c,{...signal,dir:-1},null,at),null);
  assert.equal(confirmSwing({...c,trend:'neutral'},signal,null,at),null);
  assert.equal(confirmSwing(c,{...signal,price:signal.price+.01},null,at),null);
  assert.equal(confirmSwing(c,signal,null,at+3000),null);
  assert.equal(confirmSwing(c,{...signal,t:c.expiresAt},null,c.expiresAt),null);
  const down=dailyContext(history(true),today);
  assert.equal(confirmSwing(down,{...signal,dir:-1,price:down.resistance},null,at).level,down.resistance);
  assert.ok(confirmSwing(c,{...signal,t:at+900000},first,at+900000));
});
