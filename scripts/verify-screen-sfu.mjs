// Local integration: real mediasoup worker, Chromium WebRTC, synthetic video/audio.
// Does not establish Internet quality, FPS-game feel, or 1GB server capacity.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { createScreenSfuService } from '../src/utils/ScreenSfuService.js';
import { readScreenSfuConfig } from '../src/utils/ScreenSfuBudget.js';
import { createWorker } from 'mediasoup';
const stallTest = process.argv.includes('--stall');
const nativeConsumers = [];

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = readScreenSfuConfig({
    SFU_ANNOUNCED_ADDRESS: '127.0.0.1',
    SFU_LISTEN_IP: '127.0.0.1',
    SFU_PORT: process.env.SFU_TEST_PORT || '44446',
});
const app = express();
const server = createServer(app);
const io = new Server(server);
const sfu = createScreenSfuService({
    config,
    getVoiceOwner: (socket) => socket.data.owner,
    logger: console,
    resourceSample: () => ({ memoryBytes: 1, freeBytes: 1e9, cpuPercent: 0 }),
    ...(stallTest ? { createWorker: async (options) => {
        const worker = await createWorker(options);
        const createRouter = worker.createRouter.bind(worker);
        worker.createRouter = async (options) => {
            const router = await createRouter(options);
            const createTransport = router.createWebRtcTransport.bind(router);
            router.createWebRtcTransport = async (options) => {
                const transport = await createTransport(options);
                const consume = transport.consume.bind(transport);
                transport.consume = async (options) => {
                    const consumer = await consume(options);
                    if (consumer.kind === 'video') nativeConsumers.push({ consumer, transport });
                    return consumer;
                };
                return transport;
            };
            return router;
        };
        return worker;
    } } : {}),
});
app.use(express.static(resolve('src/views')));
app.get('/', (_, res) =>
    res.send(
        '<script src="/socket.io/socket.io.js"></script><script src="/vendor/screen-sfu-client.js"></script><script src="/js/voice/voice-screen-sfu-runtime.js"></script><body></body>'
    )
);
io.on('connection', (socket) => {
    socket.on('test:join', (peerId, ack) => {
        socket.data.owner = {
            peerId,
            roomId: 'game',
            voiceSessionGeneration: 1,
        };
        socket.data.voiceScreenSharing = true;
        ack();
    });
    socket.on(
        'sfu:request',
        (payload, ack) => void sfu.request(socket, payload).then(ack)
    );
    socket.on('disconnecting', () => sfu.cleanupSocket(socket));
});
await sfu.start();
await new Promise((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen)
);
let browser;
const messages = [];
try {
    browser = await chromium.launch({
        headless: true,
        channel: process.env.SFU_TEST_BROWSER || 'msedge',
        args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const pages = [];
    for (let i = 0; i < (stallTest ? 3 : 6); i++) {
        const page = await browser.newPage();
        page.on('pageerror', (error) =>
            messages.push(`page-${i}: ${error.message}`)
        );
        page.on('console', (message) => {
            if (message.type() === 'warning')
                messages.push(`page-${i}: ${message.text()}`);
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(async ({ index, stallTest }) => {
            const socket = io();
            await new Promise((resolveConnect) =>
                socket.on('connect', resolveConnect)
            );
            await new Promise((resolveJoin) =>
                socket.emit('test:join', `peer-${index}`, resolveJoin)
            );
            window.received = new Map();
            window.routes = [];
            window.sfu = VoiceScreenSfuRuntime.createRuntime({
                config: { enabled: true, videoBitrate: 5500000 },
                onRoutes: (routes) => {
                    window.routes = routes;
                },
                onRemoteStream: ({ peerId, stream }) => {
                    document.getElementById(peerId)?.remove();
                    if (!stream) {
                        window.received.delete(peerId);
                        return;
                    }
                    window.received.set(peerId, stream);
                    const video = document.createElement('video');
                    video.id = peerId;
                    video.srcObject = stream;
                    video.autoplay = true;
                    video.muted = true;
                    document.body.append(video);
                },
                onWarning: (message, error) =>
                    console.warn(message, error?.message),
            });
            sfu.attachSocket(socket);
            sfu.setSession({
                roomId: 'game',
                peerId: `peer-${index}`,
                voiceSessionGeneration: 1,
            });
            window.publish = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = stallTest ? 1920 : 1280;
                canvas.height = stallTest ? 1080 : 720;
                const ctx = canvas.getContext('2d');
                let frame = 0;
                window.drawTimer = setInterval(() => {
                    ctx.fillStyle = `hsl(${frame++ % 360}, 80%, 45%)`;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = 'white';
                    ctx.fillRect(frame % 1200, 50, 80, 600);
                }, 16);
                const audio = new AudioContext();
                const oscillator = audio.createOscillator();
                const destination = audio.createMediaStreamDestination();
                oscillator.connect(destination);
                oscillator.start();
                await audio.resume();
                window.audio = audio;
                window.capture = new MediaStream([
                    ...canvas.captureStream(60).getTracks(),
                    ...destination.stream.getTracks(),
                ]);
                await sfu.publish(window.capture, {
                    mode: 'game',
                    frameRate: 60,
                });
            };
        }, { index: i, stallTest });
        pages.push(page);
    }
    await pages[0].evaluate(() => window.publish());
    if (stallTest) {
        await pages[0].waitForFunction(() => window.routes.length === 2, null, { timeout: 30000 });
        await pages[1].waitForFunction(() => document.querySelector('video')?.videoWidth > 960, null, { timeout: 30000 });
        await pages[2].waitForFunction(() => document.querySelector('video')?.videoWidth > 960, null, { timeout: 30000 });
        const sample = async (page) => page.evaluate(async () => {
            const source = sfu.getRemoteSource('peer-0');
            const stats = [...(await source.pc.getStats()).values()];
            const report = stats.filter((row) => row.type === 'inbound-rtp' && row.kind === 'video').sort((a,b) => (b.framesDecoded || 0) - (a.framesDecoded || 0))[0];
            return { width: report.frameWidth, height: report.frameHeight, frames: report.framesDecoded, fps: report.framesPerSecond };
        });
        const before = await Promise.all(pages.slice(1).map(sample));
        await new Promise((resolveWait) => setTimeout(resolveWait, 30000));
        const after = await Promise.all(pages.slice(1).map(sample));
        console.log('Steady samples', JSON.stringify({ before, after, messages }));
        assert.ok(after.every((row, i) => row.frames - before[i].frames > 300));
        assert.ok(after.every((row) => row.width === 1920 && row.height === 1080));
        console.log('PASS: sustained full resolution decoding on two receivers', JSON.stringify({ before, after }));
        const stopped = nativeConsumers[0];

        await stopped.consumer.pause();
        const gone = await Promise.race(pages.slice(1).map((page, index) => page.waitForFunction(() => !sfu.getRemoteSource('peer-0'), null, { timeout: 16000 }).then(() => index + 1)));
        await pages[0].waitForFunction(() => routes.length === 1, null, { timeout: 5000 });
        assert.equal(stopped.transport.dtlsState, 'connected');
        const other = gone === 1 ? 2 : 1;
        const continued = await sample(pages[other]);
        assert.ok(continued.frames > after[other - 1].frames);
        console.log('PASS: connected SFU video stall releases route for P2P without lowering resolution; other viewer continues');
    } else {
    await pages[0].waitForFunction(() => window.routes.length === 4, null, {
        timeout: 25000,
    });
    assert.equal(sfu.snapshot().viewers, 4);
    assert.equal(sfu.snapshot().reservedBps, 22512000);
    const received = await Promise.all(
        pages
            .slice(1)
            .map((page) =>
                page.evaluate(() =>
                    [...window.received.values()].map((stream) =>
                        stream.getTracks().map((track) => track.kind)
                    )
                )
            )
    );
    assert.equal(received.filter((streams) => streams.length === 1).length, 4);
    assert.equal(received.filter((streams) => streams.length === 0).length, 1);
    for (const streams of received.filter((value) => value.length))
        assert.deepEqual(streams[0].sort(), ['audio', 'video']);
    console.log(
        'PASS: one real SFU upload, four decoded video/audio receivers, fifth falls back, global 22.512Mbps reservation'
    );
    await pages[0].evaluate(() => {
        sfu.stopPublishing();
        capture.getTracks().forEach((track) => track.stop());
        clearInterval(drawTimer);
        void audio.close();
    });
    await pages[1].waitForFunction(() => window.received.size === 0);
    assert.equal(sfu.snapshot().viewers, 0);
    await pages[0].evaluate(() => window.publish());
    await pages[0].waitForFunction(() => window.routes.length === 4, null, {
        timeout: 25000,
    });
    console.log(
        'PASS: stopping releases capacity; sharing can restart on the same voice session'
    );
    sfu.close();
    await pages[0].waitForFunction(
        () => !sfu.snapshot().hasUplink && window.routes.length === 0
    );
    await pages[1].waitForFunction(() => window.received.size === 0);
    console.log(
        'PASS: server shutdown restores P2P routing and removes stale remote SFU streams'
    );
    if (
        messages.some(
            (message) =>
                !message.includes('server-bandwidth-limit') &&
                !message.includes('server-stopped')
        )
    )
        console.log('Browser messages:', messages);
    }
} finally {
    await browser?.close();
    sfu.close();
    await new Promise((resolveClose) => io.close(resolveClose));
    server.close();
}
