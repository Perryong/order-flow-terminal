// Each symbol tracks one alerted setup per timeframe. All prices are observations.
const utcDay = t => Math.floor(t / 86_400_000);
const side = dir => dir === 1 ? 'LONG' : 'SHORT';

function closeSetup(state, mode, price, t, reason) {
  const entry = state[mode];
  state[mode] = null;
  const exit = {mode:mode.toUpperCase(), dir:entry.dir, entryTime:entry.t, entryPrice:entry.price, price, t, reason};
  state.lastExit ??= {};
  state.lastExit[mode] = exit;
  return exit;
}

function trackSignal(state, signal, swing, context) {
  const exits = [];
  const {dir, price, t} = signal;
  function open(mode, extra = {}) {
    const active = state[mode];
    if (active?.dir === dir || t <= (active?.t ?? state.lastExit?.[mode]?.t ?? 0)) return;
    if (active) {
      exits.push(closeSetup(state, mode, price, t,
        'opposing ' + side(dir) + ' ' + signal.type + ' · ' + signal.note));
    }
    state[mode] = {dir, price, t, ...extra};
  }
  open('day');
  if (swing) {
    const target = dir === 1 ? context.resistance : context.support;
    open('swing', {
      boundary: swing.level - dir * context.tolerance,
      target: Number.isFinite(target) && dir * (target - price) > 0 ? target : null
    });
  }
  return exits;
}

function trackTrade(state, price, t, context) {
  const exits = [];
  if (state.day && utcDay(t) > utcDay(state.day.t)) {
    exits.push(closeSetup(state, 'day', price, t, 'first live trade in a new UTC day'));
  }
  const setup = state.swing;
  if (!setup || t <= setup.t) return exits;
  const {dir, boundary, target} = setup;
  let reason;
  if (dir * (price - boundary) < 0) {
    reason = (dir === 1 ? 'below support' : 'above resistance') + ' zone edge ' + Number(boundary.toFixed(8));
  } else if (target !== null && dir * (price - target) >= 0) {
    reason = 'reached daily ' + (dir === 1 ? 'resistance' : 'support') + ' target ' + target;
  } else if (context && t > context.asOf && t < context.expiresAt && context.trend !== (dir === 1 ? 'bullish' : 'bearish')) {
    reason = 'completed daily trend is now ' + context.trend;
  }
  if (reason) exits.push(closeSetup(state, 'swing', price, t, reason));
  return exits;
}

function exitText(symbol, exit) {
  const time = new Date(exit.t).toISOString().slice(11,19);
  return exit.mode + ' EXIT ' + side(exit.dir) + ' · ' + symbol + ' @ ' + exit.price +
    ' USDT · ' + exit.reason + ' · setup @ ' + exit.entryPrice + ' · ' + time + ' UTC';
}

module.exports = {trackSignal, trackTrade, exitText};
