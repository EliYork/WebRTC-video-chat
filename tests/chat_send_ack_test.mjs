import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('server confirms accepted chat only and rejects wrong-room, empty and limited sends', () => {
    const source = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );
    const handler = source.slice(
        source.indexOf('const handleChatSend ='),
        source.indexOf('const handleCursorMove =')
    );
    const saved = [];
    const delivered = [];
    let allow = true;
    const send = vm.runInNewContext(`${handler}; handleChatSend`, {
        resolveOwnedViewChatRoom: (_, roomId) =>
            roomId === 'lobby'
                ? { roomId, socketRoom: 'view-chat:lobby' }
                : null,
        getChannel: (roomId) => (roomId === 'lobby' ? { slug: roomId } : null),
        normalizeChatContent: (value) => String(value || '').trim(),
        normalizeSenderName: (value) => value || 'Guest',
        chatRateLimiter: { allow: () => allow },
        createChatMessageId: () => 'confirmed',
        saveChatMessage: (message) => saved.push(message),
        io: {
            to: (room) => ({
                emit: (event, message) =>
                    delivered.push({ room, event, message }),
            }),
        },
    });
    const socket = { id: 'a' };
    assert.equal(send({ roomId: 'game', content: 'wrong' }, socket).ok, false);
    assert.equal(send({ roomId: 'lobby', content: ' ' }, socket).ok, false);
    allow = false;
    assert.equal(
        send({ roomId: 'lobby', content: 'limited' }, socket).ok,
        false
    );
    assert.equal(saved.length, 0);
    assert.equal(delivered.length, 0);
    allow = true;
    const result = send({ roomId: 'lobby', content: 'hello' }, socket);
    assert.equal(result.ok, true);
    assert.equal(result.messageId, 'confirmed');
    assert.equal(saved.length, 1);
    assert.equal(delivered[0].room, 'view-chat:lobby');
});
