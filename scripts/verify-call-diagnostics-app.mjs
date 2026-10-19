// Synthetic audio only. Validates reporting/playout/UI behavior, not AEC or noise quality.
/* eslint-disable no-await-in-loop -- Two joined clients and ordered lifecycle checks. */
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
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-call-diagnostics-'));
let app, browser, output = '';
try {
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const url = `http://127.0.0.1:${port}/room/lobby`;
    app = spawn(process.execPath, [resolve('src/server.js')], {
        cwd: evidence, windowsHide: true,
        env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(evidence, 'history.json') },
    });
    app.stdout.on('data', (value) => { output += value; });
    app.stderr.on('data', (value) => { output += value; });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
        try { ready = (await fetch(url)).ok; } catch { /* startup */ }
        if (app.exitCode !== null) throw new Error(output);
        if (!ready) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready);
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const pages = [await browser.newPage(), await browser.newPage()];
    const errors = [];
    for (const page of pages) {
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.copiedDiagnostics = text; } } });
        });
        await page.goto(url);
        await page.locator('#destroyPeer').click();
        if (await page.locator('#voiceJoinConfirm').isVisible()) await page.locator('#voiceJoinConfirm').click();
        await page.waitForFunction(() => !document.getElementById('toggleAudio').disabled);
        await page.keyboard.press('Escape');
        await page.locator('#toggleAudio').click();
        await page.waitForFunction(() => document.getElementById('toggleAudio').getAttribute('aria-pressed') === 'true');
    }
    await pages[1].waitForSelector('.video-tile:not(#local-video)');
    await pages[1].locator('.video-tile:not(#local-video)').first().click({ button: 'right' });
    const voiceSlider = pages[1].locator('.peer-volume-popover input').first();
    await voiceSlider.fill('200');
    await voiceSlider.dispatchEvent('input');
    await pages[1].waitForFunction(() => document.querySelector('.video-tile:not(#local-video) video, .video-tile:not(#local-video) audio')?.muted === true);
    await pages[1].keyboard.press('Escape');
    await pages[0].waitForTimeout(2200);
    await pages[0].evaluate(() => window.VoiceCallDiagnostics.copyCombined(document.querySelector('[data-copy-call-diagnostics]')));
    const combined = await pages[0].evaluate(() => JSON.parse(window.copiedDiagnostics));
    assert.equal(combined.诊断格式, 5);
    assert.equal(combined.未响应原因, null);
    assert.equal(combined.对端.length, 1);
    assert.equal(combined.对端[0].状态, '已采样');
    assert.equal(combined.本机.当前状态.浏览器.浏览器, 'Edge');
    assert.ok(combined.对端[0].数据.当前会话.历史采样.length > 0);
    assert.ok(combined.本机.当前状态.连接.some((pc) => pc.音频流?.length > 0));
    assert.doesNotMatch(JSON.stringify(combined), /deviceId|peerId|trackIdentifier|candidate-pair|192\.168\./);
    assert.equal(combined.对端[0].数据.当前状态.本机音频.放大播放.amplifiedPlayers, 1);
    const player = combined.对端[0].数据.当前状态.输出播放[0].语音播放;
    assert.equal(player.WebAudio放大, true);
    assert.equal(player.原生静音, true);
    assert.equal(player.重复播放风险, false);
    assert.equal(player.音频轨道数, 1);
    const support = await pages[0].evaluate(() => {
        const supported = navigator.mediaDevices.getSupportedConstraints();
        return { supported: supported.restrictOwnAudio === true,
            audio: window.VoiceMediaLifecycle.buildScreenCaptureConstraints({}, supported).audio };
    });
    assert.deepEqual(support.audio, support.supported ? { restrictOwnAudio: true } : true);
    // Measure real browser gain output with a synthetic tone and AnalyserNodes.
    const gain = await pages[1].evaluate(async () => {
        const sourceContext = new AudioContext();
        const oscillator = sourceContext.createOscillator();
        const inputGain = sourceContext.createGain();
        inputGain.gain.value = 0.08;
        const destination = sourceContext.createMediaStreamDestination();
        oscillator.connect(inputGain).connect(destination);
        oscillator.start();
        await sourceContext.resume();
        const nodes = [];
        let gainContext;
        const runtime = window.VoiceRemoteAudioGain.createRuntime({ createContext: () => {
            const context = gainContext = new AudioContext();
            const original = context.createGain.bind(context);
            context.createGain = () => { const node = original(); nodes.push(node); return node; };
            return context;
        } });
        const voice = document.createElement('audio'), screen = document.createElement('audio');
        voice.srcObject = screen.srcObject = destination.stream;
        runtime.setVolume(voice, { volume: 2 });
        runtime.setVolume(screen, { volume: 1.5 });
        const analysers = nodes.map((node) => { const analyser = gainContext.createAnalyser(); analyser.fftSize = 2048; node.connect(analyser); return analyser; });
        await new Promise((done) => setTimeout(done, 400));
        const rms = analysers.map((analyser) => { const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values); return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length); });
        runtime.destroy();
        oscillator.stop();
        destination.stream.getTracks().forEach((track) => track.stop());
        await sourceContext.close();
        return rms;
    });
    assert.ok(gain[0] > 0.1 && gain[0] < 0.13, `200% RMS=${gain[0]}`);
    assert.ok(Math.abs(gain[0] / gain[1] - 4 / 3) < 0.08, 'independent voice/shared gains');
    // True fullscreen places both controls in the visible fullscreen subtree.
    await pages[1].evaluate(() => {
        const root = document.createElement('div');
        root.id = 'test-fullscreen';
        const button = document.createElement('button');
        button.textContent = 'full';
        button.onclick = () => root.requestFullscreen();
        root.append(button);
        document.body.append(root);
    });
    await pages[1].locator('#test-fullscreen button').click();
    await pages[1].waitForFunction(() => Boolean(document.fullscreenElement));
    await pages[1].evaluate(() => window.VoiceRemoteVolumeUI.openPopover({ event: { clientX: 100, clientY: 100 }, controls: [{ titleText: '语音音量', currentVolume: 200 }, { titleText: '共享音量', currentVolume: 50 }] }));
    assert.equal(await pages[1].locator('#test-fullscreen .peer-volume-popover input').count(), 2);
    await pages[1].locator('#test-fullscreen .peer-volume-popover input').nth(1).fill('40');
    await pages[1].evaluate(() => document.exitFullscreen());
    await pages[1].waitForFunction(() => !document.querySelector('.peer-volume-popover'));
    assert.equal(await pages[1].locator('.peer-volume-popover').count(), 0);
    await pages[0].keyboard.press('Escape');
    await pages[0].locator('#destroyPeer').click();
    await pages[0].waitForFunction(() => JSON.parse(localStorage.getItem('voice-call-diagnostics-v1'))?.at(-1)?.结束时间);
    await pages[0].reload();
    const saved = await pages[0].evaluate(() => JSON.parse(localStorage.getItem('voice-call-diagnostics-v1')));
    assert.ok(saved.at(-1).结束时间);
    assert.ok(saved.at(-1).事件.length);
    assert.deepEqual(errors, []);
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ combined, gain, saved, errors }, null, 2));
    process.stdout.write(`PASS: paired real Socket.IO/RTC diagnostics, local session persistence, 200% tone measurement, independent gains and fullscreen controls. Evidence: ${evidence}\n`);
} finally {
    await browser?.close();
    if (app?.exitCode === null) { app.kill(); await once(app, 'exit'); }
    writeFileSync(join(evidence, 'server.log'), output);
}
