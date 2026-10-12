/* eslint-disable no-await-in-loop, no-console */
// Real Edge / PeerJS / mediasoup, with synthetic microphone and screen audio.
// Never requests a physical microphone or joins the production service.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-audio-recovery-'));
mkdirSync(join(evidence, 'logs'));
const port = '39021';
const sfuPort = 44450;
const app = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: evidence,
    windowsHide: true,
    env: {
        ...process.env,
        PORT: port,
        USE_HTTPS: 'false',
        ENV: 'production',
        SFU_ENABLED: 'true',
        SFU_LISTEN_IP: '127.0.0.1',
        SFU_ANNOUNCED_ADDRESS: '127.0.0.1',
        SFU_PORT: String(sfuPort),
        CHAT_HISTORY_FILE: join(evidence, 'history.json'),
    },
});
let serverOutput = '';
app.stdout.on('data', (data) => {
    serverOutput += data;
});
app.stderr.on('data', (data) => {
    serverOutput += data;
});
let browser;
const pages = [];
const errors = [];
const warnings = [];
const samples = [];
const peerId = (page) =>
    page.locator('#local-video').getAttribute('data-peer-id');
const audibleFrom = async (receiver, senderId, label) => {
    await receiver.evaluate(() => {
        window.testEnergySample = undefined;
    });
    const result = await receiver.waitForFunction(
        async (id) => {
            const snapshot = window.testRegistry.getSnapshot(id);
            const pc = snapshot?.incomingCall?.peerConnection;
            if (!pc || pc.connectionState !== 'connected') return false;
            const element = document
                .getElementById(id)
                ?.querySelector('video, audio:not(.screen-share-audio)');
            if (
                !element ||
                element.paused ||
                element.muted ||
                element.volume === 0
            )
                return false;
            // Measure the primary microphone player, excluding the separately
            // controlled game/system audio so it cannot conceal a silent mic.
            const microphoneIds = new Set(
                element.srcObject?.getAudioTracks().map((track) => track.id)
            );
            const rows = [...(await pc.getStats()).values()].filter(
                (row) =>
                    row.type === 'inbound-rtp' &&
                    row.kind === 'audio' &&
                    microphoneIds.has(row.trackIdentifier) &&
                    row.audioLevel > 0.05
            );
            if (!rows.length) return false;
            const before = window.testEnergySample;
            if (!before || before.pc !== pc) {
                window.testEnergySample = { pc, rows, time: Date.now() };
                return false;
            }
            if (Date.now() - before.time < 1000) return false;
            if (
                rows.some(
                    (row) =>
                        row.totalAudioEnergy -
                            (before.rows.find((old) => old.id === row.id)
                                ?.totalAudioEnergy ?? row.totalAudioEnergy) >
                        0.02
                )
            ) {
                return {
                    before: before.rows.map((row) => ({
                        id: row.id,
                        energy: row.totalAudioEnergy,
                    })),
                    after: rows.map((row) => ({
                        id: row.id,
                        energy: row.totalAudioEnergy,
                    })),
                };
            }
            return false;
        },
        senderId,
        { timeout: 20000 }
    );
    samples.push({ label, ...(await result.jsonValue()) });
    await result.dispose();
};

