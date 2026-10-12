import { sanitizeVoiceDiagnostic } from '../views/js/shared/voice-diagnostic-schema.js';

// On-demand only, no server-side storage; scope is the current voice room.
export const createVoiceDiagnosticsRelay = ({ io, getVoiceOwner, now = Date.now, timeoutMs = 6500 }) => {
    const roomLimits = new Map();
    const ownerMatches = (socket, owner) => {
        const current = getVoiceOwner(socket);
        return current && current.roomId === owner.roomId && current.peerId === owner.peerId &&
            current.voiceSessionGeneration === owner.voiceSessionGeneration;
    };
    return {
        async collect(socket) {
            const owner = getVoiceOwner(socket);
            if (!owner) return { ok: false, reason: 'not-in-voice' };
            const started = now();
            if (roomLimits.has(owner.roomId) && started - roomLimits.get(owner.roomId) < 10000)
                return { ok: false, reason: 'rate-limited' };
            roomLimits.set(owner.roomId, started);
            for (const [room, time] of roomLimits) if (started - time > 60000) roomLimits.delete(room);
            try {
                const members = (await io.in(owner.roomId).fetchSockets()).filter((member) => {
                    const other = getVoiceOwner(member);
                    return member.id !== socket.id && other?.roomId === owner.roomId;
                });
                const results = await Promise.all(members.slice(0, 8).map(async (member, index) => {
                    const other = getVoiceOwner(member);
                    const result = await new Promise((resolve) => {
                        member.timeout(timeoutMs).emit('voice:diagnostics:sample',
                            { voiceSessionGeneration: other.voiceSessionGeneration },
                            (error, reply) => resolve(error ? null : reply));
                    });
                    if (!ownerMatches(member, other))
                        return { 序号: index + 1, 状态: '会话已变化' };
                    if (!result || result.ok !== true || !result.report ||
                        result.voiceSessionGeneration !== other.voiceSessionGeneration)
                        return { 序号: index + 1, 状态: '未响应（旧版本、离线或超时）' };
                    return { 序号: index + 1, 状态: '已采样', 数据: sanitizeVoiceDiagnostic(result.report) };
                }));
                if (!ownerMatches(socket, owner)) return { ok: false, reason: 'session-changed' };
                return { ok: true, requestedAt: new Date(started).toISOString(), results, omitted: Math.max(0, members.length - 8) };
            } catch {
                return { ok: false, reason: 'collection-failed' };
            }
        },
    };
};
