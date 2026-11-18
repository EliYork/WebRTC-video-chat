// Separate Piik distribution: the legacy release ZIP contract stays intact.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
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
const roomAssets = [
    'src/views/js/room/startup-assets.json',
    'src/views/js/room/startup.runtime.min.js',
    'src/views/js/room/startup.mainScript.min.js',
    'src/views/styles/startup.min.css',
];
const sourceEntries = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
}).split('\0');
const files = [...new Set(sourceEntries)].filter((file) =>
    file && !roomAssets.includes(file) && existsSync(join(root, file))
);
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
    const input = join(root, file);
    if (!lstatSync(input).isFile()) throw new Error(`Expected a regular file: ${file}`);
    mkdirSync(dirname(join(stage, file)), { recursive: true });
    copyFileSync(input, join(stage, file));
}
// Regenerate and validate the room bundle from the same snapshot that goes into the TAR.
execFileSync(process.execPath, [join(root, 'scripts/build-room-assets.mjs'), join(stage, 'src/views')], {
    windowsHide: true,
    stdio: 'inherit',
});
files.push(...roomAssets);
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
