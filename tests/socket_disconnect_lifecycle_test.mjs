import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Socket as SocketIoSocket } from 'socket.io';

import {
    bindSocketDisconnectLifecycle,
    removeOwnedPresenceMember,
} from '../src/utils/SocketDisconnectLifecycle.js';
import {
    emitViewCursorRemove,
    switchViewChatRoom,
} from '../src/utils/ViewChatRoomLifecycle.js';
import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

class FakeIo {
    constructor() {
        this.sockets = [];
    }

    in(roomId) {
        return {
            fetchSockets: async () =>
                this.sockets.filter((socket) => socket.rooms.has(roomId)),
        };
    }
}

class FakeSocket extends EventEmitter {
    constructor(io, id) {
        super();
        this.data = {};
        this.id = id;
        this.io = io;
        this.received = [];
        this.rooms = new Set([id]);
        io?.sockets.push(this);
    }

    async join(roomId) {
        this.rooms.add(roomId);
    }

    async leave(roomId) {
        this.rooms.delete(roomId);
    }

    to(roomId) {
        return {
            emit: (event, payload) => {
                this.io?.sockets
                    .filter(
                        (socket) => socket !== this && socket.rooms.has(roomId)
                    )
                    .forEach((socket) =>
                        socket.received.push({ event, payload })
                    );
            },
        };
    }
}

const createActualSocketIoSocket = () =>
    new SocketIoSocket(
        { adapter: {}, name: '/', server: { _opts: {} } },
        {
            conn: {
                protocol: 4,
                remoteAddress: '127.0.0.1',
                request: { connection: {}, headers: {} },
            },
            id: 'listener-probe',
        },
        {}
    );

const waitForCleanup = async (lifecycle) => {
    await lifecycle.state.disconnectingPromise;
    await lifecycle.state.disconnectPromise;
};

const createSignalingFixture = () => {
    const io = new FakeIo();
    const screenChanges = [];
    const signaling = createVoiceCallSignaling({
        io,
        onScreenShareChange: ({ socket, ...event }) =>
            screenChanges.push({ ...event, socketId: socket.id }),
        resolveRoomId: (roomId) =>
            ['lobby', 'game'].includes(roomId) ? roomId : undefined,
    });
    return { io, screenChanges, signaling };
};

test('one initialization adds exactly one listener for each disconnect phase', () => {
    const socket = createActualSocketIoSocket();

    bindSocketDisconnectLifecycle(socket);

    assert.equal(socket.listenerCount('disconnecting'), 1);
    assert.equal(socket.listenerCount('disconnect'), 1);
    assert.equal(socket.rawListeners('disconnecting').length, 1);
    assert.equal(socket.rawListeners('disconnect').length, 1);
});

