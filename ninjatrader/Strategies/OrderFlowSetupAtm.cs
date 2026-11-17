using System;
using System.ComponentModel.DataAnnotations;
using System.Windows.Media;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript.BarsTypes;
using NinjaTrader.NinjaScript.DrawingTools;

namespace NinjaTrader.NinjaScript.Strategies
{
    public class OrderFlowSetupAtm : Strategy
    {
        private VolumetricBarsType footprint;
        private int firstRealtimeBar = -1;
        private int lastEntryBar = -1;
        private readonly object atmGate = new object();
        private string atmId, entryId;
        private bool atmCreated, sawPosition, executionFault;
        private int executionCountAtEntry;

        // The Last, Bid and Ask event types all come from the ordered Level I stream.
        private int sweepSide, sweepLevels;
        private double sweepLastPrice;
        private long sweepVolume;
        private DateTime sweepStart;
        private bool sweepReported;

        private sealed class Touch
        {
            public double Price;
            public long Baseline, Displayed, Traded;
            public DateTime Start;
            public bool Reported;

            public void Reset(double price, long size, DateTime time)
            {
                Price = price;
                Baseline = Displayed = size;
                Start = time;
                Traded = 0;
                Reported = false;
            }
        }

        private readonly Touch bid = new Touch();
        private readonly Touch ask = new Touch();

