// Run with node --experimental-eventsource scripts/check_open_feed.js NVDA AMD INTC GLD.
const {openVenueStream} = require('../core/markets.js');
const {createEngine} = require('../core/engine.js');
const session = require('../core/session.js');

function usableBook(event) {
  function ladder(rows, sign) {
    return Array.isArray(rows) && rows.length >= 2 && rows.length <= 10 &&
      rows.every(([p,q], i) => Number.isFinite(p) && p>0 && Number.isFinite(q) && q>0 &&
        (!i || sign*(p-rows[i-1][0])>0));
  }
  return ladder(event.bids,-1) && ladder(event.asks,1) && event.bids[0][0]<event.asks[0][0];
}

function check(symbol,origin='http://127.0.0.1:8791') {
  return new Promise(resolve=>{
    const dataset='Moomoo US';
    const engine=createEngine({market:symbol,bucket:.01});
    let contract=null,lastStatus='Connecting',trades=0,books=0,first=null,tradeTime=0,bookTime=0,bidLevels=0,askLevels=0;
    let advancingTradeTimes=0,receivedBooks=0,receiptOnlyBooks=0,largestBidBook=0,largestAskBook=0;
    function reset(){
      advancingTradeTimes=receivedBooks=receiptOnlyBooks=largestBidBook=largestAskBook=0;
      first=null;trades=books=tradeTime=bookTime=bidLevels=askLevels=0;
    }
    function finish(ok,reason){
      clearTimeout(timeout);stream.close();
      resolve({symbol,contract,dataset,ok,reason,checked:new Date().toISOString(),trades,books,
        tradeTime:tradeTime?new Date(tradeTime).toISOString():null,depthTime:bookTime?new Date(bookTime).toISOString():null,
        bidLevels,askLevels,advancingTradeTimes,receivedBooks,receiptOnlyBooks,largestBidBook,largestAskBook,
        depthClock:bookTime?'Moomoo server receipt':null,
        tradeAgeMs:tradeTime?Date.now()-tradeTime:null,depthAgeMs:bookTime?Date.now()-bookTime:null,scannerVolume:engine.vol,lastPrice:engine.last || null});
    }
    const stream=openVenueStream(symbol,(ev,mapped)=>{
      if(ev.type==='instrument'){contract=mapped;return;}
      if(ev.type==='gap'){session.apply(engine,ev);reset();return;}
      const now=Date.now(),age=now-ev.t;
      if(!contract || ev.dataset!==dataset || ev.symbol!==symbol)return;
      if(ev.type==='depth' && usableBook(ev)){
        receivedBooks++;
        largestBidBook=Math.max(largestBidBook,ev.bids.length);
        largestAskBook=Math.max(largestAskBook,ev.asks.length);
        if(ev.timeBasis==='local receipt'){receiptOnlyBooks++;bookTime=0;books=0;return;}
      }
      if(age< -500 || age>1500)return;
      if(ev.type==='trade' && ev.qty>0 && ev.price>0 && [true,false,null].includes(ev.sell)  && ev.t>=tradeTime){
        if(ev.t>tradeTime)advancingTradeTimes++;
        session.apply(engine,ev);trades++;tradeTime=ev.t;
      }else if(ev.type==='depth' && ev.t>bookTime && usableBook(ev)){
        session.apply(engine,ev);books++;bookTime=ev.t;
        bidLevels=ev.bids.length;askLevels=ev.asks.length;
      }else return;
      first??=now;
      if(now-first>=10000 && advancingTradeTimes>=3 && books>=3 && now-Math.min(tradeTime,bookTime)<=1500 &&
         engine.vol>0 && engine.heat.length)finish(true,'Fresh executions and two-sided depth processed by scanner');
    },message=>{
      lastStatus=message;
      if(stream.channel.state==='Unavailable' || stream.channel.state==='Contract changed')finish(false,message);
    },origin);
    const timeout=setTimeout(()=>finish(false,receiptOnlyBooks && !books?'Two-sided depth arrived without verifiable upstream timestamps.':'No qualifying live sample within 90s. '+lastStatus),90000);
  });
}

if(require.main===module){
  const symbols=process.argv.slice(2);
  if(!symbols.length || symbols.some(s=>!['NVDA','AMD','INTC','GLD'].includes(s)) || typeof EventSource==='undefined'){
    console.error('Usage: node --experimental-eventsource scripts/check_open_feed.js NVDA AMD INTC GLD');process.exit(2);
  }
  Promise.all([...new Set(symbols)].map(async symbol=>{
    const report=await check(symbol);console.log(JSON.stringify(report));
    if(!report.ok)process.exitCode=1;
  })).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={usableBook,check};
