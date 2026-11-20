"""Serve Tapescope on localhost or an explicitly selected private LAN address."""
import argparse
import ipaddress
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
       ('index.html', 'terminal.css', 'terminal.js', 'chart.js', 'swing.html', 'swing.css', 'swing-view.js', 'config.js')},
    **{name: ROOT / 'core' / name for name in
       ('engine.js', 'session.js', 'markets.js', 'live-feed.js', 'spot-feed.js', 'volume-profile.js', 'profile-confirmation.js', 'backend.js')},
    **{name: ROOT / name for name in
       ('README.md', 'research/orderflow_report.py', 'research/report.html',
        'research/multi-market-order-flow.md', 'ninjatrader/Strategies/OrderFlowSetupAtm.cs')},
}


class Handler(BaseHTTPRequestHandler):
    API_PATHS = {'/api/market', '/api/reference', '/api/spot', '/api/swing', '/api/crypto', '/api/health'}

    def allowed_host(self):
        port = self.server.server_port
        hosts = {f'localhost:{port}', f'127.0.0.1:{port}', f'{self.server.server_address[0]}:{port}'}
        public = getattr(self.server, 'public_origin', '')
        if public:
            hosts.add(urlsplit(public).netloc)
        return self.headers.get('Host') in hosts

    def allowed_origin(self):
        host = self.headers.get('Host')
        origin = self.headers.get('Origin')
        public = getattr(self.server, 'public_origin', '')
        allowed = {f'http://{host}', public} | getattr(self.server, 'cors_origins', set())
        if origin:
            return origin in allowed
        return self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def end_headers(self):
        origin = self.headers.get('Origin')
        if origin and self.allowed_host() and self.allowed_origin() and urlsplit(self.path).path in self.API_PATHS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def do_OPTIONS(self):
        if (not self.allowed_host() or not self.allowed_origin() or not self.headers.get('Origin')
                or urlsplit(self.path).path not in self.API_PATHS
                or self.headers.get('Access-Control-Request-Method') != 'GET'):
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        if self.headers.get('Access-Control-Request-Private-Network') == 'true':
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_GET(self):
        if not self.allowed_host():
            self.send_error(403, 'Use the terminal address printed by this server.')
            return
        url = urlsplit(self.path)
        if url.path in self.API_PATHS:
            if not self.allowed_origin():
                self.send_error(403, 'Open this endpoint from the configured terminal.')
                return
            if url.path == '/api/health':
                self.send_json(200, {'service': 'Tapescope', 'mode': 'read-only'})
                return
            if url.path == '/api/crypto':
                from providers.crypto_provider import crypto_events, SYMBOLS
                symbols = parse_qs(url.query).get('symbol', [])
                if len(symbols) != 1 or symbols[0] not in SYMBOLS:
                    self.send_error(400, 'Choose BTCUSDT, ETHUSDT or SOLUSDT.')
                    return
                self.stream(symbols[0], crypto_events)
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

    def stream(self, symbol, source=equity_events):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        self.connection.settimeout(5)
        try:
            with closing(source(symbol)) as events:
                for event in events:
                    wire = ': keepalive' if event is None else 'data: ' + json.dumps(event, separators=(',', ':'), allow_nan=False)
                    self.wfile.write((wire + '\n\n').encode())
        except (ConnectionError, TimeoutError):
            pass


def bind_host(value):
    try:
        address = ipaddress.IPv4Address(value)
        if value == '127.0.0.1' or any(address in ipaddress.ip_network(network)
                                      for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
            return str(address)
    except ipaddress.AddressValueError:
        pass
    raise argparse.ArgumentTypeError('Use 127.0.0.1 or this Mac\'s specific private IPv4 address.')


def https_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError('Use an HTTPS origin without credentials, a path or query.')
    return f'https://{parsed.netloc}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8791)
    parser.add_argument('--host', type=bind_host, default='127.0.0.1',
                        help='127.0.0.1 by default; use the Mac\'s private IPv4 address for same-Wi-Fi access')
    parser.add_argument('--public-origin', type=https_origin, default='')
    parser.add_argument('--allow-origin', type=https_origin, action='append', default=[])
    args = parser.parse_args()
    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        server.public_origin = args.public_origin
        server.cors_origins = set(args.allow_origin)
        print(f'Order flow terminal at http://{args.host}:{server.server_port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
