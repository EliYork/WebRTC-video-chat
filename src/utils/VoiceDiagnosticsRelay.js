import { sanitizeVoiceDiagnostic } from '../views/js/shared/voice-diagnostic-schema.js';

// Short-lived memory only. A checkpoint is visible only to voice sessions that
// were already in the same room when it was captured, never to later joiners.
export const createVoiceDiagnosticsRelay = ({ io, getVoiceOwner, getMembers = () => [...(io.sockets?.sockets?.values() || [])], now = Date.now, timeoutMs = 6500 }) => {
    const roomLimits = new Map();
    const checkpoints = new Map();
    const identity = (socket, owner) => JSON.stringify([socket.id, owner.voiceSessionGeneration, owner.peerId]);
    const prune = () => {
        for (const [key, row] of checkpoints) if (now() - row.time > 120000) checkpoints.delete(key);
    };
    const ownerMatches = (socket, owner) => {
        const current = getVoiceOwner(socket);
        return current && current.roomId === owner.roomId && current.peerId === owner.peerId &&
            current.voiceSessionGeneration === owner.voiceSessionGeneration;
    };
    return {
        checkpoint(socket, payload) {
            const owner = getVoiceOwner(socket);
            if (!owner || payload?.voiceSessionGeneration !== owner.voiceSessionGeneration || !payload.report) return false;
            prune();
            const key = identity(socket, owner);
            const previous = checkpoints.get(key);
            if (previous && now() - previous.time < (payload.critical === true ? 500 : 5000)) return false;
            const report = sanitizeVoiceDiagnostic(payload.report);
            if (Buffer.byteLength(JSON.stringify(report)) > 128 * 1024) return false;
            const audience = new Set(getMembers().filter((member) => getVoiceOwner(member)?.roomId === owner.roomId)
                .slice(0, 64).map((member) => identity(member, getVoiceOwner(member))));
            checkpoints.delete(key);
            checkpoints.set(key, { owner: { ...owner }, socketId: socket.id, time: now(), report, audience });
            while (checkpoints.size > 64) checkpoints.delete(checkpoints.keys().next().value);
            return true;
        },
        async collect(socket) {
            const owner = getVoiceOwner(socket);
            if (!owner) return { ok: false, reason: 'not-in-voice' };
            const started = now();
            prune();
            if (roomLimits.has(owner.roomId) && started - roomLimits.get(owner.roomId) < 10000)
                return { ok: false, reason: 'rate-limited' };
            roomLimits.set(owner.roomId, started);
            for (const [room, time] of roomLimits) if (started - time > 60000) roomLimits.delete(room);
            try {
                const members = (await io.in(owner.roomId).fetchSockets()).filter((member) => {
                    const other = getVoiceOwner(member);
                    return member.id !== socket.id && other?.roomId === owner.roomId;
                });
                const requester = identity(socket, owner);
                const cached = [...checkpoints.values()].filter((row) => row.owner.roomId === owner.roomId &&
                    row.socketId !== socket.id && row.audience.has(requester)).sort((a, b) => b.time - a.time);
                const cachedResult = (row, index, status) => ({ 序号: index + 1, 状态: status,
                    缓存时间: new Date(row.time).toISOString(), 缓存年龄_ms: Math.max(0, now() - row.time), 数据: row.report });
                const results = await Promise.all(members.slice(0, 8).map(async (member, index) => {
                    const other = getVoiceOwner(member);
                    const result = await new Promise((resolve) => {
                        member.timeout(timeoutMs).emit('voice:diagnostics:sample',
                            { voiceSessionGeneration: other.voiceSessionGeneration },
                            (error, reply) => resolve(error ? null : reply));
                    });
                    const backup = cached.find((row) => row.socketId === member.id && identity(member, row.owner) === identity(member, other));
                    if (!ownerMatches(member, other))
                        return backup ? cachedResult(backup, index, '近期缓存（会话已变化）') : { 序号: index + 1, 状态: '会话已变化' };
                    if (!result || result.ok !== true || !result.report ||
                        result.voiceSessionGeneration !== other.voiceSessionGeneration)
                        return backup ? cachedResult(backup, index, '近期缓存（对端未响应）') : { 序号: index + 1, 状态: '未响应（旧版本、离线或超时）' };
                    return { 序号: index + 1, 状态: '已采样', 数据: sanitizeVoiceDiagnostic(result.report) };
                }));
                if (!ownerMatches(socket, owner)) return { ok: false, reason: 'session-changed' };
                const departed = cached.filter((row) => !members.some((member) => {
                    const active = getVoiceOwner(member);
                    return active && identity(member, active) === JSON.stringify([row.socketId, row.owner.voiceSessionGeneration, row.owner.peerId]);
                }));
                const remaining = Math.max(0, 8 - results.length);
                departed.slice(0, remaining).forEach((row) => results.push(cachedResult(row, results.length, '近期缓存（对端已离开）')));
                return { ok: true, requestedAt: new Date(started).toISOString(), results,
                    omitted: Math.max(0, members.length - 8) + Math.max(0, departed.length - remaining) };
            } catch {
                return { ok: false, reason: 'collection-failed' };
            }
        },
    };
};
