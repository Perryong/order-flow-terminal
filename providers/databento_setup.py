"""Private, user-local credential for the Tapescope live scanner."""
import getpass
import os
from pathlib import Path
import tempfile

KEY_FILE = Path.home() / 'Library' / 'Application Support' / 'Tapescope' / 'databento.key'


def read_key():
    key = os.environ.get('DATABENTO_API_KEY', '').strip()
    if key:
        return key
    try:
        if KEY_FILE.stat().st_mode & 0o077:
            raise ValueError('Make the local Databento key file private (chmod 600), then reconnect.')
        return KEY_FILE.read_text().strip()
    except FileNotFoundError:
        return ''


def main():
    print('For COMEX gold, enable live GLBX.MDP3 MBP-10 access in your Databento account.')
    print('Paste your Databento API key below. Input stays hidden.')
    key = getpass.getpass('Databento key: ').strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit('No valid key entered. The saved credential was left unchanged.')
    KEY_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=KEY_FILE.parent, delete=False) as f:
        f.write(key + '\n')
    os.replace(f.name, KEY_FILE)
    print('Saved for this macOS user. Select a market or reconnect in Tapescope.')
    if os.environ.get('DATABENTO_API_KEY'):
        print('An environment key takes precedence in processes where it is set.')


if __name__ == '__main__':
    main()
