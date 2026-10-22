import fs from 'node:fs';
import path from 'node:path';

export const createChatHistoryStore = ({
    filePath,
    limit = 50,
    logger,
    onPersistenceChange = () => {},
    fileSystem = fs.promises,
    batchMs = 40,
    retryMs = 2000,
} = {}) => {
    const histories = new Map();
    const roomVersions = new Map();
    const persistence = new Map();
    let version = 0, savedVersion = 0, stateRevision = 0;
    let writing = null, writingVersion = 0, timer = null, closed = false;
    let retryDelay = retryMs, writeFailed = false;
    const warn = message => { try { logger?.warn?.(message); } catch { /* Disk failures must stay nonfatal. */ } };
    const getPersistence = roomId => ({ ...(persistence.get(roomId) || {
        state: filePath ? 'saved' : 'disabled', revision: 0,
    }) });
    const setPersistence = (roomId, state) => {
        if (getPersistence(roomId).state === state) return;
        const status = { state, revision: ++stateRevision };
        persistence.set(roomId, status);
        try { onPersistenceChange({ roomId, ...status }); }
        catch { warn('[chat-history] persistence notification failed'); }
    };

    const load = () => {
        if (!filePath || !fs.existsSync(filePath)) {
            return;
        }
        try {
            const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            Object.entries(stored || {}).forEach(([roomId, messages]) => {
                if (Array.isArray(messages)) {
                    histories.set(roomId, messages.slice(-limit));
                }
            });
        } catch (error) {
            warn(`[chat-history] could not load history (${error.code || error.name})`);
        }
    };

    const schedule = delay => {
        // The active writer schedules its next batch or failure backoff. An
        // overlapping batch timer would queue persist() and bypass that delay.
        if (closed || timer || writing || !filePath) return;
        timer = setTimeout(() => { timer = null; void persist(); }, delay);
        timer.unref?.();
    };
    const persist = () => {
        if (!filePath) return Promise.resolve(false);
        const requestedVersion = version;
        if (writing) {
            const activeVersion = writingVersion;
            return writing.then(result => savedVersion >= requestedVersion ? true
                : activeVersion >= requestedVersion ? result : persist());
        }
        clearTimeout(timer); timer = null;
        if (savedVersion >= requestedVersion) return Promise.resolve(true);
        writingVersion = requestedVersion;
        const snapshot = JSON.stringify(Object.fromEntries(histories), null, 2);
        const snapshotRooms = new Map(roomVersions);
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        writing = (async () => {
            try {
                await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
                await fileSystem.writeFile(temporaryPath, snapshot, { mode: 0o600 });
                await fileSystem.rename(temporaryPath, filePath);
                savedVersion = requestedVersion;
                retryDelay = retryMs; writeFailed = false;
                snapshotRooms.forEach((roomVersion, roomId) => {
                    if (roomVersions.get(roomId) === roomVersion) setPersistence(roomId, 'saved');
                });
                return true;
            } catch (error) {
                if (!writeFailed) warn(`[chat-history] could not persist history (${error.code || error.name}); retrying`);
                writeFailed = true;
                roomVersions.forEach((roomVersion, roomId) => {
                    if (roomVersion > savedVersion) setPersistence(roomId, 'failed');
                });
                try { await fileSystem.unlink(temporaryPath); } catch { /* Preserve the previous history file. */ }
                return false;
            }
        })().finally(() => {
            writing = null;
            if (savedVersion < version) {
                schedule(writeFailed ? retryDelay : batchMs);
                if (writeFailed) retryDelay = Math.min(60000, retryDelay * 2);
            }
        });
        return writing;
    };

    const append = (message) => {
        if (closed) throw new Error('Chat history store is closed');
        const history = histories.get(message.roomId) || [];
        history.push(message);
        histories.set(message.roomId, history.slice(-limit));
        roomVersions.set(message.roomId, ++version);
        // Keep an existing failure visible while new messages are queued.
        if (getPersistence(message.roomId).state !== 'failed')
            setPersistence(message.roomId, filePath ? 'pending' : 'disabled');
        schedule(batchMs);
        return message;
    };

    load();
    return {
        append,
        get: (roomId) => [...(histories.get(roomId) || [])],
        persist,
        getPersistence,
        close: async () => {
            closed = true;
            clearTimeout(timer); timer = null;
            return persist();
        },
    };
};
