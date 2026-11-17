# Tapescope order flow terminal

Tapescope shows where trades actually occurred and how much liquidity was displayed at nearby prices. Its long and short alerts describe detected order flow. The crypto Mac watcher also alerts when a tracked day or swing setup ends. The browser and Mac watchers read market data. The optional browser paper strategy simulates entries and exits.

## Start the terminal

Run the local data server from this directory with Python 3.11 or newer.

```sh
python3 server.py --port 8791
```

[Intraday terminal](http://127.0.0.1:8791/) · [Crypto swing view](http://127.0.0.1:8791/swing.html) · [Mac alerts](#background-alerts-on-this-mac) · [Python research](#python-research) · [NinjaTrader 8](#ninjatrader-8) · [Project layout](#project-layout)

## Intraday order flow

The intraday terminal offers 15-second, 1-minute, 5-minute, 15-minute, 30-minute and 1-hour bars for every instrument in live and replay sessions. A sweep can fire within a bar. Absorption and exhaustion use completed bars, so changing the interval can change those signals. For example, an ETHUSDT **long sweep** at the default threshold means aggressive buys totaling at least 100,000 USDT traded across at least four distinct footprint price rows within 300 milliseconds and finished above the first row. Check the signal time and watch whether buyers hold those prices or sellers push back through them.

## Crypto swing view

Open the [swing view](http://127.0.0.1:8791/swing.html) to see BTCUSDT, ETHUSDT and SOLUSDT daily trends and key price levels from Binance USDⓈ-M perpetual futures. Support is a price to watch for buying interest. Resistance is a price to watch for selling interest. The watcher checks the daily context before labeling a live setup as a swing confirmation.

| Step | Rule |
| --- | --- |
| Daily trend | Bullish when the latest completed daily close is above the 20-day simple moving average and that average is above the 50-day average. Bearish when the three values are in the opposite order. A mixed or equal ordering is neutral. Candles close at midnight UTC. |
| Key levels | Use up to 90 consecutive completed daily candles, with at least 50 required. A pivot low is lower than the lows of the two bars on either side. A pivot high is higher than all four neighboring highs. Select the nearest pivot low below the last daily close for support and the nearest pivot high above it for resistance. When an eligible pivot is missing, use the trailing 20-day low or high if it lies on the appropriate side. |
| Order-flow confirmation | A bullish trend needs an existing long order-flow signal near support. A bearish trend needs a short signal near resistance. The allowed distance either side of the level is one quarter of the mean true range over the last 14 daily candles. True range includes any gap from the previous close. |
| Notification | A fresh qualifying signal produces a **SWING** Mac notification with the symbol, direction, signal price and trigger. A 15-minute cooldown per symbol and direction limits repeated swing confirmations and survives watcher restarts. The underlying intraday signal and its swing confirmation share one notification. |

For example, suppose ETH is in a bullish daily trend with support at 1,900 USDT and a 14-day average true range of 40 USDT. The confirmation zone is 1,890–1,910. A fresh **long absorption** at 1,904 could qualify. A short sweep at that price or a long sweep well above the zone would still be an intraday signal. A neutral trend, unavailable daily levels or stale flow leaves the swing alert waiting. The swing view identifies the trigger and its price. Position size, exits and holding period remain the trader's decisions.

## Reading and replaying a session

Open [the local terminal](http://127.0.0.1:8791/). It opens on Binance BTCUSDT perpetual futures. The market menu also offers [ETHUSDT](http://127.0.0.1:8791/?market=ETHUSDT) and [SOLUSDT](http://127.0.0.1:8791/?market=SOLUSDT) perpetual futures. The live strip shows the age of the latest trade and depth messages against the device clock, plus aggressive buy percentage and signed volume over the last 60 one-second buckets. Green **Live** requires both channels to have received a recent exchange timestamp. Each channel shows **Delayed** after 1.5 seconds and **Stale** after five seconds. A quiet market also increases the age of the last trade. Select **Session files → Open demo replay** for synthetic data. In replay, drag the timeline or press **Restart replay** to inspect the first prints. **Play** advances at the selected speed. Scrubbing backward rebuilds the engine from the recording.

- **Heatmap** shows resting depth, candles, large prints, reported liquidations, and setup markers. Color intensity measures displayed quantity. The bar strip below the chart shows traded volume colored by delta.
- **Footprint** displays quantity sold at the bid × quantity bought at the ask per price row. Hover a bar for OHLC and delta. Shift-scroll moves through earlier bars. Double-click returns to the latest bars.
- **TPO profile** counts UTC periods that traded at each price row and shows session volume alongside. The 15-minute, 30-minute and 1-hour selections use matching TPO periods. Shorter chart intervals use the standard 30-minute TPO period. When rows are grouped to fit the screen, the count sums the constituent rows’ visits.
- **Setup scanner** detects absorption, sweeps, exhaustion and possible icebergs. An iceberg is an inference from executions at a resting quote. The feed does not disclose hidden order identities.
- **Terminal settings** (gear) controls symbol, aggregation and size thresholds, alerts and the paper strategy. Choose an ntfy topic and subscribe to that topic in the phone app to receive live setup alerts while the terminal is open. Applying settings reruns the browser simulation. Paper P&L charges the configured fee per side (default 0.05%) on entry and exit. Fills at stop and target prices exclude slippage.

For Binance markets, **Connect live** starts a new Binance USDⓈ-M futures recording for the configured symbol. The browser consumes aggregate trades and reported liquidations over Binance’s market WebSocket. A second WebSocket subscribes to the top 20 bid and ask levels at the exchange’s 100 ms update setting. Each received event updates the engine immediately. The visible chart refreshes approximately four times per second. On connect the terminal first loads up to the 5,000 most recent aggregate trades, so bars, setups and paper trades can predate the connection. Depth and liquidations have no history, and trades printed in the moment between that load and the socket opening are missed. Statistics cover that backfill plus events received since. A reconnect can leave a gap in the recorded data. An unavailable feed is reported on screen. **Disconnect** keeps the received events available for replay. Save before starting a new session or closing the tab. After 200,000 events the terminal starts a new live segment and resets session statistics. The immediately preceding segment remains available from Session files until the next rollover. The chart retains the most recent 500 populated bars and 720 depth snapshots at the selected cursor.

Use **Session files** to save a complete session as JSON or export trades as CSV. The CSV header is `time_ms,price,qty,sell`, with 1 for an aggressive sell. Importing a CSV uses the symbol from settings. A JSON recording carries its own symbol and can reproduce depth and liquidations along with trades.

To study a recording, follow the [Python research guide](#python-research). The independent [NinjaTrader 8 guide](#ninjatrader-8) covers native charts and the separate Windows strategy.

## Stocks and gold

Use the **Market** menu for NVDA, AMD, INTC or GLD (SPDR Gold Shares). The scanner follows the selected market. Switching starts a new session and keeps the previous recording available under **Session files**. Equity trades are measured in shares. The default USD 100,000 print threshold is adjustable and has not been calibrated for predictive performance. Execution side can be unknown. Those trades contribute to volume and VWAP, and the terminal reports unclassified quantity.

Install the market-data SDKs in the virtual environment used to start the server.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-market.txt
.venv/bin/python server.py --port 8791
```

For **NVDA, AMD, INTC and GLD**, sign in to the [Moomoo OpenD desktop gateway](https://openapi.moomoo.com/moomoo-api-doc/en/quick/opend-base.html) and start it on `127.0.0.1:11111`. Use a Moomoo account with US real-time ticker and order book API permissions. Moomoo lists US depth as promotional and requires a non-professional questionnaire for ArcaBook. Keep OpenD logged in. In the local terminal, select a stock and click **Connect live**. The scanner subscribes to tick-by-tick executions and up to ten price levels per side from the Moomoo US feed. Displayed depth depends on your API entitlements. [Market data permissions](https://open.moomoo.com/api/overview/api-authority)

GLD shows a timestamped **XAU/USD spot** reference in USD per troy ounce. The default free Gold-API.com quote is polled every ten seconds and displays the provider’s update time. For an OANDA bid/ask midpoint, set `OANDA_ENV` to `live` or `practice` and provide `OANDA_TOKEN` and `OANDA_ACCOUNT_ID` for an account with XAU_USD pricing. Spot updates enter each recording as reference events. GLD chart and scanner inputs are ETF executions and book quantities in shares. The additional Yahoo Finance reference is labeled with its own source time and contract name.

JSON recordings preserve the listed market, GC delivery contract and recorded spot events. A CSV export contains executions only. A blank sell field means unclassified. When importing GC trades, use a dated filename such as `GCZ6-ticks.csv` so the terminal retains the contract identity.

## Project layout

| Location | Responsibility |
| --- | --- |
| [server.py](server.py) | Serves the local terminal and market-data endpoints. |
| `web/` | Browser pages, charts and styling for intraday order flow and the swing view. |
| `core/` | Scanner rules, swing analysis, feed handling and session replay shared by views and watchers. |
| `providers/` | Python adapters for equities, futures and reference prices. |
| `alerts/` | Read-only Mac setup watchers for cryptocurrencies and US stocks. |
| `scripts/` | Watcher installation, backtesting and market-open verification. |
| `tests/` | Regression checks for the scanner, feeds and local tools. |
| `research/` | Offline footprint report generator and template, plus the [original market-data research note](research/multi-market-order-flow.md). The note describes the proposal before the live adapters were built. |
| `ninjatrader/` | Optional NinjaScript strategy for NinjaTrader Desktop on Windows. |

## Repository references and runtime dependencies

The five projects linked with the [reel](https://www.instagram.com/reel/DfsyN2ZTeY6/) are design references. Tapescope runs its own scanner, charts and report code. None of the five is imported or required to run the terminal.

| Reference repository | What it informed in Tapescope |
| --- | --- |
| [zadescoxp/order-flow-screener](https://github.com/zadescoxp/order-flow-screener) | Monitoring large executions and reported crypto liquidations on the live tape. |
| [Linus404/Linus-Indicator-Collection](https://github.com/Linus404/Linus-Indicator-Collection) | Footprint, delta and depth-map displays. The browser draws its own charts, and the Windows guide uses native NinjaTrader indicators. |
| [srlcarlg/srl-python-indicators](https://github.com/srlcarlg/srl-python-indicators) | Footprint bubbles, volume by price and time-price opportunities in the local Python report. |
| [mahmoud20138/OrderFlow-Analysis-Pro](https://github.com/mahmoud20138/OrderFlow-Analysis-Pro) | Detecting order-flow patterns. Tapescope defines its own thresholds and trigger descriptions in the scanner engine. |
| [marksantiago290/OrderFlowBot-NinjaTrading](https://github.com/marksantiago290/OrderFlowBot-NinjaTrading) | The optional Windows strategy’s use of a saved NinjaTrader ATM template. Browser and Mac setup alerts run independently. |

**Market data.** BTCUSDT, ETHUSDT and SOLUSDT use Binance USDⓈ-M public REST and WebSocket feeds. NVDA, AMD, INTC and GLD use the `moomoo-api` Python SDK with local OpenD. XAU/USD is a separate spot reference from Gold-API.com or OANDA. The two SDK versions are pinned in [requirements-market.txt](requirements-market.txt). The intraday scanner rules are in [engine.js](core/engine.js). Daily context and swing confirmation rules are in [swing.js](core/swing.js).

## Background alerts on this Mac

To install or update the Mac watcher, run this from the project root with Node.js on your path.

```sh
python3 scripts/install_crypto_watcher.py
```

The watcher runs in the signed-in macOS user session, including when the browser tab is closed. Keep the Mac awake and online. Look in Notification Center for **Tapescope setup**. macOS may group these banners under **Script Editor**. The swing view reads the watcher’s status, so a fresh daily close can be visible while the live trade or book stream is still catching up. Read the displayed timestamps before interpreting a confirmation as current.

The watcher tracks one day setup and one independent swing setup per symbol, starting with new live alerts. Repeated entries in the same direction keep the original reference price. Tracked setups and the most recent exit for each timeframe persist in `status.json` across restarts.

| Mac exit alert | Trigger |
| --- | --- |
| **DAY EXIT LONG / SHORT** | The next fresh opposing intraday setup closes the tracked setup and starts tracking the new direction. A day setup also ends on the first eligible live trade in the next UTC day (08:00 Singapore). |
| **SWING EXIT LONG** | A live trade below the entry support zone, a trade at or above the entry day's resistance target if available, or a completed daily trend that becomes neutral or bearish. |
| **SWING EXIT SHORT** | A live trade above the entry resistance zone, a trade at or below the entry day's support target if available, or a completed daily trend that becomes neutral or bullish. |

Swing zones and targets are fixed when the setup first qualifies. A new opposite swing confirmation also closes the previous swing setup. Each exit notification gives the symbol, timeframe, original direction, observed exit price, reason, original signal price and UTC time. Price and trend exits use a fresh trade with current book data. If the Mac is offline, an unobserved crossing can be missed. These alerts track scanner setups independently of account positions or the browser paper simulator.

Inspect the existing watcher and its latest health sample with these commands.

```sh
launchctl print "gui/$(id -u)/com.tapescope.crypto-setups"
cat "$HOME/Library/Application Support/Tapescope/crypto-alerts/status.json"
```

A new setup needs fresh exchange timestamps from both trades and depth. At a quiet market the last trade can age even while the book continues to update. If the watcher is offline, its last recorded alert is historical. Browser notification and ntfy settings apply to the open terminal. The background crypto watcher sends Mac notifications on its own.

## Verification

```sh
node --test
.venv/bin/python -m unittest discover -s tests
```

### Market-open verification

To check delivery, run the following command during the US equity session with the terminal server on port 8791.

```sh
node --experimental-eventsource scripts/check_open_feed.js NVDA AMD INTC GLD
```

The probe uses the same stream adapter and scanner engine as the dashboard. For each mapped instrument it requires multiple advancing executions and multi-level, two-sided book updates within 1.5 seconds of their source timestamps. Equity trades use the trade timestamp. Equity depth uses the older of the two timestamps when Moomoo received each side. When OpenD omits those timestamps, the terminal displays the book with **Source time unavailable** and the probe reports receipt-only updates. It observes at least ten seconds and returns the contract, counts, source times, depth levels and scanner volume. Missing credentials, venue errors and timeouts produce a failed check. Keep the Mac awake and online, with Codex running and OpenD signed in, for the scheduled stock check.

## Python research

In the terminal, select **Session files → Export ticks for Python** after recording or replaying trades. Run the command below with Python 3.8 or later, then open the generated report in a browser. The HTML file includes its data and works offline.

```sh
python3 research/orderflow_report.py BTCUSDT-ticks.csv -o footprint.html
```

If downloading the tool separately, keep its `report.html` template beside the script. Use `--bucket 10` to match the built-in synthetic BTC session. Use `--bucket 5 --bar-minutes 5` for five-unit price rows and five-minute bars. The default uses one-minute bars and the terminal’s automatic row size based on the first input price. When comparing against a terminal configured with a manual row size, pass that value as `--bucket`.

The CSV header is `time_ms,price,qty,sell`. Time is Unix milliseconds. A sell of `1` hits the bid and `0` lifts the ask. A blank or `unknown` side counts toward total volume only. Quantities use the instrument’s traded units. Rows may arrive out of time order, and invalid rows produce an error with the line number.

- **Footprint** opens on the most recent page of bars. Each traded cell shows bid × ask and signed delta. Bubble area scales with cell volume within the displayed page. The footer shows each bar’s delta. The time axis displays populated bars, with gaps visible in their UTC timestamps.
- **Volume profile** sums the entire file by price row. Bars show the bid and ask portions on a common scale.
- **Time-price opportunities (TPO)** count distinct UTC half hours that traded in each row. A represents 00:00 UTC, B represents 00:30, and letters restart at UTC midnight. Each letter’s tooltip includes the date. Gaps in recorded trades remain gaps in the profile.

For an intraday review, export a session containing a scanner alert and inspect the footprint around its timestamp. For swing research, compare profiles from several recorded sessions of the same instrument using the same price-row size. A busy price row tells you where volume traded during the recorded interval. Direction over the following days requires later observations. Trade-only CSVs can show volume and delta, but checking a possible iceberg also requires the recorded book updates in the terminal’s JSON replay.

To replay trade-based setups with a simulated stop, target and fee, run the backtest from the project root. The optional arguments after the CSV are stop percent, target percent, fee percent per side and market symbol. The output groups the results by setup. A trade-only file supports the absorption, sweep and exhaustion tests. Testing a possible iceberg requires book updates as well.

```sh
node scripts/backtest.js BTCUSDT-ticks.csv
```

## NinjaTrader 8

The chart uses NinjaTrader Desktop's Order Flow + tools. The strategy labels absorption, exhaustion, sweeps and possible icebergs on a futures chart. With **Submit ATM entries** enabled, a qualifying setup submits a market entry to the account selected in the strategy settings. Your local ATM template supplies the quantity, protective stop and profit target.

For alerts-only use, leave **Submit ATM entries** unchecked (the default). The one-minute footprint and depth map below help you examine intraday activity near a price of interest. For a swing idea, use a separate daily chart to establish the trend and level you want to monitor. The NinjaScript labels the short-term reaction there. Tapescope’s Mac alerts run independently of this Windows strategy.

### Build the chart on Windows

1. In **Control Center → New → Chart**, choose the dated futures contract supplied by your data connection. In **Data Series**, choose **Order Flow Volumetric**, base period **Minute**, value **1**, delta type **Bid Ask**, ticks per level **1** and size filter **0**. Use a connection with bid/ask-stamped historical ticks for historical footprints and Level II for the heatmap. Check that your NT account has Order Flow + access. [Volumetric bar settings](https://static.ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm)
2. In the chart style settings, choose **Bid Ask**, enable **Show imbalance** and **Show maximum**, and use **Diagonal** for imbalance mode. Enable **Show bar statistics**, including **Volume**, **Delta (Bar)** and **Cum delta**. Widen the bars or zoom in until both numbers fit. The left number shows contracts sold at bid and the right shows contracts bought at ask. Cum delta resets at the session boundary. [Footprint and delta display](https://static.ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm)
3. Right-click the chart → **Indicators** and add **Order Flow Market Depth Map** to the price panel. Choose **Realtime and Historical Depth**, start with **10** levels per side, set the volume range to **Percent**, and choose bid and ask colors. Brighter bands show larger displayed depth observed at that price during the bar. Clear **Extend last known value** to limit bands to observed bars. The heatmap fills as NT receives Level II events. [Market Depth Map](https://static.ninjatrader.com/support/helpGuides/nt8/order_flow_market_depth_map.htm)
4. For trade bubbles, add **Order Flow Trade Detector**, set **Base large volume on** to **Block**, and set **Minimum volume for marker** in contracts. With overlapping text, open a second chart on the same contract for the map and bubbles, and leave the footprint on the first chart. Right-click each chart → **Templates → Save As**, then save the workspace to retain the chart arrangement. [Trade Detector](https://static.ninjatrader.com/support/helpGuides/nt8/order_flow_trade_detector.htm) · [Chart templates](https://static.ninjatrader.com/support/helpGuides/nt8/saving_chart_defaults_and_templates.htm)

### Install the strategy

1. Copy [OrderFlowSetupAtm.cs](ninjatrader/Strategies/OrderFlowSetupAtm.cs) to the Windows NinjaTrader user folder under `Documents\NinjaTrader 8\bin\Custom\Strategies\`. In **Control Center → New → NinjaScript Editor**, open the strategy under **Strategies**, then press **F5** to compile.
2. On the footprint chart, right-click → **Strategies** → add **OrderFlowSetupAtm**. Keep **Calculate** at **On each tick**. Select **Playback101** for Market Replay or **Sim101** for a connected simulation feed. Enable the strategy with **Submit ATM entries** unchecked. Each signal prints its time, contract, setup, direction and price to **New → NinjaScript Output**. Repeated signals of one type and direction in one bar update the same chart label.
3. To configure simulated entries, open Chart Trader on the simulation account. Choose **ATM Strategy → Custom**, choose your contract quantity and set **Parameter type** to **Ticks**. Enter your **Stop loss** and **Profit target** distances, then **Save as Template**. The default name the strategy looks for is `OrderFlowBracket`. Use a **local ATM** template. On versions offering server-side ATMs, that mode must be off for NinjaScript templates. [ATM template example](https://static.ninjatrader.com/support/helpGuides/nt8/tutorial_atm_strategy_example_.htm) · [Local ATM support](https://static.ninjatrader.com/support/helpGuides/nt8/server-side-vs-local-atms.htm)
4. With the strategy disabled, enter that exact name under **ATM template name**, select the desired setups, confirm the account, then check **Submit ATM entries** and enable. The strategy takes at most one entry per chart bar and waits for its ATM to finish. Existing exposure or outstanding orders on the same account and instrument also suppress new entries. Use one execution instance per account and instrument. Disabling the strategy stops new entries. Manage any existing ATM and its orders from Chart Trader or the Control Center. [NinjaScript ATM behavior](https://static.ninjatrader.com/support/helpGuides/nt8/using_atm_strategies.htm)

### NinjaTrader setup definitions

These definitions and numeric thresholds are implementation choices for this strategy. **Min contracts** defaults to 50 and controls sweep and iceberg size. Changes to visual imbalance settings or bubble size affect the display only.

| Setup | Evidence | Direction |
| --- | --- | --- |
| Absorption | A completed bar has more than 1.5× the preceding mean volume and absolute delta above 25% of bar volume. Use the preceding 5–20 completed bars. | Long on negative delta and a close above 60% of the low-to-high range. Short on positive delta and a close below 40%. |
| Exhaustion | A completed bar makes a fresh extreme against up to 10 preceding bars, prints less than 10% of its busiest price cell's volume at the extreme and closes back inside. Requires at least five prior bars. | Long at a fresh low, short at a fresh high. |
| Sweep | Classified prints move in one direction across at least four distinct traded prices in 300 ms and reach Min contracts in aggregate. Between-spread trades, an opposing print or a price reversal break the sequence. | Follow the aggressive side. |
| Iceberg candidate | Within one second at an unchanged best bid or ask, classified trades at that price exceed 3× its initially displayed size and reach Min contracts. A subsequent same-price quote increases its displayed size to at least half the initial size. | Long at a replenished bid, short at a replenished ask. Public quotes cannot identify the underlying hidden order. |

Bar-close signals use NT's volumetric bid/ask classification. Sweep and iceberg rules use the live Level I trade and inside-quote events. Separate orders can replenish the same price. The Level II map is a visual input for the trader and does not trigger entries by itself. The standalone browser engine uses its own venue feed and units, so timestamps and signals may differ. [Volumetric API](https://static.ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars2.htm) · [Market data events](https://static.ninjatrader.com/support/helpGuides/nt8/onmarketdata.htm)

### Check with Market Replay

1. Before connecting Playback, open **Tools → Historical Data → Get Market Replay data** and obtain a session for the chart's exact contract. Choose **Connections → Playback Connection**, select **Market Replay** and start before an active trading interval. Use **Show Available Data** on the playback controller to check the Level I and Level II time ranges. Load enough chart history for the bar rules. [Replay downloads](https://static.ninjatrader.com/support/helpGuides/nt8/set_up12.htm) · [Playback controls](https://static.ninjatrader.com/support/helpGuides/nt8/playback.htm)
2. Run once in signals-only mode. Verify that bid × ask cells and bar delta change, depth builds at several prices, and labels match the output window. Record a signal time. For a sparse tape, reduce **Min contracts** for this test. Fill quantity or a footprint mismatch warrants checking the contract, data coverage and chart settings.
3. Disable the strategy and rewind before the recorded signal. Re-enable on **Playback101** with the local template and **Submit ATM entries** enabled. Confirm a single entry in **Orders**. After the fill, check the stop and target sides, quantities and distances from the actual fill. Let an exit fill and check that the sibling order cancels, the account returns to flat and a later setup can enter. ATM creation errors and rejected entries appear in NinjaScript Output. Correct the template or account issue before restarting.
4. A market order can fill away from the marked signal price. A missing ATM status can leave the entry slot occupied. In that case inspect the account's position and orders, then restart the strategy once the instrument is flat and clear. Strategy Analyzer cannot replay ATM order handling. [ATM creation](https://static.ninjatrader.com/support/helpGuides/nt8/atmstrategycreate.htm) · [ATM position updates](https://static.ninjatrader.com/support/helpGuides/nt8/getatmstrategymarketposition.htm)

The source passed a C# syntax parse on macOS. Compilation against NinjaTrader assemblies, chart rendering and Playback fills require Windows NinjaTrader Desktop and have not been verified here.
