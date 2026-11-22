"""Bounded Node/frontend patch; preserve Go, downloads, secrets and live data.

Run prepare|activate|rollback in a private client-ui-* backup with plan.json and
patch.tar.gz. Plan lists exact old/new SHA256 values. No external dependencies.
Run verify-cache [base-url] from a checkout for a read-only public cache check.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = Path('/www/wwwroot/voice.eliyork.com')
PUBLIC_URL = 'https://voice.eliyork.com'
STARTUP_PATHS = ('/style.css', '/script.js', '/js/room/boot-runtime.js')
PIIK_CLIENT_PATH = '/vendor/piik-client.js'
PIIK_CLIENT_FILE = 'integrations/piik/.build/client.js'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def run(*args, **kwargs):
    return subprocess.check_output(args, stderr=subprocess.STDOUT, **kwargs)


def processes():
    return json.loads(run('pm2', 'jlist'))


def voice(state):
    return next(p for p in state if p['name'] == 'voice-room')


def protected(state):
    return {p['name']: [p['pid'], p['pm2_env'].get('restart_time')]
            for p in state if p['name'] != 'voice-room'}


def replace(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.ui-next')
    shutil.copy2(source, temporary)
    temporary.chmod(0o644)
    os.replace(temporary, destination)


def apply_release(destination):
    for name in written_files:
        staged = backup / 'after' / name
        assert sha(staged) == plan['files'][name]['new'], 'Invalid staged hash: ' + name
        replace(staged, destination / name)
    for name in removed_files:
        (destination / name).unlink()
    replace(backup / 'after' / 'voice-build-manifest.json', destination / 'voice-build-manifest.json')


def health(base, revision):
    for _ in range(60):
        try:
            data = json.load(urllib.request.urlopen(base + '/healthz', timeout=3))
            if data.get('ok') and data.get('mediaReady') and data.get('build') == revision:
                return data
        except Exception:
            pass
        time.sleep(.25)
    raise RuntimeError('Health failed: ' + base)


def verify_startup_cache(base, html=None, expected_piik=None):
    base = base.rstrip('/')
    if html is None:
        request = urllib.request.Request(base + '/room/lobby', headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=10) as response:
            html = response.read().decode()

    paths = STARTUP_PATHS
    if expected_piik is not None or re.search(r'["\']' + re.escape(PIIK_CLIENT_PATH) + r'(?=[?"\'])', html):
        paths += (PIIK_CLIENT_PATH,)
    checked = {}
    for path in paths:
        versions = set(re.findall(r'["\']' + re.escape(path) + r'\?v=([0-9a-f]{64})["\']', html))
        if len(versions) != 1:
            raise RuntimeError(f'{base}/room/lobby must advertise one SHA-256 version for {path}')
        version, = versions
        if path == PIIK_CLIENT_PATH and expected_piik is not None and version != expected_piik:
            raise RuntimeError(f'{base}{path} version does not match the release manifest')
        stale = ('1' if version[0] == '0' else '0') + version[1:]
        cases = (
            (f'?v={version}', {'public', 'max-age=31536000', 'immutable'}),
            ('', {'no-cache'}),
            (f'?v={stale}', {'no-cache'}),
            (f'?v={version}&v={version}', {'no-cache'}),
        )
        for query, expected in cases:
            url = base + path + query
            request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(request, timeout=10) as response:
                directives = {part.strip().lower() for header in response.headers.get_all('Cache-Control', [])
                              for part in header.split(',')}
                if directives != expected:
                    raise RuntimeError(f'{url} Cache-Control expected {sorted(expected)}, got {sorted(directives)}')
                if 'immutable' in expected and hashlib.sha256(response.read()).hexdigest() != version:
                    raise RuntimeError(f'{url} body SHA-256 does not match the room HTML')
        checked[path] = version
    return checked


def restart(revision):
    env = {**os.environ, 'VOICE_BUILD_ID': revision}
    run('pm2', 'restart', 'voice-room', '--update-env', env=env)
    return health('http://127.0.0.1:3000', revision)


def rollback():
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    for name, expected in snapshot['before'].items():
        source = backup / 'before' / name
        assert sha(source) == expected, 'Backup damaged: ' + name
    run('pm2', 'stop', 'voice-room')
    for name, expected in snapshot['before'].items():
        if expected is None:
            (ROOT / name).unlink(missing_ok=True)
        else:
            replace(backup / 'before' / name, ROOT / name)
    result = restart(snapshot['build'])
    assert sha(ROOT / '.env') == snapshot['envHash']
    assert protected(processes()) == snapshot['protected']
    run('pm2', 'save')
    print(json.dumps({'rolledBack': True, 'health': result}))


if sys.argv[1:2] == ['verify-cache']:
    url = sys.argv[2] if len(sys.argv) > 2 else PUBLIC_URL
    print(json.dumps(verify_startup_cache(url)))
    sys.exit(0)

os.umask(0o077)
os.environ['PATH'] = '/www/server/nodejs/v24.15.0/bin:' + os.environ['PATH']
mode, location = sys.argv[1:3]
backup = Path(location)
assert backup.parent == Path('/www/backup/voice-deploy')
assert re.fullmatch(r'client-ui-[0-9T-]+', backup.name)
plan = json.loads((backup / 'plan.json').read_text())
assert re.fullmatch('[a-f0-9]{40}', plan['revision'])
for name in plan['files']:
    assert '..' not in Path(name).parts and not name.startswith('/')
    assert name.startswith('src/') or name in {
        PIIK_CLIENT_FILE,
        'integrations/piik/.build/third-party-web.txt',
    }, name
    if plan['files'][name]['new'] is None:
        assert plan['files'][name]['old'] is not None, name

written_files = {name for name, hashes in plan['files'].items() if hashes['new'] is not None}
removed_files = set(plan['files']) - written_files

if mode == 'prepare':
    assert not (backup / 'snapshot.json').exists()
    assert sha(ROOT / 'voice-build-manifest.json') == plan['beforeManifestHash']
    assert sha(backup / 'patch.tar.gz') == plan['archiveHash']
    old_manifest = json.loads((ROOT / 'voice-build-manifest.json').read_text())
    assert old_manifest['piik'] == plan['piik']
    # Dependencies and deployed runtime must match the declared starting point.
    assert json.loads((ROOT / 'package-lock.json').read_text()) == plan['dependencyLock']
    for name, expected in old_manifest['files'].items():
        if name.startswith('src/') or name.startswith('integrations/piik/.build/'):
            assert sha(ROOT / name) == expected, 'Production drift: ' + name
    after = backup / 'after'
    after.mkdir()
    with tarfile.open(backup / 'patch.tar.gz') as archive:
        assert len(archive.getmembers()) == len(written_files)
        assert set(archive.getnames()) == written_files
        for member in archive.getmembers():
            assert member.isfile()
            content = archive.extractfile(member).read()
            assert hashlib.sha256(content).hexdigest() == plan['files'][member.name]['new']
            target = after / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    state = processes()
    current = voice(state)
    assert current['pm2_env']['status'] == 'online'
    assert current['pm2_env']['pm_cwd'] == str(ROOT)
    before = {}
    for name in [*plan['files'], 'voice-build-manifest.json']:
        before[name] = sha(ROOT / name)
        if name in plan['files']:
            assert before[name] == plan['files'][name]['old'], 'Starting hash mismatch: ' + name
        if before[name] is not None:
            target = backup / 'before' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
            assert sha(target) == before[name]
    (backup / 'pm2-before.json').write_text(json.dumps(state))
    # Private complete code/data/env and Nginx/TLS snapshot; rollback never rewinds chat.
    with tarfile.open(backup / 'safety-snapshot.tar.gz', 'w:gz') as archive:
        for name in ['src', 'integrations/piik', 'package.json', 'package-lock.json', '.env', 'data', 'voice-build-manifest.json']:
            if (ROOT / name).exists(): archive.add(ROOT / name, arcname='site/' + name)
        for path in ['/www/server/panel/vhost/nginx/voice.eliyork.com.conf',
                     '/www/server/panel/vhost/nginx/proxy/voice.eliyork.com',
                     '/www/server/panel/vhost/nginx/extension/voice.eliyork.com',
                     '/www/server/panel/vhost/nginx/rewrite/voice.eliyork.com.conf',
                     '/www/server/panel/vhost/nginx/well-known/voice.eliyork.com.conf',
                     '/www/server/panel/vhost/cert/voice.eliyork.com',
                     '/www/server/nginx/conf/nginx.conf', '/root/.pm2/dump.pm2']:
            if Path(path).exists(): archive.add(path, arcname=path.lstrip('/'))
    snapshot = {'before': before, 'envHash': sha(ROOT / '.env'),
                'protected': protected(state), 'build': current['pm2_env']['VOICE_BUILD_ID']}
    (backup / 'snapshot.json').write_text(json.dumps(snapshot, indent=2))
    (backup / 'rollback.sh').write_text(f'#!/bin/sh\nset -eu\nexec python3 "{backup}/deploy.py" rollback "{backup}"\n')
    (backup / 'rollback.sh').chmod(0o700)
    files = {name: digest for name, digest in old_manifest['files'].items() if name not in removed_files}
    files.update({name: plan['files'][name]['new'] for name in written_files})
    manifest = {**old_manifest, 'revision': plan['revision'], 'frontendRevision': plan['revision'],
                'deployedAt': time.time(), 'files': files}
    (after / 'voice-build-manifest.json').write_text(json.dumps(manifest, indent=2))
    candidate = backup / 'candidate'
    candidate.mkdir()
    shutil.copytree(ROOT / 'src', candidate / 'src')
    shutil.copytree(ROOT / 'integrations/piik', candidate / 'integrations/piik')
    for name in ['package.json', 'package-lock.json', '.env']:
        shutil.copy2(ROOT / name, candidate / name)
    (candidate / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    apply_release(candidate)
    child_env = {**os.environ, **{k:v for k,v in current['pm2_env'].items() if isinstance(v, str)},
                 'PORT': '17888', 'HOST': '127.0.0.1', 'USE_HTTPS': 'false',
                 'VOICE_BUILD_ID': plan['revision'], 'CHAT_HISTORY_FILE': str(backup / 'candidate-chat.json')}
    with (backup / 'candidate.log').open('w') as log:
        child = subprocess.Popen(['node', str(candidate / 'src/server.js')], cwd=candidate, env=child_env, stdout=log, stderr=subprocess.STDOUT)
        try:
            result = health('http://127.0.0.1:17888', plan['revision'])
            html = urllib.request.urlopen('http://127.0.0.1:17888/room/lobby').read().decode()
            assert 'share-dialog-title' in html
            assert 'data-share-action="stop"' in html
            assert plan['revision'] in html
            startup_cache = verify_startup_cache('http://127.0.0.1:17888', html, files.get(PIIK_CLIENT_FILE))
            available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))
            assert available > 160 * 1024, 'Insufficient candidate memory headroom'
            (backup / 'prepared.json').write_text(json.dumps({'health': result, 'availableKiB': available,
                                                              'startupAssetCache': startup_cache}))
        finally:
            child.terminate()
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
    print('Backup hashes and isolated candidate passed:', backup)
elif mode == 'rollback':
    rollback()
elif mode == 'activate':
    prepared = json.loads((backup / 'prepared.json').read_text())
    staged_manifest = json.loads((backup / 'after' / 'voice-build-manifest.json').read_text())
    piik_version = staged_manifest['files'].get(PIIK_CLIENT_FILE)
    if piik_version is not None:
        assert prepared.get('startupAssetCache', {}).get(PIIK_CLIENT_PATH) == piik_version, 'Prepare this Piik bundle before activation'
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    assert sha(ROOT / '.env') == snapshot['envHash']
    for name, expected in snapshot['before'].items():
        assert sha(ROOT / name) == expected, 'Production changed after backup: ' + name
    started = time.time()
    try:
        run('pm2', 'stop', 'voice-room')
        apply_release(ROOT)
        result = restart(plan['revision'])
        local_seconds = round(time.time() - started, 2)
        public = health(PUBLIC_URL, plan['revision'])
        public_seconds = round(time.time() - started, 2)
        startup_cache = verify_startup_cache(PUBLIC_URL, expected_piik=piik_version)
        assert sha(ROOT / '.env') == snapshot['envHash']
        assert protected(processes()) == snapshot['protected']
        run('pm2', 'save')
        report = {'revision': plan['revision'], 'health': result, 'public': public, 'startupAssetCache': startup_cache,
                  'stopToLocalHealthySeconds': local_seconds, 'stopToPublicHealthySeconds': public_seconds,
                  'backup': str(backup), 'changedFiles': len(plan['files'])}
        (backup / 'result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    except Exception:
        rollback()
        raise
else:
    raise ValueError(mode)
