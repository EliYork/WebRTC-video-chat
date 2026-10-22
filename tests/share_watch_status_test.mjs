import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createDocument } from './helpers/stage_dom.mjs';

const window = {};
vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/share-watch-status.js', import.meta.url), 'utf8'), { window });
const describe = (value) => window.VoiceShareWatchStatus.describe(value);

test('shared playback feedback distinguishes transport interruption, waiting, pause and actual video errors', () => {
    assert.equal(describe({ ready: false }).state, 'connecting');
    assert.equal(describe({ ready: true, connections: ['connected'], waiting: true }).state, 'buffering');
    assert.equal(describe({ ready: true, paused: true }).resume, true);
    assert.equal(describe({ ready: true, connections: ['disconnected'] }).state, 'reconnecting');
    assert.equal(describe({ ready: true, ended: true }).state, 'interrupted');
    assert.equal(describe({ ready: true, error: {} }).state, 'error');
    assert.equal(describe({ ready: true, connections: ['connected'] }).text, '', 'static video with a live connection is not labelled a failure');
    assert.equal(describe({ local: true, previewHidden: true }).state, 'preview-hidden');
    assert.equal(describe({ local: true }).text, '');
});

test('watch status follows existing players, ignores stale transport reports and cleans up observers and listeners', () => {
    const doc = createDocument(), listeners = new Map(), timers = new Map();
    let tick, changed, selected, timerId = 0;
    doc.addEventListener = (type, handler) => listeners.set(type, handler);
    doc.removeEventListener = (type) => listeners.delete(type);
    const root = doc.createElement('main'); root.dataset.voiceState = 'joined'; doc.body.append(root);
    const notice = doc.createElement('p'); notice.id = 'stageShareNotice'; root.append(notice);
    const tile = doc.createElement('article'), body = doc.createElement('div'), video = doc.createElement('video');
    body.className = 'tile-body'; body.append(video); tile.append(body); root.append(tile); selected = tile;
    const query = root.querySelector.bind(root);
    root.querySelector = selector => selector === '#video-grid > .is-stage-focus' ? selected : query(selector);
    const stream = { getVideoTracks: () => [{ readyState: 'live' }] };
    Object.assign(video, { videoWidth: 1280, readyState: 2, paused: false, srcObject: stream });
    const source = { piikConnections: [{ 统计年龄_ms: 20000, 连接状态: 'failed' }] };
    let disconnected = false;
    const localWindow = { MutationObserver: class {
        constructor(callback) { changed = callback; }
        observe() {}
        disconnect() { disconnected = true; }
    }, setInterval: callback => { tick = callback; return 'tick'; }, clearInterval: () => { tick = undefined; },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/share-watch-status.js', import.meta.url), 'utf8'), { window: localWindow });
    const runtime = localWindow.VoiceShareWatchStatus.createRuntime({ root, getSource: () => source });
    runtime.init(); runtime.init();
    assert.equal(tile.dataset.playbackState, 'playing', 'stale Piik reports cannot claim a current disconnection');
    video.paused = true; tick(); assert.equal(tile.dataset.playbackState, 'paused');
    body.querySelector('button').click();
    assert.equal(video.srcObject, stream);
    selected = undefined; changed();
    assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /共享已结束/);
    assert.equal(body.querySelector('.share-watch-message'), null);
    assert.equal(video.listeners.get('playing').size, 0);
    runtime.destroy();
    assert.equal(disconnected, true); assert.equal(tick, undefined);
    assert.equal(listeners.size, 0); assert.equal(timers.size, 0);
    assert.equal(notice.hidden, true);
});

