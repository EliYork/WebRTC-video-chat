import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './helpers/stage_dom.mjs';

const read = (path) => readFileSync(new URL(`../src/views/${path}`, import.meta.url), 'utf8');
const fixture = (width = 1920) => {
    const document = createDocument();
    const window = { document, innerWidth: width, MediaStream: class { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return []; } } };
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('stage must never read old layouts'); } });
    for (const file of ['shared/view-utils', 'room/video-tile-structure-ui', 'room/tile-status-ui', 'room/presence-view-model', 'room/stage-layout-runtime']) {
        vm.runInNewContext(read(`js/${file}.js`), { window });
    }
    const node = (id, host = document.body) => { const element = document.createElement('div'); element.id = id; host.append(element); return element; };
    const root = node('main'); const stage = node('video-grid', root); const members = node('member-cards', root); const chat = node('chat-panel', root);
    const sources = node('share-sources', root);
    for (const id of ['stageChatToggle', 'stageChannelsToggle', 'member-count', 'members-empty']) node(id);
    node('chatMessages', chat); node('chatInput', chat);
    const state = new Map(); const volumes = [];
    const runtime = window.VoiceStageLayout.createRuntime({ root, stage, members, sources, chat,
        getTiles: () => root.querySelectorAll('.video-tile'), getMember: (tile) => state.get(tile.id),
        getCameraStream: (tile) => state.get(tile.id).cameraStream,
        onVolume: (_, tile) => volumes.push(tile.id) });
    const add = (id, sharing = false) => {
        const tile = node(id, stage); tile.className = 'video-tile';
        window.VoiceVideoTileStructureUI.ensureTileStructure(tile);
        const video = document.createElement('video'); video.srcObject = { id: `stream-${id}` };
        tile.querySelector('.tile-body').append(video);
        state.set(id, { senderName: id, screenSharing: sharing, hasMic: true });
        return tile;
    };
    runtime.init();
    return { root, stage, members, chat, sources, document, window, runtime, state, add, volumes };
};

test('voice uses member cards, shares choose one stable focus and last end returns to voice', () => {
    const f = fixture(); const a = f.add('a'); const b = f.add('b');
    f.runtime.sync();
    assert.equal(f.runtime.snapshot().mode, 'voice');
    assert.deepEqual(f.members.children, [a, b]);
    f.state.get('a').screenSharing = true; f.runtime.sync();
    assert.equal(f.runtime.snapshot().selectedId, 'a');
    assert.equal(f.stage.children.length, 1);
    assert.equal(f.members.children.length, 2, 'focused sharer remains in the member list');
    f.state.get('b').screenSharing = true; f.runtime.sync();
    assert.equal(f.runtime.snapshot().selectedId, 'a', 'new share cannot steal focus');
    f.sources.children[1].click();
    assert.equal(f.runtime.snapshot().selectedId, 'b');
    f.runtime.sync(); assert.equal(f.runtime.snapshot().selectedId, 'b');
    f.state.get('b').screenSharing = false; f.runtime.sync();
    assert.equal(f.runtime.snapshot().selectedId, 'a');
    assert.equal(b.parentElement, f.members);
    f.state.get('a').screenSharing = false; f.runtime.sync();
    assert.equal(f.runtime.snapshot().mode, 'voice'); assert.equal(f.runtime.snapshot().selectedId, undefined);
    assert.equal(f.sources.children.length, 0); assert.equal(f.members.children.length, 2);
});

test('layout and chat changes preserve exact players, streams, per-sharer route state and listeners', () => {
    const f = fixture(); const a = f.add('a', true); const b = f.add('b', true);
    const videoA = a.querySelector('video'); const stream = videoA.srcObject;
    const preferences = { mode: 'p2p' };
    const route = f.document.createElement('button'); route.getPreference = () => preferences;
    a.querySelector('.tile-header-actions').append(route);
    f.runtime.sync(); const initialPlays = videoA.playCount;
    const selector = f.sources.children[0];
    for (let i = 0; i < 10; i++) {
        f.runtime.init(); f.runtime.setChatOpen(false); f.runtime.focusShare('b');
        f.runtime.setChatOpen(true); f.runtime.syncViewport(); f.runtime.sync();
    }
    assert.equal(a.querySelector('video'), videoA); assert.equal(videoA.srcObject, stream);
    assert.equal(videoA.playCount, initialPlays, 'focus and resize never reattach or replay');
    assert.equal(route.getPreference(), preferences); assert.equal(preferences.mode, 'p2p');
    assert.equal(f.stage.children.length, 2); assert.equal(b.parentElement, f.stage);
    assert.equal(f.sources.children[0], selector);
    assert.equal(f.document.getElementById('stageChatToggle').listeners.get('click').size, 1);
    assert.equal(a.querySelectorAll('video, audio').length, 1);
    assert.equal(f.members.querySelectorAll('video, audio').length, 0, 'share member proxies never duplicate the share player');
});

