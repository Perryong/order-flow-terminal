// Each view is painted from the engine state at the replay cursor.
function renderChart(canvas, e, view, offset = 0, profile = null) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(W*dpr) || canvas.height !== Math.round(H*dpr)) {
    canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle = '#0c131c'; ctx.fillRect(0,0,W,H);
  ctx.font = '10px Menlo, monospace'; ctx.textBaseline = 'middle';
  const ink = '#9cabb8', up = '#7de5c7', down = '#fd919d';
  const profileWidth=profile && view!=='tpo'?Math.min(165,Math.max(95,W*.2)):0;
  const width = W-76-profileWidth, top = 13, bottom = H-40, bucket=e.o.bucket;
  const label = (value,x,y,color=ink,align='left') => {
    ctx.fillStyle=color; ctx.textAlign=align; ctx.fillText(value,x,y);
  };
  const line = (x1,y1,x2,y2,color) => {
    ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  };
  if (!e.bars.length || width<1) {label('Waiting for trade data',W/2,H/2,ink,'center');return [];}
  const count = Math.max(2,Math.floor(width/(view==='foot'?88:12)));
  const end=Math.max(1,e.bars.length-offset);
  const bars=e.bars.slice(Math.max(0,end-count),end);
  const step=width/(view==='foot'?Math.max(1,count):Math.max(8,bars.length));
  const time=t=>new Date(t).toISOString().slice(11,16);
  const price=n=>n.toLocaleString('en-US',{maximumFractionDigits:Math.min(8,Math.max(2,Math.ceil(-Math.log10(bucket))))});
  const quantity=n=>n>=1000?(n/1000).toFixed(1)+'k':n>=10?n.toFixed(0):n.toFixed(1);
  const barIndex = new Map(bars.map((b,i)=>[b.t,i]));
  const eventX=t=>{
    const start=Math.floor(t/e.o.barMs)*e.o.barMs, index=barIndex.get(start);
    return index===undefined?-999:(index+(t-start)/e.o.barMs)*step;
  };
  if(view==='tpo'){
    const entries=[...e.tpo].sort((a,b)=>b[0]-a[0]);
    const bin=Math.max(1,Math.ceil(entries.length/Math.max(1,Math.floor((bottom-top)/15))));
    let maxT=0,maxV=0;
    const groups=[];
    for(let i=0;i<entries.length;i+=bin){
      const part=entries.slice(i,i+bin);
      const volume=part.reduce((s,[idx])=>s+e.profile.get(idx),0);
      const periods=part.reduce((s,[,n])=>s+n,0);
      groups.push({price:part[0][0]*bucket,volume,periods});maxT=Math.max(maxT,periods);maxV=Math.max(maxV,volume);
    }
    const mid=W*.50, h=(bottom-top)/Math.max(1,groups.length);
    groups.forEach((g,i)=>{
      const y=top+i*h, barHeight=Math.max(1,h-2);
      ctx.fillStyle='#439b91';ctx.fillRect(6,y,(mid-50)*g.periods/maxT,barHeight);
      ctx.fillStyle='#5276a6';ctx.fillRect(mid,y,(width-mid)*g.volume/maxV,barHeight);
      label(String(g.periods),mid-12,y+h/2,ink,'right');label(price(g.price),width+5,y+h/2);
    });
    label(bin>1?'TPO visits · grouped price rows':e.tpoMs/60000+'-minute TPO count',8,H-16);label('Traded volume',mid,H-16);
    return [];
  }
  let low=Math.min(...bars.map(b=>b.l)), high=Math.max(...bars.map(b=>b.h));
  if(profile?.rows.length && view!=='foot'){
    low=Math.min(low,profile.rows[0].price);
    high=Math.max(high,profile.rows.at(-1).price+bucket);
  }
  const padding=Math.max(bucket*1.5,(high-low)*0.16);
  low-=padding; high+=padding;
  if(view==='foot'){
    // Size text for the current price row. Move along the chart with Shift + scroll.
    const center=Math.floor((bars.at(-1).c)/bucket);
    const rows=Math.max(3,Math.floor((bottom-top)/17));
    low=(center-Math.floor(rows/2))*bucket;high=low+rows*bucket;
  }
  const y=p=>bottom-(p-low)/(high-low)*(bottom-top);
  const rowH=(bottom-top)*bucket/(high-low);
  const palette=['#152238','#1d304b','#263c5e','#2d4a70','#355a7a','#3d6b82','#43858a','#58998d','#8ab28c','#ccbd70'];
  ctx.save();ctx.beginPath();ctx.rect(0,top,width,bottom-top);ctx.clip();
  if(view==='heat'){
    const heat=e.heat.filter(s=>eventX(s.t)>=0);
    let max=0;
    for(const s of heat)for(const [idx,v] of s.levels)if(idx*bucket>=low-bucket&&idx*bucket<=high)max=Math.max(max,v);
    heat.forEach((s,i)=>{
      const x=eventX(s.t),next=heat[i+1];
      const w=next?Math.min(eventX(next.t)-x,step*Math.max(1,30000/e.o.barMs)):Math.min(step,width-x);
      for(const [idx,v] of s.levels){
        const py=y((idx+1)*bucket);
        if(py>bottom||py+rowH<top)continue;
        ctx.fillStyle=palette[Math.min(9,Math.floor(Math.sqrt(v/max)*9.8))];ctx.fillRect(x,py,Math.max(1,w+.4),Math.max(1,rowH-.6));
      }
    });
  }
  for(let i=0;i<=5;i++){const py=top+(bottom-top)*i/5;line(0,py,width,py,'#8296ac20');}
  bars.forEach((b,i)=>{
    const x=(i+.5)*step;
    if(view==='foot'){
      let maximum=1;
      for(const [bid,ask,unknown=0] of b.cells.values())maximum=Math.max(maximum,bid+ask+unknown);
      for(const [idx,[sell,buy,unknown=0]] of b.cells){
        const py=y((idx+1)*bucket);
        if(py+rowH<top||py>bottom)continue;
        ctx.fillStyle='rgba('+(unknown && !buy && !sell?'135,149,164':buy>=sell?'70,189,157':'218,103,122')+','+(.13+.42*(sell+buy+unknown)/maximum)+')';
        ctx.fillRect(i*step+5,py+1,step-7,rowH-2);
        label(quantity(sell)+' × '+quantity(buy),x+2,py+rowH/2,'#e0e7eb','center');
      }
    }
    const cx=view==='foot'?i*step+2:x,c=b.c>=b.o?up:down;
    line(cx,y(b.l),cx,y(b.h),c);ctx.fillStyle=c;
    const body=view==='foot'?3:Math.max(2,step*.45);
    ctx.fillRect(cx-body/2,Math.min(y(b.c),y(b.o)),body,Math.max(1.4,Math.abs(y(b.c)-y(b.o))));
  });
  if(view==='heat'){
    for(const p of e.prints){
      const x=eventX(p.t);
      if(x<0)continue;
      ctx.beginPath();ctx.arc(x,y(p.price),Math.min(12,Math.sqrt(p.usd/e.o.bigUsd)*2.4),0,Math.PI*2);
      ctx.fillStyle=p.sell===null?'#b9c3d3a0':p.sell?'#f48a9694':'#70dfc58f';ctx.fill();
    }
  }
  for(const p of e.liqs) {const x=eventX(p.t);if(x>=0)label('◇',x,y(p.price),'#ffe28c','center');}
  for(const s of e.signals){const x=eventX(s.t);if(x>=0)label(s.dir>0?'▲':'▼',x,y(s.price)+(s.dir>0?8:-8),s.dir>0?up:down,'center');}
  const last=bars.at(-1).c;
  ctx.setLineDash([3,4]);line(0,y(last),width,y(last),'#a5bdbc9c');ctx.setLineDash([]);
  ctx.restore();
  if(view==='foot'){
    for(let i=0;i<Math.round((bottom-top)/rowH);i++){const p=low+i*bucket;label(price(p),width+6,y(p+bucket/2));}
  }else{
    for(let i=0;i<=5;i++)label(price(high-i*(high-low)/5),width+6,top+(bottom-top)*i/5);
  }
  ctx.fillStyle='#8bdeca';ctx.fillRect(width,y(last)-8,75,16);label(price(last),width+6,y(last),'#112723');
  if(profileWidth){
    const left=width+76,right=W-5;
    ctx.fillStyle='#101d2a';ctx.fillRect(left,top,profileWidth,bottom-top);
    ctx.save();ctx.beginPath();ctx.rect(left,top,profileWidth,bottom-top);ctx.clip();
    // Merge subpixel rows for drawing only; POC/value area retain the configured price rows.
    const pixels=new Map(),pixelHeight=Math.max(1,rowH-.5);
    for(const r of profile.rows){
      const py=Math.floor(y(r.price+bucket));
      if(py>bottom || py+rowH<top)continue;
      const entry=pixels.get(py)||{volume:0,value:false};
      entry.volume+=r.volume;entry.value ||= r.price>=profile.val && r.price<profile.vah;pixels.set(py,entry);
    }
    const max=Math.max(1,...[...pixels.values()].map(r=>r.volume));
    for(const [py,r] of pixels){
      ctx.fillStyle=r.value?'#529dd1':'#31536d';
      ctx.fillRect(left+3,py,(profileWidth-12)*r.volume/max,pixelHeight);
    }
    ctx.restore();
    const levels=[['POC',profile.poc,'#ff929c'],['VAH',profile.vah,'#f2d282'],['VAL',profile.val,'#f2d282']];
    for(const [,p,c] of levels){
      if(p===null || y(p)<top || y(p)>bottom)continue;
      ctx.setLineDash([5,4]);line(0,y(p),width,y(p),c);ctx.setLineDash([]);
      line(left,y(p),right,y(p),c);
    }
    let labelY=top-14;
    for(const [name,p,c] of levels.filter(([,p])=>p!==null && y(p)>=top && y(p)<=bottom).sort((a,b)=>b[1]-a[1])){
      labelY=Math.max(labelY+14,Math.min(bottom-7,y(p)));
      ctx.fillStyle='#101d2aeb';ctx.fillRect(left+3,labelY-7,profileWidth-6,14);
      label(name+' '+price(p),left+5,labelY,c);
    }
    label('Volume',left+5,H-10);
  }
  const maxVol=Math.max(...bars.map(b=>b.vol),1);
  bars.forEach((b,i)=>{
    const h=12*b.vol/maxVol;ctx.fillStyle=b.delta>=0?'#50988c':'#ae6d7e';ctx.fillRect(i*step+1,H-21-h,Math.max(1,step-2),h);
    if(i%Math.max(1,Math.ceil(57/step))===0)label(time(b.t),i*step+2,H-10);
  });
  return bars.map((b,i)=>({bar:b,left:i*step,right:(i+1)*step}));
}
