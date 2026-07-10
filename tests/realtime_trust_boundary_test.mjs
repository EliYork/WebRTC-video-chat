import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

class FakeSocket {
    constructor(io, id) {
        this.data = {};
        this.emitted = [];
        this.id = id;
        this.io = io;
        this.rooms = new Set([id]);
        io.sockets.push(this);
    }

    async join(roomId) {
        this.rooms.add(roomId);
    }

    async leave(roomId) {
        this.rooms.delete(roomId);
    }

    emit(event, payload) {
        this.emitted.push({ event, payload });
    }

    to(roomId) {
        return {
            emit: (event, payload) => {
                this.io.sockets
                    .filter(
                        (socket) => socket !== this && socket.rooms.has(roomId)
                    )
                    .forEach((socket) => socket.emit(event, payload));
            },
        };
    }
}

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

const createFixture = () => {
    const io = new FakeIo();
    const screenChanges = [];
    const signaling = createVoiceCallSignaling({
        io,
        onScreenShareChange: ({ socket, ...event }) =>
            screenChanges.push({ ...event, socketId: socket.id }),
        resolveRoomId: (roomId) =>
            ['lobby', 'game', 'project'].includes(roomId) ? roomId : undefined,
    });
    return { io, screenChanges, signaling };
};

const getEvents = (socket, event) =>
    socket.emitted.filter((entry) => entry.event === event);

const clearEvents = (...sockets) =>
    sockets.forEach((socket) => {
        socket.emitted = [];
    });

const join = (signaling, socket, roomId, peerId) =>
    signaling.join({ peerId, roomId }, socket);

test('legal screen-share broadcasts canonical owner identity and boolean state', async () => {
    const { io, screenChanges, signaling } = createFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, observer, 'lobby', 'peer-observer');
    const joined = await join(signaling, sharer, 'lobby', 'peer-a');
    clearEvents(observer, sharer);

    const result = signaling.updateScreenShare(
        {
            peerId: 'victim-peer',
            roomId: 'project',
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        sharer
    );

    assert.deepEqual(result, { ok: true, sharing: true });
    assert.deepEqual(getEvents(observer, 'screen:share'), [
        {
            event: 'screen:share',
            payload: { peerId: 'peer-a', roomId: 'lobby', sharing: true },
        },
    ]);
    assert.deepEqual(screenChanges, [
        {
            peerId: 'peer-a',
            roomId: 'lobby',
            sharing: true,
            socketId: 'sharer',
        },
    ]);
    assert.equal(sharer.data.voiceScreenSharing, true);
});

