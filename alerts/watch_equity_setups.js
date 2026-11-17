// Read-only Moomoo setup alerts. Supply the regular-session open and close as ISO timestamps.
const {execFile}=require('node:child_process');
const {openVenueStream}=require('../core/markets.js');
const {createEngine}=require('../core/engine.js');
const {apply}=require('../core/session.js');

function setupDetector(symbol){
  const engine=createEngine({market:symbol,bucket:.01,recordTicks:false});
  let tradeTime=0,bookTime=0,tracking=false;
  function reset(){
    if(tracking)engine.resetContinuity();
    tradeTime=bookTime=0;
    tracking=false;
  }
  return (event,now=Date.now())=>{
    if(event.type==='instrument')return [];
    if(event.type==='gap'){reset();return [];}
    if(event.dataset!=='Moomoo US' || (event.symbol && event.symbol!==symbol))return [];
    if(!['trade','depth'].includes(event.type))return [];
    const age=now-event.t;
    if(!Number.isFinite(age) || age< -500 || age>1500 ||
      (event.type==='depth' && event.timeBasis!=='Moomoo server receipt')){
      reset();return [];
    }
    if((tradeTime && now-tradeTime>1500) || (bookTime && now-bookTime>1500))reset();
    if(event.type==='trade')tradeTime=event.t;
    else bookTime=event.t;
    tracking=true;
    const signals=apply(engine,event);
    return tradeTime && bookTime ? signals : [];
  };
}

const eastern=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',
  hour12:false,timeZone:'America/New_York'});
function formatAlert(symbol,signal){
  const price=signal.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  return symbol+' '+(signal.dir>0?'LONG':'SHORT')+' @ $'+price+' · '+signal.type+' · '+signal.note+
    ' · '+eastern.format(signal.t)+' ET';
}

function watch(start,end){
  if(!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-Date.now()>2147483647)
    throw Error('Supply valid session open and close timestamps within the next 24 days.');
  if(Date.now()>=end)return;
  const streams=new Map(),retries=new Map();
  function connect(symbol){
    if(Date.now()>=end)return;
    const receive=setupDetector(symbol);
    const stream=openVenueStream(symbol,event=>{
      const now=Date.now();
      if(now<start || now>=end || (event.type!=='gap' && event.t<start))return;
      for(const signal of receive(event,now)){
        if(signal.t<start)continue;
        const message=formatAlert(symbol,signal);
        console.log(message);
        const script='on run argv\ndisplay notification (item 1 of argv) with title "Tapescope setup"\nend run';
        execFile('/usr/bin/osascript',['-e',script,message],err=>{
          if(err)console.error('Mac notification failed:',err.message);
        });
      }
    },message=>{
      if(stream.channel.state==='Unavailable' || stream.channel.state==='Contract changed'){
        console.error(new Date().toISOString(),symbol,message);
        stream.close();
        clearTimeout(retries.get(symbol));
        retries.set(symbol,setTimeout(()=>connect(symbol),5000));
      }
    },'http://127.0.0.1:8791');
    streams.set(symbol,stream);
  }
  const opening=setTimeout(()=>['NVDA','AMD','INTC'].forEach(connect),Math.max(0,start-Date.now()-15000));
  setTimeout(()=>{
    clearTimeout(opening);
    for(const timer of retries.values())clearTimeout(timer);
    for(const stream of streams.values())stream.close();
  },end-Date.now());
}

if(require.main===module)watch(Date.parse(process.argv[2]),Date.parse(process.argv[3]));
module.exports={setupDetector,formatAlert};
