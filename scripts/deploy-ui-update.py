"""Bounded Node/frontend patch; preserve Go, downloads, secrets and live data.

Run prepare|activate|rollback in a private client-ui-* backup with plan.json and
patch.tar.gz. Plan lists exact old/new SHA256 values. No external dependencies.
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

os.umask(0o077)
os.environ['PATH'] = '/www/server/nodejs/v24.15.0/bin:' + os.environ['PATH']
ROOT = Path('/www/wwwroot/voice.eliyork.com')
mode, location = sys.argv[1:3]
backup = Path(location)
assert backup.parent == Path('/www/backup/voice-deploy')
assert re.fullmatch(r'client-ui-[0-9T-]+', backup.name)
plan = json.loads((backup / 'plan.json').read_text())
assert re.fullmatch('[a-f0-9]{40}', plan['revision'])
for name in plan['files']:
    assert '..' not in Path(name).parts and not name.startswith('/')
    assert name.startswith('src/') or name in {
        'integrations/piik/.build/client.js',
        'integrations/piik/.build/third-party-web.txt',
    }, name


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
        assert len(archive.getmembers()) == len(plan['files'])
        assert set(archive.getnames()) == set(plan['files'])
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
    manifest = {**old_manifest, 'revision': plan['revision'], 'frontendRevision': plan['revision'],
                'deployedAt': time.time(), 'files': {**old_manifest['files'], **{p:v['new'] for p,v in plan['files'].items()}}}
    (after / 'voice-build-manifest.json').write_text(json.dumps(manifest, indent=2))
    candidate = backup / 'candidate'
    candidate.mkdir()
    shutil.copytree(ROOT / 'src', candidate / 'src')
    shutil.copytree(ROOT / 'integrations/piik', candidate / 'integrations/piik')
    for name in ['package.json', 'package-lock.json', '.env']:
        shutil.copy2(ROOT / name, candidate / name)
    (candidate / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    for name in [*plan['files'], 'voice-build-manifest.json']:
        replace(after / name, candidate / name)
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
            available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))
            assert available > 160 * 1024, 'Insufficient candidate memory headroom'
            (backup / 'prepared.json').write_text(json.dumps({'health': result, 'availableKiB': available}))
        finally:
            child.terminate()
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
    print('Backup hashes and isolated candidate passed:', backup)
elif mode == 'rollback':
    rollback()
elif mode == 'activate':
    assert (backup / 'prepared.json').is_file()
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    assert sha(ROOT / '.env') == snapshot['envHash']
    for name, expected in snapshot['before'].items():
        assert sha(ROOT / name) == expected, 'Production changed after backup: ' + name
    started = time.time()
    try:
        run('pm2', 'stop', 'voice-room')
        for name in [*plan['files'], 'voice-build-manifest.json']:
            if name in plan['files']: assert sha(backup / 'after' / name) == plan['files'][name]['new']
            replace(backup / 'after' / name, ROOT / name)
        result = restart(plan['revision'])
        local_seconds = round(time.time() - started, 2)
        public = health('https://voice.eliyork.com', plan['revision'])
        assert sha(ROOT / '.env') == snapshot['envHash']
        assert protected(processes()) == snapshot['protected']
        run('pm2', 'save')
        report = {'revision': plan['revision'], 'health': result, 'public': public,
                  'stopToLocalHealthySeconds': local_seconds, 'stopToPublicHealthySeconds': round(time.time()-started, 2),
                  'backup': str(backup), 'changedFiles': len(plan['files'])}
        (backup / 'result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    except Exception:
        rollback()
        raise
else:
    raise ValueError(mode)
