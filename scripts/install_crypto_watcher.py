"""Install or update the signed-in Mac user's read-only Tapescope watcher."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
FILES = ('alerts/watch_crypto_setups.js', 'alerts/crypto_exits.js', 'core/engine.js', 'core/live-feed.js', 'core/swing.js')
LABEL = 'com.tapescope.crypto-setups'


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(data)
    os.replace(f.name, path)


def bootstrap(domain, plist):
    # launchd may keep a just-removed job registered while its process exits.
    for attempt in range(25):
        result = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True)
        if result.returncode == 0:
            return
        if attempt < 24:
            time.sleep(.4)
    raise subprocess.CalledProcessError(result.returncode, result.args, stderr=result.stderr)


def main():
    node = shutil.which('node')
    if sys.platform != 'darwin' or not node:
        raise SystemExit('Run this installer on macOS with Node.js on your path.')
    subprocess.run([node, '-e', "if (![WebSocket,fetch,AbortSignal.timeout].every(Boolean)) process.exit(1)"], check=True)
    directory = Path.home() / 'Library/Application Support/Tapescope/crypto-alerts'
    plist = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    domain = 'gui/' + str(os.getuid())
    job = domain + '/' + LABEL
    for name in FILES:
        atomic_write(directory / name, (ROOT / name).read_bytes())
    subprocess.run([node, '-e', "require('./alerts/watch_crypto_setups.js')"], cwd=directory, check=True)
    previous = plist.read_bytes() if plist.exists() else None
    config = plistlib.dumps(dict(Label=LABEL, KeepAlive=True, RunAtLoad=True, ThrottleInterval=10,
                                 ProgramArguments=[node, str(directory / FILES[0]), str(directory / 'status.json')]))
    loaded = subprocess.run(['launchctl', 'print', job], capture_output=True).returncode == 0
    atomic_write(plist, config)
    if loaded:
        subprocess.run(['launchctl', 'bootout', job], check=True)
    try:
        bootstrap(domain, plist)
        subprocess.run(['launchctl', 'kickstart', job], check=True)
    except subprocess.CalledProcessError:
        if previous is not None:
            subprocess.run(['launchctl', 'bootout', job], capture_output=True)
            atomic_write(plist, previous)
            if loaded:
                bootstrap(domain, plist)
        raise
    print('Started', LABEL)


if __name__ == '__main__':
    main()
