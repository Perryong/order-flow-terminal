"""Read-only XAU/USD prices for the local terminal."""
import json
import math
import os
import re
import threading
import time
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import quote as urlquote
from urllib.request import Request, urlopen

_URL = "https://api.gold-api.com/price/XAU"
_lock = threading.Lock()
_next_request = 0
_cached = None
_error = None


def _normalize(payload):
    if payload["symbol"] != "XAU" or payload["currency"] != "USD":
        raise ValueError("unexpected instrument")
    price = float(payload["price"])
    if not math.isfinite(price) or price <= 0:
        raise ValueError("invalid spot price")
    return {
        "type": "spot", "provider": "Gold-API.com", "t": _source_time(payload["updatedAt"]),
        "price": price,
    }


def _source_time(raw):
    # RFC 3339 includes the timezone, and OANDA can send nanosecond precision.
    # Older Python versions accept precisely six fractional digits.
    raw = re.sub(r"\.(\d+)", lambda m: "." + m[1][:6].ljust(6, "0"), raw, count=1)
    at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if at.tzinfo is None:
        raise ValueError("missing timestamp timezone")
    timestamp_ms = int(at.timestamp() * 1000)
    if timestamp_ms <= 0 or timestamp_ms > (time.time() + 30) * 1000:
        raise ValueError("invalid source time")
    return timestamp_ms


def _oanda_quote(payload, environment):
    row, = payload["prices"]
    if row["instrument"] != "XAU_USD" or row.get("status") == "invalid":
        raise ValueError("invalid spot instrument")
    bid = max(float(level["price"]) for level in row["bids"])
    ask = min(float(level["price"]) for level in row["asks"])
    if not (math.isfinite(bid) and math.isfinite(ask) and 0 < bid <= ask):
        raise ValueError("invalid bid/ask")
    return {
        "type": "spot", "provider": "OANDA " + environment, "t": _source_time(row["time"]),
        "price": (bid + ask) / 2, "bid": bid, "ask": ask,
        "tradeable": row.get("tradeable", row.get("status") == "tradeable"),
    }


def _request():
    token = os.environ.get("OANDA_TOKEN", "").strip()
    account = os.environ.get("OANDA_ACCOUNT_ID", "").strip()
    environment = os.environ.get("OANDA_ENV", "").strip().lower()
    if not (token or account or environment):
        return Request(_URL, headers={"Accept": "application/json"}), None
    if not (token and account and environment in ("practice", "live")):
        raise RuntimeError("Set OANDA_ENV to practice or live and provide OANDA_TOKEN and OANDA_ACCOUNT_ID")
    host = "api-fxpractice" if environment == "practice" else "api-fxtrade"
    url = f"https://{host}.oanda.com/v3/accounts/{urlquote(account, safe='')}/pricing?instruments=XAU_USD"
    return Request(url, headers={"Authorization": "Bearer " + token}), environment


def get_spot_quote():
    """Return an event dictionary or raise RuntimeError for an unavailable quote."""
    global _cached, _error, _next_request
    with _lock:
        if time.monotonic() >= _next_request:
            interval = 10
            try:
                request, environment = _request()
                if environment:
                    interval = 2
                with urlopen(request, timeout=8) as response:
                    payload = json.load(response)
                    quote = _oanda_quote(payload, environment) if environment else _normalize(payload)
                if _cached and quote["t"] < _cached["t"]:
                    raise ValueError("source time moved backwards")
                _cached, _error = quote, None
            except RuntimeError as exc:
                _error = str(exc)
            except HTTPError as exc:
                _error = f"Spot provider returned HTTP {exc.code}"
                retry = exc.headers.get("Retry-After", "")
                if retry.isdigit():
                    interval = max(interval, int(retry))
            except (OSError, ValueError, TypeError, AttributeError, KeyError, OverflowError) as exc:
                _error = f"Spot quote unavailable ({type(exc).__name__})"
            _next_request = time.monotonic() + interval
        if _error:
            if _cached:
                return {**_cached, "stale": True, "cached": True}
            raise RuntimeError(_error)
        return dict(_cached)