        [NinjaScriptProperty]
        [Display(Name = "Submit ATM entries", GroupName = "Execution", Order = 0)]
        public bool SubmitEntries { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "ATM template name", GroupName = "Execution", Order = 1)]
        public string AtmTemplate { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Absorption", GroupName = "Setups", Order = 0)]
        public bool Absorption { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Exhaustion", GroupName = "Setups", Order = 1)]
        public bool Exhaustion { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Sweep", GroupName = "Setups", Order = 2)]
        public bool Sweep { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Iceberg candidate", GroupName = "Setups", Order = 3)]
        public bool Iceberg { get; set; }

        [NinjaScriptProperty]
        [Range(1, int.MaxValue)]
        [Display(Name = "Min contracts (sweep or iceberg)", GroupName = "Setups", Order = 4)]
        public int MinContracts { get; set; }

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "OrderFlowSetupAtm";
                Description = "Marks footprint and tape setups and optionally starts a saved ATM bracket.";
                Calculate = Calculate.OnEachTick;
                BarsRequiredToTrade = 0;
                IsOverlay = true;
                SubmitEntries = false;
                AtmTemplate = "OrderFlowBracket";
                Absorption = Exhaustion = Sweep = Iceberg = true;
                MinContracts = 50;
            }
            else if (State == State.DataLoaded)
            {
                footprint = Bars.BarsSeries.BarsType as VolumetricBarsType;
                if (footprint == null)
                    Print(Name + " requires a primary Order Flow Volumetric data series.");
            }
            else if (State == State.Realtime && SubmitEntries && string.IsNullOrWhiteSpace(AtmTemplate))
            {
                executionFault = true;
                Print(Name + " needs a saved ATM template name to submit entries.");
            }
        }

        protected override void OnBarUpdate()
        {
            if (State != State.Realtime || footprint == null || CurrentBar < 0)
                return;

            if (firstRealtimeBar < 0)
                firstRealtimeBar = CurrentBar;
            if (SubmitEntries)
                RefreshAtm();

            // The first tick of the new bar finalizes [1]. Use prior completed bars
            // as the comparison window and never enter a historical setup on startup.
            if (!IsFirstTickOfBar || CurrentBar <= firstRealtimeBar || CurrentBar < 6)
                return;

            int priorCount = Math.Min(20, CurrentBar - 1);
            double total = 0, priorHigh = High[2], priorLow = Low[2];
            for (int i = 2; i <= priorCount + 1; i++)
            {
                total += Volume[i];
                if (i <= 11)
                {
                    priorHigh = Math.Max(priorHigh, High[i]);
                    priorLow = Math.Min(priorLow, Low[i]);
                }
            }

            var bar = footprint.Volumes[CurrentBar - 1];
            double range = High[1] - Low[1];
            if (range <= 0 || bar.TotalVolume <= 0)
                return;
            double finish = (Close[1] - Low[1]) / range;
            if (Absorption && bar.TotalVolume > 1.5 * total / priorCount
                && Math.Abs((double)bar.BarDelta) > 0.25 * bar.TotalVolume)
            {
                if (bar.BarDelta < 0 && finish > 0.6)
                    Signal("Absorption", 1, 1, Close[1], Time[1]);
                if (bar.BarDelta > 0 && finish < 0.4)
                    Signal("Absorption", -1, 1, Close[1], Time[1]);
            }

            if (Exhaustion)
            {
                double peakPrice;
                long peakVolume = bar.GetMaximumVolume(null, out peakPrice);
                if (Low[1] < priorLow && Close[1] > Low[1] && bar.GetTotalVolumeForPrice(Low[1]) < 0.1 * peakVolume)
                    Signal("Exhaustion", 1, 1, Close[1], Time[1]);
                if (High[1] > priorHigh && Close[1] < High[1] && bar.GetTotalVolumeForPrice(High[1]) < 0.1 * peakVolume)
                    Signal("Exhaustion", -1, 1, Close[1], Time[1]);
            }
        }

        protected override void OnMarketData(MarketDataEventArgs e)
        {
            if (State != State.Realtime || footprint == null || (!Sweep && !Iceberg))
                return;
            if (e.MarketDataType == MarketDataType.Bid || e.MarketDataType == MarketDataType.Ask)
            {
                if (Iceberg)
                    ObserveQuote(e, e.MarketDataType == MarketDataType.Bid ? bid : ask);
                return;
            }
            if (e.MarketDataType != MarketDataType.Last || e.Volume <= 0)
                return;

            int side = 0;
            if (e.Ask > e.Bid && e.Bid > 0)
                side = e.Price >= e.Ask ? 1 : e.Price <= e.Bid ? -1 : 0;
            if (side == 0)
            {
                sweepSide = 0;
                return;
            }
            if (Iceberg)
            {
                Touch touch = side > 0 ? ask : bid;
                if (e.Price == touch.Price && e.Time >= touch.Start && e.Time - touch.Start <= TimeSpan.FromSeconds(1))
                    touch.Traded += e.Volume;
            }
            if (!Sweep)
                return;

            if (side != sweepSide || e.Time < sweepStart || (e.Time - sweepStart).TotalMilliseconds > 300
                || side * (e.Price - sweepLastPrice) < 0)
            {
                sweepStart = e.Time;
                sweepSide = side;
                sweepLevels = 1;
                sweepVolume = 0;
                sweepReported = false;
            }
            else if (e.Price != sweepLastPrice)
                sweepLevels++;

            sweepLastPrice = e.Price;
            sweepVolume += e.Volume;
            if (!sweepReported && sweepLevels >= 4 && sweepVolume >= MinContracts)
            {
                sweepReported = true;
                QueueTapeSignal("Sweep", side, e.Price, e.Time);
            }
        }

        private void ObserveQuote(MarketDataEventArgs e, Touch touch)
        {
            if (touch.Price != e.Price || e.Volume <= 0 || touch.Baseline <= 0
                || e.Time < touch.Start || (e.Time - touch.Start).TotalSeconds > 1)
            {
                touch.Reset(e.Price, e.Volume, e.Time);
                return;
            }
            bool replenished = e.Volume > touch.Displayed && e.Volume >= 0.5 * touch.Baseline;
            touch.Displayed = e.Volume;
            if (!touch.Reported && replenished && touch.Traded > 3.0 * touch.Baseline && touch.Traded >= MinContracts)
            {
                touch.Reported = true;
                QueueTapeSignal("Iceberg", touch == bid ? 1 : -1, e.Price, e.Time);
            }
        }

        private void QueueTapeSignal(string name, int direction, double price, DateTime time)
        {
            TriggerCustomEvent(o => Signal(name, direction, 0, price, time), null);
        }

        private void Signal(string name, int side, int barsAgo, double price, DateTime time)
        {
            if (State != State.Realtime || CurrentBar < barsAgo)
                return;
            string direction = side > 0 ? "Long" : "Short";
            string tag = name + direction + (CurrentBar - barsAgo);
            Draw.Text(this, tag, name + " " + direction, barsAgo, price - side * 2 * TickSize,
                side > 0 ? Brushes.LimeGreen : Brushes.OrangeRed);
            Print(string.Format("{0:yyyy-MM-dd HH:mm:ss.fff} {1} {2} {3} @ {4}", time, Instrument.FullName, name, direction, price));
            if (!SubmitEntries)
                return;

            lock (atmGate)
            {
                if (executionFault || atmId != null || lastEntryBar == CurrentBar || !AccountIsClear())
                    return;
                lastEntryBar = CurrentBar;
                lock (Account.Executions)
                    executionCountAtEntry = Account.Executions.Count;
                entryId = GetAtmStrategyUniqueId();
                atmId = GetAtmStrategyUniqueId();
            }
            AtmStrategyCreate(side > 0 ? OrderAction.Buy : OrderAction.Sell, OrderType.Market, 0, 0,
                TimeInForce.Day, entryId, AtmTemplate.Trim(), atmId, (error, id) =>
                {
                    lock (atmGate)
                    {
                        if (id != atmId)
                            return;
                        atmCreated = error == ErrorCode.NoError;
                        if (!atmCreated)
                        {
                            executionFault = true;
                            Print(Name + " stopped submitting after ATM creation failed: " + error + ". Check the account and template, then restart.");
                        }
                    }
                });
        }

        private bool AccountIsClear()
        {
            if (PositionAccount.MarketPosition != MarketPosition.Flat)
                return false;
            lock (Account.Orders)
                foreach (Order order in Account.Orders)
                    if (order.Instrument == Instrument && order.OrderState != OrderState.Filled
                        && order.OrderState != OrderState.Cancelled && order.OrderState != OrderState.Rejected)
                        return false;
            return true;
        }

        private void RefreshAtm()
        {
            lock (atmGate)
            {
                if (!atmCreated || executionFault)
                    return;

                if (GetAtmStrategyMarketPosition(atmId) != MarketPosition.Flat)
                    sawPosition = true;
                if (entryId != null)
                {
                    string[] status = GetAtmStrategyEntryOrderStatus(entryId);
                    if (status.Length < 3)
                        return;
                    if (status[2] == "Rejected")
                    {
                        executionFault = true;
                        Print(Name + " stopped submitting after an entry rejection. Inspect Orders, then restart.");
                        return;
                    }
                    if (status[2] != "Filled" && status[2] != "Cancelled")
                        return;
                    if (status[2] == "Cancelled" && status[1] == "0")
                        sawPosition = true; // Confirmed zero-fill cancellation can release the entry slot.
                    entryId = null;
                    return; // ATM position updates may trail the entry fill by a market event.
                }
                if (!AccountIsClear() || GetAtmStrategyMarketPosition(atmId) != MarketPosition.Flat)
                    return;
                // An ATM can open and close between ticks, including at break-even.
                // Check the account executions since the entry request for a closing fill.
                if (!sawPosition)
                {
                    lock (Account.Executions)
                    {
                        for (int i = executionCountAtEntry; i < Account.Executions.Count; i++)
                        {
                            var fill = Account.Executions[i];
                            if (fill.Instrument == Instrument && fill.Position == 0)
                            {
                                sawPosition = true;
                                break;
                            }
                        }
                    }
                    if (!sawPosition)
                        return;
                }
                atmId = null;
                atmCreated = sawPosition = false;
            }
        }
    }
}
