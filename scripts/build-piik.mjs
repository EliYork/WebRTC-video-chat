// Pinned source dependency; no copied media implementation or build-time patches.
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
    run(go, [
        'build',
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
}
process.stdout.write(`Piik source ${pin.revision}; output ${out}\n`);
