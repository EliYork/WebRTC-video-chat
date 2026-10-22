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
    for (const file of ['shared/view-utils', 'chat/chat-message-ui', 'room/video-tile-structure-ui', 'room/tile-status-ui', 'room/presence-view-model', 'room/stage-layout-runtime']) {
        vm.runInNewContext(read(`js/${file}.js`), { window });
    }
    const node = (id, host = document.body) => { const element = document.createElement('div'); element.id = id; host.append(element); return element; };
    const root = node('main'); const stage = node('video-grid', root); const members = node('member-cards', root); const chat = node('chat-panel', root);
    const sources = node('share-sources', root);
    for (const id of ['stageChatToggle', 'stageChannelsToggle', 'stageStageToggle', 'stageMoreToggle', 'workspace-tools', 'stage-channels', 'member-count', 'members-empty', 'stageChannelName', 'stageChannelStatus', 'stageWelcomeTitle', 'stageWelcomeDetail', 'stageJoinVoice', 'stageConnectionStatus', 'chatJumpToLatest']) node(id);
    node('chatMessages', chat); node('chatInput', chat);
    const state = new Map(); const volumes = []; const channel = {}; let joins = 0;
    const runtime = window.VoiceStageLayout.createRuntime({ root, stage, members, sources, chat,
        getTiles: () => root.querySelectorAll('.video-tile'), getMember: (tile) => state.get(tile.id),
        getCameraStream: (tile) => state.get(tile.id).cameraStream,
        getChannelState: () => channel, onJoin: () => { joins++; },
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
    return { root, stage, members, chat, sources, document, window, runtime, state, add, volumes, channel, getJoins: () => joins };
};

test('voice uses member cards, shares choose one stable focus and last end returns to voice', () => {
    const f = fixture(); const a = f.add('a'); const b = f.add('b');
    const fullscreenExits = [];
    f.window.VoiceFullscreenControls = { exitTileFullscreen: tile => fullscreenExits.push(tile.id) };
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
    assert.deepEqual(fullscreenExits, ['b', 'a'], 'ended shares leave fullscreen even if a camera remains');
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

test('desktop chat starts expanded; phones start on stage and preserve explicit navigation', () => {
    for (const width of [3840, 1920, 900, 390, 320]) {
        const f = fixture(width); assert.equal(f.runtime.snapshot().chatOpen, width > 640);
        const toggle = f.document.getElementById('stageChatToggle');
        assert.equal(toggle.getAttribute('aria-expanded'), String(width > 640));
        f.runtime.setChatOpen(false);
        f.runtime.syncViewport(); f.runtime.sync();
        assert.equal(f.runtime.snapshot().chatOpen, false);
        assert.equal(f.chat.inert, true);
        f.document.getElementById('stageChannelsToggle').click(); assert.equal(f.runtime.snapshot().channelsOpen, true);
        toggle.click(); assert.equal(f.runtime.snapshot().chatOpen, true);
        assert.equal(f.runtime.snapshot().channelsOpen, false);
        f.runtime.destroy(); assert.equal(toggle.listeners.get('click').size, 0);
    }
});

test('first mobile chat opening follows latest history; later openings retain reading position', () => {
    const f = fixture(390);
    const messages = f.document.getElementById('chatMessages');
    Object.assign(messages, { scrollHeight: 1800, clientHeight: 300, scrollTop: 1500 });
    f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 1800, 'first opening scrolls to latest after hidden history becomes measurable');
    messages.scrollTop = 420;
    f.runtime.setChatOpen(false);
    messages.scrollTop = 0;
    f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 420, 'explicit close and reopen still restore reading position');
    f.runtime.destroy();
});

test('entering compact layout saves the current reading position before hiding chat', () => {
    const f = fixture(); const tile = f.add('reader', true); f.runtime.sync();
    const video = tile.querySelector('video'); const stream = video.srcObject;
    const messages = f.document.getElementById('chatMessages');
    Object.assign(messages, { scrollHeight: 1800, clientHeight: 300, scrollTop: 120 });
    f.runtime.setChatOpen(false); f.runtime.setChatOpen(true);
    messages.scrollTop = 610;
    f.window.innerWidth = 390; f.window.innerHeight = 844; f.runtime.syncViewport();
    assert.equal(f.runtime.snapshot().chatOpen, false);
    messages.scrollTop = 0;
    f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 610, 'use the position at resize, not the older explicit close');
    assert.equal(tile.querySelector('video'), video); assert.equal(video.srcObject, stream);
    f.runtime.destroy();
});

test('room changes discard the previous panel offset; clearing unread alone keeps it', () => {
    const f = fixture(390);
    const messages = f.document.getElementById('chatMessages');
    Object.assign(messages, { scrollHeight: 1800, clientHeight: 300 });
    f.runtime.setChatOpen(true); messages.scrollTop = 420;
    f.runtime.setChatOpen(false); f.runtime.notifyChatMessage({ content: 'same room' });
    f.runtime.resetUnread(); messages.scrollTop = 0; f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 420, 'read state must not discard the current channel reading position');
    f.runtime.setChatOpen(false); f.runtime.notifyChatMessage({ content: 'old room' });
    assert.equal(f.runtime.snapshot().unread, 1);
    f.runtime.resetChatRoom();
    assert.equal(f.runtime.snapshot().unread, 0);
    assert.equal(f.document.getElementById('stageChatToggle').dataset.unreadCount, '0');
    Object.assign(messages, { scrollHeight: 2400, scrollTop: 0 });
    f.runtime.setChatOpen(true);
    assert.equal(messages.scrollTop, 2400, 'new channel follows latest instead of restoring 420');
    f.runtime.destroy();
});

