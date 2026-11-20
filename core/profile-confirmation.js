// Display-only confluence. A frozen level test must precede a fresh directional flow signal.
(function(root){
  'use strict';
  const makeFlow=typeof module==='object'&&module.exports?require('./live-feed.js').flowWindow:root.flowWindow;
  function createProfileScanner(){
    let flow=makeFlow(),lastTrade=null,lastDepth=null;
    const candidates=new Map(),cooldowns=new Map(),seen=new Set(),confirmed=[];
    function status(now,profile,minutes,fresh=true){
      if(!profile || profile.partial)return 'Building '+minutes+'-minute profile · partial history';
      if(profile.hasGap)return 'Waiting for a profile without recorded feed gaps';
      if(profile.rows.length<3 || !profile.total)return 'Waiting for volume across at least three price rows';
      if(!fresh || !lastTrade || !lastDepth || [lastTrade,lastDepth].some(e=>e.timeBasis==='local receipt'||now-e.time<0||now-e.time>1500))return 'Waiting for fresh provider-timed trades and depth';
      return 'Ready · waiting for a level test and aligned order flow';
    }
    function process(ev,context){
      const {profile,minutes,signals=[],live=false,fresh=true,now=ev.t}=context;
      const time=ev.exchangeTime??ev.t,clock=live?now:ev.t;
      if(ev.type==='gap'){
        candidates.clear();flow=makeFlow();lastTrade=lastDepth=null;return [];
      }
      if(ev.type!=='trade' && ev.type!=='depth')return [];
      const previous=lastTrade;
      if(ev.type==='trade'){
        flow.trade(time,ev.qty,ev.sell);
        if(lastTrade && time<lastTrade.time)return [];
        lastTrade={time,price:ev.price,timeBasis:ev.timeBasis};
      }else{
        if(lastDepth && time<lastDepth.time)return [];
        lastDepth=ev.bids?.length && ev.asks?.length && ev.bids[0][0]<ev.asks[0][0]?{time,timeBasis:ev.timeBasis}:null;
      }
      if(!status(clock,profile,minutes,!live||fresh).startsWith('Ready')){candidates.clear();return [];}
      const price=lastTrade.price;
      for(const [name,c] of candidates){
        if(clock-c.t>60000 || Math.abs(price-c.levelPrice)>3*c.bucket)candidates.delete(name);
      }
      if(ev.type==='trade')for(const name of ['val','poc','vah']){
        const levelPrice=profile[name];
        if(!candidates.has(name) && Math.abs(price-levelPrice)<=profile.bucket){
          candidates.set(name,{t:clock,levelPrice,bucket:profile.bucket,approach:previous?Math.sign(previous.price-levelPrice):0,levels:{poc:profile.poc,vah:profile.vah,val:profile.val}});
        }
      }
      const volume=flow.read(clock),delta=volume.buy-volume.sell,out=[];
      for(const signal of signals){
        const id=[signal.t,signal.type,signal.dir,signal.price].join(':');
        if(seen.has(id))continue;
        seen.add(id);if(seen.size>1000)seen.delete(seen.values().next().value);
        if(![1,-1].includes(signal.dir) || !['sweep','absorption','exhaustion','iceberg'].includes(signal.type) || clock-signal.t<0 || clock-signal.t>5000 || volume.unknown || delta*signal.dir<=0)continue;
        const matches=[...candidates].filter(([name,c])=>
          clock>c.t && signal.t>=c.t && signal.dir*(price-c.levelPrice)>=c.bucket && Math.abs(price-c.levelPrice)<=3*c.bucket &&
          (!cooldowns.has(name+':'+signal.dir) || clock-cooldowns.get(name+':'+signal.dir)>=60000)
        ).sort((a,b)=>Math.abs(price-a[1].levelPrice)-Math.abs(price-b[1].levelPrice));
        if(!matches.length)continue;
        const [name,c]=matches[0],dir=signal.dir;
        const action=dir>0?(c.approach<0?(name==='vah'?'breakout':'reclaim'):'hold'):(c.approach>0?'breakdown':'rejection');
        const entry={t:clock,price,dir,level:name.toUpperCase(),levelPrice:c.levelPrice,levels:{...c.levels},range:minutes,bucket:c.bucket,touchTime:c.t,action,delta,flow:{...signal},mode:live?'Live':'Replay'};
        confirmed.push(entry);if(confirmed.length>200)confirmed.shift();out.push(entry);
        cooldowns.set(name+':'+dir,clock);candidates.delete(name);
      }
      return out;
    }
    return {process,status,confirmed};
  }
  if(typeof module==='object'&&module.exports)module.exports={createProfileScanner};
  else root.createProfileScanner=createProfileScanner;
})(typeof globalThis==='object'?globalThis:this);
