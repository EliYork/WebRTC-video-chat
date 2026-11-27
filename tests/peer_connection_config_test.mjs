import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('Peer binds its voice identity and current RTC configuration only after the join is ready', async () => {
    const source = readFileSync(new URL('../src/views/script.js', import.meta.url), 'utf8');
    const creation = source.slice(source.indexOf('let pendingPeerCreation;'), source.indexOf('const leaveVoiceSession ='));
    let epoch = 1, release;
    const peers = [];
    const config = { iceServers: [{ urls: 'turn:relay.example.test', username: 'short-user', credential: 'short-credential' }] };
    const context = vm.createContext({
        crypto: webcrypto, TextEncoder,
        window: { location: { protocol: 'https:', hostname: 'localhost', port: '' } },
        voiceSessionRuntime: { getSnapshot: () => ({ epoch, desiredVoiceState: 'joined', roomId: 'lobby' }), isCurrent: value => value === epoch },
        iceConfigRuntime: { prepare: () => new Promise(resolve => { release = () => resolve(config); }) },
        peerLifecycleMetadata: new WeakMap(),
        Peer: class { constructor(id, options) { this.id = id; this.options = options; peers.push(this); } on() {} },
    });
    vm.runInContext(`let currentPeer; ${creation}; globalThis.makePeer = createPeerInstance;`, context);
    const cancelled = context.makePeer('lobby'); assert.equal(peers.length, 0);
    epoch++; release(); assert.equal(await cancelled, undefined); assert.equal(peers.length, 0);
    const active = context.makePeer('lobby'), duplicate = context.makePeer('lobby'); release();
    const peer = await active;
    assert.equal(peer, await duplicate);
    assert.equal(peer.options.config, config);
    assert.equal(peer.options.iceServers, undefined);
    assert.equal(peer.options.path, '/peerjs');
    assert.match(peer.options.token, /^[a-f0-9]{64}$/);
    assert.equal(peer.id, `voice-${createHash('sha256').update(peer.options.token).digest('hex')}`);
    assert.equal(peers.length, 1);
});