test('mobile stage, chat and channels are exclusive and retain the actual video and draft', () => {
    const f = fixture(390); const tile = f.add('a', true); f.runtime.sync();
    const video = tile.querySelector('video'); const stream = video.srcObject;
    const get = (id) => f.document.getElementById(id);
    const draft = get('chatInput'); draft.value = 'mobile draft';
    get('stageChatToggle').click();
    assert.equal(f.root.dataset.mobilePanel, 'chat');
    get('stageChannelsToggle').click();
    assert.equal(f.root.dataset.mobilePanel, 'channels');
    assert.equal(f.chat.inert, true);
    assert.equal(get('stage-channels').inert, false);
    get('stageStageToggle').click();
    assert.equal(f.root.dataset.mobilePanel, 'stage');
    assert.equal(get('stageStageToggle').textContent, '共享');
    assert.equal(get('stage-channels').inert, true);
    assert.equal(tile.querySelector('video'), video);
    assert.equal(video.srcObject, stream);
    assert.equal(draft.value, 'mobile draft');
    get('stageMoreToggle').click();
    assert.equal(get('workspace-tools').inert, false);
    get('stageMoreToggle').click();
    assert.equal(get('workspace-tools').inert, true);
});

test('wide tools disclosure is inert until opened and preserves players and the chat draft', () => {
    const f = fixture(1440), tile = f.add('a', true);
    f.runtime.sync();
    const tools = f.document.getElementById('workspace-tools'), toggle = f.document.getElementById('stageMoreToggle');
    const video = tile.querySelector('video'), stream = video.srcObject;
    f.document.getElementById('chatInput').value = 'preserved draft';
    assert.equal(tools.inert, true);
    toggle.click();
    assert.equal(tools.inert, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    toggle.click();
    assert.equal(tools.inert, true);
    assert.equal(video.srcObject, stream);
    assert.equal(f.document.getElementById('chatInput').value, 'preserved draft');
    f.runtime.destroy();
});

test('wide tools CloseWatcher restores owned focus and ignores an obsolete close after reopening', () => {
    const f = fixture(1440), watchers = [];
    f.window.CloseWatcher = class {
        constructor() { watchers.push(this); }
        addEventListener(_, handler) { this.close = handler; }
        destroy() { this.destroyed = true; }
    };
    const tools = f.document.getElementById('workspace-tools'), toggle = f.document.getElementById('stageMoreToggle');
    const action = f.document.createElement('button'); tools.append(action);
    toggle.click(); action.focus(); watchers[0].close();
    assert.equal(tools.inert, true);
    assert.equal(f.document.activeElement, toggle);
    toggle.click();
    watchers[0].close();
    assert.equal(tools.inert, false);
    f.runtime.destroy();
    assert.equal(watchers[1].destroyed, true);
});

test('rotation uses the mobile layout and restores desktop chat without touching media', () => {
    const f = fixture(1920); const tile = f.add('a', true); f.runtime.sync();
    const video = tile.querySelector('video'); const stream = video.srcObject;
    f.window.innerWidth = 844; f.window.innerHeight = 390; f.runtime.syncViewport();
    assert.equal(f.runtime.snapshot().chatOpen, false);
    f.runtime.setChannelsOpen(true);
    f.window.innerWidth = 390; f.window.innerHeight = 844; f.runtime.syncViewport();
    assert.equal(f.runtime.snapshot().channelsOpen, true, 'phone rotation retains the selected view');
    f.window.innerWidth = 1920; f.window.innerHeight = 1080; f.runtime.syncViewport();
    assert.equal(f.runtime.snapshot().chatOpen, true);
    assert.equal(f.runtime.snapshot().channelsOpen, false);
    assert.equal(video.srcObject, stream);
});

test('unread messages follow actual visibility and reading position, not history or display names', () => {
    const f = fixture(390);
    const messages = f.document.getElementById('chatMessages');
    const jump = f.document.getElementById('chatJumpToLatest');
    f.runtime.notifyChatMessage({ content: 'new' });
    f.runtime.notifyChatMessage({ type: 'system' });
    assert.equal(f.runtime.snapshot().unread, 1);
    f.runtime.setChatOpen(true);
    assert.equal(f.runtime.snapshot().unread, 0);
    f.runtime.notifyChatMessage({ content: 'already reading latest' });
    assert.equal(f.runtime.snapshot().unread, 0);
    Object.assign(messages, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 });
    f.runtime.notifyChatMessage({ content: 'while reading' });
    assert.equal(messages.scrollTop, 100);
    assert.equal(f.runtime.snapshot().unread, 1);
    assert.equal(jump.hidden, false);
    jump.click();
    assert.equal(messages.scrollTop, 1000);
    assert.equal(f.runtime.snapshot().unread, 0);
    f.document.hidden = true;
    f.runtime.notifyChatMessage({ content: 'background' });
    assert.equal(f.runtime.snapshot().unread, 1);
    f.runtime.resetUnread();
    assert.equal(f.document.getElementById('stageChatToggle').dataset.unreadCount, '0');
    f.runtime.destroy(); f.runtime.notifyChatMessage({ content: 'late' });
    assert.equal(f.runtime.snapshot().unread, 0);
});

