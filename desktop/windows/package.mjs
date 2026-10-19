import { build } from 'electron-builder';
import {
    cpSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    statSync,
    existsSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import config from './electron-builder.cjs';
const directory = import.meta.dirname,
    root = resolve(directory, '../..');
const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
const git = (...args) =>
    execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
    }).trim();
const revision = git('rev-parse', 'HEAD');
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const name = `EliYork-Voice-${pkg.version}-${stamp}-win-x64`;
const output = join(directory, '.build', name);
const hash = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
function inventory(path, base = path, result = {}) {
    for (const name of readdirSync(path)) {
        const file = join(path, name);
        if (statSync(file).isDirectory()) inventory(file, base, result);
        else result[relative(base, file).replaceAll('\\', '/')] = hash(file);
    }
    return result;
}
// Every build has its own directory; previous releases are retained.
await build({
    projectDir: directory,
    publish: 'never',
    config: {
        ...config,
        directories: { output },
        electronDist: join(directory, 'node_modules/electron/dist'),
        afterPack: async ({ appOutDir }) => {
            const appDir = join(appOutDir, 'resources/app');
            const notices = [
                'EliYork Voice desktop runtime third-party licenses',
            ];
            function licenses(modules) {
                for (const name of readdirSync(modules)) {
                    if (name.startsWith('.')) continue;
                    const installed = join(modules, name);
                    if (!statSync(installed).isDirectory()) continue;
                    if (name.startsWith('@')) {
                        licenses(installed);
                        continue;
                    }
                    const info = JSON.parse(
                        readFileSync(join(installed, 'package.json'))
                    );
                    const files = readdirSync(installed).filter((n) =>
                        /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(n)
                    );
                    if (!files.length && info.name !== 'lazy-val')
                        throw Error(`Runtime license missing: ${info.name}`);
                    notices.push(
                        `\n## ${info.name} ${info.version} (${info.license || 'see license'})`
                    );
                    if (!files.length) {
                        if (info.version !== '1.0.5' || info.license !== 'MIT')
                            throw Error('Review lazy-val license again');
                        notices.push(
                            readFileSync(
                                join(directory, 'LICENSE-lazy-val.txt'),
                                'utf8'
                            )
                        );
                    }
                    for (const file of files)
                        if (statSync(join(installed, file)).isFile())
                            notices.push(
                                readFileSync(join(installed, file), 'utf8')
                            );
                    if (existsSync(join(installed, 'node_modules')))
                        licenses(join(installed, 'node_modules'));
                }
            }
            licenses(join(appDir, 'node_modules'));
            writeFileSync(
                join(appOutDir, 'LICENSES-desktop.txt'),
                notices.join('\n')
            );
        },
        // Resource editing changes the EXE after afterPack. Hash final bytes
        // before NSIS archives them (this hook also runs with signExecutable=false).
        afterSign: async ({ appOutDir }) => {
            writeFileSync(
                join(appOutDir, 'build.json'),
                JSON.stringify(
                    {
                        name: pkg.productName,
                        version: pkg.version,
                        revision,
                        trackedChanges: Boolean(
                            git('diff', 'HEAD', '--name-only')
                        ),
                        piik: JSON.parse(
                            readFileSync(
                                join(root, 'integrations/piik/source.json')
                            )
                        ),
                        electron: pkg.devDependencies.electron,
                        files: inventory(appOutDir),
                    },
                    null,
                    2
                )
            );
        },
    },
});
const unpacked = join(output, 'win-unpacked');
const manifest = JSON.parse(readFileSync(join(unpacked, 'build.json')));
for (const [path, digest] of Object.entries(manifest.files))
    if (hash(join(unpacked, path)) !== digest)
        throw Error(`Runtime SHA256 mismatch: ${path}`);
const bundle = join(output, 'distribution');
mkdirSync(bundle);
for (const file of [
    `EliYork-Voice-Setup-${pkg.version}-x64.exe`,
    `EliYork-Voice-Setup-${pkg.version}-x64.exe.blockmap`,
    'latest.yml',
])
    cpSync(join(output, file), join(bundle, file));
cpSync(join(directory, 'README.md'), join(bundle, 'README.md'));
writeFileSync(
    join(bundle, 'build.json'),
    JSON.stringify(
        { version: pkg.version, revision, files: inventory(bundle) },
        null,
        2
    )
);
const release = join(root, 'release');
mkdirSync(release, { recursive: true });
const zip = join(release, `${name}.zip`);
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
            VOICE_CLIENT_SOURCE: bundle,
            VOICE_CLIENT_ZIP: zip,
        },
    }
);
execFileSync(
    'python',
    [
        '-c',
        "import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); m=json.loads(z.read('build.json')); assert len(z.namelist())==len(set(z.namelist())); assert set(z.namelist())==set(m['files'])|{'build.json'}; assert all(hashlib.sha256(z.read(p)).hexdigest()==h for p,h in m['files'].items()); print('ZIP entries and SHA256 verified:',len(m['files']))",
        zip,
    ],
    { windowsHide: true, stdio: 'inherit' }
);
writeFileSync(
    join(directory, '.build/latest-build.json'),
    JSON.stringify(
        {
            zip,
            output,
            unpacked,
            revision,
            version: pkg.version,
            sha256: hash(zip),
        },
        null,
        2
    )
);
process.stdout.write(`${zip}\n${unpacked}\n`);
