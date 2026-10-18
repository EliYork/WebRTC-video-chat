#!/usr/bin/env python3
"""Run on the authorized Linux server. Private backup first; never restore live chat data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path('/www/wwwroot/voice.eliyork.com')
BACKUPS = Path('/www/backup/voice-deploy')
os.environ['PATH'] = '/www/server/nodejs/v24.15.0/bin:' + os.environ['PATH']
TARGETS = ['src', 'package.json', 'package-lock.json', 'integrations/piik',
           'scripts/piik-production.config.cjs', 'voice-build-manifest.json']


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def health(url, revision=None):
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                data = json.load(response)
            if data.get('ok') and (not revision or data.get('build') == revision and data.get('mediaReady')):
                return data
        except Exception:
            pass
        time.sleep(.25)
    raise RuntimeError('health failed: ' + url)


def backup():
    assert ROOT.is_dir() and (ROOT / 'node_modules').is_dir()
    directory = BACKUPS / time.strftime('piik-%Y%m%d-%H%M%S', time.gmtime())
    directory.mkdir(mode=0o700)
    os.chmod(directory, 0o700)
    state = json.loads(run('pm2', 'jlist'))
    (directory / 'pm2-before.json').write_text(json.dumps(state))
    voice = next(p for p in state if p['name'] == 'voice-room')
    assert voice['pm2_env']['status'] == 'online'
    assert Path(voice['pm2_env']['pm_cwd']) == ROOT
    present = []
    for relative in TARGETS:
        source = ROOT / relative
        if source.exists():
            dest = directory / 'runtime' / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir(): shutil.copytree(source, dest)
            else: shutil.copy2(source, dest)
            present.append(relative)
    for name in ['.env', 'data']:
        source = ROOT / name
        if source.exists():
            if source.is_dir(): shutil.copytree(source, directory / name)
            else: shutil.copy2(source, directory / name)
    nginx = Path('/www/server/panel/vhost/nginx')
    with tarfile.open(directory / 'nginx-backup.tar.gz', 'w:gz') as archive:
        for source in [nginx / 'voice.eliyork.com.conf',
                       nginx / 'proxy/voice.eliyork.com', nginx / 'extension/voice.eliyork.com',
                       nginx / 'well-known/voice.eliyork.com.conf', nginx / 'rewrite/voice.eliyork.com.conf',
                       Path('/www/server/panel/vhost/cert/voice.eliyork.com'),
                       Path('/www/server/nginx/conf/nginx.conf')]:
            if source.exists(): archive.add(source, arcname=str(source).lstrip('/'))
    dump = Path('/root/.pm2/dump.pm2')
    if dump.exists(): shutil.copy2(dump, directory / 'dump.pm2')
    info = {'present': present, 'envHash': digest(ROOT / '.env'),
            'lockHash': digest(ROOT / 'package-lock.json'),
            'serverHash': digest(ROOT / 'src/server.js'), 'created': time.time()}
    hashes = {}
    for path in (directory / 'runtime').rglob('*'):
        if path.is_file():
            relative = str(path.relative_to(directory / 'runtime'))
            hashes[relative] = digest(path)
            assert hashes[relative] == digest(ROOT / relative), 'backup readback mismatch'
    info['runtimeHashes'] = hashes
    (directory / 'backup.json').write_text(json.dumps(info, indent=2))
    shutil.copy2(__file__, directory / 'deploy.py')
    (directory / 'rollback.sh').write_text('#!/bin/sh\nset -eu\nexec python3 "' + str(directory / 'deploy.py') + '" rollback "' + str(directory) + '"\n')
    os.chmod(directory / 'rollback.sh', 0o700)
    print(directory)


def checked(directory):
    directory = directory.resolve()
    assert directory.parent == BACKUPS and directory.name.startswith('piik-')
    assert (directory / 'backup.json').is_file()
    return directory


def prepare(directory, archive_path, expected):
    directory = checked(directory)
    assert digest(archive_path) == expected, 'upload hash mismatch'
    stage = directory / 'candidate'
    assert not stage.exists()
    stage.mkdir()
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        names = [m.name for m in members]
        assert len(set(names)) == len(names)
        manifest = json.load(archive.extractfile('manifest.json'))
        assert set(names) == set(manifest['files']) | {'manifest.json'}
        for member in members:
            assert member.isfile() and not member.name.startswith('/')
            assert '..' not in Path(member.name).parts
            content = archive.extractfile(member).read()
            if member.name != 'manifest.json':
                assert hashlib.sha256(content).hexdigest() == manifest['files'][member.name]
            dest = stage / member.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
    assert digest(stage / 'package-lock.json') == digest(ROOT / 'package-lock.json'), 'dependencies changed; review required'
    (stage / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    binary = stage / 'integrations/piik/.build/piik-server'
    binary.chmod(0o700)
    config = json.loads(run('node', '-e', 'console.log(JSON.stringify(require(process.argv[1]).apps[0]))', str(stage / 'scripts/piik-production.config.cjs')))
    go_env = {**os.environ, **config['env']}
    children = []
    try:
        go_log = open(directory / 'candidate-go.log', 'w')
        go = subprocess.Popen([str(binary)], cwd=stage, env=go_env, stdout=go_log, stderr=subprocess.STDOUT)
        children.append(go)
        # Upstream health uses status=ok; Node checks the HTTP status.
        for _ in range(60):
            if go.poll() is not None: raise RuntimeError('candidate Go exited; see candidate-go.log')
            try:
                urllib.request.urlopen('http://127.0.0.1:17887/healthz', timeout=2).close()
                break
            except Exception: time.sleep(.25)
        else: raise RuntimeError('candidate Go health failed')
        node_env = {**os.environ, 'PORT': '17888', 'HOST': '127.0.0.1', 'USE_HTTPS': 'false',
                    'PIIK_ENABLED': 'true', 'PIIK_INTERNAL_URL': 'http://127.0.0.1:17887',
                    'VOICE_BUILD_ID': manifest['revision'], 'CHAT_HISTORY_FILE': str(directory / 'candidate-chat.json')}
        node_log = open(directory / 'candidate-node.log', 'w')
        node = subprocess.Popen(['node', str(stage / 'src/server.js')], cwd=stage, env=node_env, stdout=node_log, stderr=subprocess.STDOUT)
        children.append(node)
        result = health('http://127.0.0.1:17888/healthz', manifest['revision'])
        # Uploaded unmodified gateway suite is adapted only to the running candidate Go.
        gateway = directory / 'gateway-test.mjs'
        text = gateway.read_text().replace("const piik = await startPiikLocal();", "const piik = {baseURL:'http://127.0.0.1:17887',close(){}};")
        text = text.replace("import { startPiikLocal } from './piik-local-service.mjs';", '')
        test = stage / 'scripts/candidate-gateway.mjs'
        test.write_text(text)
        print(run('node', str(test), cwd=stage).strip())
        usage = {}
        for name, child in [('go', go), ('node', node)]:
            usage[name] = run('ps', '-p', str(child.pid), '-o', 'rss=,%cpu=').strip()
        available = int(next(l.split()[1] for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')))
        assert available > 160 * 1024, 'insufficient available memory with candidate'
        report = {'health': result, 'rssKiB_cpuPercent': usage, 'availableKiB': available, 'passed': True}
        (directory / 'candidate-result.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        for child in reversed(children):
            child.terminate()
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired: child.kill(); child.wait()


def restore(directory):
    directory = checked(directory)
    info = json.loads((directory / 'backup.json').read_text())
    for relative, expected in info['runtimeHashes'].items():
        assert digest(directory / 'runtime' / relative) == expected, 'backup damaged'
    run('pm2', 'stop', 'voice-room')
    state = json.loads(run('pm2', 'jlist'))
    if any(p['name'] == 'voice-piik' for p in state): run('pm2', 'delete', 'voice-piik')
    for relative in TARGETS:
        dest = ROOT / relative
        if dest.is_dir(): shutil.rmtree(dest)
        elif dest.exists(): dest.unlink()
        if relative in info['present']:
            source = directory / 'runtime' / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir(): shutil.copytree(source, dest)
            else: shutil.copy2(source, dest)
    env = {**os.environ, 'PIIK_ENABLED': 'false', 'HOST': '0.0.0.0', 'VOICE_BUILD_ID': '56d344d06be97f7cbb1c7c87a975724844df1187'}
    run('pm2', 'restart', 'voice-room', '--update-env', env=env)
    for _ in range(60):
        try:
            urllib.request.urlopen('http://127.0.0.1:3000/room/lobby', timeout=3).close()
            break
        except Exception: time.sleep(.25)
    else: raise RuntimeError('rollback Node health failed')
    assert digest(ROOT / '.env') == info['envHash']
    run('pm2', 'save')
    print('Rolled back code; live chat and .env preserved.')


def activate(directory):
    directory = checked(directory)
    assert json.loads((directory / 'candidate-result.json').read_text())['passed']
    stage = directory / 'candidate'
    manifest = json.loads((stage / 'manifest.json').read_text())
    before = json.loads((directory / 'backup.json').read_text())
    assert digest(ROOT / '.env') == before['envHash']
    assert digest(ROOT / 'src/server.js') == before['serverHash'], 'production changed since backup'
    started = time.time()
    try:
        run('pm2', 'stop', 'voice-room')
        for relative in TARGETS:
            if relative == 'voice-build-manifest.json': source = stage / 'manifest.json'
            else: source = stage / relative
            dest = ROOT / relative
            if dest.is_dir(): shutil.rmtree(dest)
            elif dest.exists(): dest.unlink()
            dest.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir(): shutil.copytree(source, dest)
            else: shutil.copy2(source, dest)
        (ROOT / 'integrations/piik/.build/piik-server').chmod(0o700)
        run('pm2', 'start', str(ROOT / 'scripts/piik-production.config.cjs'))
        env = {**os.environ, 'PIIK_ENABLED': 'true', 'PIIK_INTERNAL_URL': 'http://127.0.0.1:17887',
               'HOST': '127.0.0.1', 'VOICE_BUILD_ID': manifest['revision']}
        run('pm2', 'restart', 'voice-room', '--update-env', env=env)
        local = health('http://127.0.0.1:3000/healthz', manifest['revision'])
        public = health('https://voice.eliyork.com/healthz', manifest['revision'])
        assert digest(ROOT / '.env') == before['envHash']
        run('pm2', 'save')
        result = {'revision': manifest['revision'], 'local': local, 'public': public,
                  'stopToHealthySeconds': round(time.time()-started, 2), 'backup': str(directory), 'activatedAt': time.time()}
        (directory / 'deployment-result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
    except Exception:
        restore(directory)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'prepare', 'activate', 'rollback'])
    parser.add_argument('directory', nargs='?', type=Path)
    parser.add_argument('archive', nargs='?', type=Path)
    parser.add_argument('sha256', nargs='?')
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == 'backup': backup()
    elif args.action == 'prepare': prepare(args.directory, args.archive, args.sha256)
    elif args.action == 'activate': activate(args.directory)
    else: restore(args.directory)
