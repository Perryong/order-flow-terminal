"""Run with python -m unittest tests.test_market_provider. SDK tests never connect externally."""
import http.client
import json
import os
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from providers.market_provider import MarketRecords, MarketStream, subscription
from server import Handler, ThreadingHTTPServer

try:
    import databento as db
except ImportError:
    db = None


@unittest.skipUnless(db, 'Install requirements-market.txt for real DBN record tests')
class RecordsTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GC_CONTRACT': ''})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.feed = MarketRecords(db, 'NVDA')

    def mapping(self, feed, raw=None, instrument=12):
        raw = raw or feed.requested
        record = db.SymbolMappingMsg(0, instrument, 0, db.SType.from_str(feed.stype),
                                     feed.requested, db.SType.RAW_SYMBOL, raw, 0, 2**64 - 1)
        return feed.events(record)

    def book(self, feed, action=db.Action.TRADE if db else None,
             side=None, millis=1100, flags=0, instrument=12, publisher=None, best=None):
        levels = [best or db.BidAskPair(100_000_000_000, 101_000_000_000, 8, 9)] + [db.BidAskPair()] * 9
        record = db.MBP10Msg(feed.publisher_id if publisher is None else publisher, instrument,
                             millis * 1_000_000, 100_500_000_000, 3, action, side or db.Side.NONE, 0,
                             millis * 1_000_000, flags=flags, levels=levels)
        return feed.events(record)

    def test_real_dbn_unknown_side_and_trade_through_depth_sampling(self):
        self.assertEqual(self.mapping(self.feed)[0], {'type': 'instrument', 'dataset': 'XNAS.ITCH', 'contract': 'NVDA'})
        trade, depth = self.book(self.feed)
        self.assertIsNone(trade['sell'])
        self.assertEqual((trade['t'], trade['price'], trade['qty']), (1100, 100.5, 3))
        self.assertEqual((depth['bids'], depth['asks']), ([[100.0, 8]], [[101.0, 9]]))
        for side, sell in [(db.Side.BID, False), (db.Side.ASK, True)]:
            events = self.book(self.feed, side=side, millis=1110)
            self.assertEqual(len(events), 1)
            self.assertIs(events[0]['sell'], sell)
        self.assertEqual(self.book(self.feed, action=db.Action.CANCEL, millis=1200)[0]['type'], 'depth')

    def test_raw_and_volume_mapping_and_venue_isolation(self):
        for symbol in ('NVDA', 'AMD', 'INTC'):
            self.assertEqual(subscription(symbol), ('XNAS.ITCH', symbol, 'raw_symbol'))
        feed = MarketRecords(db, 'GC')
        self.assertEqual((feed.dataset, feed.requested, feed.stype), ('GLBX.MDP3', 'GC.v.0', 'continuous'))
        with self.assertRaisesRegex(ValueError, 'mapping'):
            self.book(feed)
        with self.assertRaisesRegex(ValueError, 'dated'):
            self.mapping(feed, 'GC.v.0')
        self.assertEqual(self.mapping(feed, 'GCZ6')[0]['contract'], 'GCZ6')
        self.assertEqual(self.book(feed)[0]['contract'], 'GCZ6')
        self.assertEqual(self.book(feed, instrument=88), [])
        self.assertEqual(self.book(feed, publisher=self.feed.publisher_id), [])
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.mapping(feed, 'GCG7', 99)
        with patch.dict(os.environ, {'GC_CONTRACT': 'GCG7'}):
            feed = MarketRecords(db, 'GC')
            self.assertEqual(feed.stype, 'raw_symbol')
            record = db.SymbolMappingMsg(0, 12, 0, db.SType.RAW_SYMBOL, 'GCG7',
                                         db.SType.INSTRUMENT_ID, '12', 0, 2**64 - 1)
            self.assertEqual(feed.events(record)[0]['contract'], 'GCG7')

    def test_gap_clear_and_unrecoverable_dropped_records(self):
        self.mapping(self.feed)
        self.book(self.feed)
        self.assertEqual(self.book(self.feed, flags=4, millis=1101)[0]['state'], 'reset')
        self.assertEqual(self.book(self.feed, flags=4, millis=1102), [])
        self.assertEqual(self.book(self.feed, action=db.Action.MODIFY, millis=1103)[0]['type'], 'depth')
        cleared = self.book(self.feed, action=db.Action.CLEAR, millis=1104)
        self.assertEqual([(e['state'], e['t']) for e in cleared], [('reset', 1104)])
        self.assertEqual(self.book(self.feed, action=db.Action.ADD, millis=1105)[0]['type'], 'depth')
        error = db.ErrorMsg(0, 'skipped', code=db.ErrorCode.SKIPPED_RECORDS_AFTER_SLOW_READING)
        with self.assertRaisesRegex(ValueError, 'skipped'):
            self.feed.events(error)

    def test_one_sided_transition_resets_before_trade_and_restores_snapshot(self):
        self.mapping(self.feed)
        self.book(self.feed)
        one = db.BidAskPair(bid_px=100_000_000_000, bid_sz=5)
        reset, trade = self.book(self.feed, millis=1101, best=one)
        self.assertEqual((reset['state'], trade['type']), ('reset', 'trade'))
        self.assertEqual(self.book(self.feed, millis=1102, action=db.Action.MODIFY, best=db.BidAskPair()), [])
        restored = self.book(self.feed, millis=1103, action=db.Action.ADD)
        self.assertEqual([e['type'] for e in restored], ['depth'])

    def test_disconnect_closes_independent_upstream_client(self):
        class IdleLive:
            def __init__(self, **kwargs):
                self.stopped = threading.Event()
                self.started = threading.Event()
                self.subscribed = None
                clients.append(self)

            def subscribe(self, **params):
                self.subscribed = params

            def __iter__(self):
                self.started.set()
                self.stopped.wait(2)
                return iter(())

            def terminate(self):
                self.stopped.set()

        clients = []
        with patch.dict(os.environ, {'DATABENTO_API_KEY': 'offline'}), patch.object(db, 'Live', IdleLive):
            stream1, stream2 = MarketStream('NVDA'), MarketStream('AMD')
            a, b = stream1.events(), stream2.events()
            try:
                for gen in (a, b):
                    self.assertEqual(next(gen)['state'], 'connecting')
                    self.assertIsNone(next(gen))
                self.assertEqual([c.subscribed['symbols'] for c in clients], ['NVDA', 'AMD'])
                a.close()
                self.assertTrue(stream1.done.wait(1))
                self.assertFalse(clients[1].stopped.is_set())
            finally:
                a.close()
                b.close()
            self.assertTrue(stream2.done.wait(1))


