'use strict';

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 4});
const labels = {bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral'};
const marketButtons = document.querySelectorAll('[data-symbol]');
const formatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  second: '2-digit', hourCycle: 'h23', timeZone: 'UTC'
});
let symbol = new URLSearchParams(location.search).get('market');
if (!symbols.includes(symbol)) symbol = symbols[0];
let snapshot = null;
let problem = '';
let loading = true;
let chartContext = null;

function price(value) { return Number.isFinite(value) ? number.format(value) : '—'; }
function time(value) { return Number.isFinite(value) && value > 0 ? formatter.format(value) + ' UTC' : '—'; }
function tone(element, direction) {
  element.classList.toggle('up', direction === 'bullish');
  element.classList.toggle('dn', direction === 'bearish');
}

function paintChart() {
  const canvas = $('dailyChart');
  const bars = chartContext?.candles?.slice(-60) || [];
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  $('chartEmpty').hidden = bars.length > 0;
  if (!bars.length || !width || !height) return;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const left = 4, right = width - 76, top = 13, bottom = height - 25;
  const levels = [[chartContext.support, '#70e6d0'], [chartContext.resistance, '#ff9097']];
  const levelsInChart = levels.filter(([p]) => Number.isFinite(p));
  const low = Math.min(...bars.map(b => b.l), ...levelsInChart.map(([p]) => p));
  const high = Math.max(...bars.map(b => b.h), ...levelsInChart.map(([p]) => p));
  const pad = Math.max((high - low) * .06, high / 10000);
  const y = p => top + (high + pad - p) / (high - low + 2 * pad) * (bottom - top);
  const step = (right - left) / bars.length;
  function line(x1, y1, x2, y2, color) {
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.font = '10px ui-monospace, monospace';
  for (let i = 0; i < 4; i++) {
    const p = high - (high - low) * i / 3;
    line(left, y(p), right, y(p), '#26323b');
    ctx.fillStyle = '#a6b4bd'; ctx.fillText(price(p), right + 6, y(p) + 3);
  }
  bars.forEach((b, i) => {
    const center = left + (i + .5) * step;
    const color = b.c >= b.o ? '#70cbb6' : '#de919b';
    line(center, y(b.h), center, y(b.l), color);
    ctx.fillStyle = color;
    ctx.fillRect(center - step * .28, Math.min(y(b.c), y(b.o)), step * .56, Math.max(1.3, Math.abs(y(b.c) - y(b.o))));
  });
  ctx.setLineDash([5, 4]);
  for (const [p, color] of levelsInChart) line(left, y(p), right, y(p), color);
  ctx.setLineDash([]);
  ctx.fillStyle = '#9eacb7';
  for (const i of [0, Math.floor(bars.length / 2), bars.length - 1]) {
    const date = new Date(bars[i].t).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', timeZone: 'UTC'});
    ctx.textAlign = i === 0 ? 'left' : i === bars.length - 1 ? 'right' : 'center';
    ctx.fillText(date, left + (i + .5) * step, height - 6);
  }
}

function render() {
  const now = Date.now(), row = snapshot?.swing?.[symbol];
  const daily = row?.context, checked = snapshot?.checked;
  const watcherFresh = !problem && now >= checked - 500 && now - checked <= 15000;
  const contextFresh = !!daily && now < daily.expiresAt;
  const health = snapshot?.health?.[symbol];
  const freshAtSample = t => Number.isFinite(t) && checked - t >= -500 && checked - t <= 1500;
  const freshFlow = watcherFresh && freshAtSample(health?.trade) && freshAtSample(health?.depth);
  for (const button of marketButtons) {
    const key = button.dataset.symbol;
    button.setAttribute('aria-pressed', String(key === symbol));
    const ctx = snapshot?.swing?.[key]?.context;
    const trend = ctx && ctx.expiresAt > now ? ctx.trend : '';
    const span = button.querySelector('span');
    span.textContent = labels[trend] || '';
    tone(span, trend);
  }
  $('watcherStatus').textContent = loading ? 'Connecting to watcher' :
    problem ? 'Watcher unavailable' : watcherFresh ? 'Watcher online' : 'Watcher data stale';
  $('watcherStatus').classList.toggle('healthy', watcherFresh);
  $('dailyHeading').textContent = symbol + ' daily chart';
  $('terminalLink').href = '/?market=' + symbol;
  $('trend').textContent = daily ? (labels[daily.trend] || 'Unavailable') + (contextFresh ? '' : ' · stale') : 'Awaiting candles';
  tone($('trend'), contextFresh ? daily.trend : '');
  $('lastPrice').textContent = price(row?.price);
  $('lastTradeTime').textContent = row?.priceTime ? time(row.priceTime) : '';
  for (const key of ['support', 'resistance', 'sma20', 'sma50', 'tolerance']) $(key).textContent = price(daily?.[key]);
  $('dailyClose').textContent = price(daily?.close);
  $('dailyTime').textContent = daily ? 'Daily close · ' + time(daily.asOf) : 'Daily close unavailable';
  $('dailyStatus').textContent = row?.error || (daily ? 'Confirmation distance is one quarter of the 14-day average true range.' : 'Waiting for the last completed UTC session.');
  $('flowStatus').textContent = freshFlow ? 'Flow fresh at ' + time(checked).split(', ').pop() :
    watcherFresh ? 'Waiting for fresh trades and depth' : 'Flow unverified';
  const direction = daily?.trend;
  const long = direction === 'bullish', level = long ? daily?.support : daily?.resistance;
  if (!watcherFresh) $('watchCondition').textContent = loading ? 'Connecting to the live watcher.' : 'Live confirmation is unavailable until the watcher updates.';
  else if (!contextFresh) $('watchCondition').textContent = 'Waiting for current daily candles.';
  else if (direction === 'neutral') $('watchCondition').textContent = 'Standing by while the daily trend is neutral.';
  else if (!Number.isFinite(level)) $('watchCondition').textContent = 'Waiting for a qualifying daily level.';
  else $('watchCondition').textContent = 'Watching for ' + (long ? 'long flow near support at ' : 'short flow near resistance at ') + price(level) + ' USDT.';
  const last = row?.lastConfirmation;
  $('lastConfirmation').textContent = last ? (last.dir > 0 ? 'LONG' : 'SHORT') + ' · ' + last.type + ' at ' + price(last.price) + ' USDT' :
    row ? 'No swing confirmation recorded.' : 'Awaiting watcher';
  tone($('lastConfirmation'), last ? last.dir > 0 ? 'bullish' : 'bearish' : '');
  $('confirmationDetails').textContent = last ? last.note + ' · ' + (last.dir > 0 ? 'Support ' : 'Resistance ') + price(last.level) + ' · ' + time(last.t) : '';
  chartContext = daily;
  paintChart();
}

async function refresh() {
  try {
    const response = await fetch('/api/swing', {cache: 'no-store', signal: AbortSignal.timeout(6000)});
    if (!response.ok) throw Error('Watcher unavailable');
    const next = await response.json();
    if (!Number.isFinite(next.checked) || !next.swing) throw Error('Waiting for swing data');
    snapshot = next;
    problem = '';
  } catch (error) { problem = error.message; }
  loading = false;
  render();
  setTimeout(refresh, 4000);
}

for (const button of marketButtons) {
  button.addEventListener('click', () => {
    symbol = button.dataset.symbol;
    const url = new URL(location.href);
    url.searchParams.set('market', symbol);
    history.replaceState(null, '', url);
    render();
  });
}
new ResizeObserver(paintChart).observe($('dailyChart').parentElement);
render();
refresh();
