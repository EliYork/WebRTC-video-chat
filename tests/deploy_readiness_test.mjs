/* eslint-disable no-await-in-loop -- Exercise each HTTP response through the actual shell gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const bash =
    process.platform === 'win32'
        ? (process.env.PATH || '')
              .split(delimiter)
              .filter(Boolean)
              .map((directory) =>
                  join(directory.replace(/^"(.*)"$/, '$1'), 'bash.exe')
              )
              .find((path) => existsSync(path)) ||
          join(
              process.env.ProgramFiles || 'C:/Program Files',
              'Git/bin/bash.exe'
          )
        : '/bin/bash';
const probeTimeoutMs = 20000;
const bashUnavailable =
    !existsSync(bash) &&
    'Bash unavailable; run this deployment gate check on the deployment host';
const source = readFileSync(
    new URL('../scripts/deploy-baota.sh', import.meta.url),
    'utf8'
).replaceAll('\r\n', '\n');
const probe = source.match(
    /^probe_ready\(\) \{\n[\s\S]*?^\}\n(?=LOCAL_READY_URL)/m
)?.[0];
assert.ok(probe);
const runProbe = async (url, t, env = {}) => {
    const started = Date.now();
    const child = spawn(
        bash,
        [
            '--noprofile',
            '--norc',
            '-c',
            `set -o pipefail\n${probe}\nprobe_ready "$READY_URL"`,
        ],
        {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
            timeout: probeTimeoutMs,
            signal: t.signal,
            env: {
                ...process.env,
                NODE: process.execPath.replaceAll('\\', '/'),
                READY_URL: url,
                ...env,
            },
        }
    );
    let output = '';
    child.stderr.on('data', (chunk) => {
        output += chunk;
    });
    const [exitCode, signal] = await once(child, 'close');
    assert.equal(
        child.killed,
        false,
        `Readiness probe exceeded its time limit\n${output}`
    );
    assert.equal(
        signal,
        null,
        `Readiness probe terminated before completing: ${signal}\n${output}`
    );
    assert.notEqual(
        exitCode,
        null,
        'Readiness probe did not return an exit code'
    );
    return { exitCode, output, elapsedMs: Date.now() - started };
};
const listen = async (server, t) => {
    t.after(
        () =>
            new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            })
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
};
test(
    'deployment readiness gate rejects 503, false flags, malformed JSON and proxy HTML',
    {
        skip: bashUnavailable,
        timeout: probeTimeoutMs * 15 + 10000,
    },
    async (t) => {
        t.diagnostic(`Bash executable: ${bash}`);
        let status = 200,
            body = '';
        const server = createServer((req, res) => {
            assert.equal(req.url, '/readyz');
            res.writeHead(status);
            res.end(body);
        });
        const port = await listen(server, t);
        const padded = JSON.stringify({
            ok: true,
            mediaReady: true,
            padding: '',
        });
        for (const [code, content, expected] of [
            [200, '{"ok":true,"mediaReady":true}', 0],
            [201, '{"ok":true,"mediaReady":true}', 1],
            [301, '{"ok":true,"mediaReady":true}', 1],
            [503, '{"ok":true,"mediaReady":true}', 1],
            [200, '{"ok":true,"mediaReady":false}', 1],
            [200, '{"ok":false,"mediaReady":true}', 1],
            [200, '{"ok":"true","mediaReady":"true"}', 1],
            [200, '<html>proxy fallback</html>', 1],
            [200, '', 1],
            [200, 'null', 1],
            [200, 'x'.repeat(70000), 1],
            [
                200,
                JSON.stringify({
                    ok: true,
                    mediaReady: true,
                    padding: 'x'.repeat(65536 - Buffer.byteLength(padded)),
                }),
                0,
            ],
            [
                200,
                JSON.stringify({
                    ok: true,
                    mediaReady: true,
                    padding: 'x'.repeat(65537 - Buffer.byteLength(padded)),
                }),
                1,
            ],
            [
                200,
                JSON.stringify({
                    ok: true,
                    mediaReady: true,
                    padding: '中'.repeat(22000),
                }),
                1,
            ],
        ]) {
            status = code;
            body = content;
            const { exitCode, output, elapsedMs } = await runProbe(
                `http://127.0.0.1:${port}/readyz`,
                t
            );
            t.diagnostic(
                `HTTP ${code}, ${Buffer.byteLength(content)} bytes: ${elapsedMs}ms`
            );
            assert.equal(
                exitCode === 0 ? 0 : 1,
                expected,
                `${code}: ${content.slice(0, 60)}\n${output}`
            );
        }
    }
);

test(
    'deployment readiness enforces an eight-second response deadline and rejects truncated bodies',
    {
        skip: bashUnavailable,
        timeout: probeTimeoutMs * 2 + 10000,
    },
    async (t) => {
        let mode = 'truncated';
        const server = createServer((_, res) => {
            if (mode === 'truncated') {
                res.writeHead(200, { 'Content-Length': '100' });
                res.end('{"ok":true,"mediaReady":true}');
            } else {
                res.writeHead(200);
                res.write('{"ok":true');
            }
        });
        const port = await listen(server, t);
        assert.equal(
            (await runProbe(`http://127.0.0.1:${port}/readyz`, t)).exitCode,
            1
        );
        mode = 'stalled';
        const stalled = await runProbe(`http://127.0.0.1:${port}/readyz`, t);
        assert.equal(stalled.exitCode, 1);
        assert.ok(
            stalled.elapsedMs >= 7500,
            `deadline returned too early: ${stalled.elapsedMs}`
        );
    }
);

test(
    'deployment readiness validates HTTPS trust and refuses unreachable or unsupported endpoints',
    {
        skip: bashUnavailable,
        timeout: probeTimeoutMs * 5 + 10000,
    },
    async (t) => {
        const cert = new URL('./fixtures/tls/server.crt', import.meta.url);
        const server = createHttpsServer(
            {
                key: readFileSync(
                    new URL('./fixtures/tls/server.key', import.meta.url)
                ),
                cert: readFileSync(cert),
            },
            (_, res) => res.end('{"ok":true,"mediaReady":true}')
        );
        const port = await listen(server, t);
        const url = `https://127.0.0.1:${port}/readyz`;
        assert.equal(
            (
                await runProbe(url, t, {
                    NODE_EXTRA_CA_CERTS: '',
                    NODE_TLS_REJECT_UNAUTHORIZED: '1',
                })
            ).exitCode,
            1
        );
        assert.equal(
            (
                await runProbe(url, t, {
                    NODE_EXTRA_CA_CERTS: '',
                    NODE_TLS_REJECT_UNAUTHORIZED: '0',
                })
            ).exitCode,
            1,
            'Readiness must verify TLS even when the parent Node environment disables it'
        );
        const { fileURLToPath } = await import('node:url');
        assert.equal(
            (
                await runProbe(url, t, {
                    NODE_EXTRA_CA_CERTS: fileURLToPath(cert),
                    NODE_TLS_REJECT_UNAUTHORIZED: '1',
                })
            ).exitCode,
            0
        );
        await new Promise((resolve) => server.close(resolve));
        assert.equal((await runProbe(url, t)).exitCode, 1);
        assert.equal(
            (await runProbe('file:///test-only/readiness', t)).exitCode,
            1
        );
        assert.equal((await runProbe('invalid-test-url', t)).exitCode, 1);
    }
);
