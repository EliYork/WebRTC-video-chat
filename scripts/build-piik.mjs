// Pinned source dependency; media remains upstream-owned.
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    existsSync,
    readFileSync,
    copyFileSync,
    writeFileSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { preparePiikGoOverlay } from './piik-go-overlay.mjs';
const root = resolve(import.meta.dirname, '..');
const home = join(root, 'integrations/piik');
const pin = JSON.parse(readFileSync(join(home, 'source.json')));
const source = join(home, '.deps/upstream');
const out = join(home, '.build');
const run = (exe, args, cwd = source) =>
    execFileSync(exe, args, { cwd, stdio: 'inherit', windowsHide: true });
mkdirSync(join(home, '.deps'), { recursive: true });
mkdirSync(out, { recursive: true });
if (!existsSync(join(source, '.git'))) {
    run('git', ['clone', '--no-checkout', pin.repository, source], root);
    run('git', ['checkout', '--detach', pin.revision]);
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
    windowsHide: true,
}).trim();
if (head !== pin.revision)
    throw new Error(
        `Piik must be checked out at ${pin.revision}; found ${head}`
    );
const changes = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    { cwd: source, encoding: 'utf8', windowsHide: true }
).trim();
if (changes)
    throw new Error(
        'Piik source has local changes; review them before building the pinned dependency.'
    );
run(process.execPath, [
    process.env.npm_execpath ||
        join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
]);
run(
    process.execPath,
    [
        join(source, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(home, 'tsconfig.json'),
    ],
    root
);
await build({
    entryPoints: [join(home, 'client.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: {
        'import.meta.url': '"/vendor/piik-client.js"',
        'import.meta.env': '{}',
    },
    outfile: join(out, 'client.js'),
    legalComments: 'eof',
});
await build({
    entryPoints: [join(source, 'src/shared/protocol.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: join(out, 'protocol.mjs'),
    legalComments: 'eof',
});
copyFileSync(join(source, 'LICENSE'), join(out, 'LICENSE-Piik.txt'));
const licenses = await import(
    pathToFileURL(join(source, 'scripts/package-licenses.mjs'))
);
licenses.writeWebLicenseNotices(source, join(out, 'third-party-web.txt'), [
    'sdp-transform',
    'zod',
]);
writeFileSync(
    join(out, 'third-party-web.txt'),
    readFileSync(join(source, 'LICENSE'), 'utf8') +
        '\n' +
        readFileSync(join(out, 'third-party-web.txt'), 'utf8')
);
if (!process.argv.includes('--web-only')) {
    const go = process.env.PIIK_GO || 'go';
    const overlay = preparePiikGoOverlay(source, out);
    run(go, [
        'build',
        '-overlay',
        overlay,
        '-p',
        '4',
        '-o',
        join(
            out,
            process.platform === 'win32' ? 'piik-server.exe' : 'piik-server'
        ),
        './cmd/piik-server',
    ]);
    licenses.writeServerLicenseNotices(
        source,
        join(out, 'third-party-go.txt'),
        go,
        {
            goos: process.platform === 'win32' ? 'windows' : 'linux',
            goarch: 'amd64',
        }
    );
    if (process.argv.includes('--native')) {
        if (process.platform !== 'win32')
            throw new Error('This native build target requires Windows');
        const shellEnvironment = { ...process.env };
        // PowerShell 7's inherited module path can hide Windows PowerShell's
        // Get-FileHash. Let the child construct its own standard module path.
        delete shellEnvironment.PSModulePath;
        execFileSync(
            process.env.PIIK_POWERSHELL || 'powershell.exe',
            [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                join(source, 'native/capture/windows/build.ps1'),
                '-OutputDirectory',
                join(source, 'build/platform-native'),
            ],
            {
                cwd: source,
                stdio: 'inherit',
                windowsHide: true,
                env: shellEnvironment,
            }
        );
        // App's approved-site launcher is embedded even in Site mode.
        // Build upstream assets; the platform never mounts Piik room pages.
        run(process.execPath, [
            process.env.npm_execpath ||
                join(
                    dirname(process.execPath),
                    'node_modules/npm/bin/npm-cli.js'
                ),
            'run',
            'build:web',
        ]);
        run(go, [
            'build',
            '-p',
            '4',
            '-o',
            join(out, 'piik-app.exe'),
            './cmd/piik-app',
        ]);
        mkdirSync(join(out, 'runtime/native'), { recursive: true });
        copyFileSync(
            join(source, 'build/platform-native/piik-capture.exe'),
            join(out, 'runtime/native/piik-capture.exe')
        );
        licenses.writeAppLicenseNotices(
            source,
            out,
            go,
            {
                goos: 'windows',
                goarch: 'amd64',
                captureName: 'piik-capture.exe',
            },
            null
        );
    }
}
process.stdout.write(`Piik source ${pin.revision}; output ${out}\n`);
