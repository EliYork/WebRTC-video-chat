import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTurnCredentials, readTurnConfig } from '../src/utils/TurnCredentials.js';
import { validateSocketPacket } from '../src/utils/SocketPacketValidation.js';

const env = { TURN_URLS: 'turn:relay.example.test:3478?transport=udp,turns:relay.example.test:5349?transport=tcp',
    TURN_SHARED_SECRET: 'test-only-shared-secret-1234567890', TURN_TTL_SECONDS: '600' };
const socket = id => ({ id, connected: true });
test('TURN is optional; partial or invalid configuration fails without exposing values', () => {
    assert.deepEqual(readTurnConfig({}), { enabled: false });
    for (const changed of [
        { TURN_URLS: '' }, { TURN_SHARED_SECRET: '' }, { TURN_SHARED_SECRET: 'short' },
        { TURN_SHARED_SECRET: ' padded-secret-that-should-not-be-trimmed ' },
        { TURN_TTL_SECONDS: '599' }, { TURN_TTL_SECONDS: '86401' }, { TURN_TTL_SECONDS: '1.2' },
        { TURN_URLS: 'https://secret.example.test' }, { TURN_URLS: 'turn:user:password@secret.example.test' },
        { TURN_URLS: 'turn:secret.example.test/path' }, { TURN_URLS: 'turn:secret.example.test:65536' },
        { TURN_URLS: 'turn:secret.example.test:0' }, { TURN_URLS: 'turn:bad-label-.example.test' },
        { TURN_URLS: 'turn:999.999.999.999' }, { TURN_URLS: 'turn:[not-ipv6]' },
        { TURN_URLS: 'turns:secret.example.test?transport=udp' }, { TURN_URLS: 'turn:secret.example.test,' },
        { TURN_URLS: Array.from({ length: 9 }, (_, n) => `turn:relay${n}.example.test`).join(',') },
    ]) {
        assert.throws(() => readTurnConfig({ ...env, ...changed }), error => {
            assert.match(error.message, /\[turn\]/); assert.doesNotMatch(error.message, /secret\.example|password@|1234567890/); return true;
        });
    }
    assert.deepEqual(readTurnConfig({ ...env, TURN_URLS: 'turn:[::1]:3478,turn:127.0.0.1:3478,turn:[::1]:3478' }).urls,
        ['turn:[::1]:3478', 'turn:127.0.0.1:3478']);
});

test('coturn REST credentials sign expiry and random identity; shared secret stays server side', () => {
    const config = readTurnConfig(env), clock = 1700000000000;
    const provider = createTurnCredentials({ config, now: () => clock });
    const a = socket('secret-socket-identity'), b = socket('another-socket');
    const result = provider.request(a), turn = result.iceServers.at(-1);
    assert.equal(result.ok, true); assert.equal(result.ttlSeconds, 600);
    assert.match(turn.username, /^1700000600:[a-f0-9]{32}$/);
    assert.equal(turn.credential, createHmac('sha1', config.secret).update(turn.username).digest('base64'));
    assert.notEqual(provider.request(b).iceServers.at(-1).username, turn.username);
    assert.doesNotMatch(JSON.stringify(result), /secret-socket|1234567890/);
    result.iceServers.at(-1).urls.length = 0;
    assert.equal(provider.request(a).iceServers.at(-1).urls.length, 2, 'responses do not mutate the provider cache/config');
});

test('credentials cache per live socket, renew after half TTL and clean up on disconnect', () => {
    let clock = 0;
    const provider = createTurnCredentials({ config: readTurnConfig(env), now: () => clock }), a = socket('a');
    const first = provider.request(a).iceServers.at(-1);
    clock = 200000; assert.equal(provider.request(a).iceServers.at(-1).username, first.username);
    clock = 301000; const next = provider.request(a).iceServers.at(-1);
    assert.notEqual(next.username, first.username);
    provider.clear(a); assert.notEqual(provider.request(a).iceServers.at(-1).username, next.username);
    a.connected = false; assert.equal(provider.request(a).ok, false);
});

test('issuance is bounded per socket and across reconnect storms without retaining cleared sockets', () => {
    let clock = 0;
    const provider = createTurnCredentials({ config: readTurnConfig(env), now: () => clock }), a = socket('a');
    for (let i = 0; i < 6; i++) assert.equal(provider.request(a).ok, true);
    assert.equal(provider.request(a).reason, 'ice-rate-limited');
    for (let i = 0; i < 119; i++) {
        const next = socket('b' + i); assert.equal(provider.request(next).ok, true); provider.clear(next);
    }
    assert.equal(provider.request(socket('over-limit')).reason, 'ice-rate-limited');
    clock = 60001; assert.equal(provider.request(socket('after-window')).ok, true);
    provider.clear(a); assert.equal(provider.request(a).ok, true);
});

test('disabled TURN returns STUN only and rtc:ice accepts no client configuration payload', () => {
    const provider = createTurnCredentials({ config: { enabled: false } });
    const response = provider.request(socket('a'));
    assert.equal(response.turnEnabled, false); assert.equal(response.ttlSeconds, null);
    assert.equal(response.iceServers.every(row => row.urls.startsWith('stun:')), true);
    validateSocketPacket(['rtc:ice', { secret: 'injected' }, () => {}], () => assert.fail('payload must not reach issuer'));
    let reached = false; validateSocketPacket(['rtc:ice', () => {}], () => { reached = true; }); assert.equal(reached, true);
});
