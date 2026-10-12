import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

for (const phase of ['queued', 'discovery', 'joining']) {
    test(`disconnect during ${phase} cannot resurrect voice ownership`, async () => {
        const events = [];
        const socket = {
            id: 'disconnected-peer',
            data: {},
            rooms: new Set(),
            disconnected: phase === 'queued',
            async join(room) {
                this.rooms.add(room);
                if (phase === 'joining') this.disconnected = true;
            },
            async leave(room) {
                this.rooms.delete(room);
            },
            emit: (...args) => events.push(args),
            to: () => ({ emit: (...args) => events.push(args) }),
        };
        const signaling = createVoiceCallSignaling({
            resolveRoomId: (room) => (room === 'lobby' ? room : undefined),
            io: {
                in: () => ({
                    async fetchSockets() {
                        if (phase === 'discovery') socket.disconnected = true;
                        return [];
                    },
                }),
            },
        });
        const result = await signaling.join(
            { roomId: 'lobby', peerId: 'peer-a' },
            socket
        );
        assert.equal(result.ok, false);
        assert.equal(socket.data.voiceRoomId, undefined);
        assert.equal(socket.data.voicePeerId, undefined);
        assert.equal(socket.rooms.size, 0);
        assert.equal(events.length, 0);
    });
}