test('cross-room and peer spoof fields cannot select broadcast target or identity', async () => {
    const { io, signaling } = createFixture();
    const lobbyObserver = new FakeSocket(io, 'lobby-observer');
    const projectObserver = new FakeSocket(io, 'project-observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, lobbyObserver, 'lobby', 'lobby-peer');
    await join(signaling, projectObserver, 'project', 'project-peer');
    const joined = await join(signaling, sharer, 'lobby', 'peer-a');
    clearEvents(lobbyObserver, projectObserver, sharer);

    signaling.updateScreenShare(
        {
            peerId: 'project-peer',
            roomId: 'project',
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        sharer
    );

    assert.equal(getEvents(projectObserver, 'screen:share').length, 0);
    assert.deepEqual(getEvents(lobbyObserver, 'screen:share')[0].payload, {
        peerId: 'peer-a',
        roomId: 'lobby',
        sharing: true,
    });
});

test('unjoined sockets and sockets outside their owned room cannot share', async () => {
    const { io, screenChanges, signaling } = createFixture();
    const observer = new FakeSocket(io, 'observer');
    const outsider = new FakeSocket(io, 'outsider');
    await join(signaling, observer, 'lobby', 'observer-peer');
    clearEvents(observer);

    assert.deepEqual(
        signaling.updateScreenShare(
            { sharing: true, voiceSessionGeneration: 1 },
            outsider
        ),
        { ok: false, reason: 'voice-owner-missing' }
    );

    const joined = await join(signaling, outsider, 'lobby', 'peer-a');
    outsider.rooms.delete('lobby');
    assert.deepEqual(
        signaling.updateScreenShare(
            {
                sharing: true,
                voiceSessionGeneration: joined.voiceSessionGeneration,
            },
            outsider
        ),
        { ok: false, reason: 'voice-owner-missing' }
    );
    assert.equal(getEvents(observer, 'screen:share').length, 0);
    assert.equal(screenChanges.length, 0);
});

test('invalid sharing types and stale session generations are rejected', async () => {
    const { io, screenChanges, signaling } = createFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, observer, 'lobby', 'observer-peer');
    const joined = await join(signaling, sharer, 'lobby', 'peer-a');
    clearEvents(observer, sharer);

    ['true', 1, null, {}, []].forEach((sharing) => {
        assert.deepEqual(
            signaling.updateScreenShare(
                {
                    sharing,
                    voiceSessionGeneration: joined.voiceSessionGeneration,
                },
                sharer
            ),
            { ok: false, reason: 'invalid-screen-share-state' }
        );
    });
    assert.deepEqual(
        signaling.updateScreenShare(
            {
                sharing: true,
                voiceSessionGeneration: joined.voiceSessionGeneration + 1,
            },
            sharer
        ),
        { ok: false, reason: 'invalid-screen-share-state' }
    );
    assert.equal(getEvents(observer, 'screen:share').length, 0);
    assert.equal(screenChanges.length, 0);
});

test('true false transitions broadcast once and duplicate states are idempotent', async () => {
    const { io, screenChanges, signaling } = createFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, observer, 'lobby', 'observer-peer');
    const joined = await join(signaling, sharer, 'lobby', 'peer-a');
    clearEvents(observer, sharer);
    const payload = {
        sharing: true,
        voiceSessionGeneration: joined.voiceSessionGeneration,
    };

    assert.deepEqual(signaling.updateScreenShare(payload, sharer), {
        ok: true,
        sharing: true,
    });
    assert.deepEqual(signaling.updateScreenShare(payload, sharer), {
        duplicate: true,
        ok: true,
        sharing: true,
    });
    assert.deepEqual(
        signaling.updateScreenShare({ ...payload, sharing: false }, sharer),
        { ok: true, sharing: false }
    );
    assert.deepEqual(
        signaling.updateScreenShare({ ...payload, sharing: false }, sharer),
        { duplicate: true, ok: true, sharing: false }
    );

    assert.deepEqual(
        getEvents(observer, 'screen:share').map(
            ({ payload: event }) => event.sharing
        ),
        [true, false]
    );
    assert.deepEqual(
        screenChanges.map(({ sharing }) => sharing),
        [true, false]
    );
});

