import unittest
from contextlib import closing
from unittest.mock import patch

from moomoo.common.constant import ContextStatus
from moomoo.common.pb import Qot_UpdateTicker_pb2, Qot_UpdateOrderBook_pb2
from providers.moomoo_provider import MoomooRecords, equity_events


class MoomooFeedTest(unittest.TestCase):
    def setUp(self):
        self.records = MoomooRecords('AMD')

    def test_subscription_requests_fresh_extended_hours_ticks(self):
        with patch('moomoo.OpenQuoteContext') as gateway, closing(equity_events('AMD')) as events:
            ctx = gateway.return_value
            ctx.status = ContextStatus.READY
            ctx.subscribe.return_value = (0, None)
            next(events)
            self.assertEqual(next(events)['type'], 'instrument')
            options = ctx.subscribe.call_args.kwargs
            self.assertTrue(options.get('extended_time', False))
            self.assertFalse(options['is_first_push'])

    def test_only_live_ticks_for_selected_symbol_once(self):
        msg = Qot_UpdateTicker_pb2.Response(retType=0)
        body = msg.s2c
        body.security.market, body.security.code = 11, 'AMD'
        for seq, direction, push in [(7, 1, 3), (8, 2, 1), (9, 3, 1), (8, 2, 1)]:
            body.tickerList.add(sequence=seq, dir=direction, pushDataType=push,
                                timestamp=1700000000.25, price=120, volume=5)
        trades = list(self.records.trades(body))
        self.assertEqual([(e['t'], e['sell'], e['qty']) for e in trades],
                         [(1700000000250, True, 5), (1700000000250, None, 5)])
        body.security.code = 'NVDA'
        self.assertFalse(list(self.records.trades(body)))

    def test_depth_uses_both_provider_clocks_or_marks_receipt_only(self):
        msg = Qot_UpdateOrderBook_pb2.Response(retType=0)
        book = msg.s2c
        book.security.market, book.security.code = 11, 'AMD'
        for p in (100, 99):
            book.orderBookBidList.add(price=p, volume=10)
            book.orderBookAskList.add(price=202-p, volume=20)
        book.svrRecvTimeBidTimestamp = 1700000000.5
        ev, = self.records.depth(book)
        self.assertEqual(ev['timeBasis'], 'local receipt')
        book.svrRecvTimeAskTimestamp = 1700000000.25
        ev, = self.records.depth(book)
        self.assertEqual((ev['t'],ev['timeBasis'],ev['asks'][0]),
                         (1700000000250, 'Moomoo server receipt', [102,20]))
        del book.orderBookAskList[1:]
        ev, = self.records.depth(book)
        self.assertEqual(ev['state'], 'reset')
