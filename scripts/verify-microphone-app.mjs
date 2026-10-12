// Actual browser/P2P audio with deterministic input devices; no physical mic access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-microphone-'));
mkdirSync(join(evidence, 'logs'));
const port = '39019';
const publicUrl = process.env.MIC_TEST_URL;
const app = publicUrl ? undefined : spawn(process.execPath, [resolve('src/server.js')], {
    cwd: evidence,
    env: { ...process.env, PORT: port, USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(evidence, 'history.json') },
    windowsHide: true,
});
let output = '';
app?.stdout.on('data', (data) => { output += data; });
app?.stderr.on('data', (data) => { output += data; });
let browser;
const pages = [];
const errors = [];
const gain = (page) => page.locator('#micGainSlider').inputValue();
const liveAudio = (page) => page.evaluate(async () => {
    for (const pc of testConnections.filter((value) => value.connectionState === 'connected')) {
        for (const row of (await pc.getStats()).values()) {
            if (row.type === 'inbound-rtp' && row.kind === 'audio' && Number.isFinite(row.totalAudioEnergy)) {
                return { id: row.id, energy: row.totalAudioEnergy, duration: row.totalSamplesDuration, level: row.audioLevel };
            }
        }
    }
});
const audible = async (page) => {
    await page.waitForFunction(async () => {
        for (const pc of testConnections.filter((value) => value.connectionState === 'connected')) {
            for (const row of (await pc.getStats()).values()) {
                if (row.type === 'inbound-rtp' && row.kind === 'audio' && row.audioLevel > 0.05) return true;
            }
        }
        return false;
    }, null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const before = await liveAudio(page);
    await page.waitForTimeout(2000);
    const after = await liveAudio(page);
    console.log('Receiver audio samples:', { before, after });
    assert.ok(after && before && after.id === before.id && after.energy - before.energy > 0.02, 'receiver must get audible audio, not just RTP packets');
};
try {
    for (let i = 0; !publicUrl && i < 100; i++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {}
        if (app.exitCode !== null) throw new Error(output);
        await new Promise((done) => setTimeout(done, 100));
    }
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    for (let i = 0; i < 2; i++) {
        const page = await browser.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            window.testConnections = [];
            window.testRequests = [];
            window.testContexts = [];
            const RTC = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends RTC {
                constructor(...args) { super(...args); testConnections.push(this); }
            };
            const Context = window.AudioContext;
            window.AudioContext = class extends Context {
                constructor(...args) {
                    super(...args);
                    testContexts.push(this);
                    // Model a browser that requires resume, and a broken context.
                    if (window.testBlockProcessing) {
                        Object.defineProperty(this, 'state', { get: () => 'suspended' });
                        this.resume = async () => { throw new Error('test processing unavailable'); };
                    }
                }
            };
            navigator.mediaDevices.enumerateDevices = async () => [
                { kind: 'audioinput', deviceId: 'default', label: '默认 - Test Mic A' },
                { kind: 'audioinput', deviceId: 'mic-a', label: 'Test Mic A' },
                { kind: 'audioinput', deviceId: 'mic-b', label: 'Test Mic B' },
                { kind: 'audiooutput', deviceId: 'default', label: 'Test Output' },
            ];
            navigator.mediaDevices.getUserMedia = async (constraints) => {
                if (!constraints.audio) throw new Error('only audio requested in this test');
                const deviceId = constraints.audio.deviceId?.exact || 'default';
                testRequests.push(deviceId);
                const context = new Context();
                const oscillator = context.createOscillator();
                oscillator.frequency.value = deviceId === 'mic-b' ? 880 : 440;
                const gainNode = context.createGain();
                gainNode.gain.value = 0.3;
                const destination = context.createMediaStreamDestination();
                oscillator.connect(gainNode).connect(destination);
                oscillator.start();
                await context.resume();
                const track = destination.stream.getAudioTracks()[0];
                track.getSettings = () => ({ deviceId: deviceId === 'default' ? 'mic-a' : deviceId });
                return destination.stream;
            };
        });
        await page.goto(publicUrl || `http://127.0.0.1:${port}/room/game`);
        console.log('Initial microphone gain:', await gain(page));
        assert.equal(await gain(page), '100');
        await page.locator('#destroyPeer').click();
        if (await page.locator('#voiceJoinConfirm').isVisible()) await page.locator('#voiceJoinConfirm').click();
        await page.waitForFunction(() => !document.getElementById('toggleAudio').disabled, null, { timeout: 20000 });
        pages.push(page);
    }
    await pages[0].locator('#toggleAudio').click();
    await pages[0].waitForFunction(() => document.getElementById('toggleAudio').getAttribute('aria-pressed') === 'true');
    await audible(pages[1]);
    assert.equal(await pages[0].locator('[data-device-type="mic"][data-device-id="default"]').getAttribute('aria-pressed'), 'true');
    console.log('PASS: default mic sends audible P2P audio on a fresh profile at 100 percent gain');

    await pages[0].locator('#toggleAudio').click();
    await pages[0].waitForFunction(() => document.getElementById('toggleAudio').getAttribute('aria-pressed') === 'false');
    await pages[0].locator('[data-device-control="mic"]').hover();
    await pages[0].locator('[data-device-type="mic"][data-device-id="mic-b"]').click();
    await pages[0].waitForFunction(() => testRequests.at(-1) === 'mic-b');
    await pages[0].waitForTimeout(500);
    assert.equal(await pages[0].locator('#toggleAudio').getAttribute('aria-pressed'), 'false');
    await pages[0].locator('#toggleAudio').click();
    await audible(pages[1]);
    console.log('PASS: switching devices while muted changes actual capture and unmuting restores audible audio');

    await pages[0].evaluate(() => { window.testBlockProcessing = true; });
    await pages[0].locator('[data-device-control="mic"]').hover();
    await pages[0].locator('[data-device-type="mic"][data-device-id="default"]').click();
    await pages[0].waitForFunction(() => testRequests.at(-1) === 'default');
    await audible(pages[1]);
    await pages[0].evaluate(() => VoiceDeviceRuntime && navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
    await pages[0].waitForTimeout(400);
    assert.equal(await pages[0].locator('[data-device-type="mic"][data-device-id="default"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    console.log('PASS: unavailable audio processing falls back to audible raw mic; default selection remains default after device refresh');
    console.log('Evidence directory:', evidence);
} catch (error) {
    console.error('Browser errors:', errors);
    console.error('Server output:', output);
    throw error;
} finally {
    await browser?.close();
    if (app?.exitCode === null) app.kill();
}
