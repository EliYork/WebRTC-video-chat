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
        textContent: '',
        append: (...nodes) => children.push(...nodes),
        remove() {
            this.removed = true;
        },
        setAttribute(k, v) {
            this.attributes[k] = v;
        },
        querySelector(selector) {
            const cls = selector.startsWith('.') ? selector.slice(1) : null;
            return children.find((c) =>
                cls
                    ? c.classList?.contains(cls)
                    : c.tagName?.toLowerCase() === selector
            );
        },
    };
    return el;
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

async function sampleLabel(
    report,
    { screen = true, videoSize = {}, videoTrack = track() } = {}
) {
    const { runTimers, win } = load();
    const tile = element('div');
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
        text:
            tile.querySelector('.voice-media-quality-pill')?.textContent || '',
        tile,
    };
}

test('formats standard and non-standard resolutions', async () => {
    assert.equal(
        (
            await sampleLabel({
                framesWidth: 1920,
                framesHeight: 1080,
                framesPerSecond: 60,
            })
        ).text,
        '1080p · 60fps'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 2560, framesHeight: 1440 })).text,
        '1440p'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 3840, framesHeight: 2160 })).text,
        '4K'
    );
    assert.equal(
        (await sampleLabel({ framesWidth: 1600, framesHeight: 900 })).text,
        '1600×900'
    );
});

test('omits missing pieces and never renders zero fps', async () => {
    assert.equal(
        (
            await sampleLabel({
                framesWidth: 1920,
                framesHeight: 1080,
                framesPerSecond: 0,
            })
        ).text,
        '1080p'
    );
    assert.equal((await sampleLabel({ framesPerSecond: 60 })).text, '60fps');
    assert.equal((await sampleLabel({})).text, '');
});

test('falls back to element and track dimensions without CSS sizes', async () => {
    assert.equal(
        (
            await sampleLabel(
                { framesPerSecond: 60 },
                { videoSize: { width: 1920, height: 1080 } }
            )
        ).text,
        '1080p · 60fps'
    );
    assert.equal(
        (
            await sampleLabel(
                {},
                { videoTrack: track({ width: 1280, height: 720 }) }
            )
        ).text,
        '720p'
    );
});

test('calculates and smooths fps from decoded frame deltas', async () => {
    const { runTimers, win } = load();
    const tile = element('div');
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
        '1080p · 60fps'
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
    const tile = element('div');
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
        ''
    );
    assert.equal(rt.getActivePeerCount(), 1);
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
        const tile = element('div');
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
        '30fps'
    );
    assert.equal(
        sources.get('b').tile.querySelector('.voice-media-quality-pill')
            .textContent,
        '60fps'
    );
    const oldTile = sources.get('a').tile;
    const tile = element('div');
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
        '61fps'
    );
    assert.equal(
        oldTile.querySelector('.voice-media-quality-pill')?.textContent || '',
        ''
    );
    rt.stop('a');
    rt.stop('b');
    assert.equal(timers.size, 0);
});