const openMember = async (index) => {
    const page = await browser.newPage();
    pages.push(page);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'warning' || message.type() === 'error')
            warnings.push(message.text());
    });
    await page.addInitScript(
        ({ index }) => {
            window.testContexts = [];
            window.testCaptures = [];
            window.testSinkCalls = [];
            window.testConnections = [];
            let registryApi;
            Object.defineProperty(window, 'VoicePeerRegistry', {
                configurable: true,
                get: () => registryApi,
                set(value) {
                    const create = value.createRegistry;
                    value.createRegistry = (...args) => {
                        window.testRegistry = create(...args);
                        return window.testRegistry;
                    };
                    registryApi = value;
                },
            });
            const NativeContext = window.AudioContext;
            window.AudioContext = class extends NativeContext {
                constructor(...args) {
                    super(...args);
                    window.testContexts.push(this);
                }
            };
            const RTC = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends RTC {
                constructor(...args) {
                    super(...args);
                    window.testConnections.push(this);
                }
            };
            const setSink = HTMLMediaElement.prototype.setSinkId;
            HTMLMediaElement.prototype.setSinkId = function (id) {
                window.testSinkCalls.push(id);
                if (id === 'denied-output')
                    return Promise.reject(
                        Object.assign(
                            new Error('test sink permission denied'),
                            { name: 'NotAllowedError' }
                        )
                    );
                return setSink.call(this, id);
            };
            const nativePlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                if (
                    window.testDenyPlayback &&
                    this.closest('.video-tile')?.id !== 'local-video'
                ) {
                    return Promise.reject(
                        Object.assign(
                            new Error('test browser requires gesture'),
                            { name: 'NotAllowedError' }
                        )
                    );
                }
                return nativePlay.call(this);
            };
            navigator.mediaDevices.enumerateDevices = async () => [
                {
                    kind: 'audioinput',
                    deviceId: 'default',
                    label: 'Test Microphone',
                },
                { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
                {
                    kind: 'audiooutput',
                    deviceId: 'denied-output',
                    label: 'Denied Speaker',
                },
            ];
            navigator.mediaDevices.getUserMedia = async () => {
                const ctx = new NativeContext();
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                const dest = ctx.createMediaStreamDestination();
                oscillator.frequency.value = 440 * (index + 1);
                gain.gain.value = 0.3;
                oscillator.connect(gain).connect(dest);
                oscillator.start();
                await ctx.resume();
                window.testCaptures.push({ ctx, stream: dest.stream });
                return dest.stream;
            };
            navigator.mediaDevices.getDisplayMedia = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1280;
                canvas.height = 720;
                const ctx = canvas.getContext('2d');
                let frame = 0;
                setInterval(() => {
                    ctx.fillStyle = `hsl(${frame++ % 360},80%,40%)`;
                    ctx.fillRect(0, 0, 1280, 720);
                }, 33);
                const audio = new NativeContext();
                const oscillator = audio.createOscillator();
                const gain = audio.createGain();
                const dest = audio.createMediaStreamDestination();
                oscillator.frequency.value = 1760;
                gain.gain.value = 0.2;
                oscillator.connect(gain).connect(dest);
                oscillator.start();
                await audio.resume();
                return new MediaStream([
                    ...canvas.captureStream(30).getTracks(),
                    ...dest.stream.getTracks(),
                ]);
            };
        },
        { index }
    );
    await page.goto(`http://127.0.0.1:${port}/room/game`);
    await page.evaluate(() => {
        window.testConsumers = [];
        const create = window.ScreenSfuClient.Device.prototype.createRecvTransport;
        window.ScreenSfuClient.Device.prototype.createRecvTransport = function (
            ...args
        ) {
            const transport = create.apply(this, args);
            const consume = transport.consume.bind(transport);
            transport.consume = async (...args) => {
                const consumer = await consume(...args);
                window.testConsumers.push(consumer);
                return consumer;
            };
            return transport;
        };
    });
    await page.locator('#destroyPeer').click();
    if (await page.locator('#voiceJoinConfirm').isVisible())
        await page.locator('#voiceJoinConfirm').click();
    await page.waitForFunction(
        () => !document.getElementById('toggleAudio').disabled
    );
    await page.locator('#toggleAudio').click();
    await page.waitForFunction(
        () =>
            document
                .getElementById('toggleAudio')
                .getAttribute('aria-pressed') === 'true'
    );
    return page;
};

