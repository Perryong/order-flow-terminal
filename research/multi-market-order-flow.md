# Order flow for NVDA, AMD, INTC and gold

Research date: 14 November 2026. The current terminal subscribes to one Binance USDⓈ-M instrument at a time. The stock and gold feeds below are proposed integrations.

## How closely the implementation follows the reel

| Reel step | Current behavior | Difference that matters |
| --- | --- | --- |
| Track big orders | The engine marks large executions and detects possible icebergs by comparing traded quantity at a best quote with the displayed size before and after. Binance supplies forced-order reports. | An iceberg is inferred. A liquidation requires an explicit venue event. |
| Chart the activity | The browser renders footprints, cumulative delta and a depth heatmap. The Windows guide configures native NinjaTrader volumetric bars and Market Depth Map. | The browser uses the Binance feed. NinjaTrader uses its own connection and chart settings. |
| Test with Python | The local report reads tick CSVs and builds footprint bubbles, a volume profile and 30-minute TPO. | A CSV of trades alone cannot reproduce book replenishment. |
| Scan and notify | Absorption and exhaustion use closed bars. Sweeps use a 300 ms burst spanning four distinct price rows. Optional desktop and ntfy alerts carry direction, price and trigger. | These are local rules. The referenced Analysis Pro repository also assesses qualified price levels and scores signals. Cross-project signal parity has not been established. |
| Execute with a bracket | The browser simulates trades. A separate NinjaScript strategy can submit an entry using a saved ATM template. | Windows NinjaTrader compilation and Playback fills remain unverified. Browser alerts do not route into NinjaTrader. |

The browser and Python regression suites passed during this review. These checks cover the local implementation. A claim to reproduce another strategy’s entries requires running both on the same recorded feed with matching clocks, aggregation, parameters and sessions.

Sources: [reel](https://www.instagram.com/reel/DfsyN2ZTeY6/), [screener](https://github.com/zadescoxp/order-flow-screener), [NT8 charts](https://github.com/Linus404/Linus-Indicator-collection), [Python profiles](https://github.com/srlcarlg/srl-python-indicators), [Analysis Pro](https://github.com/mahmoud20138/OrderFlow-Analysis-Pro), [OrderFlowBot](https://github.com/marksantiago290/OrderFlowBot-NinjaTrading).

## Market data findings

**Stocks.** A read-only Alpaca IEX quote request returned all three tickers. The market clock showed the US regular session closed, and the quotes carried Friday timestamps. NVDA and AMD had an empty ask in the latest IEX record. A SIP query returned an internal error, which leaves entitlement unverified. The connector test establishes research access; the running terminal needs credentials for its own stream. Alpaca stock trades include price, size, venue and conditions. The quoted bid and ask support an estimated aggressor side with time-aligned quotes. Tag prints with unknown side when the quote is unusable, locked, crossed or ambiguous. Volume and VWAP can still include eligible unclassified prints. [Alpaca stock stream schema](https://docs.alpaca.markets/docs/real-time-stock-pricing-data)

**Venue-level stock order flow.** Nasdaq TotalView via XNAS.ITCH supplies Nasdaq executions and book updates, which are suitable for a Nasdaq-specific heatmap and replenishment detector. Match trades to the same venue’s depth. Nasdaq cross trades and certain non-displayed executions have unknown side. Crosses, corrections and book resets need explicit handling. Alerts should carry the venue so a Nasdaq setup cannot be mistaken for US market-wide activity. [Nasdaq feed specification](https://databento.com/docs/datasets/xnas-itch)

**Spot gold.** XAUUSG is unresolved. XAU/USD and XAU/SGD are different prices. Confirm the pair and the broker. For example, OANDA’s stream delivers account-specific bid/ask prices and available liquidity up to four times per second per instrument. A quote change is insufficient evidence of executed buyer or seller volume. A broker quoting gold can support a price/spread view; trade-based setups require a documented execution feed. [OANDA pricing specification](https://developer.oanda.com/rest-live-v20/pricing-ep/)

**Exchange-traded gold.** For the reel’s workflow, use trades and depth from the same dated COMEX GC or MGC contract. Track the active contract and show its expiry next to every signal. GC represents 100 troy ounces, MGC 10. At an illustrative USD 4,000/oz, one GC execution has USD 400,000 notional, while one MGC is USD 40,000. The current engine calculates price times quantity and needs the contract multiplier. A futures setup should display the futures price even when spot gold is also on screen. Live data access and exchange permissions require verification. [CME contract specifications](https://www.cmegroup.com/markets/metals/precious/gold-futures.contractSpecs.html) · [CME market data](https://databento.com/datasets/GLBX.MDP3)

## Proposed implementation and verification

1. For full order flow, start with a recorded Nasdaq NVDA session and a recorded GC session. Use the equities sample to validate the same adapter for AMD and INTC. Keep provider credentials on a local service. Stream normalized events to the browser with venue, instrument, exchange time, sequence, units, tick size, multiplier and aggressor-side provenance. Keep a separate engine and warm-up buffer for each symbol.
2. Set each detector’s required inputs. Volume profile and VWAP need eligible executions. Delta needs classified trades. Iceberg candidates need trades and a fresh same-venue book. Enable liquidation markers only on a feed with explicit liquidation events. Show market closure, entitlement errors and data gaps separately from an absence of setups.
3. Calibrate print size and sweep thresholds on historical sessions per instrument. Use native ticks for swept levels and distinguish regular trading, auctions, extended hours, halts and futures session breaks. Join backfill to the live feed by sequence and suppress notifications during warm-up.
4. Replay known sequences. Verify shares/contracts, price and time, unknown-side handling, and rejection of signals from other venues or stale depth. Check the live and replay engines emit the same alert exactly once. Observe a live session before describing any new adapter as live verified.

A lighter first release can use Alpaca stock trades and best quotes with estimated-side labels and unavailable depth features. The full-depth release is the closer fit for the reel. A broker-specific spot gold view can coexist with either choice.