const resumeFixture = () => {
    let tick, now = 10000;
    const source = {};
    const doc = createDocument();
    doc.addEventListener = () => {}; doc.removeEventListener = () => {};
    const root = doc.createElement('main'); doc.body.append(root);
    const tile = doc.createElement('article'), video = doc.createElement('video');
    tile.append(video); root.append(tile);
    const query = root.querySelector.bind(root);
    root.querySelector = selector => selector === '#video-grid > .is-stage-focus' ? tile : query(selector);
    Object.assign(video, { paused: true, readyState: 2, videoWidth: 1280,
        srcObject: { getVideoTracks: () => [{ readyState: 'live' }] } });
    const localWindow = { MutationObserver: class { observe() {} disconnect() {} },
        setInterval(callback) { tick = callback; }, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/share-watch-status.js', import.meta.url), 'utf8'),
        { window: localWindow, Date: { now: () => now } });
    const runtime = localWindow.VoiceShareWatchStatus.createRuntime({ root, getSource: () => source });
    runtime.init();
    return { runtime, tile, video, source, button: tile.querySelector('button'), label: tile.querySelector('span'),
        tick: () => tick(), advance: ms => { now += ms; },
        emit: type => video.listeners.get(type).forEach(handler => handler()) };
};
const settleResume = () => new Promise(resolve => setImmediate(resolve));

const bufferingFixture = () => {
    const f = resumeFixture(); f.video.paused = false;
    f.emit('waiting'); f.advance(1000); f.tick();
    assert.equal(f.tile.dataset.playbackState, 'buffering');
    return f;
};

for (const type of ['emptied', 'ended', 'error', 'loadeddata', 'playing']) {
    test(`${type} clears previous buffering before the same player is reused`, () => {
        const f = bufferingFixture();
        try {
            const track = { readyState: 'live' };
            f.video.srcObject.getVideoTracks = () => [track];
            if (type === 'emptied') f.video.readyState = 0;
            if (type === 'ended') track.readyState = 'ended';
            if (type === 'error') f.video.error = {};
            f.emit(type);
            if (type === 'emptied') assert.equal(f.tile.dataset.playbackState, 'connecting');
            if (type === 'ended') assert.equal(f.tile.dataset.playbackState, 'interrupted');
            if (type === 'error') assert.equal(f.tile.dataset.playbackState, 'error');
            f.video.readyState = 2; track.readyState = 'live'; f.video.error = null; f.tick();
            assert.equal(f.tile.dataset.playbackState, 'playing');
            assert.equal(f.label.textContent, '');
            f.emit('stalled'); f.advance(800); f.tick();
            assert.equal(f.tile.dataset.playbackState, 'playing', 'fresh stalls keep the existing delay');
            f.advance(1); f.tick();
            assert.equal(f.tile.dataset.playbackState, 'buffering', 'new stalls still become visible');
        } finally { f.runtime.destroy(); }
    });
}

test('replacing a stream without a media event clears buffering on the next status update', () => {
    const f = bufferingFixture();
    try {
        f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] };
        f.tick();
        assert.equal(f.tile.dataset.playbackState, 'playing');
        assert.equal(f.label.textContent, '');
        f.advance(1000); f.tick();
        assert.equal(f.tile.dataset.playbackState, 'playing');
    } finally { f.runtime.destroy(); }
});

test('the first waiting event on a replacement stream starts its own delay', () => {
    const f = bufferingFixture();
    try {
        f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] };
        f.emit('waiting'); f.tick();
        assert.equal(f.tile.dataset.playbackState, 'playing');
        f.advance(800); f.tick();
        assert.equal(f.tile.dataset.playbackState, 'playing');
        f.advance(1); f.tick();
        assert.equal(f.tile.dataset.playbackState, 'buffering');
    } finally { f.runtime.destroy(); }
});

for (const change of ['new-request', 'new-stream', 'stream-replaced-and-restored', 'already-playing', 'emptied-and-reused', 'played-then-paused', 'destroyed']) {
    test(`old resume rejection cannot overwrite ${change} playback`, async () => {
        const f = resumeFixture(); const pending = [];
        f.video.play = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
        f.button.click(); assert.equal(pending.length, 1, 'play remains synchronous with the click');
        if (change === 'new-request') f.button.click();
        if (change === 'new-stream') f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] };
        if (change === 'stream-replaced-and-restored') {
            const original = f.video.srcObject;
            f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] }; f.tick();
            f.video.srcObject = original; f.tick();
        }
        if (change === 'already-playing') f.video.paused = false;
        if (change === 'emptied-and-reused') f.video.listeners.get('emptied').forEach(handler => handler());
        if (change === 'played-then-paused') {
            f.video.paused = false; f.video.listeners.get('playing').forEach(handler => handler());
            f.video.paused = true; f.video.listeners.get('pause').forEach(handler => handler());
        }
        if (change === 'destroyed') f.runtime.destroy();
        const before = f.label.textContent;
        pending[0].reject(new Error('old play denied')); await settleResume();
        assert.equal(f.label.textContent, before);
        if (pending[1]) {
            f.video.paused = false; pending[1].resolve(); await settleResume();
            assert.equal(f.label.textContent, '');
        }
        f.runtime.destroy();
    });
}