try {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
        } catch { /* Wait for the isolated local server. */ }
        if (app.exitCode !== null) throw new Error(serverOutput);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
        headless: true,
        channel: 'msedge',
        args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const a = await openMember(0);
    const b = await openMember(1);
    const aId = await peerId(a);
    const bId = await peerId(b);
    await audibleFrom(a, bId, 'initial B to A');
    await audibleFrom(b, aId, 'initial A to B');
    console.log('PASS: initial bidirectional microphone audio');
    await a.locator('#shareScreen').click();
    await a.locator('[data-screen-share-start]').click();
    await a.waitForFunction(
        () =>
            document
                .getElementById('screenStatusText')
                .textContent.includes('服务器转发 1 人'),
        null,
        { timeout: 30000 }
    );
    await audibleFrom(a, bId, 'SFU B to A');
    await audibleFrom(b, aId, 'SFU A to B');
    const c = await openMember(2);
    const cId = await peerId(c);
    await a.waitForFunction(
        () =>
            document
                .getElementById('screenStatusText')
                .textContent.includes('服务器转发 2 人'),
        null,
        { timeout: 30000 }
    );
    await audibleFrom(a, cId, 'late C to A during SFU');
    await audibleFrom(c, aId, 'late A to C during SFU');
    console.log(
        'PASS: late join during SFU preserves bidirectional microphone audio'
    );

    await b.evaluate(async () => {
        const consumer = window.testConsumers.find(
            (value) => value.kind === 'video' && !value.closed
        );
        const frozen = await consumer.getStats();
        consumer.getStats = async () => frozen;
    });
    await a.waitForFunction(
        () =>
            document
                .getElementById('screenStatusText')
                .textContent.includes('服务器转发 1 人'),
        null,
        { timeout: 25000 }
    );
    await b.waitForFunction(
        async (id) => {
            const pc =
                window.testRegistry.getSnapshot(id)?.incomingCall?.peerConnection;
            return (
                pc &&
                [...(await pc.getStats()).values()].some(
                    (row) =>
                        row.type === 'inbound-rtp' &&
                        row.kind === 'video' &&
                        row.framesPerSecond > 5
                )
            );
        },
        aId,
        { timeout: 15000 }
    );
    await audibleFrom(a, bId, 'P2P fallback B to A');
    await audibleFrom(b, aId, 'P2P fallback A to B');
    assert.equal(await peerId(a), aId);
    assert.equal(await peerId(b), bId);
    console.log(
        'PASS: SFU stall falls back to real P2P with both microphones audible and no rejoin'
    );

    await b.evaluate((id) => {
        window.testRegistry.getSnapshot(id).outgoingCall.peerConnection.close();
    }, aId);
    await audibleFrom(a, bId, 'closed B sender auto rebuild');
    assert.equal(await b.evaluate(() => window.testCaptures.length), 1);
    assert.equal(await peerId(b), bId);
    console.log(
        'PASS: failed microphone send direction rebuilds automatically without recapture/rejoin'
    );

    await b.evaluate(async () => {
        await window.testContexts.find((value) => value.state === 'running').suspend();
    });
    await b.waitForFunction(() => window.testContexts[0].state === 'running', null, {
        timeout: 6000,
    });
    await audibleFrom(a, bId, 'suspended processing resumed');
    await b.evaluate(async () => {
        await window.testContexts[0].close();
    });
    await audibleFrom(a, bId, 'closed processing falls back to raw');
    assert.equal(await b.evaluate(() => window.testCaptures.length), 1);
    assert.equal(
        await b.evaluate(
            () => window.testCaptures[0].stream.getAudioTracks()[0].readyState
        ),
        'live'
    );
    console.log(
        'PASS: suspended processing resumes; closed processing uses the existing raw mic'
    );

    await b.evaluate((id) => {
        window.testDenyPlayback = true;
        document.getElementById(id).querySelector('video, audio').pause();
    }, aId);
    await b
        .locator('[data-voice-status-kind="playback"] [data-audio-recovery]')
        .waitFor({ state: 'visible', timeout: 6000 });
    await b.evaluate(() => {
        window.testDenyPlayback = false;
    });
    await b
        .locator('[data-voice-status-kind="playback"] [data-audio-recovery]')
        .click();
    await audibleFrom(b, aId, 'gesture playback recovery');
    await b
        .locator('[data-voice-status-kind="playback"]')
        .waitFor({ state: 'hidden', timeout: 6000 });
    console.log(
        'PASS: playback denial offers an effective in-room recovery click'
    );

    assert.deepEqual(
        await b.evaluate(() => window.testSinkCalls),
        [],
        'default sink must not be repeatedly reopened'
    );
    await b.locator('[data-control-menu="output"]').click();
    await b
        .locator('[data-device-type="output"][data-device-id="denied-output"]')
        .click();
    await b
        .locator('[data-voice-status-kind="output"]')
        .waitFor({ state: 'visible' });
    assert.match(
        await b.locator('[data-voice-status-kind="output"]').textContent(),
        /未允许.*已回退默认设备/
    );
    await audibleFrom(b, aId, 'denied output uses existing default sink');
    await b
        .locator('[data-voice-status-kind="output"] [data-audio-recovery]')
        .click();
    await b
        .locator('[data-voice-status-kind="output"]')
        .waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    writeFileSync(
        join(evidence, 'samples.json'),
        JSON.stringify(samples, null, 2)
    );
    console.log(
        'PASS: output failure is classified and recovers without leaving the channel'
    );
    console.log('Evidence:', evidence);
} catch (error) {
    for (const [index, page] of pages.entries()) {
        const state = await page
            .evaluate(() => ({
                peers: window.testRegistry?.getPeerIds().map((id) => {
                    const state = window.testRegistry.getSnapshot(id);
                    return {
                        id,
                        incoming:
                            state.incomingCall?.peerConnection?.connectionState,
                        outgoing:
                            state.outgoingCall?.peerConnection?.connectionState,
                        inGeneration: state.incomingGeneration,
                        outGeneration: state.outgoingGeneration,
                    };
                }),
                connections: window.testConnections.length,
                contexts: window.testContexts.map((value) => value.state),
                status: document.getElementById('voiceStatusMessages')
                    ?.textContent,
            }))
            .catch(() => undefined);
        console.error('Page', index, state);
    }
    console.error('Warnings:', warnings.slice(-15));
    console.error('Browser errors:', errors);
    console.error('Server output:', serverOutput);
    throw error;
} finally {
    writeFileSync(join(evidence, 'server.log'), serverOutput);
    await browser?.close();
    if (app.exitCode === null) app.kill();
}
