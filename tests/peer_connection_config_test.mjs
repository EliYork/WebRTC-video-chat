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
        iceServers: servers,
    });
    assert.equal(options.iceServers, undefined);
    assert.equal(options.config.iceServers[0], servers[0]);
    assert.equal(options.path, '/peerjs');
});
