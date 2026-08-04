import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createChatHistoryStore } from '../src/utils/ChatHistoryStore.js';

test('chat history persists across store recreation and enforces its limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-history-'));
    const filePath = join(directory, 'history.json');
    try {
        const store = createChatHistoryStore({ filePath, limit: 2 });
        store.append({ id: '1', roomId: 'lobby' });
        store.append({ id: '2', roomId: 'lobby' });
        store.append({ id: '3', roomId: 'lobby' });

        assert.deepEqual(
            createChatHistoryStore({ filePath, limit: 2 })
                .get('lobby')
                .map(({ id }) => id),
            ['2', '3']
        );
        assert.equal(JSON.parse(readFileSync(filePath)).lobby.length, 2);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('corrupt history is ignored without preventing future persistence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-history-'));
    const filePath = join(directory, 'history.json');
    try {
        writeFileSync(filePath, '{invalid');
        const warnings = [];
        const store = createChatHistoryStore({
            filePath,
            logger: { warn: (...args) => warnings.push(args) },
        });
        assert.deepEqual(store.get('lobby'), []);
        store.append({ id: '1', roomId: 'lobby' });
        assert.equal(warnings.length, 1);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
