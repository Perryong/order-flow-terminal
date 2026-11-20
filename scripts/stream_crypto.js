// Market data only. One bounded-lifetime relay per SSE connection; never loads alert or order modules.
'use strict';
const {openMarketChannel}=require('../core/live-feed.js');
const symbol=process.argv[2];
if(!['BTCUSDT','ETHUSDT','SOLUSDT'].includes(symbol)){process.exitCode=1;return;}
const emit=ev=>{
  // Stop a slow consumer rather than retaining an unbounded tick backlog.
  if(process.stdout.writableLength>2*1024*1024)process.exit(1);
  process.stdout.write(JSON.stringify({...ev,symbol})+'\n');
};
process.stdout.on('error',()=>process.exit(0));
let trades,depth,lastTradeId=null,lastDepthId=null,interrupted=false;
(async()=>{
  emit({type:'status',state:'connecting',message:'Loading recent trades from Mac'});
  let rows=[];
  try{
    for(let page=0;page<5;page++){
      const from=rows.length?'&fromId='+Math.max(0,rows[0].a-1000):'';
      const r=await fetch('https://fapi.binance.com/fapi/v1/aggTrades?symbol='+symbol+'&limit=1000'+from,{signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error();
      const part=(await r.json()).filter(d=>!rows.length||d.a<rows[0].a);
      if(!part.length)break;rows=part.concat(rows);
    }
    for(const d of rows){lastTradeId=d.a;emit({type:'trade',tradeId:d.a,t:d.T,price:+d.p,qty:+d.q,sell:d.m,historical:true});}
  }catch{emit({type:'status',state:'connecting',message:'Recent history unavailable; collecting new trades'});}
  function changed(){
    const channels=[trades,depth];
    if(!interrupted && channels.some(c=>['Unavailable','Reconnecting'].includes(c?.state))){interrupted=true;emit({type:'gap',t:Date.now()});}
    if(channels.every(c=>c?.state==='Open')){interrupted=false;emit({type:'status',state:'live'});}
  }
  trades=openMarketChannel('wss://fstream.binance.com/market/stream?streams='+symbol.toLowerCase()+'@aggTrade/'+symbol.toLowerCase()+'@forceOrder',(d,ch)=>{
    if(d.e==='aggTrade'&&d.s===symbol&&(lastTradeId===null||d.a>lastTradeId)){
      lastTradeId=d.a;ch.exchangeTime=d.T;emit({type:'trade',tradeId:d.a,t:d.T,price:+d.p,qty:+d.q,sell:d.m});
    }else if(d.e==='forceOrder'&&d.o?.s===symbol){
      const o=d.o;emit({type:'liquidation',t:o.T,side:o.S,price:+o.ap||+o.p,qty:+o.z||+o.l});
    }
  },changed);
  depth=openMarketChannel('wss://fstream.binance.com/public/ws/'+symbol.toLowerCase()+'@depth20@100ms',(d,ch)=>{
    if(d.s!==symbol||d.e!=='depthUpdate'||lastDepthId!==null&&d.u<=lastDepthId)return;
    const levels=rows=>rows.map(([p,q])=>[+p,+q]).filter(([p,q])=>p>0&&q>0),bids=levels(d.b),asks=levels(d.a);
    if(!bids.length||!asks.length)return;
    lastDepthId=d.u;ch.exchangeTime=d.T;emit({type:'depth',updateId:d.u,t:d.T,bids,asks});
  },changed);
})().catch(()=>{emit({type:'status',state:'error',message:'Mac crypto relay unavailable'});process.exitCode=1;});
