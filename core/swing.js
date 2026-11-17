// Daily context for Binance USDⓈ-M perpetuals. All session boundaries are UTC.
const DAY = 86_400_000;
const COOLDOWN = 15 * 60_000;

function dailyContext(rows, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY;
  const candles = rows.filter(row => row[0] < today).slice(-90).map(row => {
    const [t, open, high, low, close] = row;
    const o = Number(open), h = Number(high), l = Number(low), c = Number(close);
    if (!Number.isSafeInteger(t) || t % DAY !== 0 || row[6] !== t + DAY - 1 ||
        ![o,h,l,c].every(n => Number.isFinite(n) && n > 0) ||
        l > Math.min(o,c) || h < Math.max(o,c)) {
      throw new Error('Invalid Binance daily candle');
    }
    return {t,o,h,l,c};
  });
  if (candles.length < 50 || candles.at(-1).t !== today - DAY ||
      candles.some((bar,i) => i && bar.t !== candles[i-1].t + DAY)) {
    throw new Error('Waiting for consecutive completed UTC daily candles');
  }
  const close = candles.at(-1).c;
  const meanClose = n => candles.slice(-n).reduce((sum,bar) => sum + bar.c, 0) / n;
  const sma20 = meanClose(20), sma50 = meanClose(50);
  let trend = 'neutral';
  if (close > sma20 && sma20 > sma50) trend = 'bullish';
  if (close < sma20 && sma20 < sma50) trend = 'bearish';

  let support = null, resistance = null, trueRangeSum = 0;
  for (let i = 0; i < candles.length; i++) {
    const {h,l} = candles[i];
    if (i >= candles.length - 14) {
      const priorClose = candles[i-1].c;
      trueRangeSum += Math.max(h,priorClose) - Math.min(l,priorClose);
    }
    if (i < 2 || i + 2 >= candles.length) continue;
    const others = [candles[i-2],candles[i-1],candles[i+1],candles[i+2]];
    if (l < close && others.every(bar => l < bar.l)) support = Math.max(support ?? l,l);
    if (h > close && others.every(bar => h > bar.h)) resistance = Math.min(resistance ?? h,h);
  }
  const recent = candles.slice(-20);
  if (support === null) {
    const low = Math.min(...recent.map(bar => bar.l));
    if (low < close) support = low;
  }
  if (resistance === null) {
    const high = Math.max(...recent.map(bar => bar.h));
    if (high > close) resistance = high;
  }
  const atr14 = trueRangeSum / 14;
  return {trend,asOf:today-1,expiresAt:today+DAY,close,sma20,sma50,atr14,
          support,resistance,tolerance:atr14/4,candles};
}

async function fetchDailyContext(symbol) {
  const url = new URL('https://fapi.binance.com/fapi/v1/klines');
  url.search = new URLSearchParams({symbol,interval:'1d',limit:'91'}).toString();
  const response = await fetch(url,{signal:AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error('Binance daily candles returned HTTP ' + response.status);
  return dailyContext(await response.json());
}

function confirmSwing(context, signal, lastConfirmation, now = Date.now()) {
  if (!context || now >= context.expiresAt || signal.t <= context.asOf ||
      now - signal.t > 1500 || signal.t - now > 500) return null;
  const long = signal.dir === 1;
  if (!long && signal.dir !== -1) return null;
  if (context.trend !== (long ? 'bullish' : 'bearish')) return null;
  const level = long ? context.support : context.resistance;
  if (level === null || !Number.isFinite(signal.price) || context.tolerance <= 0 ||
      signal.price < level - context.tolerance || signal.price > level + context.tolerance) return null;
  if (lastConfirmation?.dir === signal.dir && signal.t - lastConfirmation.t < COOLDOWN) return null;
  const {t,type,dir,price,note} = signal;
  return {t,type,dir,price,note,level,trend:context.trend};
}

module.exports = {dailyContext,fetchDailyContext,confirmSwing};
