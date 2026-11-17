"""Normalize a single Databento live MBP-10 subscription for the local terminal."""
import os
import re
from providers.databento_setup import read_key
from queue import Empty, Full, Queue
from threading import Event, Thread

SYMBOLS = {'NVDA', 'AMD', 'INTC', 'GC'}
GC_CODE = re.compile(r'GC[FGHJKMNQUVXZ](?:[0-9]{1,2}|[0-9]{4})')
UNDEF_PRICE = 2**63 - 1
BAD_BOOK = 1 << 2


def status(state, message, **fields):
    return dict(type='status', state=state, message=message, **fields)


def subscription(symbol):
    if symbol not in SYMBOLS:
        raise ValueError('Choose NVDA, AMD, INTC or GC.')
    if symbol != 'GC':
        return 'XNAS.ITCH', symbol, 'raw_symbol'
    override = os.environ.get('GC_CONTRACT', '').strip().upper()
    if override and not GC_CODE.fullmatch(override):
        raise ValueError('Set GC_CONTRACT to a dated COMEX symbol such as GCZ6, or unset it to use GC.v.0.')
    return ('GLBX.MDP3', override, 'raw_symbol') if override else ('GLBX.MDP3', 'GC.v.0', 'continuous')


class MarketRecords:
    def __init__(self, db, symbol):
        self.db = db
        self.symbol = symbol
        self.dataset, self.requested, self.stype = subscription(symbol)
        self.publisher_id = (db.Publisher.GLBX_MDP3_GLBX if symbol == 'GC'
                             else db.Publisher.XNAS_ITCH_XNAS).to_int()
        self.instrument_id = None
        self.contract = None
        self.last_depth = None
        self.bad_book = False
        self.one_sided = False

    def mapping(self, record):
        db = self.db
        if record.stype_out == db.SType.RAW_SYMBOL:
            raw = record.stype_out_symbol
            if self.stype == 'continuous' and record.stype_in_symbol != self.requested:
                return []
        elif (self.stype == 'raw_symbol' and record.stype_in == db.SType.RAW_SYMBOL
              and record.stype_out == db.SType.INSTRUMENT_ID
              and record.stype_out_symbol == str(record.instrument_id)):
            raw = record.stype_in_symbol
        else:
            return []
        if self.stype == 'raw_symbol' and raw != self.requested:
            return []
        if self.symbol == 'GC' and not GC_CODE.fullmatch(raw):
            raise ValueError('Databento did not resolve GC to a dated outright contract. Check GC_CONTRACT.')
        if self.instrument_id is not None:
            if (record.instrument_id, raw) != (self.instrument_id, self.contract):
                raise ValueError('Databento changed the instrument mapping. Reconnect to start a fresh session.')
            return []
        self.instrument_id, self.contract = record.instrument_id, raw
        return [dict(type='instrument', contract=raw, dataset=self.dataset),
                status('live', f'{raw} subscribed on {self.dataset}. Waiting for exchange events.')]

    def events(self, record):
        db = self.db
        if isinstance(record, db.ErrorMsg):
            if record.code == db.ErrorCode.SKIPPED_RECORDS_AFTER_SLOW_READING:
                raise ValueError('Provider skipped records. Reconnect to start a fresh session.')
            raise ValueError(f'{self.dataset} subscription failed ({record.code}). Check the symbol, API key and live MBP-10 entitlement.')
        if isinstance(record, db.SymbolMappingMsg):
            return self.mapping(record)
        if not isinstance(record, db.MBP10Msg) or record.publisher_id != self.publisher_id:
            return []
        if self.instrument_id is None:
            raise ValueError('Market data arrived without its confirmed symbol mapping. Reconnect and check the subscription.')
        if record.instrument_id != self.instrument_id:
            return []
        t = record.ts_event // 1_000_000
        if record.flags & BAD_BOOK:
            if self.bad_book:
                return []
            self.bad_book = True
            self.one_sided = False
            self.last_depth = None
            return [status('reset', 'Provider reported a data gap. Waiting for a clean book.', t=t)]
        self.bad_book = False
        if record.action == db.Action.CLEAR:
            self.one_sided = False
            self.last_depth = None
            return [status('reset', 'Exchange cleared the book. Waiting for a fresh snapshot.', t=t)]

        fields = dict(t=t, dataset=self.dataset, symbol=self.symbol)
        if self.symbol == 'GC':
            fields['contract'] = self.contract
        result = []
        if record.action == db.Action.TRADE and 0 < record.price < UNDEF_PRICE and record.size > 0:
            sell = True if record.side == db.Side.ASK else False if record.side == db.Side.BID else None
            result.append(dict(type='trade', price=record.price / 1e9, qty=record.size, sell=sell, **fields))
        # Each MBP-10 record contains a full snapshot. Limit display updates while retaining every trade.
        # A missing top quote invalidates the prior book immediately, including between display updates.
        levels = record.levels
        best = levels[0]
        if not (0 < best.bid_px < UNDEF_PRICE and best.bid_sz and
                0 < best.ask_px < UNDEF_PRICE and best.ask_sz):
            if not self.one_sided:
                result.insert(0, status('reset', 'Book is empty or one-sided. Waiting for both quotes.', t=t))
            self.one_sided = True
            self.last_depth = None
            return result
        self.one_sided = False
        if self.last_depth is None or t >= self.last_depth + 100:
            self.last_depth = t
            bids, asks = [], []
            for level in levels:
                if 0 < level.bid_px < UNDEF_PRICE and level.bid_sz:
                    bids.append([level.bid_px / 1e9, level.bid_sz])
                if 0 < level.ask_px < UNDEF_PRICE and level.ask_sz:
                    asks.append([level.ask_px / 1e9, level.ask_sz])
            result.append(dict(type='depth', bids=bids, asks=asks, **fields))
        return result