class HTTPTest(unittest.TestCase):
    def setUp(self):
        class QuietHandler(Handler):
            def log_message(self, *args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.02})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def get(self, path, headers=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        try:
            conn.request('GET', path, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.read().decode()
        finally:
            conn.close()

    def test_live_market_and_static_allowlists(self):
        self.assertEqual(self.get('/api/market?symbol=GC')[0], 400)
        self.assertEqual(self.get('/api/reference?symbol=GC')[0], 400)
        self.assertEqual(self.get('/api/market?symbol=MGC')[0], 400)
        self.assertEqual(self.get('/api/market?symbol=NVDA', {'Origin': 'https://example.org'})[0], 403)
        self.assertEqual(self.get('/', {'Host': 'example.org'})[0], 403)
        self.assertEqual(self.get('/')[0], 200)
        for path in ('/.env', '/.venv/pyvenv.cfg', '/market_provider.py', '/%2e%2e/README.md'):
            self.assertEqual(self.get(path)[0], 404)

    def test_reference_and_spot_response_contract(self):
        reference = Mock(return_value={'price': 2})
        spot = Mock(return_value={'type': 'quote'})
        with patch.dict(sys.modules, {'providers.reference_quotes': SimpleNamespace(reference_quote=reference),
                                      'providers.spot_provider': SimpleNamespace(get_spot_quote=spot)}):
            self.assertEqual(json.loads(self.get('/api/reference?symbol=GLD')[1]), {'price': 2})
            reference.assert_called_once_with('GLD')
            self.assertEqual(self.get('/api/reference?symbol=BAD')[0], 400)
            self.assertEqual(json.loads(self.get('/api/spot')[1]), {'type': 'quote'})
            reference.side_effect = RuntimeError('unavailable')
            spot.side_effect = RuntimeError('unavailable')
            self.assertEqual(self.get('/api/reference?symbol=GLD')[0], 502)
            self.assertEqual(self.get('/api/spot')[0], 503)
