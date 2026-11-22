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
import { preparePiikNativeOverlay } from './piik-native-overlay.mjs';
import { piikClientOverlay, checkPiikTypes } from './piik-client-overlay.mjs';
const root = resolve(import.meta.dirname, '..');
const home = join(root, 'integrations/piik');
const pin = JSON.parse(readFileSync(join(home, 'source.json')));
const source = join(home, '.deps/upstream');
const out = join(home, '.build');
const run = (exe, args, cwd = source, env = process.env) =>
    execFileSync(exe, args, { cwd, env, stdio: 'inherit', windowsHide: true });
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
await checkPiikTypes(source, home);
await build({
    entryPoints: [join(home, 'client.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    plugins: [piikClientOverlay],
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
    const linuxServer = process.argv.includes('--linux-server');
    const serverTarget = { goos: linuxServer || process.platform !== 'win32' ? 'linux' : 'windows', goarch: 'amd64' };
    const serverDirectory = linuxServer ? join(out, 'production') : out;
    mkdirSync(serverDirectory, { recursive: true });
    const goFlags = ['-mod=readonly', '-overlay', overlay];
    // The upstream notice generator runs go list in a child process. Apply
    // the same overlay so it reports the modules actually compiled above.
    const writeGoNotices = (write) => {
        const previous = process.env.GOFLAGS;
        process.env.GOFLAGS = [previous, '-mod=readonly', `"-overlay=${overlay.replaceAll('\\', '/')}"`].filter(Boolean).join(' ');
        try { write(); }
        finally {
            if (previous === undefined) delete process.env.GOFLAGS;
            else process.env.GOFLAGS = previous;
        }
    };
    run(go, [
        'build',
        ...goFlags,
        '-p',
        '4',
        '-o',
        join(
            serverDirectory,
            serverTarget.goos === 'windows' ? 'piik-server.exe' : 'piik-server'
        ),
        './cmd/piik-server',
    ], source, { ...process.env, GOOS: serverTarget.goos, GOARCH: serverTarget.goarch, CGO_ENABLED: '0' });
    writeGoNotices(() => licenses.writeServerLicenseNotices(
        source,
        join(serverDirectory, 'third-party-go.txt'),
        go,
        serverTarget,
    ));
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
                preparePiikNativeOverlay(source, out),
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
            ...goFlags,
            '-p',
            '4',
            '-o',
            join(out, 'piik-app.exe'),
            './cmd/piik-app',
        ], source, { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' });
        mkdirSync(join(out, 'runtime/native'), { recursive: true });
        copyFileSync(
            join(source, 'build/platform-native/piik-capture.exe'),
            join(out, 'runtime/native/piik-capture.exe')
        );
        writeGoNotices(() => licenses.writeAppLicenseNotices(
            source,
            out,
            go,
            {
                goos: 'windows',
                goarch: 'amd64',
                captureName: 'piik-capture.exe',
            },
            null
        ));
    }
}
process.stdout.write(`Piik source ${pin.revision}; output ${out}\n`);
