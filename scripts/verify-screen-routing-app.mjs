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
const sfuPort = Number(process.env.SFU_TEST_PORT || '44448');
const priority = process.argv.includes('--priority');
const expectedServerViewers = priority ? 1 : 4;
const app = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: evidence,
    env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: port,
        USE_HTTPS: 'false',
        ENV: 'production',
        SCREEN_MEDIA_PROVIDER: 'legacy',
        SFU_ENABLED: 'true',
        SFU_ANNOUNCED_ADDRESS: '127.0.0.1',
        SFU_LISTEN_IP: '127.0.0.1',
        SFU_PORT: String(sfuPort),
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
const focusedShare = '#video-grid > .is-stage-focus';
const routeDialog = '.voice-route-dialog[open]';
const shareScreen = async (page) => {
    await page.locator('#shareScreen').click();
    await page.locator('[data-screen-share-codec]').selectOption('vp8');
    await page.locator('[data-screen-share-start]').click();
    await page.locator(`${focusedShare}#local-video video`).waitFor();
};
const openRouteDialog = async (page) => {
    await page.locator(`${focusedShare} .voice-player-more`).click();
    await page.getByRole('menuitem', { name: '连接方式…' }).click();
    await page.locator(routeDialog).waitFor();
};
const closeRouteDialog = (page) => page.locator(`${routeDialog} .voice-route-close`).click();
const waitForRoute = (page, route, mode) => page.waitForFunction(
    ({ focusedShare, route, mode }) => {
        const control = document.querySelector(`${focusedShare} .voice-route-toggle`);
        return Boolean(control && (!route || control.title.includes(route)) && (!mode || control.title.endsWith(`· ${mode}`)));
    },
    { focusedShare, route, mode },
    { timeout: 15000 }
);
const waitForVideoTransport = (page, useServer, { sustained = false } = {}) => page.waitForFunction(
    async ({ focusedShare, useServer, sfuPort, sustained }) => {
        const currentVideo = () => document.querySelector(`${focusedShare} video`);
        const video = currentVideo();
        const track = video?.srcObject?.getVideoTracks()[0];
        if (!track || !video.videoWidth) return false;
        for (const pc of window.testConnections) {
            if (pc.connectionState !== 'connected' || !pc.getReceivers().some((receiver) => receiver.track === track)) continue;
            const stats = await pc.getStats();
            for (const row of stats.values()) {
                if (row.type !== 'inbound-rtp' || row.kind !== 'video' || row.trackIdentifier !== track.id || !(row.framesPerSecond > (sustained ? 5 : 0))) continue;
                const transport = stats.get(row.transportId);
                const pair = stats.get(transport?.selectedCandidatePairId);
                const remote = stats.get(pair?.remoteCandidateId);
                if (!remote || (useServer !== undefined && (remote.port === sfuPort) !== useServer)) continue;
                if (!sustained) return true;

                await new Promise((resolveSample) => setTimeout(resolveSample, 1200));
                const next = (await pc.getStats()).get(row.id);
                const elapsed = (next?.timestamp - row.timestamp) / 1000;
                return currentVideo() === video && video.srcObject?.getVideoTracks()[0] === track &&
                    next?.trackIdentifier === track.id && next.framesPerSecond > 5 &&
                    elapsed >= 1 && (next.framesDecoded - row.framesDecoded) / elapsed > 5;
            }
        }
        return false;
    },
    { focusedShare, useServer, sfuPort, sustained },
    { timeout: 15000 }
);
const verifyManualRoute = async (page, useServer) => {
    const label = useServer ? '服务器转发' : 'P2P';
    await openRouteDialog(page);
    const dialog = page.locator(routeDialog);
    await dialog.locator('.voice-route-auto input').uncheck();
    const choice = dialog.getByRole('button', { name: useServer ? '服务器转发' : 'P2P（可能经过 TURN）', exact: true });
    await choice.click();
    await waitForRoute(page, label, '手动');
    await closeRouteDialog(page);
    await page.locator('#stageChatToggle').click();
    await page.locator('#stageChatToggle').click();
    await waitForRoute(page, label, '手动');
    await waitForVideoTransport(page, useServer);
    await openRouteDialog(page);
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.locator('.voice-route-auto input').isChecked(), false);
    await closeRouteDialog(page);
};
try {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
        } catch {
            // The local server may still be starting.
        }
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
        pages.push(page);
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
        await page.waitForFunction(() => window.testSocket?.io?.engine?.transport?.name === 'websocket', null, { timeout: 10000 });
        await page.evaluate(() => {
            window.testSfuConsumers = [];
            const create = window.ScreenSfuClient.Device.prototype.createRecvTransport;
            window.ScreenSfuClient.Device.prototype.createRecvTransport = function (...args) {
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
        await page.locator('[data-audio-noise-mode]').evaluate((select) => {
            select.value = 'browser';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.locator('#stageJoinVoice').click();
        await page.locator('#main[data-voice-state="joined"]').waitFor();
        await page.locator('#toggleAudio[aria-busy="false"]').waitFor();
        const microphone = page.locator('#toggleAudio');
        if ((await microphone.getAttribute('aria-pressed')) !== 'true') await microphone.click();
        await page.waitForFunction(
            () =>
                document
                    .getElementById('toggleAudio')
                    ?.getAttribute('aria-pressed') === 'true',
            null,
            { timeout: 10000 }
        );
    }
    const [publisher, firstViewer, ...laterViewers] = pages;
    const viewers = [firstViewer, ...laterViewers];
    await shareScreen(publisher);
    // The room starts in P2P-first mode. Use the actual player UI to request SFU.
    await Promise.all(viewers.map(openRouteDialog));
    await firstViewer.locator(`${routeDialog} .voice-route-auto input`).check();
    await waitForRoute(firstViewer, '服务器转发', '自动');
    await Promise.all(laterViewers.map((viewer) => viewer.locator(`${routeDialog} .voice-route-auto input`).check()));
    await Promise.all(laterViewers.map((viewer) => waitForRoute(viewer, priority ? 'P2P' : '服务器转发', '自动')));
    await Promise.all(viewers.map(closeRouteDialog));
    await pages[0].waitForFunction(
        (count) =>
            window.testConnections
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
    await Promise.all(viewers.map((viewer, index) => waitForVideoTransport(viewer, index < expectedServerViewers)));
    if (priority) {
        console.log('PASS: first viewer keeps SFU and three later viewers decode over P2P with separate game audio');
        // Keep these viewers on their existing routes while the first viewer frees and requests the slot again.
        await Promise.all(laterViewers.map(async (viewer) => {
            await openRouteDialog(viewer);
            await viewer.locator(`${routeDialog} .voice-route-auto input`).uncheck();
            await waitForRoute(viewer, 'P2P', '手动');
            await closeRouteDialog(viewer);
        }));
    } else {
        console.log('PASS: four SFU viewers, one active video upload, P2P microphone and separate game audio');
    }
    await firstViewer.bringToFront();
    await firstViewer.locator(`${focusedShare} .voice-player-more`).click();
    await firstViewer.getByRole('menuitemcheckbox', { name: '显示视频统计' }).click();
    const panel = firstViewer.locator(`${focusedShare} .voice-share-stats`);
    await panel.getByText('详细指标', { exact: true }).click();
    await firstViewer.waitForFunction((selector) =>
        [...document.querySelectorAll(`${selector} .voice-share-stats details[open] dt`)].some((label) =>
            label.textContent === '统计区间' && parseFloat(label.nextElementSibling?.textContent) > 0
        ), focusedShare, { timeout: 12000 });
    await panel.getByRole('button', { name: '隐藏' }).click();
    console.log('PASS: viewer diagnostics show video statistics across multiple samples');
    await verifyManualRoute(firstViewer, false);
    await verifyManualRoute(firstViewer, true);
    console.log('PASS: manual P2P and SFU survive chat toggles and keep decoding on the selected ICE transport');

    await openRouteDialog(firstViewer);
    await firstViewer.locator(`${routeDialog} .voice-route-auto input`).check();
    await waitForRoute(firstViewer, '服务器转发', '自动');
    await closeRouteDialog(firstViewer);
    if (priority) {
        await Promise.all(laterViewers.map(async (viewer) => {
            await openRouteDialog(viewer);
            await viewer.locator(`${routeDialog} .voice-route-auto input`).check();
            await waitForRoute(viewer, '', '自动');
            await closeRouteDialog(viewer);
        }));
    }
    if (!priority) {
        // The native-worker test pauses actual SFU packets. Here, freeze only
        // receiver stats to exercise failover through the complete room UI.
        await pages[1].evaluate(async () => {
            const consumer = window.testSfuConsumers.find((value) => value.kind === 'video' && !value.closed);
            const frozen = await consumer.getStats();
            consumer.getStats = async () => frozen;
        });
        await waitForRoute(firstViewer, 'P2P', '自动');
        await pages[1].waitForFunction(async (sfuPort) => {
            for (const pc of window.testConnections.filter((value) => value.connectionState === 'connected')) {
                const rows = [...(await pc.getStats()).values()];
                if (!rows.some((row) => row.type === 'remote-candidate' && row.port === sfuPort) &&
                    rows.some((row) => row.type === 'inbound-rtp' && row.kind === 'video' && row.framesPerSecond > 5 && row.frameWidth === 1280 && row.frameHeight === 720)) return true;
            }
            return false;
        }, sfuPort, { timeout: 15000 });
        for (const page of pages.slice(2)) {
            assert.ok(await page.evaluate(async () => {
                for (const consumer of window.testSfuConsumers.filter((value) => value.kind === 'video' && !value.closed)) {
                    if ([...(await consumer.getStats()).values()].some((row) => row.type === 'inbound-rtp' && row.framesPerSecond > 5)) return true;
                }
                return false;
            }));
        }
        console.log('PASS: stalled SFU receiver resumes real P2P at original capture resolution; other SFU viewers continue');
    }
    await publisher.locator('[data-local-share-controls] [data-share-action="stop"]').click();
    await Promise.all(pages.map((page) => page.locator('#main[data-stage-mode="voice"]').waitFor()));
    await shareScreen(publisher);
    await Promise.all(viewers.map(async (viewer, index) => {
        try {
            await waitForVideoTransport(viewer, undefined, { sustained: true });
        } catch (cause) {
            throw new Error(`Share restart: viewer ${index + 1} did not sustain more than 5 decoded FPS on the displayed track`, { cause });
        }
    }));
    console.log(
        'PASS: screen stop and restart retain room membership and playback'
    );
    app.kill();
    await pages[0].waitForFunction(
        () =>
            window.testConnections
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
                for (const pc of window.testConnections.filter(
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
                micPressed: document.getElementById('toggleAudio')?.getAttribute('aria-pressed'),
                route: document.querySelector('#video-grid > .is-stage-focus .voice-route-toggle')?.title,
                routeStatus: document.querySelector('.voice-route-dialog[open] .voice-route-status')?.textContent,
                rtc: window.testConnections.map((pc) => ({
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
