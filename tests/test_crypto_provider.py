import io
import unittest
from unittest.mock import Mock, patch
from providers.crypto_provider import crypto_events

class CryptoRelayTest(unittest.TestCase):
    def test_rejects_unknown_symbols_without_starting_a_process(self):
        with self.assertRaises(ValueError):
            next(crypto_events('NOTALLOWED'))

    def test_disconnect_closes_child_process(self):
        child=Mock()
        child.stdout=io.BytesIO(b'{"type":"trade","t":1,"price":100,"qty":1,"sell":false}\n{"type":"trade","price":101}\n')
        child.poll.return_value=None
        with patch('providers.crypto_provider.subprocess.Popen',return_value=child),patch('providers.crypto_provider.select.select',side_effect=[([child.stdout],[],[])]):
            stream=crypto_events('BTCUSDT')
            self.assertEqual(next(stream)['price'],100)
            self.assertEqual(next(stream)['price'],101)
            stream.close()
        child.terminate.assert_called_once()
        child.wait.assert_called_once()