class MarketStream:
    """An independent SDK session per SSE client. None events are keepalives."""
    def __init__(self, symbol):
        self.symbol = symbol
        self.queue = Queue(maxsize=8192)
        self.closed = Event()
        self.done = Event()
        self.client = None
        self.error = None
        self.thread = Thread(target=self.run, daemon=True, name=f'market-{symbol}')

    def run(self):
        client = None
        key = ''
        try:
            key = read_key()
            if not key:
                raise ValueError('Run Set up Databento.command or set DATABENTO_API_KEY in the server environment, then reconnect.')
            try:
                import databento as db
            except ImportError:
                raise ValueError('Install the live SDK with python3 -m pip install -r requirements-market.txt, then restart the server.') from None
            records = MarketRecords(db, self.symbol)
            client = db.Live(key=key, reconnect_policy='none')
            client.subscribe(dataset=records.dataset, schema='mbp-10', stype_in=records.stype, symbols=records.requested)
            # Publish only after subscribe finishes so a disconnect cannot block on the SDK connection lock.
            self.client = client
            if self.closed.is_set():
                return
            for record in client:
                if self.closed.is_set():
                    return
                for event in records.events(record):
                    self.queue.put_nowait(event)
            self.error = 'Databento disconnected. Reconnect to start a fresh session.'
        except Full:
            self.error = 'The browser fell behind the live feed. Reconnect to start a fresh session.'
        except ValueError as exc:
            self.error = str(exc).replace(key, '[redacted]') if key else str(exc)
        except Exception as exc:
            dataset = 'GLBX.MDP3' if self.symbol == 'GC' else 'XNAS.ITCH'
            self.error = f'Databento connection failed ({type(exc).__name__}). Check network access, DATABENTO_API_KEY and {dataset} live MBP-10 entitlement.'
        finally:
            try:
                if client is not None:
                    client.terminate()
            finally:
                self.done.set()

    def events(self):
        yield status('connecting', f'Connecting {self.symbol} to Databento MBP-10.')
        self.thread.start()
        try:
            while not self.done.is_set() or not self.queue.empty():
                try:
                    yield self.queue.get(timeout=0.5)
                except Empty:
                    if not self.done.is_set():
                        yield None
            if self.error:
                yield status('error', self.error)
        finally:
            self.closed.set()
            if self.client is not None:
                self.client.terminate()