test('chat preserves input, message objects, scroll position and restores keyboard focus safely', () => {
    const f = fixture();
    const input = f.document.getElementById('chatInput'); input.value = 'unfinished'; input.focus();
    const messages = f.document.getElementById('chatMessages'); messages.scrollTop = 321;
    const message = f.document.createElement('li'); messages.append(message);
    f.runtime.setChatOpen(false); assert.equal(f.chat.inert, true);
    assert.equal(f.document.activeElement, f.document.getElementById('stageChatToggle'));
    messages.scrollTop = 0; f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 321); assert.equal(input.value, 'unfinished');
    assert.equal(messages.children[0], message);
});

test('member departure, camera and speaking changes keep one card per member', () => {
    const f = fixture(); const a = f.add('a'); const b = f.add('b', true);
    f.runtime.sync(); f.runtime.setSpeaking('b', true);
    const proxy = f.members.querySelector('.stage-member-proxy');
    assert.equal(proxy.classList.contains('is-speaking'), true);
    assert.equal(b.classList.contains('is-speaking'), true);
    f.state.get('b').muted = true; f.runtime.sync();
    assert.equal(proxy.querySelector('.tile-badges').children[0].title, '静音');
    proxy.querySelector('.member-volume-button').click(); assert.deepEqual(f.volumes, ['b']);
    f.state.get('a').cameraOn = true; f.runtime.sync(); assert.equal(a.parentElement, f.members);
    b.remove(); f.runtime.sync(); assert.equal(f.members.children.length, 1);
    assert.equal(f.runtime.snapshot().mode, 'voice');
    assert.equal(f.document.getElementById('member-count').textContent, '1 人');
});

test('hidden local screen preview remains a share; distinct camera preview is silent and releases no tracks', () => {
    const f = fixture(); const local = f.add('local-video', true);
    local.classList.add('is-local-preview-hidden'); local.querySelector('video').srcObject = null;
    let stopped = 0; const camera = { readyState: 'live', stop() { stopped++; } };
    Object.assign(f.state.get('local-video'), { cameraOn: true, cameraStream: { getVideoTracks: () => [camera] } });
    f.runtime.sync(); assert.equal(f.runtime.snapshot().mode, 'sharing');
    const preview = f.members.querySelector('video'); assert.equal(preview.muted, true);
    assert.equal(preview.srcObject.tracks[0], camera); assert.deepEqual(preview.srcObject.getAudioTracks(), []);
    const stream = preview.srcObject; f.runtime.sync(); assert.equal(preview.srcObject, stream);
    f.state.get('local-video').cameraOn = false; f.runtime.sync();
    assert.equal(preview.srcObject, null); assert.equal(stopped, 0);
    assert.equal(local.querySelector('video').srcObject, null, 'preview stays hidden');
});

test('mobile starts with viewable media, channels and chat have independent controls', () => {
    const f = fixture(390); assert.equal(f.runtime.snapshot().chatOpen, false);
    f.document.getElementById('stageChannelsToggle').click(); assert.equal(f.runtime.snapshot().channelsOpen, true);
    f.document.getElementById('stageChatToggle').click(); assert.equal(f.runtime.snapshot().chatOpen, true);
    f.runtime.setChannelsOpen(false); assert.equal(f.runtime.snapshot().chatOpen, true);
    f.runtime.destroy(); assert.equal(f.document.getElementById('stageChatToggle').listeners.get('click').size, 0);
});

test('page loads only active resources and stage code cannot capture or change media routes', () => {
    const html = read('room/index.ejs');
    assert.doesNotMatch(html, /js\/layout\/|mobile-room-state|page-layout|data-drag-handle/);
    const source = read('js/room/stage-layout-runtime.js');
    assert.doesNotMatch(source, /setReceiveRoute|RTCPeerConnection|getUserMedia|getDisplayMedia|replaceTrack|\.stop\(|localStorage|\.clone\(/);
    for (const [, url] of html.matchAll(/(?:src|href)="(\/(?:js\/|styles\/|style\.css)[^"]+)"/g)) {
        assert.doesNotThrow(() => read(url.slice(1).split('?')[0]), `missing resource ${url}`);
    }
    assert.match(read('js/voice/voice-media-quality-view.js'), /state\.control\.change\(mode\)/);
    assert.match(read('script.js'), /change: \(mode\) => screenSfuRuntime\.setReceiveRoute\(peerId, mode\)/);
});
