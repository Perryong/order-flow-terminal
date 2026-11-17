'use strict';
const $ = id => document.getElementById(id);
const number = (n,d=2) => n.toLocaleString('en-US',{maximumFractionDigits:d});
const quote = n => number(n,n>=100?2:n>=1?4:8);
const signed = n => (n>0?'+':'')+number(n);
const shortTime = t => new Date(t).toISOString().slice(11,19);
const asOf = t => new Date(t).toISOString().replace('T',' ').slice(0,19)+' UTC';
let venueStream,spotFeed,referenceTimer,referenceQuote,referenceStatus='',spotQuote,spotStatus='',venueStatus='';
const setupTypes=['absorption','sweep','exhaustion','iceberg'];
const cfg={barMs:60000,bucket:0,bigUsd:100000,usd:1000,stopPct:.2,targetPct:.4,feePct:.05,on:false,types:setupTypes,topic:'',desktop:false,symbol:'BTCUSDT'};
let data, engine, index=0, cursor=0, source='', running=false, generation=0;
let view='heat', tape='prints', latestBook=null, firstPrice=null, tradeCount=0, offset=0, hits=[], dirty=true;
let tradesChannel, depthChannel, minute, previousSegment, lastTradeId, lastDepthId, previousDraw=0, previousFrame=0;

