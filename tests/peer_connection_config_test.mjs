import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('Peer receives RTC ICE configuration under config, not signaling options', () => {
    const source = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );
    const creation = source.match(
        /new Peer\(undefined, (\{[\s\S]*?\n {4}\})\);/
    );
    assert.ok(creation);
    const servers = [{ urls: 'stun:example.test:3478' }];
    const options = vm.runInNewContext(`(${creation[1]})`, {
        window: { location: { hostname: 'localhost' } },
        peerPort: '3000',
        isSecurePeerConnection: false,
        iceConfiguration: { iceServers: servers },
    });
    assert.equal(options.iceServers, undefined);
    assert.equal(options.config.iceServers[0], servers[0]);
    assert.equal(options.path, '/peerjs');
});

test('Peer waits for current ICE credentials and a cancelled join never creates a Peer', async () => {
    const source = readFileSync(new URL('../src/views/script.js', import.meta.url), 'utf8');
    const creation = source.slice(source.indexOf('let pendingPeerCreation;'), source.indexOf('const leaveVoiceSession ='));
    let epoch = 1, release;
    const peers = [];
    const config = { iceServers: [{ urls: 'turn:relay.example.test', username: 'short-user', credential: 'short-credential' }] };
    const context = vm.createContext({
        window: { location: { protocol: 'https:', hostname: 'localhost', port: '' } },
        voiceSessionRuntime: { getSnapshot: () => ({ epoch, desiredVoiceState: 'joined', roomId: 'lobby' }), isCurrent: value => value === epoch },
        iceConfigRuntime: { prepare: () => new Promise(resolve => { release = () => resolve(config); }) },
        peerLifecycleMetadata: new WeakMap(),
        Peer: class { constructor(_, options) { this.options = options; peers.push(this); } on() {} },
    });
    vm.runInContext(`let currentPeer; ${creation}; globalThis.makePeer = createPeerInstance;`, context);
    const cancelled = context.makePeer('lobby'); assert.equal(peers.length, 0);
    epoch++; release(); assert.equal(await cancelled, undefined); assert.equal(peers.length, 0);
    const active = context.makePeer('lobby'), duplicate = context.makePeer('lobby'); release();
    assert.equal(await active, await duplicate);
    assert.equal((await active).options.config, config); assert.equal(peers.length, 1);
});
