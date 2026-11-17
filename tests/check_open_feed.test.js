const {test}=require('node:test');
const assert=require('node:assert/strict');
const {usableBook}=require('../scripts/check_open_feed.js');
test('market-open proof requires multiple ordered live levels on both sides',()=>{
  const bids=[[100,1],[99,2]],asks=[[101,4],[102,2]];
  assert.ok(usableBook({bids,asks}));
  for(const invalid of [{bids:[],asks},{bids:bids.slice(0,1),asks},{bids,asks:bids},{bids,asks:[...asks].reverse()}])
    assert.equal(usableBook(invalid),false);
});
test('Moomoo local receipt does not establish source freshness',()=>{
  const {openVenueStream}=require('../core/markets.js');
  let source;
  global.EventSource=class { constructor(){source=this;} close(){} };
  try {
    const events=[];
    const live=openVenueStream('INTC',event=>events.push(event),()=>{});
    const push=ev=>source.onmessage({data:JSON.stringify({dataset:'Moomoo US',symbol:'INTC',...ev})});
    push({type:'instrument',contract:'INTC'});
    push({type:'depth',t:200,timeBasis:'local receipt'});
    assert.equal(events.length,2);
    assert.equal(live.depth.state,'Source time unavailable');
    assert.equal(live.depth.exchangeTime,0);
    push({type:'trade',t:220});
    assert.equal(live.depth.state,'Source time unavailable');
    push({type:'depth',t:240,timeBasis:'Moomoo server receipt'});
    assert.equal(live.depth.exchangeTime,240);
  } finally {delete global.EventSource;}
});
