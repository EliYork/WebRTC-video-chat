import {
    cpSync,
    renameSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..'),
    directory = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
}).trim();
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const out = join(directory, '.build', `EliYork-Voice-${pkg.version}-${stamp}`);
mkdirSync(out, { recursive: true });
cpSync(join(directory, 'node_modules/electron/dist'), out, { recursive: true });
renameSync(join(out, 'electron.exe'), join(out, 'EliYork Voice.exe'));
const appDir = join(out, 'resources/app'),
    nativeDir = join(out, 'resources/native');
mkdirSync(appDir, { recursive: true });
mkdirSync(join(nativeDir, 'runtime/native'), { recursive: true });
for (const file of [
    'package.json',
    'main.cjs',
    'picker-preload.cjs',
    'picker.html',
    'picker.cjs',
])
    cpSync(join(directory, file), join(appDir, file));
const build = join(root, 'integrations/piik/.build');
for (const file of [
    'piik-app.exe',
    'THIRD-PARTY-NOTICES.txt',
    'LICENSE-Piik.txt',
])
    cpSync(join(build, file), join(nativeDir, file));
cpSync(
    join(build, 'runtime/native/piik-capture.exe'),
    join(nativeDir, 'runtime/native/piik-capture.exe')
);
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE-EliYork.txt'));
cpSync(join(directory, 'README.md'), join(out, 'README.md'));
const files = {};
function walk(dir, base = '') {
    for (const name of readdirSync(dir)) {
        const rel = base + name,
            path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, rel + '/');
        else
            files[rel] = createHash('sha256')
                .update(readFileSync(path))
                .digest('hex');
    }
}
walk(out);
writeFileSync(
    join(out, 'build.json'),
    JSON.stringify(
        {
            name: pkg.productName,
            version: pkg.version,
            revision,
            piik: JSON.parse(
                readFileSync(join(root, 'integrations/piik/source.json'))
            ),
            electron: pkg.devDependencies.electron,
            files,
        },
        null,
        2
    )
);
const release = join(root, 'release');
mkdirSync(release, { recursive: true });
const zip = join(release, `${out.split(/[\\/]/).at(-1)}-win-x64.zip`);
// Literal paths through environment variables avoid PowerShell string evaluation.
execFileSync(
    'powershell.exe',
    [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:VOICE_CLIENT_SOURCE,$env:VOICE_CLIENT_ZIP)',
    ],
    {
        windowsHide: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            VOICE_CLIENT_SOURCE: out,
            VOICE_CLIENT_ZIP: zip,
        },
    }
);
// Verify every archive entry and digest before declaring the artifact valid.
execFileSync(
    'python',
    [
        '-c',
        "import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); m=json.loads(z.read('build.json')); assert len(z.namelist())==len(set(z.namelist())); assert set(z.namelist())==set(m['files'])|{'build.json'}; assert all(hashlib.sha256(z.read(p)).hexdigest()==h for p,h in m['files'].items()); print('ZIP entries and SHA256 verified:',len(m['files']))",
        zip,
    ],
    { windowsHide: true, stdio: 'inherit' }
);
process.stdout.write(`${zip}\n${out}\n`);
