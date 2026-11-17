// Metadata for the order-flow venue. Spot gold has no scanner or paper strategy.
const marketInfo = {
  NVDA:{venue:'US equities',unit:'shares',row:.01},
  AMD:{venue:'US equities',unit:'shares',row:.01},
  INTC:{venue:'US equities',unit:'shares',row:.01},
  GLD:{venue:'US equities',unit:'shares',row:.01},
  GC:{venue:'COMEX',unit:'contracts',row:.1}
};
function listedMarket(symbol){return Object.hasOwn(marketInfo,symbol)?marketInfo[symbol]:null;}

function openVenueStream(symbol, receive, status, origin='') {
  const channel={state:'Connecting',exchangeTime:0};
  const depth={state:'Connecting',exchangeTime:0};
  const dataset=symbol==='GC'?'GLBX.MDP3':'Moomoo US';
  const es=new EventSource(origin+'/api/market?symbol='+encodeURIComponent(symbol));
  let contract=null, disconnected=false;
  function setState(state){channel.state=depth.state=state;}
  es.onopen=()=>{setState('Open');disconnected=false;};
  es.onmessage=({data})=>{
    const ev=JSON.parse(data);
    if(ev.type==='status'){
      if(ev.state==='error'){
        if(channel.exchangeTime || depth.exchangeTime)receive({type:'gap',t:Date.now()},contract);
        setState('Unavailable');es.close();
      }
      if(ev.state==='connecting')setState('Connecting');
      if(ev.state==='live')setState('Open');
      if(ev.state==='reset'){
        channel.exchangeTime=depth.exchangeTime=0;
        receive({type:'gap',t:ev.t ?? Date.now()},contract);
      }
      status(ev.message || '');return;
    }
    if(ev.dataset && ev.dataset!==dataset || ev.symbol && ev.symbol!==symbol)return;
    if(ev.type==='instrument'){
      if(symbol==='GC' && !/^GC[FGHJKMNQUVXZ]\d{1,4}$/.test(ev.contract))return;
      if(symbol!=='GC' && ev.contract!==symbol)return;
      if(contract && ev.contract!==contract){
        setState('Contract changed');es.close();status('Contract changed. Save this session and reconnect.');return;
      }
      contract=ev.contract;receive(ev,contract);return;
    }
    if(!contract || ev.contract && ev.contract!==contract)return;
    if(ev.type!=='trade' && ev.type!=='depth')return;
    const health=ev.type==='trade'?channel:depth;
    const receiptOnly=ev.timeBasis==='local receipt';
    health.state=receiptOnly?'Source time unavailable':'Open';
    health.exchangeTime=receiptOnly?0:ev.t;
    receive(ev,contract);
  };
  es.onerror=()=>{
    setState(es.readyState===EventSource.CLOSED?'Unavailable':'Reconnecting');
    channel.exchangeTime=depth.exchangeTime=0;
    if(!disconnected){receive({type:'gap',t:Date.now()},contract);disconnected=true;}
    status('Market stream unavailable. Open the terminal from server.py and check the data subscription.');
  };
  return {channel,depth,close:()=>es.close()};
}

if (typeof module !== 'undefined') module.exports = {openVenueStream};
