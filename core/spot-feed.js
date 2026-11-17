// XAU/USD pricing from the configured same-origin provider.
// The source timestamp and latest spot price are preserved during market closures.
function spotFeedStatus(quote, now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday').value;
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const weekend = weekday === 'Sat' || weekday === 'Fri' && hour >= 17 || weekday === 'Sun' && hour < 18;
  const dailyBreak = hour === 17 && !['Fri', 'Sat', 'Sun'].includes(weekday);
  const publicFeed = quote.provider === 'goldprice.dev';
  const maxAge = publicFeed ? 20 * 60000 : 30000;
  let condition = publicFeed ? '15 min delayed' : quote.provider === 'Gold-API.com' ? 'Spot price' : 'Bid/ask midpoint';
  if (quote.cached) condition += ' · cached, provider unavailable';
  else if (publicFeed && weekend) condition += ' · weekend closure';
  else if (publicFeed && dailyBreak) condition += ' · daily break';
  else if (quote.tradeable === false) condition += ' · non-tradeable';
  else if (quote.stale || now - quote.t > maxAge) condition += ' · stale';
  const time = new Date(quote.t).toISOString().slice(0, 19).replace('T', ' ');
  return quote.provider + ' · ' + condition + ' · ' + time + ' UTC';
}

function openSpotFeed(onQuote, onStatus) {
  let closed = false, timer = null, previous = null, interval = 60000;
  const controller = new AbortController();

  async function poll() {
    try {
      const response = await fetch('/api/spot', {signal: controller.signal, cache: 'no-store'});
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'HTTP ' + response.status);
      }
      const quote = await response.json();
      if (closed) return;
      const oanda = ['OANDA practice', 'OANDA live'].includes(quote.provider);
      if (quote.type !== 'spot' || (!oanda && quote.provider !== 'Gold-API.com' && quote.provider !== 'goldprice.dev') || !Number.isSafeInteger(quote.t)
          || quote.t <= 0 || quote.t > Date.now() + 30000 || !Number.isFinite(quote.price) || quote.price <= 0
          || (oanda && !(Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && 0 < quote.bid && quote.bid <= quote.ask))
          || (previous && quote.provider === previous.provider && quote.t < previous.t)) throw new Error('Invalid source quote');
      interval = quote.cached ? 60000 : oanda ? 2000 : quote.provider === 'Gold-API.com' ? 10000 : 60000;
      if (!previous || quote.provider !== previous.provider || quote.t !== previous.t || quote.price !== previous.price
          || quote.bid !== previous.bid || quote.ask !== previous.ask) {
        onQuote({...(oanda ? {bid: quote.bid, ask: quote.ask} : {}), type: 'spot', t: quote.t, price: quote.price, provider: quote.provider});
      }
      previous = quote;
      onStatus(spotFeedStatus(quote));
    } catch (error) {
      interval = 60000;
      if (!closed) {
        onStatus(previous ? spotFeedStatus({...previous, cached: true})
          : 'Spot unavailable · ' + error.message);
      }
    } finally {
      if (!closed) timer = setTimeout(poll, interval);
    }
  }

  onStatus('Connecting');
  poll();
  return {close() { closed = true; controller.abort(); clearTimeout(timer); }};
}

if (typeof module !== 'undefined') module.exports = {openSpotFeed, spotFeedStatus};
