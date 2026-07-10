import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    emitViewCursorRemove,
    getViewChatSocketRoom,
    resolveOwnedViewChatRoom,
    switchViewChatRoom,
} from '../src/utils/ViewChatRoomLifecycle.js';

class FakeHub {
    constructor() {
        this.sockets = new Map();
    }

    createSocket(id) {
        const socket = new FakeSocket(this, id);
        this.sockets.set(id, socket);
        return socket;
    }

    emitToRoom(room, event, payload, exceptId) {
        this.sockets.forEach((socket) => {
            if (socket.id !== exceptId && socket.rooms.has(room)) {
                socket.received.push({ event, payload, room });
            }
        });
    }
}

class FakeSocket {
    constructor(hub, id) {
        this.data = {};
        this.hub = hub;
        this.id = id;
        this.joinCalls = [];
        this.leaveCalls = [];
        this.received = [];
        this.rooms = new Set([id]);
    }

    async join(room) {
        this.joinCalls.push(room);
        this.rooms.add(room);
    }

    async leave(room) {
        this.leaveCalls.push(room);
        this.rooms.delete(room);
    }

    to(room) {
        return {
            emit: (event, payload) => {
                this.hub.emitToRoom(room, event, payload, this.id);
            },
        };
    }

    disconnect() {
        this.rooms.clear();
    }
}

const allowFixedChannels = (roomId) =>
    new Set(['lobby', 'game', 'project']).has(roomId);

const switchRoom = (socket, roomId) =>
    switchViewChatRoom(socket, roomId, {
        isAllowedRoomId: allowFixedChannels,
    });

test('lobby -> game -> project leaves old view/chat rooms', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    await switchRoom(socket, 'lobby');
    await switchRoom(socket, 'game');
    await switchRoom(socket, 'project');

    assert.deepEqual(socket.rooms, new Set(['socket-a', 'view-chat:project']));
    assert.equal(socket.data.viewRoomId, 'project');
    assert.equal(socket.data.chatRoomId, 'project');
    assert.deepEqual(socket.leaveCalls, ['view-chat:lobby', 'view-chat:game']);
});

test('joining the same view/chat room is idempotent', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    await switchRoom(socket, 'lobby');
    await switchRoom(socket, 'lobby');

    assert.deepEqual(socket.joinCalls, ['view-chat:lobby']);
    assert.deepEqual(socket.leaveCalls, []);
    assert.deepEqual(socket.rooms, new Set(['socket-a', 'view-chat:lobby']));
});

test('view/chat switching preserves an independent voice room', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    socket.data.voiceRoomId = 'lobby';
    await socket.join('lobby');
    await switchRoom(socket, 'game');
    await switchRoom(socket, 'project');

    assert.equal(socket.data.voiceRoomId, 'lobby');
    assert.equal(socket.rooms.has('lobby'), true);
    assert.equal(socket.rooms.has('view-chat:project'), true);
    assert.equal(socket.rooms.has('view-chat:game'), false);
});

test('switching view room removes the old shared cursor', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');
    const oldRoomObserver = hub.createSocket('socket-b');

    await switchRoom(socket, 'lobby');
    await switchRoom(oldRoomObserver, 'lobby');
    await switchRoom(socket, 'game');

    assert.deepEqual(oldRoomObserver.received, [
        {
            event: 'cursor:remove',
            payload: { roomId: 'lobby', socketId: 'socket-a' },
            room: 'view-chat:lobby',
        },
    ]);
});

test('old chat and cursor room events no longer reach a switched socket', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    socket.data.voiceRoomId = 'lobby';
    await socket.join('lobby');
    await switchRoom(socket, 'lobby');
    await switchRoom(socket, 'game');
    socket.received.length = 0;

    assert.equal(socket.rooms.has('lobby'), true);

    hub.emitToRoom(getViewChatSocketRoom('lobby'), 'chat:message', {
        roomId: 'lobby',
    });
    hub.emitToRoom(getViewChatSocketRoom('lobby'), 'cursor:move', {
        roomId: 'lobby',
    });
    assert.deepEqual(socket.received, []);

    hub.emitToRoom(getViewChatSocketRoom('game'), 'chat:message', {
        roomId: 'game',
    });
    assert.equal(socket.received.length, 1);
});

test('owned room resolution rejects stale room payloads without joining them', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    await switchRoom(socket, 'game');

    assert.equal(resolveOwnedViewChatRoom(socket, 'lobby', 'chatRoomId'), null);
    assert.deepEqual(socket.rooms, new Set(['socket-a', 'view-chat:game']));
});

test('disconnect cleanup removes the current cursor before rooms are cleared', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');
    const observer = hub.createSocket('socket-b');

    await switchRoom(socket, 'project');
    await switchRoom(observer, 'project');

    assert.equal(emitViewCursorRemove(socket), true);
    socket.disconnect();

    assert.equal(socket.rooms.size, 0);
    assert.deepEqual(observer.received, [
        {
            event: 'cursor:remove',
            payload: { roomId: 'project', socketId: 'socket-a' },
            room: 'view-chat:project',
        },
    ]);
});

test('invalid channels do not change data or room membership', async () => {
    const hub = new FakeHub();
    const socket = hub.createSocket('socket-a');

    await switchRoom(socket, 'lobby');
    const beforeRooms = new Set(socket.rooms);
    const result = await switchRoom(socket, 'not-a-channel');

    assert.equal(result.valid, false);
    assert.deepEqual(socket.rooms, beforeRooms);
    assert.equal(socket.data.viewRoomId, 'lobby');
    assert.equal(socket.data.chatRoomId, 'lobby');
});

test('server disconnect wiring centralizes cursor voice and presence cleanup', () => {
    const serverSource = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );

    assert.match(
        serverSource,
        /bindSocketDisconnectLifecycle\(socket,[\s\S]*?name: 'cursor-remove'[\s\S]*?handleCursorRemove\(socket\)[\s\S]*?name: 'voice-screen-share-leave'[\s\S]*?handleDisconnectingVoice\(socket\)[\s\S]*?name: 'presence-remove'[\s\S]*?handlePresenceRemove\(socket\)/
    );
    assert.match(
        serverSource,
        /disconnectSteps:[\s\S]*?name: 'clear-socket-owners'[\s\S]*?clearDisconnectedSocketOwners\(socket\)[\s\S]*?name: 'disconnect-log'/
    );
});
