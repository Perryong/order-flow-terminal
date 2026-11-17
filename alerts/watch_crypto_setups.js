// Continuous read-only Binance USDⓈ-M scanner. macOS delivers signal notifications.
const {execFile}=require('node:child_process');
const {createEngine}=require('../core/engine.js');
const {openMarketChannel}=require('../core/live-feed.js');
const fs=require('node:fs');
const {trackSignal,trackTrade,exitText}=require('./crypto_exits.js');
const {fetchDailyContext,confirmSwing}=require('../core/swing.js');

function cryptoScanner(symbol){
  const engine=createEngine({recordTicks:false});
  const times={trade:0,depth:0};
  const ids={trade:0,depth:0};
  const quote={price:null,priceTime:0};
  function reset(){
    if(times.trade || times.depth)engine.resetContinuity();
    times.trade=times.depth=0;
  }
  function receive(d,now=Date.now(),onLiveTrade){
    if(d.s!==symbol)return [];
    const trade=d.e==='aggTrade';
    if(!trade && d.e!=='depthUpdate')return [];
    const kind=trade?'trade':'depth',id=trade?d.a:d.u;
    if(!Number.isSafeInteger(id) || id<=ids[kind])return [];
    ids[kind]=id;
    if(!Number.isSafeInteger(d.T) || now-d.T>1500 || d.T-now>500){reset();return [];}
    if((times.trade && now-times.trade>1500) || (times.depth && now-times.depth>1500))reset();
    let signals;
    if(trade){
      if(!Number.isFinite(+d.p) || !Number.isFinite(+d.q) || +d.p<=0 || +d.q<=0 || typeof d.m!=='boolean')return [];
      quote.price=+d.p;
      quote.priceTime=d.T;
      signals=engine.trade(d.T,+d.p,+d.q,d.m);
    }else{
      const ladder=rows=>(rows || []).map(([p,q])=>[+p,+q]).filter(([p,q])=>Number.isFinite(p)&&Number.isFinite(q)&&p>0&&q>0);
      const bids=ladder(d.b),asks=ladder(d.a);
      if(!bids.length || !asks.length || bids[0][0]>=asks[0][0]){reset();return [];}
      signals=engine.depth(d.T,bids,asks);
    }
    times[kind]=d.T;
    if(trade && times.depth)onLiveTrade?.(quote.price,d.T);
    return times.trade && times.depth ? signals.filter(s=>now-s.t<=1500) : [];
  }
  return {receive,reset,times,quote};
}

function alertText(symbol,s,swing=null){
  const time=new Date(s.t).toISOString().slice(11,19);
  const context=swing?' · '+swing.trend+' daily trend near '+(s.dir>0?'support ':'resistance ')+swing.level:'';
  return (swing?'SWING · ':'')+symbol+' '+(s.dir>0?'LONG':'SHORT')+' @ '+s.price+' USDT · '+s.type+' · '+s.note+context+' · '+time+' UTC';
}

function watch(statusFile){
  const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'], scanners={},channels=[];
  const base='wss://fstream.binance.com';
  const swing={};
  let saved={};
  if(statusFile && fs.existsSync(statusFile)){
    try { saved=JSON.parse(fs.readFileSync(statusFile,'utf8')); }
    catch(err){ console.error('Could not read previous scanner status:',err.message); }
  }
  const setups={};
  let lastAlert=saved.lastAlert ?? null,deliveryError=null,stopping=false;
  for(const symbol of symbols){
    setups[symbol]=saved.setups?.[symbol] ?? {};
    swing[symbol]={
      context:null, price:null, priceTime:0, error:null,
      lastConfirmation:saved.swing?.[symbol]?.lastConfirmation ?? null
    };
  }
  async function refreshDaily(){
    await Promise.all(symbols.map(async symbol=>{
      const state=swing[symbol];
      if(state.context && Date.now()<state.context.expiresAt)return;
      try {
        state.context=await fetchDailyContext(symbol);
        state.error=null;
      } catch(err){
        state.context=null;
        state.error=err.message;
      }
    }));
    if(!stopping)save();
  }
  function save(){
    if(!statusFile || stopping)return;
    for(const symbol of symbols)Object.assign(swing[symbol],scanners[symbol].quote);
    const health=Object.fromEntries(symbols.map(s=>[s,scanners[s].times]));
    fs.writeFileSync(statusFile+'.tmp',JSON.stringify({checked:Date.now(),health,lastAlert,deliveryError,swing,setups}));
    fs.renameSync(statusFile+'.tmp',statusFile);
  }
  for(const symbol of symbols){
    const scanner=scanners[symbol]=cryptoScanner(symbol);
    const receive=d=>{
      const state=swing[symbol];
      const tracked=setups[symbol];
      const messages=[];
      const addExits=exits=>{for(const exit of exits)messages.push(exitText(symbol,exit));};
      const signals=scanner.receive(d,Date.now(),(price,t)=>{
        addExits(trackTrade(tracked,price,t,state.context));
      });
      for(const signal of signals){
        const confirmation=confirmSwing(state.context,signal,state.lastConfirmation);
        if(confirmation)state.lastConfirmation=confirmation;
        addExits(trackSignal(tracked,signal,confirmation,state.context));
        messages.push(alertText(symbol,signal,confirmation));
      }
      if(!messages.length)return;
      lastAlert=messages.at(-1);
      save(); // Record the transition before submitting notifications, including across restarts.
      const script='on run argv\ndisplay notification (item 1 of argv) with title "Tapescope setup"\nend run';
      for(const message of messages){
        execFile('/usr/bin/osascript',['-e',script,message],err=>{
          deliveryError=err?err.message:null;
          save();
        });
      }
    };
    for(const suffix of ['/market/ws/'+symbol.toLowerCase()+'@aggTrade','/public/ws/'+symbol.toLowerCase()+'@depth20@100ms']){
      let channel;
      channel=openMarketChannel(base+suffix,receive,()=>{
        if(channel && channel.state!=='Open')scanner.reset();
      });
      channels.push(channel);
    }
  }
  save();
  refreshDaily();
  const dailyTimer=setInterval(refreshDaily,60_000);
  const timer=setInterval(save,5000);
  function stop(){stopping=true;clearInterval(dailyTimer);clearInterval(timer);for(const c of channels)c.close();}
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
}
if(require.main===module)watch(process.argv[2]);
module.exports={cryptoScanner,alertText};
