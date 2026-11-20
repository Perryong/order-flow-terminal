// Executed volume in completed UTC seconds, independent of chart candles and recording segments.
(function(root){
  'use strict';
  function createVolumeProfile(){
    const seconds=new Map(), gaps=new Set();
    let first=null, newest=-Infinity, cache=null, coverageSince=null, awaitingResume=false;
    function invalidate(s){
      if(cache && s*1000>=cache.result.start && s*1000<cache.result.end)cache=null;
    }
    function prune(end){
      const cutoff=end-3600;
      for(const s of seconds.keys())if(s<cutoff)seconds.delete(s);
      for(const s of gaps)if(s<cutoff)gaps.delete(s);
    }
    function trade(t,price,qty){
      if(!Number.isFinite(t)||t<0||!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0)return;
      const s=Math.floor(t/1000);
      if(s<newest-3600)return;
      if(s>newest){newest=s;prune(s);}
      first=first===null?t:Math.min(first,t);
      if(awaitingResume){
        coverageSince=Math.max(coverageSince,t);gaps.add(s);awaitingResume=false;cache=null;
      }
      let prices=seconds.get(s);
      if(!prices){prices=new Map();seconds.set(s,prices);}
      prices.set(price,(prices.get(price)||0)+qty);
      invalidate(s);
    }
    function gap(t){
      if(Number.isFinite(t)&&t>=0){
        gaps.add(Math.floor(t/1000));coverageSince=t;awaitingResume=true;cache=null;
      }
    }
    function read(t,minutes,bucket){
      if(![15,30,60].includes(minutes)||!Number.isFinite(bucket)||bucket<=0||!Number.isFinite(t)||t<0)throw Error('Invalid volume profile range or price row');
      const end=Math.floor(t/1000),start=end-minutes*60,key=end+':'+minutes+':'+bucket;
      if(cache?.key===key)return cache.result;
      prune(end);
      const totals=new Map();
      let last=null;
      for(const [s,prices] of seconds){
        if(s<start||s>=end)continue;
        last=Math.max(last??s,s);
        for(const [price,qty] of prices){
          const idx=Math.floor(price/bucket+1e-9);
          totals.set(idx,(totals.get(idx)||0)+qty);
        }
      }
      const rows=[...totals].sort((a,b)=>a[0]-b[0]).map(([idx,volume])=>({price:idx*bucket,volume}));
      const total=rows.reduce((sum,r)=>sum+r.volume,0);
      const result={rows,total,bucket,start:start*1000,end:end*1000,coverageStart:first===null?null:Math.max(start*1000,first),lastTrade:last===null?null:last*1000,partial:awaitingResume||first===null||Math.max(first,coverageSince??first)>start*1000,hasGap:awaitingResume||[...gaps].some(s=>s>=start&&s<=end),poc:null,val:null,vah:null,valueVolume:0};
      if(rows.length){
        let poc=0;
        rows.forEach((r,i)=>{if(r.volume>rows[poc].volume)poc=i;});
        let lo=poc,hi=poc,volume=rows[poc].volume;
        // Include the higher-volume neighboring traded row; ties choose the lower price.
        while(volume<total*.7 && (lo>0||hi<rows.length-1)){
          if(lo>0 && (hi===rows.length-1||rows[lo-1].volume>=rows[hi+1].volume))volume+=rows[--lo].volume;
          else volume+=rows[++hi].volume;
        }
        Object.assign(result,{poc:rows[poc].price+bucket/2,val:rows[lo].price,vah:rows[hi].price+bucket,valueVolume:volume});
      }
      cache={key,result};return result;
    }
    return {trade,gap,read};
  }
  if(typeof module==='object'&&module.exports)module.exports={createVolumeProfile};
  else root.createVolumeProfile=createVolumeProfile;
})(typeof globalThis==='object'?globalThis:this);
