// Full application smoke: actual PeerJS/P2P, mediasoup, controls and rendered tiles.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-screen-sfu-'));
mkdirSync(join(evidence, 'logs'));
const port = process.env.SFU_APP_TEST_PORT || '39013';
const priority = process.argv.includes('--priority');
const expectedServerViewers = priority ? 1 : 4;
const app = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: evidence,
    env: {
        ...process.env,
        PORT: port,
        USE_HTTPS: 'false',
        ENV: 'production',
        SFU_ENABLED: 'true',
        SFU_ANNOUNCED_ADDRESS: '127.0.0.1',
        SFU_LISTEN_IP: '127.0.0.1',
        SFU_PORT: '44448',
        ...(priority ? { SFU_PAYLOAD_MBPS: '7', SFU_VIDEO_MBPS: '6.5' } : {}),
        CHAT_HISTORY_FILE: join(evidence, 'history.json'),
    },
    windowsHide: true,
});
let output = '';
app.stdout.on('data', (data) => {
    output += data;
});
app.stderr.on('data', (data) => {
    output += data;
});
const errors = [];
const warnings = [];
let browser;
const pages = [];
try {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
        } catch {}
        if (app.exitCode !== null) throw new Error(output);
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    browser = await chromium.launch({
        headless: true,
        channel: process.env.SFU_TEST_BROWSER || 'msedge',
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
        ],
    });
    for (let i = 0; i < 5; i++) {
        const page = await browser.newPage();
        page.on('pageerror', (error) => errors.push(`${i}: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'warning' || message.type() === 'error')
                warnings.push(`console ${i}: ${message.text()}`);
        });
        await page.addInitScript(() => {
            let socketFactory;
            Object.defineProperty(window, 'io', {
                configurable: true,
                get: () => socketFactory,
                set(value) {
                    socketFactory = Object.assign((...args) => {
                        window.testSocket = value(...args);
                        return window.testSocket;
                    }, value);
                },
            });
            window.testConnections = [];
            const Original = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends Original {
                constructor(...args) {
                    super(...args);
                    window.testConnections.push(this);
                }
            };
            navigator.mediaDevices.getDisplayMedia = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1280;
                canvas.height = 720;
                const ctx = canvas.getContext('2d');
                let frame = 0;
                window.drawTimer = setInterval(() => {
                    ctx.fillStyle = `hsl(${frame++ % 360},80%,40%)`;
                    ctx.fillRect(0, 0, 1280, 720);
                    ctx.fillStyle = 'white';
                    ctx.fillRect(frame % 1200, 0, 80, 720);
                }, 16);
                const audio = new AudioContext();
                const oscillator = audio.createOscillator();
                const destination = audio.createMediaStreamDestination();
                oscillator.connect(destination);
                oscillator.start();
                await audio.resume();
                return new MediaStream([
                    ...canvas.captureStream(60).getTracks(),
                    ...destination.stream.getTracks(),
                ]);
            };
        });
        await page.goto(`http://127.0.0.1:${port}/room/game`);
        await page.waitForFunction(() => testSocket?.io?.engine?.transport?.name === 'websocket', null, { timeout: 10000 });
        await page.evaluate(() => {
            window.testSfuConsumers = [];
            const create = ScreenSfuClient.Device.prototype.createRecvTransport;
            ScreenSfuClient.Device.prototype.createRecvTransport = function (...args) {
                const transport = create.apply(this, args);
                const consume = transport.consume.bind(transport);
                transport.consume = async (...parameters) => {
                    const consumer = await consume(...parameters);
                    window.testSfuConsumers.push(consumer);
                    return consumer;
                };
                return transport;
            };
        });
        await page.locator('#destroyPeer').click();
        if (await page.locator('#voiceJoinConfirm').isVisible())
            await page.locator('#voiceJoinConfirm').click();
        await page.waitForFunction(
            () => document.getElementById('shareScreen')?.disabled === false,
            null,
            { timeout: 20000 }
        );
        await page.locator('#toggleAudio').click();
        await page.waitForFunction(
            () =>
                document
                    .getElementById('toggleAudio')
                    ?.getAttribute('aria-pressed') === 'true',
            null,
            { timeout: 10000 }
        );
        pages.push(page);
    }
    await pages[0].locator('#shareScreen').click();
    await pages[0].locator('[data-screen-share-start]').click();
    await pages[0].waitForFunction(
        (count) =>
            document
                .getElementById('screenStatusText')
                .textContent.includes(`服务器转发 ${count} 人`),
        expectedServerViewers,
        { timeout: 25000 }
    );
    await pages[0].waitForFunction(
        (count) =>
            testConnections
                .filter((pc) => pc.connectionState === 'connected')
                .flatMap((pc) => pc.getSenders())
                .filter((sender) => sender.track?.kind === 'video').length ===
            count,
        5 - expectedServerViewers,
        { timeout: 10000 }
    );
    for (const page of pages.slice(1)) {
        await page.waitForFunction(
            () =>
                [
                    ...document.querySelectorAll(
                        '.video-tile:not(#local-video) video'
                    ),
                ].some((video) => video.videoWidth > 0 && !video.paused),
            null,
            { timeout: 10000 }
        );
        await page.waitForFunction(
            () =>
                [
                    ...document.querySelectorAll(
                        '.video-tile:not(#local-video) video'
                    ),
                ].some(
                    (video) =>
                        video.videoWidth > 0 &&
                        video.srcObject?.getAudioTracks().length > 0
                ),
            null,
            { timeout: 10000 }
        );
        const kinds = await page.evaluate(() =>
            [
                ...document.querySelectorAll(
                    '.video-tile:not(#local-video) video'
                ),
            ]
                .find((video) => video.videoWidth > 0)
                ?.srcObject.getTracks()
                .map((track) => track.kind)
        );
        assert.ok(
            kinds.includes('audio'),
            'microphone must remain in the primary playback stream'
        );
        assert.ok(
            await page.locator('.screen-share-audio').count(),
            'game sound must retain separate volume control'
        );
    }
    for (const page of pages.slice(1)) {
        const panel = page.locator('.video-tile:not(#local-video) .share-diagnostics').first();
        await panel.locator('summary').click();
        await page.waitForFunction(() => {
            const text = document.querySelector('.video-tile:not(#local-video) .share-diagnostics[open] pre')?.textContent;
            try {
                const data = JSON.parse(text);
                return data.连接.some((connection) => connection.视频流.some((video) => video.方向 === '接收' && video.采样间隔_ms > 0));
            } catch { return false; }
        }, null, { timeout: 12000 });
    }
    console.log('PASS: viewer diagnostics remain open and retain interval statistics across SFU samples');
    if (priority) {
        const viaServer = await Promise.all(
            pages.slice(1).map((page) =>
                page.evaluate(async () => {
                    for (const pc of testConnections.filter(
                        (value) => value.connectionState === 'connected'
                    )) {
                        const stats = [...(await pc.getStats()).values()];
                        if (
                            stats.some(
                                (row) =>
                                    row.type === 'remote-candidate' &&
                                    row.port === 44448
                            ) &&
                            stats.some(
                                (row) =>
                                    row.type === 'inbound-rtp' &&
                                    row.kind === 'video' &&
                                    row.framesDecoded > 0
                            )
                        )
                            return true;
                    }
                    return false;
                })
            )
        );
        assert.deepEqual(viaServer, [true, false, false, false]);
        console.log(
            'PASS: first viewer retains SFU; three later viewers still watch over real P2P with separate game audio'
        );
    } else
        console.log(
            'PASS: full room controls, four SFU viewers, one active video upload, P2P microphone and separate game audio'
        );
    if (!priority) {
        // The native-worker test pauses actual SFU packets. Here, freeze only
        // receiver stats to exercise failover through the complete room UI.
        await pages[1].evaluate(async () => {
            const consumer = testSfuConsumers.find((value) => value.kind === 'video' && !value.closed);
            const frozen = await consumer.getStats();
            consumer.getStats = async () => frozen;
        });
        await pages[0].waitForFunction(() => document.getElementById('screenStatusText').textContent.includes('服务器转发 3 人'), null, { timeout: 20000 });
        await pages[1].waitForFunction(async () => {
            for (const pc of testConnections.filter((value) => value.connectionState === 'connected')) {
                const rows = [...(await pc.getStats()).values()];
                if (!rows.some((row) => row.type === 'remote-candidate' && row.port === 44448) &&
                    rows.some((row) => row.type === 'inbound-rtp' && row.kind === 'video' && row.framesPerSecond > 5 && row.frameWidth === 1280 && row.frameHeight === 720)) return true;
            }
            return false;
        }, null, { timeout: 15000 });
        for (const page of pages.slice(2)) {
            assert.ok(await page.evaluate(async () => {
                for (const consumer of testSfuConsumers.filter((value) => value.kind === 'video' && !value.closed)) {
                    if ([...(await consumer.getStats()).values()].some((row) => row.type === 'inbound-rtp' && row.framesPerSecond > 5)) return true;
                }
                return false;
            }));
        }
        console.log('PASS: stalled SFU receiver resumes real P2P at original capture resolution; other SFU viewers continue');
    }
    await pages[0].locator('#shareScreen').click();
    await pages[0].locator('#shareScreen').click();
    await pages[0].locator('[data-screen-share-start]').click();
    await pages[0].waitForFunction(
        (count) =>
            document
                .getElementById('screenStatusText')
                .textContent.includes(`服务器转发 ${count} 人`),
        expectedServerViewers,
        { timeout: 25000 }
    );
    console.log(
        'PASS: screen stop and restart retain room membership and playback'
    );
    app.kill();
    await pages[0].waitForFunction(
        () =>
            testConnections
                .filter((pc) => pc.connectionState === 'connected')
                .flatMap((pc) => pc.getSenders())
                .filter((sender) => sender.track?.kind === 'video').length ===
            4,
        null,
        { timeout: 20000 }
    );
    for (const page of pages.slice(1)) {
        await page.waitForFunction(
            async () => {
                for (const pc of testConnections.filter(
                    (value) => value.connectionState === 'connected'
                )) {
                    if (
                        [...(await pc.getStats()).values()].some(
                            (stats) =>
                                stats.type === 'inbound-rtp' &&
                                stats.kind === 'video' &&
                                stats.framesPerSecond > 5
                        )
                    )
                        return true;
                }
                return false;
            },
            null,
            { timeout: 15000 }
        );
    }
    console.log(
        'PASS: existing four P2P video paths resume even after the entire signaling/SFU process stops'
    );
    assert.deepEqual(errors, []);
    console.log(
        `Browser console warnings/errors: ${warnings.length} (fake audio sinks and expected shutdown errors; retained in failure diagnostics)`
    );
    console.log(`Evidence logs: ${evidence}`);
} catch (error) {
    for (const [index, page] of pages.entries())
        console.error(
            'Page state',
            index,
            await page.evaluate(() => ({
                mic: document.getElementById('callStatusText')?.textContent,
                rtc: testConnections.map((pc) => ({
                    state: pc.connectionState,
                    send: pc.getSenders().map((s) => s.track?.kind),
                    recv: pc.getReceivers().map((r) => r.track.kind),
                })),
                media: [
                    ...document.querySelectorAll(
                        '.video-tile video, .video-tile audio'
                    ),
                ].map((v) => ({
                    tile: v.closest('.video-tile').id,
                    width: v.videoWidth,
                    tracks: v.srcObject
                        ?.getTracks()
                        .map((t) => ({ id: t.id, kind: t.kind })),
                })),
            }))
        );
    console.error('Browser errors:', errors);
    console.error('Browser console:', warnings);
    console.error('Server output:', output);
    throw error;
} finally {
    await browser?.close();
    if (app.exitCode === null) app.kill();
}
