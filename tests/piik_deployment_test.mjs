import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piikBuildInputs, piikServerArtifacts, recordPiikServerBuild, verifyPiikServerBuild } from '../scripts/piik-build-provenance.mjs';

test('full-release rollback restores its actual baseline and preserves live data', () => {
    execFileSync(process.env.PYTHON || 'python', ['-B', fileURLToPath(new URL('./deploy_piik_server_test.py', import.meta.url))],
        { windowsHide: true, encoding: 'utf8', timeout: 15000 });
});

test('Piik server packaging rejects a build with changed inputs or output bytes', (t) => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const build = mkdtempSync(join(tmpdir(), 'piik-build-record-'));
    t.after(() => rmSync(build, { recursive: true, force: true }));
    mkdirSync(join(build, 'production'));
    for (const path of Object.values(piikServerArtifacts)) writeFileSync(join(build, path), path);
    const inputs = piikBuildInputs(root);
    assert.throws(() => verifyPiikServerBuild(root, build), /build record is missing/);
    assert.throws(() => recordPiikServerBuild(root, build, {}), /inputs changed/);
    recordPiikServerBuild(root, build, inputs);
    assert.deepEqual(verifyPiikServerBuild(root, build).inputs, inputs);
    writeFileSync(join(build, 'production/piik-server'), 'previous build');
    assert.throws(() => verifyPiikServerBuild(root, build), /artifacts or inputs changed/);
});
