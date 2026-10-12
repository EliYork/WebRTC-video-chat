// Real Edge, real HTTP CSP, real RNNoise WASM; synthetic mic, no physical audio.
/* eslint-disable no-await-in-loop -- Ordered switches exercise one live pipeline. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-noise-switch-'));
const publicUrl = process.env.NOISE_TEST_URL;
let app, browser, output = '';
try {
    let url = publicUrl;
    if (!url) {
        const reservation = createServer();
        reservation.listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = reservation.address().port;
        await new Promise((done) => reservation.close(done));
        url = `http://127.0.0.1:${port}/room/lobby`;
        app = spawn(process.execPath, [resolve('src/server.js')], {
            cwd: evidence, windowsHide: true,
            env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(evidence, 'history.json') },
        });
        app.stdout.on('data', (v) => { output += v; });
        app.stderr.on('data', (v) => { output += v; });
        let ready = false;
        for (let i = 0; i < 100 && !ready; i++) {
            try { ready = (await fetch(url)).ok; } catch { /* startup */ }
            if (app.exitCode !== null) throw new Error(output);
            if (!ready) await new Promise((done) => setTimeout(done, 100));
        }
        assert.ok(ready, 'isolated server started');
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true,
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
        window.noiseTestOutputTracks = [];
        const original = AudioContext.prototype.createMediaStreamDestination;
        AudioContext.prototype.createMediaStreamDestination = function (...args) {
            const destination = original.apply(this, args);
            window.noiseTestOutputTracks.push(destination.stream.getAudioTracks()[0]);
            return destination;
        };
    });
    const response = await page.goto(url);
    assert.equal(response.status(), 200);
    const policy = response.headers()['content-security-policy'];
    assert.ok(policy.includes("'wasm-unsafe-eval'"));
    assert.ok(!policy.includes("'unsafe-eval'"));
    await page.waitForFunction(() => Boolean(window.VoiceAudioProcessing));
    // DevTools evaluation can bypass eval CSP. Execute from a normal nonce script.
    await page.evaluate(() => {
        const script = document.createElement('script');
        script.nonce = document.querySelector('script[nonce]').nonce;
        script.textContent = `setTimeout(() => {
            try { window.eval('1 + 1'); window.noiseTestEvalBlocked = false; }
            catch (error) { window.noiseTestEvalBlocked = error.name === 'EvalError'; }
        }, 0);`;
        document.head.append(script);
        script.remove();
    });
    await page.waitForFunction(() => window.noiseTestEvalBlocked !== undefined);
    // No route replacements or bypassCSP: load the application's real modules.
    const report = await page.evaluate(async () => {
        const evalBlocked = window.noiseTestEvalBlocked;
        const runtime = window.VoiceAudioProcessing.createRuntime();
        const reports = [];
        let stream, track;
        try {
            for (const mode of ['rnnoise', 'browser', 'rnnoise', 'off', 'rnnoise', 'browser', 'off', 'rnnoise']) {
                const candidate = await runtime.stage({ mode, deviceId: 'default' });
                const previous = stream;
                stream = runtime.adopt(candidate);
                track ||= stream.getAudioTracks()[0];
                // Allow the Worklet's gate acknowledgement to arrive.
                await new Promise((done) => setTimeout(done, 100));
                reports.push({ requested: mode, stable: !previous || stream === previous,
                    sameTrack: stream.getAudioTracks()[0] === track,
                    muted: !track.enabled, trackState: track.readyState,
                    diagnostics: runtime.diagnostics(stream) });
                track.enabled = false;
            }
            const rapid = await Promise.allSettled(['browser', 'off', 'rnnoise'].map(
                (mode) => runtime.stage({ mode, deviceId: 'default' })
            ));
            stream = runtime.adopt(rapid[2].value);
            return { browser: navigator.userAgent, evalBlocked, reports,
                rapid: rapid.map((row) => ({ status: row.status, errorName: row.reason?.name })),
                rapidStable: stream.getAudioTracks()[0] === track && !track.enabled };
        } finally { runtime.dispose(stream); }
    });
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
    assert.ok(report.evalBlocked, 'JavaScript eval blocked by CSP');
    for (const [index, row] of report.reports.entries()) {
        assert.ok(row.stable && row.sameTrack && row.trackState === 'live');
        assert.equal(row.diagnostics.mode, row.requested);
        assert.equal(row.diagnostics.actual.noiseSuppression, row.requested === 'browser');
        assert.equal(row.diagnostics.lastSwitchFailure, null);
        if (index) assert.ok(row.muted, 'switch preserves mute');
        if (row.requested === 'rnnoise') {
            assert.ok(row.diagnostics.speechGateSupported && row.diagnostics.speechGateEnabled);
        }
    }
    assert.deepEqual(report.rapid.map((row) => row.status), ['rejected', 'rejected', 'fulfilled']);
    assert.ok(report.rapid.slice(0, 2).every((row) => row.errorName === 'AbortError'));
    assert.ok(report.rapidStable);
    // Also exercise the actual joined-room settings controller and status view.
    await page.locator('#destroyPeer').click();
    if (await page.locator('#voiceJoinConfirm').isVisible()) await page.locator('#voiceJoinConfirm').click();
    await page.waitForFunction(() => !document.getElementById('toggleAudio').disabled);
    if (await page.locator('#toggleAudio').getAttribute('aria-pressed') === 'false')
        await page.locator('#toggleAudio').click();
    await page.waitForFunction(() => window.noiseTestOutputTracks.some((track) => track.readyState === 'live'));
    await page.evaluate(() => {
        window.noiseTestUiTrack = window.noiseTestOutputTracks.find((track) => track.readyState === 'live');
    });
    if (await page.locator('#toggleAudio').getAttribute('aria-pressed') === 'true')
        await page.locator('#toggleAudio').click();
    const uiReports = [];
    for (const [mode, label] of [['browser', '浏览器内置'], ['rnnoise', 'RNNoise'], ['off', '关闭'], ['rnnoise', 'RNNoise'], ['browser', '浏览器内置'], ['rnnoise', 'RNNoise']]) {
        await page.locator('[data-audio-noise-mode]').selectOption(mode, { force: true });
        await page.waitForFunction(({ mode, label }) => {
            const status = document.querySelector('[data-audio-processing-status]').textContent;
            return document.querySelector('[data-audio-noise-mode]').value === mode &&
                status.includes(`实际：${label}`) && !status.includes('切换中') && !status.includes('失败');
        }, { mode, label });
        const row = await page.evaluate(() => ({
            status: document.querySelector('[data-audio-processing-status]').textContent,
            stable: window.noiseTestUiTrack.readyState === 'live',
            muted: !window.noiseTestUiTrack.enabled,
            liveOutputs: window.noiseTestOutputTracks.filter((track) => track.readyState === 'live').length,
        }));
        assert.ok(row.stable && row.muted && row.liveOutputs === 1);
        uiReports.push({ mode, ...row });
    }
    await page.locator('#destroyPeer').click();
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ ...report, uiReports }, null, 2));
    process.stdout.write(`PASS: 8 runtime switches, 6 joined-room UI switches, rapid selection, stable muted track, WASM allowed and JS eval blocked. Evidence: ${evidence}\n`);
} finally {
    await browser?.close();
    if (app?.exitCode === null) {
        const exited = once(app, 'exit');
        app.kill();
        await exited;
    }
}