for (const failure of ['throw', 'reject']) {
    test(`current play ${failure} shows a controlled recovery error and remains retryable`, async () => {
        const f = resumeFixture();
        f.video.play = () => {
            if (failure === 'throw') throw new Error('current play denied');
            return Promise.reject(new Error('current play denied'));
        };
        assert.doesNotThrow(() => f.button.click()); await settleResume();
        assert.match(f.label.textContent, /未能恢复播放/);
        assert.equal(f.button.hidden, false);
        const message = f.label.textContent;
        f.advance(1000); f.tick(); f.emit('resize');
        assert.equal(f.label.textContent, message, 'periodic status refresh and resize retain the current failure');
        f.video.play = () => { f.video.paused = false; return Promise.resolve(); };
        f.button.click(); await settleResume();
        assert.equal(f.label.textContent, '');
        f.runtime.destroy();
    });
}

test('a retry clears the previous playback failure while its own result is pending', async () => {
    const f = resumeFixture();
    try {
        f.video.play = () => Promise.reject(new Error('denied'));
        f.button.click(); await settleResume();
        assert.match(f.label.textContent, /未能恢复播放/);
        let finish;
        f.video.play = () => new Promise(resolve => { finish = resolve; });
        f.button.click();
        assert.equal(f.label.textContent, '播放已暂停');
        f.tick(); assert.equal(f.label.textContent, '播放已暂停');
        f.video.paused = false; finish(); await settleResume();
        assert.equal(f.label.textContent, '');
    } finally { f.runtime.destroy(); }
});

test('connection failures take priority over retained playback failure and recovery restores it', async () => {
    const f = resumeFixture();
    try {
        f.video.play = () => Promise.reject(new Error('denied'));
        f.button.click(); await settleResume();
        const message = f.label.textContent;
        f.source.pc = { connectionState: 'disconnected' }; f.tick();
        assert.equal(f.tile.dataset.playbackState, 'reconnecting');
        assert.match(f.label.textContent, /共享连接中断/);
        assert.equal(f.button.hidden, true);
        f.source.pc.connectionState = 'connected'; f.tick();
        assert.equal(f.label.textContent, message);
        assert.equal(f.button.hidden, false);
    } finally { f.runtime.destroy(); }
});

test('a resume failure belongs to the current stream even when it was replaced before the click', async () => {
    const f = resumeFixture();
    try {
        f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] };
        f.video.play = () => Promise.reject(new Error('denied'));
        f.button.click(); await settleResume(); f.tick();
        assert.match(f.label.textContent, /未能恢复播放/);
    } finally { f.runtime.destroy(); }
});

for (const change of ['new-stream', 'emptied', 'ended', 'playing', 'observed-unpaused']) {
    test(`a retained playback failure is cleared by ${change}`, async () => {
        const f = resumeFixture();
        try {
            f.video.play = () => Promise.reject(new Error('denied'));
            f.button.click(); await settleResume();
            assert.match(f.label.textContent, /未能恢复播放/);
            if (change === 'new-stream') {
                f.video.srcObject = { getVideoTracks: () => [{ readyState: 'live' }] };
            } else if (change === 'observed-unpaused') {
                f.video.paused = false; f.tick();
            } else {
                if (change === 'playing') f.video.paused = false;
                f.emit(change);
            }
            f.video.paused = true; f.tick();
            assert.equal(f.label.textContent, '播放已暂停');
        } finally { f.runtime.destroy(); }
    });
}
