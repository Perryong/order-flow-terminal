"""Timestamped reference prices independent of the scanner's licensed event feeds."""
import json
import math
import re
import time
from threading import Lock
from urllib.parse import quote
from urllib.request import Request, urlopen

_LOCK = Lock()
_CACHE = {}


def reference_quote(symbol):
    if symbol not in {'NVDA', 'AMD', 'INTC', 'GLD', 'GC'}:
        raise ValueError('Unsupported market')
    with _LOCK:
        saved = _CACHE.get(symbol)
        if saved and time.monotonic() - saved[0] < 60:
            return saved[1]
    ticker = 'GC=F' if symbol == 'GC' else symbol
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(ticker) + '?range=5d&interval=1d'
    try:
        with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=5) as response:
            meta = json.load(response)['chart']['result'][0]['meta']
        price, ts = float(meta['regularMarketPrice']), int(meta['regularMarketTime'])
        if meta['symbol'] != ticker or not math.isfinite(price) or price <= 0 or ts <= 0:
            raise ValueError('Invalid quote')
        name = meta.get('shortName', ticker)
        if symbol == 'GC' and (meta.get('exchangeName') != 'CMX' or not re.fullmatch(r'Gold [A-Za-z]{3} \d{2,4}', name)):
            raise ValueError('Unidentified COMEX contract')
        result = {'symbol': symbol, 'label': name, 't': ts * 1000,
                  'price': price, 'provider': 'Yahoo Finance'}
    except Exception as error:
        raise RuntimeError('Reference price unavailable') from error
    with _LOCK:
        _CACHE[symbol] = (time.monotonic(), result)
    return result
