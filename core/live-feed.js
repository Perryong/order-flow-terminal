// Each channel reconnects independently. Freshness follows exchange transaction time.
function streamState(channel, now = Date.now()) {
  if (!channel) return 'Connecting';
  if (channel.state !== 'Open') return channel.state;
  if (!channel.exchangeTime) return 'Waiting';
  const age = now - channel.exchangeTime;
  if (age < -2000) return 'Check clock';
  if (age > 5000) return 'Stale';
  if (age > 1500) return 'Delayed';
  return 'Live';
}

function openMarketChannel(url, receive, change) {
  const channel = {state:'Connecting', exchangeTime:0, close};
  let ws, timer, stopped = false, lastMessage = 0;
  function close() {
    stopped = true;
    clearTimeout(timer);
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      ws.close();
    }
  }
  function watch() {
    if (Date.now() - lastMessage >= 30000) ws.close();
    else timer = setTimeout(watch, 5000);
  }
  function connect() {
    if (stopped) return;
    channel.state = 'Connecting'; channel.exchangeTime = 0; change();
    ws = new WebSocket(url);
    lastMessage = Date.now(); timer = setTimeout(watch, 5000);
    ws.onopen = () => {channel.state = 'Open'; change();};
    ws.onmessage = ({data}) => {
      lastMessage = Date.now();
      const message = JSON.parse(data);
      receive(message.data || message, channel);
    };
    ws.onerror = () => {channel.state = 'Unavailable'; change();};
    ws.onclose = () => {
      clearTimeout(timer);
      if (stopped) return;
      channel.state = 'Reconnecting'; change();
      timer = setTimeout(connect, 3000);
    };
  }
  connect();
  return channel;
}

// Keep one minute of aggressor-side volume in fixed memory, including the current second.
function flowWindow() {
  const slots = new Array(60);
  return {
    trade(time, qty, sell) {
      const sec = Math.floor(time/1000), i = sec % 60;
      if (slots[i]?.sec > sec) return;
      if (slots[i]?.sec !== sec) slots[i] = {sec,buy:0,sell:0,unknown:0};
      slots[i][sell === true ? 'sell' : sell === false ? 'buy' : 'unknown'] += qty;
    },
    read(time) {
      const sec = Math.floor(time/1000);
      let buy = 0, sell = 0, unknown = 0;
      for (const slot of slots) if (slot && slot.sec <= sec && sec-slot.sec < 60) {
        buy += slot.buy; sell += slot.sell; unknown += slot.unknown;
      }
      return unknown ? {buy,sell,unknown} : {buy,sell};
    }
  };
}
if (typeof module !== 'undefined') module.exports = {streamState, flowWindow, openMarketChannel};
