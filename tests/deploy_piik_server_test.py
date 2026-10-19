"""Filesystem rollback regression; all process/network operations are mocked."""
import importlib.util
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'scripts/deploy-piik-server.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class Rollback(unittest.TestCase):
    def exercise(self, integrated, corrupt=False, go_status='online'):
        with tempfile.TemporaryDirectory(prefix='voice-rollback-') as temporary:
            home = Path(temporary)
            root, backups = home / 'site', home / 'backups'
            directory = backups / 'piik-fixture'
            root.mkdir()
            directory.mkdir(parents=True)
            (root / '.env').write_text('PRIVATE_VALUE=preserve')
            (root / 'data').mkdir()
            (root / 'data/chat-history.json').write_text('live chat after backup')
            old = {'src/server.js': b'previous code', 'voice-build-manifest.json': b'{"revision":"original"}'}
            if integrated: old['integrations/piik/.build/piik-server'] = b'previous Go'
            for name, content in old.items():
                source = directory / 'runtime' / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_bytes(content)
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'new candidate')
            original = {'PIIK_ENABLED': 'true' if integrated else 'false',
                        'VOICE_BUILD_ID': 'previous-revision',
                        'HOST': '127.0.0.1' if integrated else '0.0.0.0'}
            apps = [{'name': 'voice-room', 'pm2_env': {**original, 'pm_cwd': str(root)}}]
            if integrated:
                apps.append({'name': 'voice-piik', 'pm2_env': {
                    'pm_cwd': str(root), 'pm_exec_path': str(root / 'integrations/piik/.build/piik-server'),
                    'exec_interpreter': 'none', 'status': go_status, 'autorestart': True,
                    'max_memory_restart': 123456789, 'env': {'PORT': '17887', 'GOMEMLIMIT': 'custom-limit'},
                }})
            (directory / 'pm2-before.json').write_text(json.dumps(apps))
            info = {'runtimeHashes': {n: deploy.digest(directory / 'runtime' / n) for n in old},
                    'present': sorted({n.split('/')[0] if '/' in n and not n.startswith('integrations/')
                                       else 'integrations/piik' if n.startswith('integrations/') else n for n in old}),
                    'envHash': deploy.digest(root / '.env')}
            (directory / 'backup.json').write_text(json.dumps(info))
            if corrupt: (directory / 'runtime/src/server.js').write_text('damaged')
            commands = []

            def run(*args, **kwargs):
                commands.append((args, kwargs))
                if args == ('pm2', 'jlist'):
                    return json.dumps([{'name': 'voice-room'}, {'name': 'voice-piik'}])
                return ''

            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'BACKUPS', backups), \
                 patch.object(deploy, 'run', side_effect=run), \
                 patch.object(deploy.urllib.request, 'urlopen'), patch.object(deploy, 'health') as health:
                if corrupt:
                    with self.assertRaisesRegex(AssertionError, 'backup damaged'): deploy.restore(directory)
                    self.assertEqual(commands, [], 'Reject bad backups before stopping any service')
                    return
                deploy.restore(directory)
            for name, content in old.items(): self.assertEqual((root / name).read_bytes(), content)
            self.assertEqual((root / 'data/chat-history.json').read_text(), 'live chat after backup')
            self.assertEqual(deploy.digest(root / '.env'), info['envHash'])
            restart = next(kwargs['env'] for args, kwargs in commands if args[:3] == ('pm2', 'restart', 'voice-room'))
            for key, value in original.items(): self.assertEqual(restart[key], value)
            config = directory / 'restore-piik.config.json'
            self.assertEqual(config.exists(), integrated)
            if integrated:
                app = json.loads(config.read_text())['apps'][0]
                self.assertEqual(app['env']['GOMEMLIMIT'], 'custom-limit')
                self.assertEqual(app['max_memory_restart'], 123456789)
                self.assertTrue(any(args[:2] == ('pm2', 'start') for args, _ in commands))
                self.assertEqual(any(args == ('pm2', 'stop', 'voice-piik') for args, _ in commands), go_status != 'online')
                health.assert_called_once_with('http://127.0.0.1:3000/healthz', 'previous-revision')
            else: health.assert_not_called()

    def test_fusion_rollback_preserves_original_build_and_go(self): self.exercise(True)
    def test_legacy_rollback_does_not_introduce_go(self): self.exercise(False)
    def test_rollback_preserves_stopped_go(self): self.exercise(True, go_status='stopped')
    def test_corrupt_backup_does_not_stop_services(self): self.exercise(True, corrupt=True)

    def test_candidate_cannot_use_production_go_or_stun(self):
        with tempfile.TemporaryDirectory(prefix='voice-candidate-') as temporary:
            home = Path(temporary)
            root, backups = home / 'site', home / 'backups'
            directory = backups / 'piik-fixture'
            root.mkdir()
            directory.mkdir(parents=True)
            (directory / 'backup.json').write_text('{}')
            (directory / 'pm2-before.json').write_text(json.dumps([
                {'name': 'voice-room', 'pm2_env': {'SFU_ENABLED': 'false'}}]))
            (root / '.env').write_text('PRESERVED_SETTING=1')
            (root / 'node_modules').mkdir()
            (root / 'package-lock.json').write_text('{}')
            (directory / 'gateway-test.mjs').write_text("const piik = await startPiikLocal();")
            files = {'package-lock.json': b'{}',
                     'scripts/piik-production.config.cjs': b'fixture',
                     'integrations/piik/.build/piik-server': b'fixture'}
            manifest = {'revision': 'candidate-revision',
                        'files': {n: hashlib.sha256(data).hexdigest() for n, data in files.items()}}
            archive = home / 'candidate.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                for name, content in {**files, 'manifest.json': json.dumps(manifest).encode()}.items():
                    member = tarfile.TarInfo(name)
                    member.size = len(content)
                    output.addfile(member, io.BytesIO(content))
            children = []

            class Child:
                def __init__(self, *args, **kwargs):
                    self.env, self.pid, self.stopped = kwargs['env'], 1, False
                    children.append(self)
                def poll(self): return None
                def terminate(self): self.stopped = True
                def wait(self, **kwargs): return 0

            def run(*args, **kwargs):
                if args[:2] == ('node', '-e'):
                    return json.dumps({'env': {'PORT': '17887', 'STUN_URLS': 'stun:production:3478'}})
                if args[0] == 'ps': return '1000 0.0'
                return 'isolated gateway passed'

            original_read = Path.read_text
            def read(path, *args, **kwargs):
                return 'MemAvailable: 524288 kB' if str(path).replace('\\', '/') == '/proc/meminfo' else original_read(path, *args, **kwargs)

            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'BACKUPS', backups), \
                 patch.object(deploy, 'run', side_effect=run), patch.object(deploy.subprocess, 'Popen', Child), \
                 patch.object(deploy.urllib.request, 'urlopen'), patch.object(deploy, 'health', return_value={'ok': True}), \
                 patch.object(Path, 'read_text', read), \
                 patch.object(Path, 'symlink_to', lambda link, target, **kwargs: link.mkdir()):
                deploy.prepare(directory, archive, deploy.digest(archive))
            self.assertEqual(len(children), 2)
            go, node = children
            self.assertNotEqual(go.env['PORT'], '17887')
            self.assertNotEqual(node.env['PORT'], go.env['PORT'])
            self.assertEqual(go.env['STUN_URLS'], '')
            self.assertEqual(go.env['ROOM_DATABASE_PATH'], ':memory:')
            self.assertEqual(node.env['SFU_ENABLED'], 'false')
            self.assertEqual(node.env['PIIK_INTERNAL_URL'], 'http://127.0.0.1:' + go.env['PORT'])
            self.assertEqual((directory / 'candidate/.env').read_text(), 'PRESERVED_SETTING=1')
            self.assertIn(node.env['PIIK_INTERNAL_URL'], (directory / 'candidate/scripts/candidate-gateway.mjs').read_text())
            self.assertNotIn('17887', (directory / 'candidate/scripts/candidate-gateway.mjs').read_text())
            self.assertTrue(all(child.stopped for child in children))


if __name__ == '__main__': unittest.main()
