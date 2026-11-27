const sameOwner = (left, right) =>
    right && left.roomId === right.roomId && left.peerId === right.peerId &&
    left.voiceSessionGeneration === right.voiceSessionGeneration;

export function createPresenceUpdateLimiter({ getOwner, apply, intervalMs = 250 }) {
    const entries = new WeakMap();
    const clear = (socket) => {
        clearTimeout(entries.get(socket)?.timer);
        entries.delete(socket);
    };
    const schedule = (socket, entry) => {
        entry.timer = setTimeout(() => {
            if (entries.get(socket) !== entry) return;
            if (!entry.pending || !sameOwner(entry.owner, getOwner(socket))) return clear(socket);
            const payload = entry.pending;
            entry.pending = null;
            schedule(socket, entry);
            apply(payload, socket);
        }, intervalMs);
        entry.timer.unref();
    };
    return {
        clear,
        discard(socket) {
            const entry = entries.get(socket);
            if (entry) entry.pending = null;
        },
        submit(socket, payload) {
            const owner = getOwner(socket);
            if (!owner) return clear(socket);
            const entry = entries.get(socket);
            if (entry && sameOwner(entry.owner, owner)) {
                // Updates may omit fields. Keep the latest value of each field.
                entry.pending = { ...entry.pending, ...payload };
                return;
            }
            clear(socket);
            const next = { owner: { ...owner }, pending: null };
            entries.set(socket, next);
            schedule(socket, next);
            apply(payload, socket);
        },
    };
}
