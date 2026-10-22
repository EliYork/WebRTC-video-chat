/* eslint-disable no-await-in-loop -- One bounded real WGC test, explicitly opted in. */
// Capture only the HWND owned by our silent motion process. No screen capture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
if (!process.argv.includes('--allow-window')) throw Error('Requires --allow-window: shows an isolated silent motion window');
const home = resolve('integrations/piik/.build/performance');
const capture = resolve(process.env.PIIK_PERF_CAPTURE || 'integrations/piik/.build/runtime/native/piik-capture.exe');
const tag = process.env.PIIK_PERF_TAG || 'wgc-baseline';
const width = 3840, height = 2160, bitrate = 15000000;
assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process piik-capture -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8', windowsHide: true }).trim(), '0', 'do not contend with an existing capture');
const motion = spawn(join(home, 'native/motion-window.exe'), [String(width), String(height), '30'], { windowsHide: true, stdio: 'pipe' });
let text = '', identity, motionError = '', captureProcess, failure, log = '', buffer = Buffer.alloc(0);
const render = [], frames = [], source = [], statuses = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const wait = async (fn, label) => { for (let i = 0; i < 150; i++) { if (failure) throw failure; if (fn()) return; await delay(100); } throw Error(`Timeout: ${label}; ${log.slice(-1000)} ${motionError}`); };
motion.on('error', e => { failure = e; });
motion.stdout.on('data', b => { text += b; const lines = text.split(/\r?\n/); text = lines.pop(); for (const line of lines) {
    const row = JSON.parse(line); if (row.hwnd) identity = row; else render.push(row);
} });
motion.stderr.on('data', b => { motionError += b; });
try {
    await wait(() => identity, 'owned motion window');
    captureProcess = spawn(capture, ['--capture-video', 'window', identity.hwnd, String(identity.pid), identity.creationTime,
        '--adapter-index', '0', '--mft-index', '0', '--width', String(width), '--height', String(height),
        '--fps', '60', '--bitrate', String(bitrate), '--preference', 'maintain-framerate', '--codec', 'h264', '--protocol-v7',
        '--output', String(width), String(height), '60', String(bitrate)],
    { windowsHide: true, stdio: 'pipe', env: { ...process.env, PIIK_CAPTURE_DEBUG: '1' } });
    captureProcess.on('error', e => { failure = e; });
    captureProcess.stdin.on('error', e => { failure = e; });
    captureProcess.stderr.on('data', b => { log += b; });
    captureProcess.stdout.on('data', b => { buffer = Buffer.concat([buffer, b]);
        while (buffer.length >= 32) {
            assert.equal(buffer.toString('ascii', 0, 4), 'SMED');
            const size = buffer.readUInt32BE(28); assert.ok(size <= 4 * 1024 * 1024);
            if (buffer.length < size + 32) break;
            const kind = buffer[5], row = { at: performance.now(), timestamp: Number(buffer.readBigUInt64BE(8)) / 10000,
                bytes: size, width: buffer.readUInt16BE(24), height: buffer.readUInt16BE(26), key: buffer[6] === 1 };
            if (kind === 5) source.push(row);
            if (kind === 2) frames.push(row);
            if (kind === 3) statuses.push(JSON.parse(buffer.toString('utf8', 32, 32 + size)));
            buffer = buffer.subarray(32 + size);
        }
    });
    await wait(() => frames.length >= 90, 'WGC and NVIDIA encoded output');
    const began = performance.now(), beforeSource = source.length, beforeFrames = frames.length;
    await delay(8000);
    assert.equal(captureProcess.exitCode, null, log);
    const elapsed = (performance.now() - began) / 1000;
    const output = frames.slice(beforeFrames), input = source.slice(beforeSource);
    const delta = input.slice(1).map((r, i) => r.timestamp - input[i].timestamp).sort((a, b) => a - b);
    const report = { tag, ownedSyntheticWindow: true, realWgc: true, audio: false, target: { width, height, fps: 60, bitrate }, elapsed,
        acceptedCaptureFps: input.length / elapsed, encodedFps: output.length / elapsed,
        reducedFrames: output.filter(r => r.width !== width || r.height !== height).length,
        mbps: output.reduce((sum, r) => sum + r.bytes, 0) * 8 / elapsed / 1e6,
        captureTimestampGapP95Ms: delta[Math.floor(delta.length * .95)], render, statuses,
        samples: { input, output },
    };
    const header = Buffer.alloc(32); header.write('SMED'); header[4] = 2; header[5] = 7; header.writeUInt32BE(1, 28);
    captureProcess.stdin.write(Buffer.concat([header, Buffer.from('Q')]));
    await wait(() => captureProcess.exitCode !== null, 'capture graceful stop');
    assert.equal(captureProcess.exitCode, 0, log);
    writeFileSync(join(home, `${tag}.json`), JSON.stringify(report, null, 2));
    writeFileSync(join(home, `${tag}.log`), log);
    process.stdout.write(JSON.stringify({ ...report, samples: undefined, render: render.at(-1) }, null, 2) + '\n');
} finally {
    if (captureProcess && captureProcess.exitCode === null) { captureProcess.kill(); await once(captureProcess, 'exit'); }
    if (motion.exitCode === null) { motion.kill(); await once(motion, 'exit'); }
}
