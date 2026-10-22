import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewSource = readFileSync(
    new URL(
        '../src/views/js/voice/voice-media-quality-view.js',
        import.meta.url
    ),
    'utf8'
);
const runtimeSource = readFileSync(
    new URL(
        '../src/views/js/voice/voice-media-quality-runtime.js',
        import.meta.url
    ),
    'utf8'
);

function createClassList() {
    const set = new Set();
    return {
        add: (v) => set.add(v),
        contains: (v) => set.has(v),
        remove: (v) => set.delete(v),
        toggle: (v, force) => (force ? set.add(v) : set.delete(v)),
        toString: () => [...set].join(' '),
    };
}
function element(tag) {
    const children = [];
    const el = {
        tagName: tag.toUpperCase(),
        children,
        classList: createClassList(),
        dataset: {},
        attributes: {},
        listeners: {},
        textContent: '',
        append(...nodes) {
            nodes.forEach((node) => {
                node.remove?.();
                node.parentElement = this;
                children.push(node);
            });
        },
        before(node) {
            const siblings = this.parentElement?.children;
            if (!siblings) return;
            node.remove?.();
            const index = siblings.indexOf(this);
            node.parentElement = this.parentElement;
            siblings.splice(index, 0, node);
        },
        remove() {
            const siblings = this.parentElement?.children;
            const index = siblings?.indexOf(this) ?? -1;
            if (index >= 0) siblings.splice(index, 1);
            this.parentElement = null;
            this.removed = true;
        },
        setAttribute(k, v) {
            this.attributes[k] = v;
        },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        showModal() { this.open = true; },
        close() { this.open = false; this.listeners.close?.(); },
        querySelector(selector) {
            const cls = selector.startsWith('.') ? selector.slice(1) : null;
            for (const child of children) {
                if (
                    cls
                        ? child.classList?.contains(cls)
                        : child.tagName?.toLowerCase() === selector
                ) {
                    return child;
                }
                const descendant = child.querySelector?.(selector);
                if (descendant) return descendant;
            }
            return undefined;
        },
    };
    return el;
}
function tileStructure() {
    const tile = element('div');
    const header = element('div');
    const controls = element('div');
    const actions = element('div');
    header.classList.add('tile-header');
    controls.classList.add('tile-header-controls');
    actions.classList.add('tile-header-actions');
    controls.append(actions);
    header.append(controls);
    tile.append(header);
    return { actions, controls, header, tile };
}
function load() {
    let timerId = 0;
    const timers = new Map();
    const win = {
        document: {
            hidden: false,
            createElement: element,
            addEventListener() {},
        },
        setTimeout(fn) {
            const id = ++timerId;
            timers.set(id, fn);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
    };
    vm.runInNewContext(viewSource, { window: win });
    vm.runInNewContext(runtimeSource, { window: win });
    return {
        runTimers: async () => {
            const fns = [...timers.values()];
            timers.clear();
            await Promise.all(fns.map((fn) => fn()));
        },
        timers,
        win,
    };
}
const track = (settings = {}) => ({
    kind: 'video',
    readyState: 'live',
    getSettings: () => settings,
});
const stream = (videoTrack = track()) => ({
    getVideoTracks: () => (videoTrack ? [videoTrack] : []),
});
const stats = (report) => new Map([[report.id || 'inbound', report]]);

test('diagnostics mount immediately on late sharing state and return after restart', async () => {
    const { win, runTimers } = load();
    const { tile } = tileStructure();
    const s = stream();
    const source = { tile, stream: s, video: { srcObject: s }, isScreenSharing: false };
    const mounted = new Set();
    win.VoiceShareDiagnostics = { sync: ({ tile }) => mounted.add(tile), remove: (tile) => mounted.delete(tile) };
    const rt = win.VoiceMediaQualityRuntime.createRuntime({ getQualitySource: () => source, view: win.VoiceMediaQualityView });
    rt.syncPeer('peer');
    assert.equal(mounted.size, 0);
    source.isScreenSharing = true;
    rt.syncPeer('peer');
    assert.equal(mounted.has(tile), true);
    source.isScreenSharing = false;
    rt.syncPeer('peer');
    assert.equal(mounted.size, 0);
    source.stream = stream();
    source.video.srcObject = source.stream;
    source.isScreenSharing = true;
    rt.syncPeer('peer');
    assert.equal(mounted.has(tile), true);
    source.stream = stream();
    source.video.srcObject = source.stream;
    await runTimers();
    assert.equal(rt.getActivePeerCount(), 1);
    assert.equal(mounted.has(tile), true);
});

test('presence reconciliation resynchronizes quality after shared-room snapshot', () => {
    const script = readFileSync(new URL('../src/views/script.js', import.meta.url), 'utf8');
    const reconcile = script.slice(script.indexOf('const reconcilePresenceState ='), script.indexOf('const emitWithAck ='));
    assert.match(reconcile, /syncPresenceTilesForJoinedRoom\(channels\)/);
    assert.match(reconcile, /voicePeerRegistry.getPeerIds\(\).forEach\(\(peerId\) => \{[\s\S]*voiceMediaQualityRuntime\?\.syncPeer\(peerId\)/);
});

async function sampleLabel(
    report,
    { screen = true, videoSize = {}, videoTrack = track() } = {}
) {
    const { runTimers, win } = load();
    const { controls, tile } = tileStructure();
    const video = element('video');
    const s = stream(videoTrack);
    video.srcObject = s;
    video.videoWidth = videoSize.width || 0;
    video.videoHeight = videoSize.height || 0;
    const pc = {
        getStats: async () =>
            stats({
                type: 'inbound-rtp',
                kind: 'video',
                timestamp: 1000,
                ...report,
            }),
    };
    const rt = win.VoiceMediaQualityRuntime.createRuntime({
        getQualitySource: () => ({
            generation: 1,
            isScreenSharing: screen,
            pc,
            stream: s,
            tile,
            video,
        }),
        view: win.VoiceMediaQualityView,
    });
    rt.syncPeer('peer-a');
    await runTimers();
    return {
        rt,
        controls,
        text:
            tile.querySelector('.voice-media-quality-pill')?.textContent || '',
        tile,
    };
}

test('quality pill mounts in title controls before fullscreen actions', async () => {
    const sample = await sampleLabel({
        framesWidth: 1920,
        framesHeight: 1080,
        framesPerSecond: 60,
    });
    const pill = sample.tile.querySelector('.voice-media-quality-pill');
    assert.equal(pill.parentElement, sample.controls);
    assert.equal(
        sample.controls.children
            .at(-1)
            .classList.contains('tile-header-actions'),
        true
    );
    assert.equal(pill.textContent, '解码 1080p · 60fps');
});

test('local share shows selected settings regardless of preview frames and handles stop', async () => {
    const { win, runTimers } = load();
    let now = 1000;
    let frames = 0;
    win.performance = { now: () => now };
    const { tile } = tileStructure();
    const videoTrack = track({ width: 1920, height: 1080, frameRate: 60 });
    const sourceStream = stream(videoTrack);
    // The preview may use a different stream wrapper for the same capture track.
    const video = {
        srcObject: stream(videoTrack),
        getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }),
    };
    const source = {
        isLocal: true,
        shareOptions: { resolutionPreset: '1440p', frameRate: 60 },
        isScreenSharing: true,
        tile,
        video,
        stream: sourceStream,
    };
    const rt = win.VoiceMediaQualityRuntime.createRuntime({
        getQualitySource: () => source,
        view: win.VoiceMediaQualityView,
    });
    rt.syncPeer('local-video');
    await runTimers();
    const label = () =>
        tile.querySelector('.voice-media-quality-pill').textContent;
    assert.equal(label(), '共享目标 1440p · 60fps');
    now += 1000;
    frames = 27;
    await runTimers();
    assert.equal(label(), '共享目标 1440p · 60fps');
    now += 1000;
    await runTimers();
    assert.equal(label(), '共享目标 1440p · 60fps');
    source.previewHidden = true;
    await runTimers();
    assert.equal(label(), '共享目标 1440p · 60fps');
    source.isScreenSharing = false;
    await runTimers();
    assert.equal(rt.getActivePeerCount(), 0);
    assert.equal(label(), '');
});

test('formats standard and non-standard resolutions', async () => {
    assert.equal(
        (
            await sampleLabel({
                framesWidth: 1920,
                framesHeight: 1080,
                framesPerSecond: 60,
            })
        ).text,
        '解码 1080p · 60fps'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 2560, framesHeight: 1440 })).text,
        '视频 1440p · 帧率不可用/待采样'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 3840, framesHeight: 2160 })).text,
        '视频 4K · 帧率不可用/待采样'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 1600, framesHeight: 900 })).text,
        '视频 1600×900 · 帧率不可用/待采样'
    );
});