test('connection feedback distinguishes signalling, voice recovery and connected playback', () => {
    const f = fixture(390); const notice = f.document.getElementById('stageConnectionStatus');
    f.runtime.setChatConnection('offline'); assert.match(notice.textContent, /聊天已离线/);
    f.channel.connectionState = 'reconnecting-peer'; f.runtime.sync();
    assert.match(notice.textContent, /语音正在重新连接/);
    f.channel.connectionState = 'joined'; f.runtime.setChatConnection('connected');
    assert.equal(notice.hidden, true);
});

test('mobile CloseWatchers close panels without changing history and release on resize/destroy', () => {
    const f = fixture(390); const watchers = [];
    f.window.CloseWatcher = class {
        constructor() { watchers.push(this); }
        addEventListener(_, handler) { this.close = handler; }
        destroy() { this.destroyed = true; }
    };
    f.runtime.setChatOpen(true); assert.equal(watchers.length, 1);
    f.runtime.sync(); assert.equal(watchers.length, 1, 'state updates do not recreate the watcher');
    watchers[0].close(); assert.equal(f.runtime.snapshot().chatOpen, false);
    f.runtime.setChannelsOpen(true); assert.equal(watchers.length, 2);
    f.window.innerWidth = 1920; f.runtime.syncViewport();
    assert.equal(watchers[1].destroyed, true);
    f.window.innerWidth = 390; f.runtime.syncViewport(); f.runtime.setChatOpen(true);
    f.runtime.destroy(); assert.equal(watchers.at(-1).destroyed, true);
});

test('visual keyboard leaves the chat composer usable; zoom does not trigger keyboard layout', () => {
    const f = fixture(390);
    f.window.innerHeight = 844;
    f.window.visualViewport = { height: 400, scale: 1 };
    const values = new Map(); f.root.style.setProperty = (key, value) => values.set(key, value);
    f.runtime.setChatOpen(true);
    f.document.getElementById('chatInput').focus();
    f.runtime.syncViewport();
    assert.equal(f.root.classList.contains('stage-mobile-keyboard'), true);
    assert.equal(values.get('--stage-viewport-height'), '400px');
    f.window.visualViewport.scale = 2; f.runtime.syncViewport();
    assert.equal(f.root.classList.contains('stage-mobile-keyboard'), false);
    f.window.visualViewport.scale = 1; f.runtime.setChatOpen(false);
    assert.equal(f.root.classList.contains('stage-mobile-keyboard'), false);
});

test('channel guide distinguishes unknown, empty, occupied, joining and joined without creating media', () => {
    const f = fixture(); const get = (id) => f.document.getElementById(id);
    assert.equal(f.root.dataset.channelOccupancy, 'unknown');
    assert.equal(f.members.hidden, true);
    Object.assign(f.channel, { joined: false, memberCount: 0, channelName: '大厅' }); f.runtime.sync();
    assert.equal(f.root.dataset.voiceState, 'not-joined');
    assert.equal(f.root.dataset.channelOccupancy, 'empty');
    assert.match(get('stageWelcomeTitle').textContent, /第一个/);
    get('stageJoinVoice').click(); assert.equal(f.getJoins(), 1);
    f.channel.memberCount = 3; f.runtime.sync();
    assert.equal(f.root.dataset.channelOccupancy, 'occupied');
    assert.match(get('stageWelcomeTitle').textContent, /3 位/);
    assert.equal(get('stageChannelName').textContent, '大厅');
    f.channel.pending = true; f.runtime.sync();
    assert.equal(f.root.dataset.voiceState, 'joining'); assert.equal(get('stageJoinVoice').disabled, true);
    f.channel.joined = true; f.channel.pending = false; f.add('local-video'); f.runtime.sync();
    assert.equal(f.root.dataset.voiceState, 'joined'); assert.equal(f.members.hidden, false);
    assert.equal(get('members-empty').hidden, true); assert.equal(get('stageJoinVoice').hidden, true);
});

test('one, two, three, four and larger member grids retain every original tile and speaking state', () => {
    const f = fixture();
    for (let n = 1; n <= 12; n++) {
        const tile = f.add(`member-${n}`); const video = tile.querySelector('video');
        f.runtime.sync(); f.runtime.setSpeaking(tile.id, true);
        assert.equal(f.members.children.length, n);
        assert.equal(f.members.dataset.memberCount, String(n));
        assert.equal(tile.querySelector('video'), video); assert.equal(tile.classList.contains('is-speaking'), true);
    }
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
