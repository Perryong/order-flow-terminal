const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backendConfig}=require('../core/backend.js');
test('local URLs remain same-origin; hosted URLs use only an HTTPS origin',()=>{
 assert.equal(backendConfig().url('/api/spot'),'/api/spot');
 assert.equal(backendConfig('https://mac.example.test/').url('/api/market?symbol=NVDA'),'https://mac.example.test/api/market?symbol=NVDA');
 for(const origin of ['http://192.168.1.2:8791','https://user:secret@mac.test','https://mac.test/path','javascript:alert(1)'])assert.throws(()=>backendConfig(origin));
 assert.throws(()=>backendConfig().url('https://other.test'));
});
const {openCryptoStream}=require('../core/markets.js');
test('Mac crypto stream keeps backfill separate from live health and reports loss of connection',t=>{
 let es;
 const original=global.EventSource;
 t.after(()=>{if(original===undefined)delete global.EventSource;else global.EventSource=original;});
 global.EventSource=class {
  constructor(url){this.url=url;es=this;}
  close(){this.closed=true;}
 };
 const events=[],messages=[];
 const stream=openCryptoStream('BTCUSDT',e=>events.push(e),m=>messages.push(m),'https://mac.test');
 const send=e=>es.onmessage({data:JSON.stringify(e)});
 assert.equal(es.url,'https://mac.test/api/crypto?symbol=BTCUSDT');
 send({type:'trade',symbol:'BTCUSDT',tradeId:1,t:100,price:1,qty:1,sell:false,historical:true});
 assert.equal(stream.channel.exchangeTime,0);
 send({type:'trade',symbol:'ETHUSDT',t:200});assert.equal(events.length,1);
 send({type:'trade',symbol:'BTCUSDT',tradeId:2,t:200,price:1,qty:1,sell:false});
 send({type:'depth',symbol:'BTCUSDT',t:201,bids:[[1,1]],asks:[[2,1]]});
 assert.equal(stream.channel.exchangeTime,200);assert.equal(stream.depth.exchangeTime,201);
 es.onerror();assert.equal(stream.channel.exchangeTime,0);assert.equal(events.at(-1).type,'gap');
 assert.match(messages.at(-1),/Mac data server unavailable/);
 stream.close();assert.equal(es.closed,true);
});
test('SSE reconnect does not replay overlapping Binance aggregate trades',t=>{
 let es;const original=global.EventSource;t.after(()=>{if(original===undefined)delete global.EventSource;else global.EventSource=original;});
 global.EventSource=class {constructor(){es=this;}close(){}};
 const trades=[];
 const stream=openCryptoStream('BTCUSDT',e=>{if(e.type==='trade')trades.push(e);},()=>{},'https://mac.test');
 const send=(tradeId,historical=false)=>es.onmessage({data:JSON.stringify({type:'trade',symbol:'BTCUSDT',tradeId,t:100+tradeId,price:100,qty:7,sell:false,historical})});
 send(10,true);send(11);es.onerror();send(10,true);send(11,true);send(12,true);send(13);send(13);
 assert.deepEqual(trades.map(e=>e.tradeId),[10,11,12,13]);
 assert.equal(stream.channel.exchangeTime,113);
 stream.close();
});