test('distinguishes measured zero FPS from unavailable FPS', async () => {
    assert.equal(
        (
            await sampleLabel({
                framesWidth: 1920,
                framesHeight: 1080,
                framesPerSecond: 0,
            })
        ).text,
        '解码 1080p · 0fps'
    );
    assert.equal(
        (await sampleLabel({ framesPerSecond: 60 })).text,
        '解码 60fps'
    );
    assert.equal((await sampleLabel({})).text, '视频 帧率不可用/待采样');
});

test('falls back to element and track dimensions without CSS sizes', async () => {
    assert.equal(
        (
            await sampleLabel(
                { framesPerSecond: 60 },
                { videoSize: { width: 1920, height: 1080 } }
            )
        ).text,
        '解码 1080p · 60fps'
    );
    assert.equal(
        (
            await sampleLabel(
                {},
                { videoTrack: track({ width: 1280, height: 720 }) }
            )
        ).text,
        '视频 720p · 帧率不可用/待采样'
    );
});

test('calculates and smooths fps from decoded frame deltas', async () => {
    const { runTimers, win } = load();
    const { tile } = tileStructure();
    const video = element('video');
    const s = stream(track());
    video.srcObject = s;
    const reports = [100, 158, 218, 279].map((frames, i) => ({
        type: 'inbound-rtp',
        kind: 'video',
        framesWidth: 1920,
        framesHeight: 1080,
        framesDecoded: frames,
        timestamp: i * 1000,
    }));
    const pc = { getStats: async () => stats(reports.shift()) };
    const rt = win.VoiceMediaQualityRuntime.createRuntime({
        getQualitySource: () => ({
            generation: 1,
            isScreenSharing: true,
            pc,
            stream: s,
            tile,
            video,
        }),
        view: win.VoiceMediaQualityView,
    });
    rt.syncPeer('peer-a');
    await runTimers();
    await runTimers();
    await runTimers();
    await runTimers();
    assert.equal(
        tile.querySelector('.voice-media-quality-pill').textContent,
        '解码 1080p · 60fps'
    );
});

