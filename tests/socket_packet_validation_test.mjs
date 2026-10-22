import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSocketPacket } from '../src/utils/SocketPacketValidation.js';

test('malformed client packets are rejected before business handlers run', () => {
    for (const event of [
        'voice:join',
        'chat:join',
        'chat:send',
        'presence:update',
        'presence:joinVoice',
        'cursor:move',
        'cursor:leave',
        'screen:share',
    ]) {
        for (const payload of [null, undefined, [], 'bad', 42]) {
            let called = false;
            let response;
            validateSocketPacket(
                [
                    event,
                    payload,
                    (value) => {
                        response = value;
                    },
                ],
                () => {
                    called = true;
                }
            );
            assert.equal(called, false, event);
            assert.equal(response.ok, false);
        }
    }
});

test('object coercion, nonfinite numbers and invalid acknowledgement arguments are blocked', () => {
    for (const packet of [
        ['chat:send', { content: { toString: null } }],
        ['presence:update', { senderName: {} }],
        ['voice:join', { peerId: {} }],
        ['voice:join', { clientSessionEpoch: {} }],
        ['cursor:move', { x: Infinity }],
        ['screen:share', { voiceSessionGeneration: {} }],
        ['voice:join', {}, 'not-a-function'],
        ['voice:snapshot', {}],
    ]) {
        validateSocketPacket(packet, () =>
            assert.fail('invalid packet reached handler')
        );
    }
});

test('history request IDs are optional positive safe integers', () => {
    for (const joinRequestId of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1', {}]) {
        let accepted = false;
        validateSocketPacket(['chat:join', { roomId: 'lobby', joinRequestId }], () => { accepted = true; });
        assert.equal(accepted, false);
    }
    for (const payload of [{ roomId: 'lobby' }, { roomId: 'lobby', joinRequestId: 7 }]) {
        let accepted = false;
        validateSocketPacket(['chat:join', payload], () => { accepted = true; });
        assert.equal(accepted, true);
    }
});

test('normal requests and payload-free lifecycle events remain compatible', () => {
    for (const packet of [
        [
            'voice:join',
            { roomId: 'lobby', peerId: 'peer-a', clientSessionEpoch: 1 },
        ],
        [
            'chat:send',
            { roomId: 'lobby', content: '你好', senderName: 'Guest' },
            () => {},
        ],
        ['presence:update', { muted: false, hasMic: true }],
        ['cursor:move', { x: 0.4, y: 0.6 }],
        ['screen:share', { sharing: false, voiceSessionGeneration: 1 }],
        ['voice:snapshot', () => {}],
        ['voicePeerLeft'],
        ['presence:leaveVoice'],
    ]) {
        let calls = 0;
        validateSocketPacket(packet, () => {
            calls++;
        });
        assert.equal(calls, 1);
    }
});
