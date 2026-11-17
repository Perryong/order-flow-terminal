const {test} = require('node:test');
const assert = require('node:assert/strict');
const {streamState, flowWindow} = require('../core/live-feed.js');
test('a silent socket and an old event cannot report a live feed', () => {
  const channel = {state:'Open',exchangeTime:100000};
  assert.equal(streamState(channel,100100),'Live');
  assert.equal(streamState(channel,103000),'Delayed');
  assert.equal(streamState(channel,106000),'Stale');
  assert.equal(streamState({...channel,state:'Reconnecting'},100100),'Reconnecting');
  assert.equal(streamState(channel,95000),'Check clock');
});
test('minute analysis expires trades even when no new trade arrives', () => {
  const flow=flowWindow();
  flow.trade(100000,2,false);flow.trade(159010,5,true);
  assert.deepEqual(flow.read(159900),{buy:2,sell:5});
  assert.deepEqual(flow.read(160000),{buy:0,sell:5});
  flow.trade(160000,3,false);flow.trade(100900,9,true);
  assert.deepEqual(flow.read(160100),{buy:3,sell:5});
});
test('minute delta excludes trades whose aggressor was not provided', () => {
  const flow=flowWindow();
  flow.trade(10000,3,null);flow.trade(10000,2,false);flow.trade(10000,1,true);
  assert.deepEqual(flow.read(10000),{buy:2,sell:1,unknown:3});
});