test('screen-only lifecycle hides camera, ended, audio-only, reject, stale and cleanup states', async () => {
    assert.equal(
        (await sampleLabel({ framesPerSecond: 60 }, { screen: false })).text,
        ''
    );
    assert.equal(
        (
            await sampleLabel(
                { framesPerSecond: 60 },
                { videoTrack: { kind: 'video', readyState: 'ended' } }
            )
        ).text,
        ''
    );
    assert.equal(
        (await sampleLabel({ framesPerSecond: 60 }, { videoTrack: null })).text,
        ''
    );
    const { runTimers, win } = load();
    const { tile } = tileStructure();
    const video = element('video');
    const s = stream(track());
    video.srcObject = s;
    const pc = {
        getStats: async () => {
            throw new Error('nope');
        },
    };
    const rt = win.VoiceMediaQualityRuntime.createRuntime({
        getQualitySource: () => ({
            generation: 1,
            isScreenSharing: true,
            pc,
            stream: s,
            tile,
            video,
        }),
        view: win.VoiceMediaQualityView,
    });
    rt.syncPeer('peer-a');
    await runTimers();
    assert.equal(
        tile.querySelector('.voice-media-quality-pill')?.textContent || '',
        '播放 帧率不可用/待采样'
    );
    assert.equal(rt.getActivePeerCount(), 1);
    let playbackFrames = 10;
    let playbackTime = 1000;
    win.performance = { now: () => playbackTime };
    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.getVideoPlaybackQuality = () => ({ totalVideoFrames: playbackFrames, droppedVideoFrames: 0 });
    await runTimers();
    playbackFrames += 25;
    playbackTime += 1000;
    await runTimers();
    assert.equal(tile.querySelector('.voice-media-quality-pill').textContent, '播放 720p · 25fps');
    assert.match(tile.querySelector('.voice-media-quality-pill').title, /不等同于合成器提交/);
    rt.stop('peer-a', 'leave', { remove: true });
    assert.equal(rt.getActivePeerCount(), 0);
});

