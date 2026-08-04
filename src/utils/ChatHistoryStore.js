import fs from 'node:fs';
import path from 'node:path';

export const createChatHistoryStore = ({
    filePath,
    limit = 50,
    logger,
} = {}) => {
    const histories = new Map();

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
            logger?.warn?.('[chat-history] could not load history', error);
        }
    };

    const persist = () => {
        if (!filePath) {
            return false;
        }
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const temporaryPath = `${filePath}.${process.pid}.tmp`;
            fs.writeFileSync(
                temporaryPath,
                JSON.stringify(Object.fromEntries(histories), null, 2),
                { mode: 0o600 }
            );
            fs.renameSync(temporaryPath, filePath);
            return true;
        } catch (error) {
            logger?.warn?.('[chat-history] could not persist history', error);
            return false;
        }
    };

    const append = (message) => {
        const history = histories.get(message.roomId) || [];
        history.push(message);
        histories.set(message.roomId, history.slice(-limit));
        persist();
        return message;
    };

    load();
    return {
        append,
        get: (roomId) => [...(histories.get(roomId) || [])],
        persist,
    };
};
