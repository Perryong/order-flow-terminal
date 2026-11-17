"""Read-only US equity trade and order book pushes from a local Moomoo OpenD."""
import math
import time
from collections import deque
from datetime import datetime
from queue import Empty, Full, Queue
from threading import Event
from zoneinfo import ZoneInfo

from providers.market_provider import status

DATASET = 'Moomoo US'
EASTERN = ZoneInfo('America/New_York')


def timestamp(epoch, text):
    if epoch > 0 and math.isfinite(epoch):
        return int(epoch * 1000)
    if text:
        try:
            moment = datetime.fromisoformat(text)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=EASTERN)
            return int(moment.timestamp() * 1000)
        except (ValueError, OverflowError):
            pass
    return 0


def quantity(record):
    return record.hpVolume if record.HasField('hpVolume') else record.volume


class MoomooRecords:
    def __init__(self, symbol):
        from moomoo.common.pb import Qot_Common_pb2
        self.pb = Qot_Common_pb2
        self.symbol = symbol
        self.fields = dict(dataset=DATASET, symbol=symbol)
        self.sequences = set()
        self.recent = deque()

    def matches(self, body):
        return body.security.market == self.pb.QotMarket_US_Security and body.security.code == self.symbol

    def trades(self, body):
        if not self.matches(body):
            return
        for tick in body.tickerList:
            if tick.pushDataType == self.pb.PushDataType_ByDisConn:
                yield status('reset', 'Moomoo reported a quote interruption.')
                continue
            if tick.pushDataType != self.pb.PushDataType_Realtime or tick.sequence in self.sequences:
                continue
            t = timestamp(tick.timestamp, tick.time)
            qty = quantity(tick)
            if min(t, tick.price, qty) <= 0 or not all(map(math.isfinite, (tick.price, qty))):
                continue
            self.sequences.add(tick.sequence)
            self.recent.append(tick.sequence)
            if len(self.recent) > 8192:
                self.sequences.remove(self.recent.popleft())
            side = {self.pb.TickerDirection_Bid: False, self.pb.TickerDirection_Ask: True}.get(tick.dir)
            yield dict(type='trade', t=t, price=tick.price, qty=qty, sell=side, **self.fields)

    def depth(self, body):
        if not self.matches(body) or body.orderBookType != self.pb.OrderBookType_Normal:
            return
        def ladder(rows):
            return [[r.price, quantity(r)] for r in rows[:10] if
                    all(math.isfinite(v) and v > 0 for v in (r.price, quantity(r)))]
        bids, asks = ladder(body.orderBookBidList), ladder(body.orderBookAskList)
        if (min(len(bids), len(asks)) < 2 or bids[0][0] >= asks[0][0] or
                any(a[0] <= b[0] for a, b in zip(bids, bids[1:])) or
                any(a[0] >= b[0] for a, b in zip(asks, asks[1:]))):
            yield status('reset', 'Waiting for multiple ordered Moomoo bid and ask levels.')
            return
        t = min(timestamp(body.svrRecvTimeBidTimestamp, body.svrRecvTimeBid),
                timestamp(body.svrRecvTimeAskTimestamp, body.svrRecvTimeAsk))
        yield dict(type='depth', t=t or time.time_ns() // 1_000_000, bids=bids, asks=asks,
                   timeBasis='Moomoo server receipt' if t else 'local receipt', **self.fields)


def equity_events(symbol):
    yield status('connecting', f'Connecting US.{symbol} to Moomoo OpenD on 127.0.0.1:11111.')
    try:
        import moomoo as mm
        from moomoo.common.constant import ContextStatus
    except ImportError:
        yield status('error', 'Install moomoo-api from requirements-market.txt in the server environment.')
        return
    records = MoomooRecords(symbol)
    queue = Queue(maxsize=8192)
    failed = Event()
    error = 'The Moomoo consumer fell behind. Reconnect to start a fresh session.'

    def handle(response, decode):
        nonlocal error
        if failed.is_set():
            return
        try:
            if response.retType != mm.RET_OK:
                raise ValueError(response.retMsg)
            for event in decode(response.s2c):
                queue.put_nowait(event)
        except Full:
            failed.set()
        except Exception as exc:
            error = f'Moomoo push error: {exc}'
            failed.set()

    class Trades(mm.TickerHandlerBase):
        def on_recv_rsp(self, response):
            handle(response, records.trades)

    class Book(mm.OrderBookHandlerBase):
        def on_recv_rsp(self, response):
            handle(response, records.depth)

    ctx = None
    try:
        ctx = mm.OpenQuoteContext(host='127.0.0.1', port=11111, is_async_connect=True)
        deadline = time.monotonic() + 6
        while ctx.status != ContextStatus.READY:
            if time.monotonic() >= deadline:
                raise ValueError('Open Moomoo OpenD, sign in, and start the API on 127.0.0.1:11111.')
            time.sleep(.1)
        connection = ctx.get_sync_conn_id()
        ctx.set_handler(Trades())
        ctx.set_handler(Book())
        code, msg = ctx.subscribe(['US.' + symbol], [mm.SubType.TICKER, mm.SubType.ORDER_BOOK],
                                  is_first_push=False, extended_time=True)
        if code != mm.RET_OK:
            raise ValueError(f'US.{symbol} Moomoo subscription failed: {msg}')
        yield dict(type='instrument', contract=symbol, **records.fields)
        yield status('live', 'Moomoo subscribed. Waiting for trades and order book pushes.')
        while not failed.is_set():
            if ctx.status != ContextStatus.READY or ctx.get_sync_conn_id() != connection:
                raise ValueError('Moomoo OpenD disconnected. Reconnect to start a fresh session.')
            try:
                yield queue.get(timeout=.5)
            except Empty:
                yield None
        raise ValueError(error)
    except (ValueError, OSError, RuntimeError) as exc:
        yield status('error', str(exc))
    finally:
        if ctx is not None:
            ctx.close()