test('independent peers, call replacement and timer cleanup', async () => {
    const { runTimers, timers, win } = load();
    const sources = new Map();
    const rt = win.VoiceMediaQualityRuntime.createRuntime({
        getQualitySource: (id) => sources.get(id),
        view: win.VoiceMediaQualityView,
    });
    for (const [id, fps] of [
        ['a', 30],
        ['b', 60],
    ]) {
        const { tile } = tileStructure();
        const video = element('video');
        const s = stream(track());
        video.srcObject = s;
        sources.set(id, {
            generation: 1,
            isScreenSharing: true,
            pc: {
                getStats: async () =>
                    stats({
                        type: 'inbound-rtp',
                        kind: 'video',
                        framesPerSecond: fps,
                    }),
            },
            stream: s,
            tile,
            video,
        });
        rt.syncPeer(id);
    }
    await runTimers();
    assert.equal(
        sources.get('a').tile.querySelector('.voice-media-quality-pill')
            .textContent,
        '解码 30fps'
    );
    assert.equal(
        sources.get('b').tile.querySelector('.voice-media-quality-pill')
            .textContent,
        '解码 60fps'
    );
    const oldTile = sources.get('a').tile;
    const { tile } = tileStructure();
    const video = element('video');
    const s = stream(track());
    video.srcObject = s;
    sources.set('a', {
        generation: 2,
        isScreenSharing: true,
        pc: {
            getStats: async () =>
                stats({
                    type: 'inbound-rtp',
                    kind: 'video',
                    framesPerSecond: 61,
                }),
        },
        stream: s,
        tile,
        video,
    });
    rt.syncPeer('a');
    await runTimers();
    assert.equal(
        tile.querySelector('.voice-media-quality-pill').textContent,
        '解码 61fps'
    );
    assert.equal(
        oldTile.querySelector('.voice-media-quality-pill')?.textContent || '',
        ''
    );
    rt.stop('a');
    rt.stop('b');
    assert.equal(timers.size, 0);
});

function qualitySequence() {
    const f = load();
    const { tile } = tileStructure();
    const videoTrack = { ...track(), id: 'playing-video' };
    const s = stream(videoTrack);
    let now = 0;
    let playbackFrames = 0;
    let rows = [];
    f.win.performance = { now: () => now };
    const source = { tile, stream: s, isScreenSharing: true,
        video: { srcObject: s, videoWidth: 3840, videoHeight: 2160,
            getVideoPlaybackQuality: () => ({ totalVideoFrames: playbackFrames, droppedVideoFrames: 0 }) },
        pc: { getStats: async () => new Map(rows.map((row) => [row.id, row])) } };
    const rt = f.win.VoiceMediaQualityRuntime.createRuntime({ getQualitySource: () => source, view: f.win.VoiceMediaQualityView });
    rt.syncPeer('viewer');
    return { ...f, source, rt, tile,
        async step(reports, rendered = 60) {
            now += 1000;
            playbackFrames += rendered;
            rows = reports.map((report) => ({ type: 'inbound-rtp', kind: 'video', timestamp: now, ...report }));
            await f.runTimers();
            return tile.querySelector('.voice-media-quality-pill').textContent;
        } };
}

test('SFU quality ignores idle byte counters and prefers the playing track over other active receivers', async () => {
    const f = qualitySequence();
    const reports = (frames) => [
        { id: 'idle', bytesReceived: 9000000, framesDecoded: 0 },
        { id: 'other', trackIdentifier: 'other-track', framesDecoded: 9000, framesPerSecond: 15 },
        { id: 'playing', trackIdentifier: 'playing-video', framesDecoded: frames },
    ];
    await f.step(reports(100));
    assert.equal(await f.step(reports(160)), '解码 4K · 60fps');
    const withoutIds = [{ id: 'idle', bytesReceived: 9000000 }, { id: 'playing', framesDecoded: 220 }];
    assert.equal(await f.step(withoutIds), '解码 4K · 60fps');
});

