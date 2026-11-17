"""Serve the order flow terminal and its market-data endpoints on localhost."""
import argparse
import json
import mimetypes
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from providers.moomoo_provider import equity_events

ROOT = Path(__file__).resolve().parent
SWING_STATUS = Path.home() / 'Library/Application Support/Tapescope/crypto-alerts/status.json'
PUBLIC = {
    **{name: ROOT / 'web' / name for name in
       ('index.html', 'terminal.css', 'terminal.js', 'chart.js', 'swing.html', 'swing.css', 'swing-view.js')},
    **{name: ROOT / 'core' / name for name in
       ('engine.js', 'session.js', 'markets.js', 'live-feed.js', 'spot-feed.js')},
    **{name: ROOT / name for name in
       ('README.md', 'research/orderflow_report.py', 'research/report.html',
        'research/multi-market-order-flow.md', 'ninjatrader/Strategies/OrderFlowSetupAtm.cs')},
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host = self.headers.get('Host')
        port = self.server.server_port
        if host not in {f'localhost:{port}', f'127.0.0.1:{port}'}:
            self.send_error(403, 'Use the localhost address printed by this server.')
            return
        url = urlsplit(self.path)
        if url.path in ('/api/market', '/api/reference', '/api/spot', '/api/swing'):
            if (self.headers.get('Origin', f'http://{host}') != f'http://{host}'
                    or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
                self.send_error(403, 'Open this endpoint from the local terminal.')
                return
            if url.path == '/api/swing':
                try:
                    state = json.loads(SWING_STATUS.read_text())
                    data = {key: state[key] for key in ('checked', 'health', 'swing')}
                except (OSError, ValueError, KeyError, TypeError):
                    self.send_json(503, {'error': 'Waiting for the crypto swing watcher.'})
                    return
                self.send_json(200, data)
                return
            if url.path == '/api/spot':
                from providers.spot_provider import get_spot_quote
                try:
                    self.send_json(200, get_spot_quote())
                except RuntimeError as exc:
                    self.send_json(503, {'error': str(exc)})
                return
            symbols = parse_qs(url.query).get('symbol', [])
            if len(symbols) != 1 or symbols[0] not in {'NVDA', 'AMD', 'INTC', 'GLD'}:
                self.send_error(400, 'Choose NVDA, AMD, INTC or GLD.')
                return
            if url.path == '/api/reference':
                from providers.reference_quotes import reference_quote
                try:
                    data = reference_quote(symbols[0])
                except (ValueError, RuntimeError) as exc:
                    self.send_json(502, {'error': str(exc)})
                    return
                self.send_json(200, data)
                return
            self.stream(symbols[0])
            return
        name = 'index.html' if url.path == '/' else url.path.removeprefix('/')
        path = PUBLIC.get(name)
        if path is None or not path.is_file() or path.resolve() != path:
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        content_type = 'text/plain; charset=utf-8' if path.suffix == '.md' else mimetypes.guess_type(name)[0]
        self.send_header('Content-Type', content_type or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, code, data):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def stream(self, symbol):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        self.connection.settimeout(5)
        try:
            with closing(equity_events(symbol)) as events:
                for event in events:
                    wire = ': keepalive' if event is None else 'data: ' + json.dumps(event, separators=(',', ':'), allow_nan=False)
                    self.wfile.write((wire + '\n\n').encode())
        except (ConnectionError, TimeoutError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        print(f'Order flow terminal at http://127.0.0.1:{server.server_port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