test('business operations do not grow disconnect listener counts', async () => {
    const { io, signaling } = createSignalingFixture();
    const socket = new FakeSocket(io, 'operations');
    new FakeSocket(io, 'observer');
    bindSocketDisconnectLifecycle(socket);
    const assertStable = () => {
        assert.equal(socket.listenerCount('disconnecting'), 1);
        assert.equal(socket.listenerCount('disconnect'), 1);
    };

    await switchViewChatRoom(socket, 'lobby');
    assertStable();
    await switchViewChatRoom(socket, 'game');
    assertStable();
    const joined = await signaling.join(
        { peerId: 'operations-peer', roomId: 'game' },
        socket
    );
    assertStable();
    signaling.updateScreenShare(
        {
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        socket
    );
    signaling.updateScreenShare(
        {
            sharing: false,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        socket
    );
    socket.data.presenceRoomId = 'game';
    socket.data.hasMic = true;
    assertStable();
    await signaling.leave(socket, { reason: 'voicePeerLeft' });
    await signaling.join({ peerId: 'operations-peer', roomId: 'game' }, socket);
    assertStable();
});

test('twenty sockets keep isolated guards and identical listener counts', () => {
    const io = new FakeIo();
    const sockets = Array.from({ length: 20 }, (_, index) => {
        const socket = new FakeSocket(io, `socket-${index}`);
        bindSocketDisconnectLifecycle(socket);
        return socket;
    });

    sockets.forEach((socket) => {
        assert.equal(socket.listenerCount('disconnecting'), 1);
        assert.equal(socket.listenerCount('disconnect'), 1);
        assert.equal(socket.data.disconnectCleanupStarted, undefined);
    });
    sockets[0].emit('disconnecting', 'transport close');
    assert.equal(sockets[0].data.disconnectCleanupStarted, true);
    assert.equal(sockets[1].data.disconnectCleanupStarted, undefined);
});

test('repeated helper initialization returns one lifecycle without new listeners', () => {
    const socket = new FakeSocket(undefined, 'duplicate-init');
    const first = bindSocketDisconnectLifecycle(socket);
    const second = bindSocketDisconnectLifecycle(socket);

    assert.equal(first, second);
    assert.equal(socket.listenerCount('disconnecting'), 1);
    assert.equal(socket.listenerCount('disconnect'), 1);
});

test('presence removal mutates its owned map once and duplicate cleanup is silent', () => {
    const socket = new FakeSocket(undefined, 'presence-owner');
    socket.data.presenceRoomId = 'lobby';
    const membersByRoom = new Map([
        ['lobby', new Map([[socket.id, { socketId: socket.id }]])],
    ]);

    assert.equal(removeOwnedPresenceMember(membersByRoom, socket), true);
    assert.equal(removeOwnedPresenceMember(membersByRoom, socket), false);
    assert.equal(membersByRoom.has('lobby'), false);
});

test('disconnecting owns cursor removal and disconnect does not rebroadcast it', async () => {
    const io = new FakeIo();
    const socket = new FakeSocket(io, 'cursor-owner');
    const observer = new FakeSocket(io, 'cursor-observer');
    await switchViewChatRoom(socket, 'lobby');
    await switchViewChatRoom(observer, 'lobby');
    const lifecycle = bindSocketDisconnectLifecycle(socket, {
        disconnectingSteps: [
            { name: 'cursor-remove', run: () => emitViewCursorRemove(socket) },
        ],
        disconnectSteps: [
            {
                name: 'clear-view-owner',
                run: () => {
                    delete socket.data.viewRoomId;
                    delete socket.data.chatRoomId;
                },
            },
        ],
    });

    socket.emit('disconnecting', 'transport close');
    socket.emit('disconnect', 'transport close');
    await waitForCleanup(lifecycle);
    lifecycle.runDisconnecting('duplicate');
    lifecycle.runDisconnect('duplicate');

    assert.deepEqual(
        observer.received.filter(({ event }) => event === 'cursor:remove'),
        [
            {
                event: 'cursor:remove',
                payload: { roomId: 'lobby', socketId: 'cursor-owner' },
            },
        ]
    );
    assert.equal(socket.data.viewRoomId, undefined);
});

test('sharing disconnect broadcasts sharing false and peer leave once', async () => {
    const { io, screenChanges, signaling } = createSignalingFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await signaling.join(
        { peerId: 'observer-peer', roomId: 'lobby' },
        observer
    );
    const joined = await signaling.join(
        { peerId: 'sharer-peer', roomId: 'lobby' },
        sharer
    );
    signaling.updateScreenShare(
        {
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        sharer
    );
    observer.received = [];
    screenChanges.length = 0;
    let presenceRemovals = 0;
    const lifecycle = bindSocketDisconnectLifecycle(sharer, {
        disconnectingSteps: [
            {
                name: 'voice-leave',
                run: () =>
                    signaling.leave(sharer, {
                        reason: 'socket-disconnecting',
                    }),
            },
            {
                name: 'presence-remove',
                run: () => {
                    presenceRemovals += 1;
                },
            },
        ],
        disconnectSteps: [
            {
                name: 'clear-owner',
                run: () => {
                    delete sharer.data.voiceSessionGeneration;
                },
            },
        ],
    });

    sharer.emit('disconnecting', 'transport close');
    sharer.emit('disconnect', 'transport close');
    await waitForCleanup(lifecycle);
    await lifecycle.runDisconnect('duplicate');

    assert.deepEqual(
        observer.received.map(({ event, payload }) => ({ event, payload })),
        [
            {
                event: 'screen:share',
                payload: {
                    peerId: 'sharer-peer',
                    roomId: 'lobby',
                    sharing: false,
                },
            },
            {
                event: 'removeUserVideo',
                payload: { peerId: 'sharer-peer', roomId: 'lobby' },
            },
        ]
    );
    assert.deepEqual(
        screenChanges.map(({ sharing }) => sharing),
        [false]
    );
    assert.equal(presenceRemovals, 1);
    assert.equal(sharer.data.voiceRoomId, undefined);
    assert.equal(sharer.data.disconnectCleanupCompleted, true);
});

test('active voice leave followed by disconnect does not repeat media broadcasts', async () => {
    const { io, signaling } = createSignalingFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await signaling.join(
        { peerId: 'observer-peer', roomId: 'lobby' },
        observer
    );
    const joined = await signaling.join(
        { peerId: 'sharer-peer', roomId: 'lobby' },
        sharer
    );
    signaling.updateScreenShare(
        {
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        sharer
    );
    observer.received = [];
    await signaling.leave(sharer, { reason: 'voicePeerLeft' });
    const lifecycle = bindSocketDisconnectLifecycle(sharer, {
        disconnectingSteps: [
            {
                name: 'voice-leave',
                run: () =>
                    signaling.leave(sharer, {
                        reason: 'socket-disconnecting',
                    }),
            },
        ],
    });

    sharer.emit('disconnecting', 'transport close');
    sharer.emit('disconnect', 'transport close');
    await waitForCleanup(lifecycle);

    assert.equal(
        observer.received.filter(({ event }) => event === 'screen:share')
            .length,
        1
    );
    assert.equal(
        observer.received.filter(({ event }) => event === 'removeUserVideo')
            .length,
        1
    );
});

test('cleanup errors are isolated and logged once while later steps finish', async () => {
    const socket = new FakeSocket(undefined, 'error-isolation');
    const completed = [];
    const errors = [];
    socket.data.voiceRoomId = 'lobby';
    const lifecycle = bindSocketDisconnectLifecycle(socket, {
        disconnectingSteps: [
            {
                name: 'broken-cursor',
                run: () => {
                    throw new Error('cursor failed');
                },
            },
            {
                name: 'voice-owner',
                run: () => completed.push('voice'),
            },
            {
                name: 'presence',
                run: () => completed.push('presence'),
            },
        ],
        disconnectSteps: [
            {
                name: 'clear-owner',
                run: () => {
                    delete socket.data.voiceRoomId;
                    completed.push('owner');
                },
            },
        ],
        onError: ({ error, step }) =>
            errors.push({ message: error.message, step }),
    });

    socket.emit('disconnecting', 'transport error');
    socket.emit('disconnect', 'transport error');
    await waitForCleanup(lifecycle);

    assert.deepEqual(completed, ['voice', 'presence', 'owner']);
    assert.deepEqual(errors, [
        { message: 'cursor failed', step: 'broken-cursor' },
    ]);
    assert.equal(socket.data.voiceRoomId, undefined);
    assert.equal(socket.listenerCount('disconnecting'), 0);
    assert.equal(socket.listenerCount('disconnect'), 0);
});

test('server has one centralized binder and no nested disconnect registration', () => {
    const server = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );
    const lifecycle = readFileSync(
        new URL('../src/utils/SocketDisconnectLifecycle.js', import.meta.url),
        'utf8'
    );
    const voice = readFileSync(
        new URL('../src/utils/VoiceCallSignaling.js', import.meta.url),
        'utf8'
    );
    const viewChat = readFileSync(
        new URL('../src/utils/ViewChatRoomLifecycle.js', import.meta.url),
        'utf8'
    );

    assert.equal(
        (server.match(/bindSocketDisconnectLifecycle\(socket/g) || []).length,
        1
    );
    assert.equal(
        (lifecycle.match(/socket\.on\('disconnecting'/g) || []).length,
        1
    );
    assert.equal(
        (lifecycle.match(/socket\.on\('disconnect'/g) || []).length,
        1
    );
    [server, voice, viewChat].forEach((source) => {
        assert.doesNotMatch(
            source,
            /socket\.(?:on|once)\('disconnect(?:ing)?'/
        );
    });
    [server, lifecycle].forEach((source) => {
        assert.doesNotMatch(
            source,
            /setMaxListeners|defaultMaxListeners|removeAllListeners/
        );
    });
});
