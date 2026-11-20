"""Read-only Binance relay using the same Node WebSocket runtime as local watchers."""
import json
import os
import select
import subprocess
from pathlib import Path

SYMBOLS = {'BTCUSDT', 'ETHUSDT', 'SOLUSDT'}
ROOT = Path(__file__).resolve().parents[1]


def crypto_events(symbol):
    if symbol not in SYMBOLS:
        raise ValueError('Choose BTCUSDT, ETHUSDT or SOLUSDT.')
    process = subprocess.Popen([os.environ.get('TAPESCOPE_NODE', 'node'), str(ROOT / 'scripts/stream_crypto.js'), symbol],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    pending = b''
    try:
        while True:
            if not select.select([process.stdout], [], [], 5)[0]:
                yield None
                continue
            chunk = process.stdout.read1(65536)
            if not chunk:
                yield {'type': 'status', 'state': 'error', 'message': 'Mac crypto relay stopped. Reconnect to retry.'}
                return
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                yield json.loads(line)
            if len(pending) > 2 * 1024 * 1024:
                raise ValueError('Invalid relay message size')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
