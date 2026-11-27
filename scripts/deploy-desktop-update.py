"""Run on the authorized host: prepare|activate|rollback /www/backup/voice-deploy/client-... .

Operator stages plan.json, this file and after/<relative path>. No credentials.
Three download files and one Nginx location are updated. Legacy plans can also
include the four supported frontend assets.
Node/Go are not restarted. Rollback preserves live environment and chat data.
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote, unquote

os.umask(0o077)
os.environ['PATH'] = '/www/server/nodejs/v24.15.0/bin:' + os.environ['PATH']
ROOT = pathlib.Path('/www/wwwroot/voice.eliyork.com')
NGINX = pathlib.Path('/www/server/panel/vhost/nginx/extension/voice.eliyork.com/voice-client-downloads.conf')
BIN = '/www/server/nginx/sbin/nginx'
FRONTEND = {
    'src/views/js/voice/voice-media-quality-runtime.js': '/js/voice/voice-media-quality-runtime.js',
    'src/views/styles/media.css': '/styles/media.css',
    'src/views/js/voice/voice-call-diagnostics.js': '/js/voice/voice-call-diagnostics.js',
    'src/views/js/shared/copy-link-ui.js': '/js/shared/copy-link-ui.js',
}
mode, location = sys.argv[1:3]
backup = pathlib.Path(location)
assert backup.parent == pathlib.Path('/www/backup/voice-deploy')
assert re.fullmatch(r'client-[0-9T-]+', backup.name)
plan = json.loads((backup / 'plan.json').read_text())
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', plan['version'])
installer = plan.get('installer', f'EliYork-Voice-Setup-{plan["version"]}-x64.exe')
assert installer in {f'{prefix}-Setup-{plan["version"]}-x64.exe' for prefix in ('EliYork-Voice', '晓语音')}
downloads = {'downloads/windows/latest.yml', f'downloads/windows/{installer}',
             f'downloads/windows/{installer}.blockmap'}
frontend = FRONTEND if set(plan['files']) - downloads else {}
assert set(plan['files']) == set(frontend) | downloads


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_feed(location):
    feed = (location / 'downloads/windows/latest.yml').read_text(encoding='utf-8')
    fields = dict(re.findall(r'^(version|path|sha512):[ \t]*(.+?)\s*$', feed, re.MULTILINE))
    assert fields['version'].strip("'\"") == plan['version'], 'Feed version does not match the release'
    assert unquote(fields['path'].strip("'\"")) == installer, 'Feed does not reference the intended installer'
    with (location / 'downloads/windows' / installer).open('rb') as binary:
        expected = base64.b64encode(hashlib.file_digest(binary, 'sha512').digest()).decode()
    assert fields['sha512'].strip("'\"") == expected, 'Feed installer SHA512 mismatch'


def wait_for_download(path):
    url = 'https://voice.eliyork.com/' + quote(path)
    request = urllib.request.Request(url, headers={'Range': 'bytes=0-63'})
    with (ROOT / path).open('rb') as file:
        expected = file.read(64)
    deadline = time.monotonic() + 12
    while True:
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                if response.status == 206 and response.read(64) == expected:
                    return
        except OSError:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('Public download failed verification: ' + path)
        time.sleep(.25)


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.STDOUT)


def replace(source, destination):
    missing = []
    parent = destination.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    for parent in missing:
        os.chmod(parent, 0o755)
    temp = destination.with_name(destination.name + '.client-next')
    shutil.copy2(source, temp)
    os.chmod(temp, 0o644)
    os.replace(temp, destination)


def rollback():
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    for path, existed in snapshot.items():
        destination = NGINX if path == '@nginx' else ROOT / path
        source = backup / 'before' / ('nginx.conf' if path == '@nginx' else path)
        if existed:
            replace(source, destination)
        else:
            destination.unlink(missing_ok=True)
    run(BIN, '-t')
    run(BIN, '-s', 'reload')
    print('Restored frontend, manifest, download feed and Nginx location; Node/Go unchanged.')


if mode == 'prepare':
    assert not (backup / 'snapshot.json').exists(), 'Backup already prepared'
    manifest = json.loads((ROOT / 'voice-build-manifest.json').read_text())
    for path in frontend:
        assert sha(ROOT / path) == manifest['files'][path], f'Production drift: {path}'
    for path, digest in plan['files'].items():
        assert sha(backup / 'after' / path) == digest, f'Upload mismatch: {path}'
    verify_feed(backup / 'after')
    snapshot = {}
    for path in [*plan['files'], 'voice-build-manifest.json', '@nginx']:
        source = NGINX if path == '@nginx' else ROOT / path
        snapshot[path] = source.exists()
        if source.exists():
            target = backup / 'before' / ('nginx.conf' if path == '@nginx' else path)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            assert sha(source) == sha(target)
    for path in ['.env', 'data/chat-history.json']:
        if (ROOT / path).exists():
            target = backup / 'safety-snapshot' / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / path, target)
    (backup / 'nginx-before.txt').write_bytes(run(BIN, '-T'))
    (backup / 'pm2-before.json').write_bytes(run('pm2', 'jlist'))
    (backup / 'snapshot.json').write_text(json.dumps(snapshot, indent=2))
    (backup / 'rollback.sh').write_text(f'#!/bin/sh\nexec python3 "{backup}/deploy.py" rollback "{backup}"\n')
    os.chmod(backup / 'rollback.sh', 0o700)
    print('Backup and staged SHA256 verified; no production changes:', backup)
elif mode == 'rollback':
    rollback()
elif mode == 'activate':
    assert (backup / 'snapshot.json').exists()
    assert 'zone=perserver:' in pathlib.Path('/www/server/nginx/conf/nginx.conf').read_text()
    verify_feed(backup / 'after')
    try:
        # Stage the immutable files before reloading Nginx. The existing feed
        # continues to serve the previous version until both new URLs work.
        feed_path = 'downloads/windows/latest.yml'
        for path in plan['files']:
            assert sha(backup / 'after' / path) == plan['files'][path]
            if path != feed_path:
                replace(backup / 'after' / path, ROOT / path)
        NGINX.write_text('''# Xiaoyuyin Windows downloads and legacy installer compatibility.
location ^~ /downloads/windows/ {
    root /www/wwwroot/voice.eliyork.com;
    if ($uri !~ "^/downloads/windows/(latest\\.yml|(EliYork-Voice|晓语音)-Setup-[0-9]+\\.[0-9]+\\.[0-9]+-x64\\.exe(\\.blockmap)?)$") { return 404; }
    try_files $uri =404;
    autoindex off;
    limit_except GET { deny all; }
    # Two site-wide active downloads, 1,000,000 bytes/s each: total 2 MB/s.
    limit_rate 1000000;
    limit_conn perserver 2;
    limit_conn_status 429;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
    default_type application/octet-stream;
}
''')
        os.chmod(NGINX, 0o600)
        run(BIN, '-t')
        run(BIN, '-s', 'reload')
        for path in sorted(downloads - {feed_path}):
            wait_for_download(path)
        replace(backup / 'after' / feed_path, ROOT / feed_path)
        wait_for_download(feed_path)
        manifest = json.loads((ROOT / 'voice-build-manifest.json').read_text())
        manifest['files'].update(plan['files'])
        if frontend:
            manifest['frontendRevision'] = plan['revision']
        manifest['desktopVersion'] = plan['version']
        manifest.setdefault('hotfixes', []).append({'revision': plan['revision'], 'backup': str(backup)})
        temp = backup / 'manifest-after.json'
        temp.write_text(json.dumps(manifest, indent=2))
        replace(temp, ROOT / 'voice-build-manifest.json')
        for path, url in frontend.items():
            with urllib.request.urlopen('https://voice.eliyork.com' + url + '?v=' + plan['revision'], timeout=20) as response:
                assert hashlib.sha256(response.read()).hexdigest() == plan['files'][path]
        with urllib.request.urlopen('https://voice.eliyork.com/healthz', timeout=15) as response:
            health = json.load(response)
        assert health['ok'] and health['mediaReady']
        for path, digest in plan['files'].items():
            assert sha(ROOT / path) == digest
        before = json.loads((backup / 'pm2-before.json').read_text())
        after = json.loads(run('pm2', 'jlist'))
        assert {p['name']: p['pid'] for p in before} == {p['name']: p['pid'] for p in after}
        result = {'status': 'deployed', 'version': plan['version'], 'revision': plan['revision'],
                  'backup': str(backup), 'health': health, 'nodeGoRestarted': False,
                  'nginxGracefulReload': True, 'downloadLimitBytesPerSecond': 1000000,
                  'downloadConnections': 2, 'downloadAggregateBytesPerSecond': 2000000}
        (backup / 'result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
    except Exception:
        rollback()
        raise
else:
    raise ValueError(mode)
