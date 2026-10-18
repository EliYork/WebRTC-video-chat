// Separate Piik distribution: the legacy release ZIP contract stays intact.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
}).trim();
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const build = join(root, 'integrations/piik/.build');
const stage = join(build, `server-${stamp}`);
mkdirSync(stage, { recursive: true });
const files = execFileSync('git', ['ls-files', 'src'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
})
    .trim()
    .split(/\r?\n/);
files.push(
    'package.json',
    'package-lock.json',
    '.env.example',
    'LICENSE',
    'docs/RELEASE.md',
    'scripts/piik-production.config.cjs',
    'integrations/piik/source.json',
    'integrations/piik/LICENSE-Piik.txt'
);
for (const file of files) {
    mkdirSync(dirname(join(stage, file)), { recursive: true });
    copyFileSync(join(root, file), join(stage, file));
}
for (const name of [
    'client.js',
    'protocol.mjs',
    'third-party-web.txt',
    'third-party-go.txt',
    'LICENSE-Piik.txt',
    'piik-server',
]) {
    const dest = `integrations/piik/.build/${name}`;
    mkdirSync(dirname(join(stage, dest)), { recursive: true });
    copyFileSync(
        join(build, name === 'piik-server' ? 'production/piik-server' : name),
        join(stage, dest)
    );
    files.push(dest);
}
const hashes = Object.fromEntries(
    files.map((file) => [
        file,
        createHash('sha256')
            .update(readFileSync(join(stage, file)))
            .digest('hex'),
    ])
);
const manifest = {
    revision,
    piik: JSON.parse(readFileSync(join(root, 'integrations/piik/source.json'))),
    files: hashes,
};
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
const archive = join(build, `eliyork-voice-piik-server-${stamp}.tar.gz`);
execFileSync(
    'tar.exe',
    ['-czf', archive, '-C', stage, ...files, 'manifest.json'],
    { windowsHide: true, stdio: 'inherit' }
);
execFileSync(
    'python',
    [
        '-c',
        "import tarfile,json,hashlib,sys; t=tarfile.open(sys.argv[1]); m=json.load(t.extractfile('manifest.json')); assert set(t.getnames())==set(m['files'])|{'manifest.json'}; assert all(hashlib.sha256(t.extractfile(p).read()).hexdigest()==h for p,h in m['files'].items()); print('Server archive entries/SHA256 verified:',len(m['files']))",
        archive,
    ],
    { windowsHide: true, stdio: 'inherit' }
);
process.stdout.write(`${archive}\n`);
