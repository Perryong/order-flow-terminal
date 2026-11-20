"""Build only allowlisted static assets; never copy server config, recordings or credentials."""
import argparse
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def build(destination, api_origin=''):
    if api_origin:
        parsed = urlsplit(api_origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            raise ValueError('Use an HTTPS API origin without credentials or a path')
        api_origin = f'https://{parsed.netloc}'
    destination = Path(destination).resolve()
    if destination == ROOT or ROOT.is_relative_to(destination):
        raise ValueError('Build into a separate output directory')
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Use an empty build directory to avoid publishing unrelated files')
    destination.mkdir(parents=True, exist_ok=True)
    for source in list((ROOT / 'web').glob('*.html')) + list((ROOT / 'web').glob('*.css')) + list((ROOT / 'web').glob('*.js')):
        shutil.copy2(source, destination / source.name)
    for name in ('engine.js', 'session.js', 'volume-profile.js', 'live-feed.js', 'profile-confirmation.js', 'markets.js', 'spot-feed.js', 'backend.js'):
        shutil.copy2(ROOT / 'core' / name, destination / name)
    for name in ('README.md', 'research/orderflow_report.py', 'research/report.html', 'ninjatrader/Strategies/OrderFlowSetupAtm.cs'):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    (destination / 'config.js').write_text('window.TAPESCOPE_CONFIG = ' + json.dumps({'apiOrigin': api_origin}) + ';\n')
    (destination / '.nojekyll').touch()
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / '.pages-build'))
    parser.add_argument('--api-origin', default='')
    args = parser.parse_args()
    print(build(args.output, args.api_origin))
