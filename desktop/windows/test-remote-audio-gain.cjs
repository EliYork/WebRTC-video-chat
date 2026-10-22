/* eslint-disable no-await-in-loop -- Bounded polling observes only isolated loopback peers and synthetic audio. */
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const work = mkdtempSync(join(tmpdir(), 'voice-remote-gain-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/remote-audio-gain');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let server, win, deadline, results, failed = false;
const requests = [];
const rendererMessages = [];
const cleanup = async () => {
    clearTimeout(deadline);
    win?.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
};
const fail = async error => {
    if (failed) return;
    failed = true;
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, results, requests, rendererMessages, work }, null, 2));
    process.stderr.write(String(error.stack || error) + '\n');
    await cleanup();
    app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function verifyRenderer() {
    const sourceContext = new AudioContext();
    const destination = sourceContext.createMediaStreamDestination();
    const oscillator = sourceContext.createOscillator();
    const level = sourceContext.createGain();
    level.gain.value = 0.02;
    oscillator.connect(level).connect(destination);
    oscillator.start();
    const sourceTrack = destination.stream.getAudioTracks()[0];
    const peers = [], contexts = [], failures = [];
    const runtime = window.VoiceRemoteAudioGain.createRuntime({
        createContext: () => { const context = new AudioContext(); contexts.push(context); return context; },
        onFailure: error => failures.push(error.message),
    });
    const until = async (predicate, label) => {
        const stop = performance.now() + 5000;
        while (!predicate()) {
            if (performance.now() >= stop) throw new Error('Timeout: ' + label);
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };
    const connect = async () => {
        // No STUN/TURN services or physical media: both endpoints live here.
        const sender = new RTCPeerConnection({ iceServers: [] });
        const receiver = new RTCPeerConnection({ iceServers: [] });
        peers.push(sender, receiver);
        let stream;
        receiver.ontrack = event => { stream = new MediaStream([event.track]); };
        sender.addTrack(sourceTrack, destination.stream);
        await sender.setLocalDescription(await sender.createOffer());
        await until(() => sender.iceGatheringState === 'complete', 'sender ICE');
        await receiver.setRemoteDescription(sender.localDescription);
        await receiver.setLocalDescription(await receiver.createAnswer());
        await until(() => receiver.iceGatheringState === 'complete', 'receiver ICE');
        await sender.setRemoteDescription(receiver.localDescription);
        await until(() => receiver.connectionState === 'connected' && Boolean(stream), 'loopback connection');
        return { sender, receiver, stream, track: stream.getAudioTracks()[0] };
    };
    const measure = async (branch, context) => {
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        const samples = new Float32Array(analyser.fftSize);
        branch.gain.connect(analyser);
        let rms = 0;
        const stop = performance.now() + 2000;
        try {
            while (performance.now() < stop) {
                analyser.getFloatTimeDomainData(samples);
                rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
                if (rms > 0.001) break;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            return rms;
        } finally { branch.gain.disconnect(analyser); }
    };
    let result;
    try {
        await sourceContext.resume();
        const first = await connect();
        const player = document.createElement('audio');
        player.srcObject = first.stream;
        runtime.setVolume(player, { volume: 2 });
        const oldBranch = runtime.getBranchToken(player);
        const initialRms = await measure(oldBranch, runtime.getOutputTarget(player));

        const second = await connect();
        const sameId = first.track.id === second.track.id;
        const distinctObjects = first.track !== second.track;
        first.sender.close(); first.receiver.close();
        player.srcObject = second.stream;
        runtime.setVolume(player, { volume: 1.5 });
        const currentBranch = runtime.getBranchToken(player);
        // Let buffered samples from the closed first connection drain.
        await new Promise(resolve => setTimeout(resolve, 300));
        const replacementRms = await measure(currentBranch, runtime.getOutputTarget(player));
        const stats = await second.receiver.getStats();
        const receivedBytes = [...stats.values()].filter(report => report.type === 'inbound-rtp' && report.kind === 'audio')
            .reduce((total, report) => total + (report.bytesReceived || 0), 0);
        result = {
            sameId, distinctObjects, initialRms, replacementRms, receivedBytes,
            branchReplaced: currentBranch !== oldBranch,
            currentSourceIsNewReceiver: currentBranch.sources[0].mediaStream.getAudioTracks()[0] === second.track,
            nativeMuted: player.muted, failures,
        };
        // Use the real suspended graph and receiver, controlling only resume
        // completion order. No physical output or media capture is involved.
        const outputContext = runtime.getOutputTarget(player);
        const nativeResume = outputContext.resume.bind(outputContext);
        await outputContext.suspend();
        let rejectOld, releaseNew, resumeCalls = 0;
        outputContext.resume = () => {
            resumeCalls++;
            if (resumeCalls === 1) return new Promise((_, reject) => { rejectOld = reject; });
            return new Promise(resolve => { releaseNew = resolve; }).then(nativeResume);
        };
        runtime.setVolume(player, { volume: 1.8 });
        runtime.setVolume(player, { volume: 1.6 });
        rejectOld(new Error('controlled obsolete resume rejection'));
        await new Promise(resolve => setTimeout(resolve, 20));
        const whilePending = {
            branchPreserved: runtime.getBranchToken(player) === currentBranch,
            nativeMuted: player.muted, contextState: outputContext.state, failures: failures.length,
        };
        releaseNew();
        await until(() => outputContext.state === 'running', 'newer resume');
        outputContext.resume = nativeResume;
        result.resumeRace = {
            controlledResumeOrder: true, resumeCalls, whilePending,
            branchPreserved: runtime.getBranchToken(player) === currentBranch,
            nativeMuted: player.muted, contextState: outputContext.state,
            volume: currentBranch.volume, rms: await measure(currentBranch, outputContext),
        };
        runtime.destroy();
        result.sourceStillLiveAfterGainDestroy = sourceTrack.readyState === 'live';
        result.newReceiverStillLiveAfterGainDestroy = second.track.readyState === 'live';
    } finally {
        runtime.destroy();
        peers.forEach(peer => peer.close());
        destination.stream.getTracks().forEach(track => track.stop());
        oscillator.stop(); oscillator.disconnect(); level.disconnect();
        await Promise.all([...contexts, sourceContext].map(context => context.state === 'closed' ? undefined : context.close()));
    }
    result.allContextsClosed = [...contexts, sourceContext].every(context => context.state === 'closed');
    result.syntheticSourceEnded = sourceTrack.readyState === 'ended';
    return result;
}

app.whenReady().then(async () => {
    const source = readFileSync(resolve(__dirname, '../../src/views/js/media/remote-audio-gain.js'));
    server = createServer((request, response) => {
        requests.push(request.url);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'");
        if (request.url === '/runtime.js') {
            response.setHeader('Content-Type', 'application/javascript; charset=utf-8'); response.end(source);
        } else {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end('<!doctype html><title>Isolated remote gain replacement</title><script src="/runtime.js"></script>');
        }
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    win = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, offscreen: true, autoplayPolicy: 'no-user-gesture-required',
    } });
    win.webContents.on('console-message', event => rendererMessages.push({ message: event.message, sourceId: event.sourceId, lineNumber: event.lineNumber }));
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: /^(https?|wss?):$/.test(url.protocol) && (url.hostname !== '127.0.0.1' || url.port !== String(port)) });
    });
    deadline = setTimeout(() => { void fail(new Error('Hidden receiver replacement test exceeded 30 seconds')); }, 30000);
    await win.loadURL(`http://127.0.0.1:${port}/`);
    const loaded = await win.webContents.executeJavaScript(`({url:location.href,runtime:typeof window.VoiceRemoteAudioGain,html:document.documentElement.outerHTML})`);
    assert.equal(loaded.runtime, 'object', JSON.stringify(loaded));
    results = await win.webContents.executeJavaScript(`(${verifyRenderer.toString()})()`);
    assert.equal(results.sameId, true);
    assert.equal(results.distinctObjects, true);
    assert.ok(results.initialRms > 0.001);
    assert.equal(results.branchReplaced, true);
    assert.equal(results.currentSourceIsNewReceiver, true);
    assert.ok(results.replacementRms > 0.001);
    assert.ok(results.receivedBytes > 0);
    assert.equal(results.nativeMuted, true);
    assert.deepEqual(results.failures, []);
    assert.deepEqual(results.resumeRace.whilePending, {
        branchPreserved: true, nativeMuted: true, contextState: 'suspended', failures: 0,
    });
    assert.equal(results.resumeRace.resumeCalls, 2);
    assert.equal(results.resumeRace.branchPreserved, true);
    assert.equal(results.resumeRace.nativeMuted, true);
    assert.equal(results.resumeRace.contextState, 'running');
    assert.equal(results.resumeRace.volume, 1.6);
    assert.ok(results.resumeRace.rms > 0.001);
    assert.equal(results.sourceStillLiveAfterGainDestroy, true);
    assert.equal(results.newReceiverStillLiveAfterGainDestroy, true);
    assert.equal(results.allContextsClosed, true);
    assert.equal(results.syntheticSourceEnded, true);
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, hidden: !win.isVisible(), muted: win.webContents.isAudioMuted(), results, realMediaCapture: false, physicalDeviceVerified: false, work }, null, 2));
    await cleanup();
    process.stdout.write('PASS hidden WebRTC receiver replacement and resume race: amplified signal, newer recovery and native mute preserved. No real media capture.\n');
    app.quit();
}).catch(fail);