test('active leave clears sharing before peer removal and disconnect is duplicate', async () => {
    const { io, screenChanges, signaling } = createFixture();
    const observer = new FakeSocket(io, 'observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, observer, 'lobby', 'observer-peer');
    const joined = await join(signaling, sharer, 'lobby', 'peer-a');
    signaling.updateScreenShare(
        {
            sharing: true,
            voiceSessionGeneration: joined.voiceSessionGeneration,
        },
        sharer
    );
    clearEvents(observer, sharer);

    const leave = await signaling.leave(sharer, { reason: 'voicePeerLeft' });
    const disconnect = await signaling.leave(sharer, {
        reason: 'socket-disconnect',
    });

    assert.deepEqual(
        observer.emitted.map(({ event, payload }) => ({ event, payload })),
        [
            {
                event: 'screen:share',
                payload: {
                    peerId: 'peer-a',
                    roomId: 'lobby',
                    sharing: false,
                },
            },
            {
                event: 'removeUserVideo',
                payload: { peerId: 'peer-a', roomId: 'lobby' },
            },
        ]
    );
    assert.equal(leave.ok, true);
    assert.deepEqual(disconnect, { duplicate: true, ok: true });
    assert.deepEqual(
        screenChanges.map(({ sharing }) => sharing),
        [true, false]
    );
    assert.equal(sharer.data.voiceScreenSharing, undefined);
});

test('rejoin gets a new session and late old events cannot modify the new room', async () => {
    const { io, signaling } = createFixture();
    const lobbyObserver = new FakeSocket(io, 'lobby-observer');
    const gameObserver = new FakeSocket(io, 'game-observer');
    const sharer = new FakeSocket(io, 'sharer');
    await join(signaling, lobbyObserver, 'lobby', 'lobby-peer');
    await join(signaling, gameObserver, 'game', 'game-peer');
    const oldSession = await join(signaling, sharer, 'lobby', 'peer-a');
    signaling.updateScreenShare(
        {
            sharing: true,
            voiceSessionGeneration: oldSession.voiceSessionGeneration,
        },
        sharer
    );
    await signaling.leave(sharer, { reason: 'voicePeerLeft' });
    const newSession = await join(signaling, sharer, 'game', 'peer-b');
    clearEvents(lobbyObserver, gameObserver, sharer);

    assert.equal(
        newSession.voiceSessionGeneration,
        oldSession.voiceSessionGeneration + 1
    );
    assert.equal(sharer.data.voiceScreenSharing, false);
    assert.deepEqual(
        signaling.updateScreenShare(
            {
                sharing: false,
                voiceSessionGeneration: oldSession.voiceSessionGeneration,
            },
            sharer
        ),
        { ok: false, reason: 'invalid-screen-share-state' }
    );
    assert.deepEqual(
        signaling.updateScreenShare(
            {
                sharing: true,
                voiceSessionGeneration: newSession.voiceSessionGeneration,
            },
            sharer
        ),
        { ok: true, sharing: true }
    );
    assert.equal(getEvents(lobbyObserver, 'screen:share').length, 0);
    assert.deepEqual(getEvents(gameObserver, 'screen:share')[0].payload, {
        peerId: 'peer-b',
        roomId: 'game',
        sharing: true,
    });
});

test('duplicate peer identity in one voice room is rejected', async () => {
    const { io, signaling } = createFixture();
    const original = new FakeSocket(io, 'original');
    const impersonator = new FakeSocket(io, 'impersonator');
    await join(signaling, original, 'lobby', 'peer-a');

    assert.deepEqual(await join(signaling, impersonator, 'lobby', 'peer-a'), {
        ok: false,
        reason: 'voice-peer-id-in-use',
    });
    assert.equal(impersonator.rooms.has('lobby'), false);
    assert.deepEqual(impersonator.data, {});
});

test('screen-share protocol contract removes legacy events and client identity fields', () => {
    const serverSource = readFileSync(
        new URL('../src/server.js', import.meta.url),
        'utf8'
    );
    const signalingSource = readFileSync(
        new URL('../src/utils/VoiceCallSignaling.js', import.meta.url),
        'utf8'
    );
    const scriptSource = readFileSync(
        new URL('../src/views/script.js', import.meta.url),
        'utf8'
    );

    [serverSource, signalingSource, scriptSource].forEach((source) => {
        assert.doesNotMatch(source, /screen:shareStart|screen:shareStop/);
    });
    assert.match(serverSource, /socket\.on\('screen:share'/);
    assert.doesNotMatch(serverSource, /Boolean\(screenSharing\)/);
    assert.equal(
        serverSource.match(
            /screenSharing: socket\.data\.voiceScreenSharing === true/g
        )?.length,
        2
    );
    assert.match(signalingSource, /socket\.to\(owner\.roomId\)/);
    assert.match(
        scriptSource,
        /emit\('screen:share', \{\s*sharing,\s*voiceSessionGeneration,?\s*\}\)/
    );
    assert.doesNotMatch(
        scriptSource,
        /emit\('screen:share', \{[^}]*roomId|emit\('screen:share', \{[^}]*peerId/
    );
});