test('FPS falls back to playback even when stats already provide dimensions', async () => {
    const f = qualitySequence();
    const rows = [{ id: 'no-fps', frameWidth: 3840, frameHeight: 2160 }];
    assert.equal(await f.step(rows), '视频 4K · 帧率不可用/待采样');
    assert.equal(await f.step(rows, 47), '播放 4K · 47fps');
});

test('zero decoded growth displays a stall immediately and report replacement never mixes counters', async () => {
    const f = qualitySequence();
    await f.step([{ id: 'old', framesDecoded: 100 }]);
    assert.equal(await f.step([{ id: 'old', framesDecoded: 160 }]), '解码 4K · 60fps');
    assert.equal(await f.step([{ id: 'old', framesDecoded: 160 }]), '解码 4K · 0fps');
    assert.equal(await f.step([{ id: 'new', framesDecoded: 9000 }], 25), '播放 4K · 25fps');
    assert.equal(await f.step([{ id: 'new', framesDecoded: 9030 }]), '解码 4K · 30fps');
});

test('route button is adjacent to FPS, binds once, exposes auto/manual choices and cleans up its dialog', async () => {
    const { win } = load();
    const { tile, controls } = tileStructure();
    const view = win.VoiceMediaQualityView;
    const current = { mode: 'auto', route: 'sfu', available: true, pending: false, error: '' };
    const changes = [];
    let finish;
    const control = { get: () => current, change(mode) {
        changes.push(mode);
        current.mode = mode;
        current.pending = true;
        return new Promise((resolve) => { finish = () => { current.pending = false; resolve(); }; });
    } };
    view.render(tile, '4K · 60fps');
    view.renderRoute(tile, control);
    view.renderRoute(tile, control);
    const button = tile.querySelector('.voice-route-toggle');
    const dialog = tile.querySelector('.voice-route-dialog');
    const checkbox = tile.querySelector('input');
    const choices = tile.querySelector('.voice-route-choices');
    assert.equal(controls.children.filter((child) => child === button).length, 1);
    assert.equal(controls.children.indexOf(button), controls.children.indexOf(tile.querySelector('.voice-media-quality-pill')) + 1);
    button.listeners.click({ stopPropagation() {} });
    assert.equal(dialog.open, true);
    assert.equal(checkbox.checked, true);
    assert.ok(choices.children.slice(0, 2).every((choice) => choice.disabled));
    assert.equal(choices.children[2].disabled, false, 'P2P-first is selectable from legacy auto');
    checkbox.checked = false;
    const manual = checkbox.listeners.change();
    assert.deepEqual(changes, ['sfu'], 'unchecking auto holds the current route');
    assert.equal(checkbox.disabled, true);
    assert.equal(tile.querySelector('.voice-route-status').textContent, '正在切换…');
    finish();
    await manual;
    assert.equal(choices.children[0].disabled, false);
    const direct = choices.children[0].listeners.click();
    assert.deepEqual(changes, ['sfu', 'p2p']);
    finish();
    await direct;
    view.remove(tile);
    assert.equal(dialog.open, false);
    assert.equal(tile.querySelector('.voice-route-dialog'), undefined);
    assert.equal(tile.querySelector('.voice-route-toggle'), undefined);
});

test('receiver badge labels complete receive explicitly when no decoder counter exists', async () => {
    const f = qualitySequence();
    await f.step([{ id: 'r', framesReceived: 100 }]);
    assert.equal(await f.step([{ id: 'r', framesReceived: 145 }]), '完整接收 4K · 45fps');
});

test('repeated RTC timestamps show stale status instead of reusing a healthy FPS badge', async () => {
    const f = qualitySequence();
    const row = { id: 'r', timestamp: 1000, framesDecoded: 100, framesPerSecond: 60 };
    assert.equal(await f.step([row]), '解码 4K · 60fps');
    assert.equal(await f.step([row]), '视频 4K · 数据过期');
});