function notice(message=''){
  $('notice').textContent=message;$('notice').hidden=!message;
}
function clearEngine(){
  engine=createEngine({barMs:cfg.barMs,market:data.market,bucket:cfg.bucket || data.rowSize || listedMarket(data.market)?.row || (source==='Demo replay'?10:0),bigUsd:cfg.bigUsd});
  if(cfg.barMs>=15*60000)engine.tpoMs=cfg.barMs;
  spotQuote=null;
  Object.assign(engine.bot,{on:cfg.on,types:new Set(cfg.types),usd:cfg.usd,stopPct:cfg.stopPct,targetPct:cfg.targetPct,feePct:cfg.feePct});
  latestBook=null;firstPrice=null;tradeCount=0;minute=flowWindow();index=0;offset=0;dirty=true;
}
function stopFeed(){
  generation++;
  venueStream?.close();spotFeed?.close();clearInterval(referenceTimer);venueStream=spotFeed=null;
  tradesChannel?.close?.(); depthChannel?.close?.();
  referenceQuote=null;referenceStatus=spotStatus=venueStatus='';
  tradesChannel = depthChannel = null;
  running=false;
}
function applyEvent(ev,alertLive=false){
  if(ev.type==='spot') {spotQuote=ev;return;}
  if(ev.type==='gap')latestBook=null;
  if(ev.type==='trade'){if(firstPrice===null)firstPrice=ev.price;tradeCount++;minute.trade(ev.exchangeTime ?? ev.t,ev.qty,ev.sell);}
  if(ev.type==='depth')latestBook=ev;
  const signals=FlowSession.apply(engine,ev);
  if(alertLive)for(const s of signals)sendAlert(s);
}
function advance(t){
  cursor=t;
  while(index<data.events.length && data.events[index].t<=t)applyEvent(data.events[index++]);
  dirty=true;
}
function seek(t){
  if(t<cursor || !engine)clearEngine();
  advance(t);previousFrame=performance.now();
}
function openSession(record,name,fraction=0){
  stopFeed();source=name;data=record;notice();clearEngine();
  setPicker(record.market || record.symbol);
  const start=data.events[0].t,end=data.events.at(-1).t;
  advance(start+(end-start)*fraction);render();
}
function sendAlert(signal){
  const instrument = (data.contract || data.symbol)+' · '+(listedMarket(data.market)?.venue || 'Binance');
  const msg=instrument+' '+(signal.dir>0?'LONG ':'SHORT ')+signal.type+' @ '+number(signal.price)+' · '+signal.note+' · '+shortTime(signal.t)+' UTC';
  if(cfg.desktop && 'Notification' in window && Notification.permission==='granted'){
    try{new Notification(msg);}catch{notice('Desktop notifications are unavailable in this browser.');}
  }
  if(cfg.topic)fetch('https://ntfy.sh/'+cfg.topic,{method:'POST',body:msg}).then(r=>{if(!r.ok)throw Error();}).catch(()=>notice('Phone alert delivery failed. Check the topic and connection.'));
}
function ingest(ev){
  // Arrival order drives the replay cursor. The engine uses the original exchange time.
  if (data.events.length >= 200000) {
    previousSegment = {...data,rowSize:engine.o.bucket};
    data = {...data,events:[]};
    clearEngine();
    notice('New live segment. The preceding 200,000 events are available in Session files.');
    $('previousSession').hidden = false;
  }
  const exchangeTime = ev.t;
  ev.exchangeTime = exchangeTime;
  ev.t = Math.max(ev.type==='spot'?Date.now():exchangeTime,data.events.at(-1)?.t ?? 0);
  data.events.push(ev);cursor=ev.t;
  const needsDepth=ev.type==='depth' || (listedMarket(data.market) && data.market!=='GC');
  const current = streamState(tradesChannel)==='Live' && (!needsDepth || streamState(depthChannel)==='Live');
  applyEvent(ev,current);index++;dirty=true;
}
function freezeLive(){
  stopFeed();source=data.events.length?'Recorded replay':'Disconnected';dirty=true;
}
// Load the most recent aggregate trades so bars and setups exist as soon as the feed opens.
// shortcut: trades printed between this fetch and the socket opening are missed, and depth has no history
async function backfill(symbol,token){
  let rows=[];
  for(let page=0;page<5;page++){
    const from=rows.length?'&fromId='+Math.max(0,rows[0].a-1000):'';
    const r=await fetch('https://fapi.binance.com/fapi/v1/aggTrades?symbol='+symbol+'&limit=1000'+from);
    if(!r.ok)throw Error(r.status);
    const part=(await r.json()).filter(d=>!rows.length||d.a<rows[0].a);
    if(!part.length)break;
    rows=part.concat(rows);
  }
  if(token!==generation)return;
  for(const d of rows){lastTradeId=d.a;ingest({type:'trade',t:d.T,price:+d.p,qty:+d.q,sell:d.m});}
}
async function connect(){
  stopFeed();const token=generation;
  source='Live feed';data={version:1,symbol:cfg.symbol,events:[]};clearEngine();cursor=0;
  setPicker(cfg.symbol);
  lastTradeId = lastDepthId = null;
  notice();
  if(listedMarket(cfg.symbol)){
    data.market=cfg.symbol;clearEngine();render();
    startListedFeed(token);
    return;
  }
  render();
  try{await backfill(data.symbol,token);}catch{notice('Recent trade history is unavailable. The session starts from connection.');}
  if(token!==generation)return;
  render();
  const symbol=data.symbol.toLowerCase(), base='wss://fstream.binance.com';
  const changed=()=>{dirty=true;};
  tradesChannel=openMarketChannel(base+'/market/stream?streams='+symbol+'@aggTrade/'+symbol+'@forceOrder',(d,ch)=>{
    if(token!==generation || d.s!==data.symbol && d.o?.s!==data.symbol)return;
    if(d.e==='aggTrade' && (lastTradeId===null || d.a>lastTradeId)){
      lastTradeId=d.a;ch.exchangeTime=d.T;
      ingest({type:'trade',t:d.T,price:+d.p,qty:+d.q,sell:d.m});
    }else if(d.e==='forceOrder'){
      const o=d.o,price=+o.ap||+o.p,qty=+o.z||+o.l;
      if(price>0&&qty>0)ingest({type:'liquidation',t:o.T,side:o.S,price,qty});
    }
  },changed);
  depthChannel=openMarketChannel(base+'/public/ws/'+symbol+'@depth20@100ms',(d,ch)=>{
    if(token!==generation || d.s!==data.symbol || d.e!=='depthUpdate' || (lastDepthId!==null && d.u<=lastDepthId))return;
    const levels=rows=>rows.map(([p,q])=>[+p,+q]).filter(([p,q])=>p>0&&q>0);
    const bids=levels(d.b),asks=levels(d.a);
    if(!bids.length || !asks.length)return;
    lastDepthId=d.u;ch.exchangeTime=d.T;
    ingest({type:'depth',t:d.T,bids,asks});
  },changed);
}
function startListedFeed(token){
  const symbol=data.symbol;
  const current=()=>generation===token;
  async function fetchReference(){
    try{
      const r=await fetch('/api/reference?symbol='+symbol,{cache:'no-store'});
      if(!r.ok)throw Error();
      const q=await r.json();
      if(!current() || q.symbol!==symbol)return;
      referenceQuote=q;referenceStatus='';dirty=true;
    }catch{if(current()){referenceStatus='Reference unavailable';dirty=true;}}
  }
  fetchReference();referenceTimer=setInterval(fetchReference,60000);
  if(symbol==='GLD'){
    spotFeed=openSpotFeed(ev=>{if(current())ingest(ev);},s=>{if(current()){spotStatus=s;dirty=true;}});
  }
  venueStream=openVenueStream(symbol,ev=>{
    if(!current())return;
    if(ev.type==='instrument')return;
    if(ev.type==='gap' && !tradeCount && !latestBook)return;
    if(ev.type==='trade'||ev.type==='depth')venueStatus='';
    ingest(ev);
  },message=>{if(current()){venueStatus=message;dirty=true;}});
  tradesChannel=venueStream.channel;depthChannel=venueStream.depth;
}
function renderMarketQuotes(live){
  const gold=data.market==='GC' || data.market==='GLD';
  $('marketQuotes').hidden=!listedMarket(data.market) || (!live && !gold);
  $('marketRef').hidden=!live;
  $('spotRef').hidden=!gold;
  $('refCaption').textContent=(referenceQuote?.label || data.symbol)+' · reference last';
  $('refValue').textContent=referenceQuote?quote(referenceQuote.price)+' USD':'—';
  $('refTime').textContent=referenceQuote?referenceQuote.provider+' · '+asOf(referenceQuote.t)+(referenceStatus?' · '+referenceStatus:''):(referenceStatus || 'Loading reference quote');
  $('spotValue').textContent=spotQuote?quote(spotQuote.price)+' USD/oz':'—';
  $('spotTime').textContent= live && spotStatus ? spotStatus : spotQuote ?
    spotQuote.provider+' · '+asOf(spotQuote.exchangeTime ?? spotQuote.t) :
    live?'Waiting for spot quote':'No spot quote recorded at this point';
}
function liveReadout(now){
  const trades=streamState(tradesChannel,now), depth=streamState(depthChannel,now);
  function update(id,state,channel){
    const age=channel?.exchangeTime ? Math.max(0,now-channel.exchangeTime) : null;
    $(id).textContent=state+(age===null?'':' · '+(age/1000).toFixed(1)+'s old');
    $(id).className=state==='Live'?'up':'';
  }
  update('tradeHealth',trades,tradesChannel); update('depthHealth',depth,depthChannel);
  const {buy,sell,unknown=0}=minute.read(now), total=buy+sell;
  const unit=listedMarket(data.market)?.unit || (data.symbol.endsWith('USDT')?data.symbol.slice(0,-4):'base units');
  $('minuteFlow').textContent=total?number(100*buy/total,1)+'% of classified volume bought · Δ '+signed(buy-sell)+' '+unit+(unknown?' · '+number(unknown)+' unclassified':'') :unknown?number(unknown)+' '+unit+' unclassified':'Awaiting trades in this minute';
  return trades===depth?trades:('Trades '+trades.toLowerCase()+' · depth '+depth.toLowerCase());
}
function colorMetric(el,value){
  el.classList.toggle('up',value>0);el.classList.toggle('dn',value<0);
}
function el(tag,txt,cls){
  const node=document.createElement(tag);if(txt!==undefined)node.textContent=txt;if(cls)node.className=cls;return node;
}
function empty(node,message){node.append(el('div',message,'empty'));}
function showSignals(){
  const list=$('signals');list.replaceChildren();$('signalCount').textContent=engine.signals.length;
  const icons={absorption:'⊣',sweep:'↗',exhaustion:'≈',iceberg:'◇'};
  for(const s of engine.signals.slice(-45).reverse()){
    const row=el('div',undefined,'signal'),info=el('div');
    const glyph=s.type==='sweep'&&s.dir<0?'↘':icons[s.type];
    row.append(el('span',glyph,'glyph '+(s.dir<0?'dn':'')));
    info.append(el('strong',s.type==='iceberg'?'Possible iceberg':s.type),el('small',(s.dir>0?'Long':'Short')+' · '+number(s.price)),el('small',s.note));
    row.append(info,el('time',shortTime(s.t)));list.append(row);
  }
  if(!list.children.length)empty(list,source==='Live feed' && listedMarket(data.market) && venueStatus?venueStatus:'Waiting for a qualifying setup.');
}
function showBook(){
  const box=$('bookRows');box.replaceChildren();
  $('bookTime').textContent=latestBook?shortTime(latestBook.exchangeTime ?? latestBook.t)+' UTC':'UTC';
  if(source==='Live feed' && !latestBook)empty(box,venueStatus || 'Waiting for exchange depth updates.');
  if(!latestBook){if(source!=='Live feed')empty(box,'No depth snapshots at this point in the session.');return;}
  const bids=latestBook.bids.slice(0,6),asks=latestBook.asks.slice(0,6);
  const max=Math.max(...bids.concat(asks).map(r=>r[1]));
  for(let i=0;i<Math.max(bids.length,asks.length);i++){
    const row=el('div',undefined,'book-row');
    for(const [level,side] of [[bids[i],'up'],[asks[i],'dn']]){
      const cell=el('div',undefined,side);
      if(level){
        cell.append(el('span',number(level[0],8)),el('small',number(level[1],3)));
        const shade=side==='up'?'#193432':'#382830';
        cell.style.background='linear-gradient(90deg,'+shade+' '+(level[1]/max*100)+'%,transparent 0)';
      }
      row.append(cell);
    }box.append(row);
  }
}
function showTape(){
  const trades=tape==='paper', liqs=tape==='liqs', currency=listedMarket(data.market)?'USD':'USDT';
  const rows=trades?engine.bot.trades:(liqs?engine.liqs:engine.prints);
  const head=$('tableHead'),body=$('tableBody');head.replaceChildren();body.replaceChildren();
  const hr=el('tr');
  for(const name of trades?['Closed (UTC)','Side','Entry','Exit','P&L ('+currency+')']:['Time (UTC)','Side','Price','Quantity','Value ('+currency+')'])hr.append(el('th',name));
  head.append(hr);$('tapeCount').textContent=rows.length;
  function summary(msg){const r=el('tr'),cell=el('td',msg,'empty');cell.colSpan=5;r.append(cell);body.append(r);}
  if(trades){
    const b=engine.bot,p=b.pos;
    summary((b.on?'Enabled':'Disabled')+' · P&L '+signed(b.pnl)+' '+currency+' · '+(p?((p.dir>0?'Long':'Short')+' from '+number(p.entry)+' · stop '+number(p.stop)+' · target '+number(p.target)):'Flat'));
  }
  for(const r of rows.slice(-60).reverse()){
    const tr=el('tr'), buy=trades?r.dir>0:!r.sell;
    const side=trades?(buy?'Long':'Short'):liqs?(buy?'Short closed':'Long closed'):(r.sell===null?'Unknown':buy?'Buy':'Sell');
    const values=trades?[shortTime(r.tExit),side,number(r.entry,8),number(r.exit,8),signed(r.pnl)]:[shortTime(r.t),side,number(r.price,8),number(r.qty ?? r.usd/r.price,4),number(r.usd,0)];
    values.forEach((v,i)=>tr.append(el('td',v,i===1 && r.sell!==null?(buy?'up':'dn'):undefined)));body.append(tr);
  }
  if(!rows.length)summary(trades?'No closed paper trades.':liqs?'No reported liquidations at this point.':'No trades above the size threshold yet.');
}
const legends={
  heat:[['#70dfc5','Buy print'],['#ef919e','Sell print'],['#f5d981','Liquidation'],['#91acb5','Setup'],['','Resting liquidity']],
  foot:[['#70dfc5','Bid × ask quantity'],['#91acb5','Hover for bar delta'],['#f5d981','Liquidation']],
  get tpo(){return [['#439b91',engine.tpoMs/60000+'-minute TPO visits'],['#5276a6','Session volume profile']];}
};
function drawChart(){
  hits=renderChart($('chart'),engine,view,offset);
}
function render(){
  const live=source==='Live feed', active=engine.vol>0;
  const market=listedMarket(data.market);
  $('marketName').textContent=data.contract || data.symbol;
  $('sourceName').textContent=source==='Demo replay'?'Synthetic session':market?(data.market==='GC'?'COMEX · gold futures':live?'Moomoo · US equities':'US equities'):live?'Binance USDⓈ-M':source;
  $('lastPrice').previousElementSibling.textContent=market?'Last execution · USD':'Last price';
  document.querySelectorAll('.currencyUnit').forEach(el=>el.textContent=market?'USD':'USDT');
  const liqButton=document.querySelector('[data-list="liqs"]');liqButton.hidden=Boolean(market);
  if(market && tape==='liqs') {tape='prints';document.querySelectorAll('[data-list]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.list===tape));}
  renderMarketQuotes(live);
  $('lastPrice').textContent=active?quote(engine.last):'—';
  const change=active?100*(engine.last-firstPrice)/firstPrice:0;
  $('priceChange').textContent=active?signed(change)+'% this session':'Session change';colorMetric($('priceChange'),change);
  $('delta').textContent=active?signed(engine.cvd):'—';colorMetric($('delta'),engine.cvd);
  $('volume').textContent=active?number(engine.vol):'—';$('volumeNote').textContent=number(tradeCount)+' prints'+(market?' · '+market.unit:'')+(engine.unknownVol?' · '+number(engine.unknownVol)+' unclassified':'');
  $('vwap').textContent=active?quote(engine.pv/engine.vol):'—';
  $('liveReadout').hidden=!live;
  const liveStatus=live?liveReadout(Date.now()):'';
  $('modeBadge').textContent=live?liveStatus:source;$('modeBadge').classList.toggle('live',live && liveStatus==='Live');
  $('footerSource').textContent=live?(market?.venue || 'Binance futures')+' · '+liveStatus:source==='Demo replay'?'Synthetic BTCUSDT replay':source+' · '+data.symbol;
  $('sessionDate').textContent=data.events.length?new Date(cursor).toISOString().slice(0,10)+'  ·  UTC':'UTC';
  $('connect').textContent=live?'Disconnect':'Connect live ↗';
  $('play').disabled=$('speed').disabled=$('scrub').disabled=$('restart').disabled=live || !data.events.length;
  $('play').textContent=running?'Ⅱ':'▶';$('play').setAttribute('aria-label',running?'Pause replay':'Play replay');$('play').title=running?'Pause replay':'Play replay';
  const first=data.events[0]?.t || 0,last=data.events.at(-1)?.t || 0;
  $('scrub').value=last>first?(cursor-first)/(last-first)*1000:0;
  $('replayTime').textContent=data.events.length?shortTime(cursor)+' UTC':'—';
  $('legend').replaceChildren(...legends[view].filter(([,name])=>!market || name!=='Liquidation').map(([color,name])=>{
    const tag=el('span'),key=el('b');if(color){key.style.background=color;tag.append(key,name);}else{key.className='ramp';tag.append(name,key);}return tag;
  }));
  showSignals();showBook();showTape();drawChart();dirty=false;
}
function download(content,name,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
for(const [id,d] of [['tools','toolsDialog'],['settings','settingsDialog'],['sourceBtn','filesDialog']]){
  $(id).onclick=()=>$(d).showModal();
}
function setPicker(symbol){
  const picker=$('marketPicker');
  picker.querySelector('[data-custom]')?.remove();
  if(symbol==='GC'){picker.value='';return;}
  if(![...picker.options].some(o=>o.value===symbol)){
    const custom=new Option(symbol+' · Binance',symbol);custom.dataset.custom='1';picker.add(custom);
  }
  picker.value=symbol;
}
$('marketPicker').onchange=()=>{
  if(data.events.length && (data.market!=='GC'||data.contract)){previousSegment={...data,rowSize:engine.o.bucket};$('previousSession').hidden=false;}
  cfg.symbol=$('marketPicker').value;$('symbol').value=cfg.symbol;
  connect();
};
document.querySelectorAll('dialog').forEach(d=>{d.querySelector('.close').onclick=()=>d.close();});
for(const type of setupTypes){
  const label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.value=type;check.checked=true;label.append(check,type);$('botTypes').append(label);
}
$('config').onsubmit=async ev=>{
  ev.preventDefault();
  cfg.symbol=$('symbol').value.trim().toUpperCase();setPicker(cfg.symbol);
  cfg.bigUsd=+$('large').value;cfg.bucket=+$('bucket').value;
  cfg.on=$('botOn').checked;cfg.usd=+$('size').value;cfg.stopPct=+$('stop').value;cfg.targetPct=+$('target').value;cfg.feePct=+$('fee').value;
  cfg.types=Array.from($('botTypes').querySelectorAll(':checked'),i=>i.value);
  cfg.topic=$('topic').value.trim();cfg.desktop=$('notify').checked;
  $('settingsDialog').close();
  if(source==='Live feed' && data.symbol!==cfg.symbol){freezeLive();notice('Current recording stopped. Save the session, then connect to '+cfg.symbol+'.');}
  const saved=cursor;clearEngine();advance(saved);render();
  if(cfg.desktop && (!('Notification' in window) || await Notification.requestPermission()!=='granted')){cfg.desktop=false;$('notify').checked=false;notice('Desktop notification permission is unavailable.');}
};
$('timeframe').onchange=()=>{cfg.barMs=+$('timeframe').value;const t=cursor;clearEngine();advance(t);render();};
$('connect').onclick=()=>{if(source==='Live feed'){freezeLive();render();}else connect();};
$('play').onclick=()=>{
  if(!running&&index===data.events.length){clearEngine();advance(data.events[0].t);}
  running=!running;previousFrame=performance.now();render();
};
$('restart').onclick=()=>{running=false;clearEngine();advance(data.events[0].t);render();};
$('scrub').oninput=()=>{const start=data.events[0].t;seek(start+(data.events.at(-1).t-start)*Number($('scrub').value)/1000);render();};
$('demo').onclick=()=>{$('filesDialog').close();openSession(FlowSession.demo(),'Demo replay',.94);};
$('import').onchange=async ev=>{
  const f=ev.target.files[0];if(!f)return;ev.target.value='';const token=generation;
  try{
    const text=await f.text();const csv=f.name.toLowerCase().endsWith('.csv');
    const csvSymbol=f.name.toUpperCase().match(/^(GC[FGHJKMNQUVXZ](?:\d{4}|\d{1,2}))(?:[-_.]|$)/)?.[1] || cfg.symbol;
    const record=csv?FlowSession.fromCSV(text,csvSymbol):FlowSession.parse(text);
    if(token!==generation)return;
    $('filesDialog').close();openSession(record,csv?'Tick replay':record.synthetic?'Demo replay':'Recorded replay',1);
  }catch(err){$('filesDialog').close();notice('Import failed · '+err.message);}
};
$('exportSession').onclick=()=>{
  if(!data.events.length || data.market==='GC' && !data.contract){$('filesDialog').close();notice('A market recording needs events and a resolved instrument.');return;}
  download(JSON.stringify({...data,rowSize:engine.o.bucket,synthetic:source==='Demo replay'}),(data.contract||data.symbol)+'-session.json','application/json');$('filesDialog').close();
};
$('previousSession').onclick=()=>{
  if(previousSegment) download(JSON.stringify(previousSegment),previousSegment.symbol+'-'+previousSegment.events[0].t+'.json','application/json');
  $('filesDialog').close();
};
$('exportCSV').onclick=()=>{
  const trades=data.events.filter(ev=>ev.type==='trade');$('filesDialog').close();
  if(!trades.length){notice('The session has no trades to export.');return;}
  const lines=trades.map(ev=>[ev.exchangeTime ?? ev.t,ev.price,ev.qty,ev.sell===null?'':ev.sell?1:0].join(','));
  download('time_ms,price,qty,sell\n'+lines.join('\n'),(data.contract||data.symbol)+'-ticks.csv','text/csv');
};
for(const [attr,action] of [['view',v=>{view=v;offset=0;}],['list',v=>{tape=v;}]]){
  const buttons=document.querySelectorAll('[data-'+attr+']');
  buttons.forEach(btn=>btn.onclick=()=>{buttons.forEach(b=>b.setAttribute('aria-pressed',b===btn));action(btn.dataset[attr]);render();});
}
$('chart').onpointermove=ev=>{
  const sel=hits.find(hit=>hit.left<=ev.offsetX&&hit.right>ev.offsetX);
  const hover=$('hover');hover.hidden=!sel;if(!sel)return;
  const b=sel.bar;hover.textContent=shortTime(b.t)+' · O '+number(b.o)+'  H '+number(b.h)+'  L '+number(b.l)+'  C '+number(b.c)+'  Δ '+signed(b.delta);
};
$('chart').onpointerleave=()=>{$('hover').hidden=true;};
$('chart').addEventListener('wheel',ev=>{
  if(!ev.shiftKey&&!ev.deltaX)return;
  ev.preventDefault();offset=Math.max(0,Math.min(engine.bars.length-1,offset+Math.sign(ev.deltaX||ev.deltaY)));drawChart();
},{passive:false});
$('chart').ondblclick=()=>{offset=0;drawChart();};
function frame(now){
  if(running){
    const end=data.events.at(-1).t;
    advance(Math.min(end,cursor+(now-previousFrame)*Number($('speed').value)));
    if(cursor>=end)running=false;
  }
  previousFrame=now;
  if((dirty || source==='Live feed' && now-previousDraw>=1000) && now-previousDraw>240){render();previousDraw=now;}
  requestAnimationFrame(frame);
}
new ResizeObserver(()=>{dirty=true;}).observe($('chart'));
const requestedMarket = new URLSearchParams(location.search).get('market');
if([...$('marketPicker').options].some(option=>option.value===requestedMarket)){
  cfg.symbol=requestedMarket;$('symbol').value=requestedMarket;
}
connect();
requestAnimationFrame(frame);
