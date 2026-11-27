import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const piikServerArtifacts = {
    'client.js': 'client.js',
    'protocol.mjs': 'protocol.mjs',
    'third-party-web.txt': 'third-party-web.txt',
    'LICENSE-Piik.txt': 'LICENSE-Piik.txt',
    'piik-server': 'production/piik-server',
    'third-party-go.txt': 'production/third-party-go.txt',
};

const readHashes = (root, paths) => Object.fromEntries(paths.map(path => [
    path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex'),
]));

function goOverlays(root, folder) {
    return readdirSync(join(root, folder), { withFileTypes: true }).flatMap(entry => {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) return goOverlays(root, path);
        return entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go') ? [path] : [];
    });
}

export function piikBuildInputs(root) {
    const web = 'integrations/piik';
    const typescript = readdirSync(join(root, web)).filter(name => name.endsWith('.ts'));
    return readHashes(root, [
        'package-lock.json',
        `${web}/source.json`,
        `${web}/tsconfig.json`,
        ...typescript.map(name => `${web}/${name}`),
        'scripts/build-piik.mjs',
        'scripts/piik-build-provenance.mjs',
        'scripts/piik-client-overlay.mjs',
        'scripts/piik-go-overlay.mjs',
        'scripts/piik-media-log-filter.go',
        'scripts/piik-share-overlay.mjs',
        ...goOverlays(root, 'scripts/piik-share'),
    ].sort());
}

const fileName = 'production/server-build.json';
const target = 'linux/amd64';
const artifactPaths = Object.values(piikServerArtifacts);

export function recordPiikServerBuild(root, build, inputs) {
    if (!isDeepStrictEqual(piikBuildInputs(root), inputs))
        throw Error('Piik build inputs changed during compilation');
    const record = { target, inputs, artifacts: readHashes(build, artifactPaths) };
    writeFileSync(join(build, fileName), JSON.stringify(record, null, 2) + '\n');
}

export function verifyPiikServerBuild(root, build) {
    const rebuild = 'Run npm run build:piik -- --linux-server before packaging';
    let record;
    try { record = JSON.parse(readFileSync(join(build, fileName), 'utf8')); }
    catch (error) { throw Error(`Piik build record is missing or unreadable. ${rebuild}`, { cause: error }); }
    if (record?.target !== target || !isDeepStrictEqual(record.inputs, piikBuildInputs(root)) ||
        !isDeepStrictEqual(record.artifacts, readHashes(build, artifactPaths))) {
        throw Error(`Piik build artifacts or inputs changed. ${rebuild}`);
    }
    return record;
}
