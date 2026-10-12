// Offline comparison: optional public/user-supplied speech + synthetic typing.
// Reports proxy metrics, never substitutes for a real keyboard listening test.
/* eslint-disable no-await-in-loop -- Model renders must be sequential to compare isolated engines. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-rnnoise-compare-'));
let app, browser, log = '';
try {
    const reservation = createServer(); reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const url = `http://127.0.0.1:${port}/room/lobby`;
    app = spawn(process.execPath, [resolve('src/server.js')], { cwd: evidence, windowsHide: true,
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(evidence, 'history.json') } });
    app.stdout.on('data', (value) => { log += value; }); app.stderr.on('data', (value) => { log += value; });
    let ready;
    for (let i = 0; i < 100 && !ready; i++) {
        try { ready = (await fetch(url)).ok; } catch { /* startup */ }
        if (!ready) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage(); await page.goto(url);
    const speech = process.argv[2] ? readFileSync(resolve(process.argv[2])).toString('base64') : null;
    const result = await page.evaluate(async (speech) => {
        const { loadRnnoise } = await import('/vendor/web-noise-suppressor.js');
        const modern = await WebAssembly.compile(await (await fetch('/wasm/rnnoise-v2-2025.1.5.wasm')).arrayBuffer());
        const legacy = await loadRnnoise({ url: '/wasm/rnnoise.wasm', simdUrl: '/wasm/rnnoise_simd.wasm' });
        const { loadRnnoiseV2 } = await import('/audio-worklet/rnnoise-v2-wasm.js');
        const api = await loadRnnoiseV2(modern);
        const state = api.createDenoiseState();
        const times = [], frame = new Float32Array(480);
        for (let i = 0; i < 500; i++) {
            for (let j = 0; j < 480; j++) frame[j] = Math.sin((i * 480 + j) * 0.037) * 4000;
            const start = performance.now(); state.processFrame(frame);
            if (i >= 20) times.push(performance.now() - start);
        }
        state.destroy(); times.sort((a, b) => a - b);
        const length = 48000 * 8, voice = new Float32Array(length), typing = new Float32Array(length);
        if (speech) {
            const ctx = new OfflineAudioContext(1, length, 48000);
            const bytes = Uint8Array.from(atob(speech), (c) => c.charCodeAt(0));
            const decoded = await ctx.decodeAudioData(bytes.buffer);
            voice.set(decoded.getChannelData(0).subarray(0, length));
            let peak = 0; for (const value of voice) peak = Math.max(peak, Math.abs(value));
            for (let i = 0; i < length; i++) voice[i] *= 0.4 / (peak || 1);
        }
        let seed = 123456, filtered = 0;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
        for (let start = 24000; start < length - 12000; start += Math.round(5000 + random() * 2500)) {
            for (let i = 0; i < 2400; i++) {
                filtered = filtered * 0.55 + random() * 0.45;
                typing[start + i] += (filtered * 0.6 + Math.sin(i * 0.18) * 0.15) * Math.exp(-i / 220);
            }
        }
        const mixed = voice.map((value, i) => value + typing[i]);
        const render = async (engine, input) => {
            const ctx = new OfflineAudioContext(1, length + 4800, 48000);
            await ctx.audioWorklet.addModule('/audio-worklet/rnnoise-processor.js');
            const node = new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', {
                processorOptions: { engine, wasmBinary: engine === 'rnnoise-v2-2025.1.5' ? modern : legacy, maxChannels: 1 }, outputChannelCount: [1] });
            await new Promise((done, fail) => {
                const timer = setTimeout(() => fail(new Error('worklet-init-timeout')), 5000);
                node.port.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(timer); done(); } if (data.type === 'error') { clearTimeout(timer); fail(new Error(data.detail)); } };
                node.port.postMessage({ type: 'speech-gate', enabled: false, revision: 1 });
            });
            const buffer = ctx.createBuffer(1, input.length, 48000); buffer.copyToChannel(input, 0);
            const source = ctx.createBufferSource(); source.buffer = buffer;
            source.connect(node).connect(ctx.destination); source.start();
            const output = (await ctx.startRendering()).getChannelData(0).slice();
            node.port.postMessage('destroy'); node.disconnect(); return output;
        };
        const energy = (values) => values.reduce((sum, value) => sum + value * value, 0);
        const align = (output, reference) => {
            let lag = 0, best = -Infinity;
            for (let offset = 0; offset <= 2400; offset += 16) {
                let score = 0; for (let i = 48000; i < length - 48000; i += 16) score += output[i + offset] * reference[i];
                if (score > best) { best = score; lag = offset; }
            }
            return lag;
        };
        const metrics = (output, reference, lag) => {
            let dot = 0, refEnergy = 0, outEnergy = 0;
            for (let i = 48000; i < length - 48000; i++) { dot += output[i + lag] * reference[i]; refEnergy += reference[i] ** 2; outEnergy += output[i + lag] ** 2; }
            const projected = dot * dot / Math.max(1e-15, refEnergy);
            return { siSdrDb: 10 * Math.log10(Math.max(1e-15, projected) / Math.max(1e-15, outEnergy - projected)),
                relativeVoiceLevelDb: 20 * Math.log10(Math.abs(dot) / Math.max(1e-15, refEnergy)) };
        };
        const rows = [];
        for (const engine of ['rnnoise-legacy-2022', 'rnnoise-v2-2025.1.5']) {
            const noiseOut = await render(engine, typing);
            const row = { engine, syntheticTypingAttenuationDb: 10 * Math.log10(energy(typing) / Math.max(1e-15, energy(noiseOut))) };
            if (speech) {
                const cleanOut = await render(engine, voice), mixedOut = await render(engine, mixed);
                const lag = align(cleanOut, voice);
                row.delayMs = lag / 48; row.clean = metrics(cleanOut, voice, lag); row.mixed = metrics(mixedOut, voice, lag);
            }
            rows.push(row);
        }
        return { rows, probe: { p50Ms: times[240], p95Ms: times[456], p99Ms: times[475], maxMs: times.at(-1) },
            sample: speech ? 'provided speech + synthetic typing; no user microphone recording' : 'synthetic typing only',
            limitation: 'SI-SDR and energy are proxies; no guarantee of real keyboard suppression or subjective speech quality' };
    }, speech);
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result, null, 2) + `\nEvidence: ${evidence}\n`);
} finally {
    await browser?.close();
    if (app?.exitCode === null) { app.kill(); await once(app, 'exit'); }
    writeFileSync(join(evidence, 'server.log'), log);
}
