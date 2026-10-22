import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createChatHistoryStore } from '../src/utils/ChatHistoryStore.js';

test('chat history persists across store recreation and enforces its limit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-history-'));
    const filePath = join(directory, 'history.json');
    try {
        const store = createChatHistoryStore({ filePath, limit: 2 });
        store.append({ id: '1', roomId: 'lobby' });
        store.append({ id: '2', roomId: 'lobby' });
        store.append({ id: '3', roomId: 'lobby' });
        assert.equal(await store.persist(), true);

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

test('slow writes are asynchronous and serialize later messages without marking them saved early', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-queue-'));
    const filePath = join(directory, 'history.json');
    let release, writes = 0, active = 0, maxActive = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const store = createChatHistoryStore({filePath, batchMs:60000, fileSystem:{...fileSystem,
        writeFile:async (...args) => {
            writes++; maxActive = Math.max(maxActive, ++active);
            if (writes === 1) await gate;
            try { return await fileSystem.writeFile(...args); } finally { active--; }
        }}});
    try {
        store.append({id:'first',roomId:'lobby'});
        const first = store.persist();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(store.getPersistence('lobby').state, 'pending');
        store.append({id:'second',roomId:'lobby'});
        store.append({id:'other',roomId:'game'});
        const latest = store.persist();
        release(); assert.equal(await first,true); assert.equal(await latest,true);
        assert.equal(writes,2); assert.equal(maxActive,1);
        assert.equal(store.getPersistence('lobby').state,'saved');
        assert.deepEqual(JSON.parse(readFileSync(filePath)).lobby.map(m=>m.id),['first','second']);
        assert.equal(JSON.parse(readFileSync(filePath)).game[0].id,'other');
    } finally { release(); await store.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('failed atomic replacement preserves old history and automatically retries without duplicating messages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-retry-'));
    const filePath = join(directory,'history.json'), changes = [], warnings = [];
    writeFileSync(filePath,JSON.stringify({lobby:[{id:'old',roomId:'lobby'}]}));
    let fail = true, restored;
    const recovered = new Promise(resolve=>{ restored=resolve; });
    const store = createChatHistoryStore({filePath,retryMs:20,batchMs:60000,
        logger:{warn:message=>warnings.push(message)},
        onPersistenceChange:status=>{changes.push(status);if(status.state==='saved')restored();},
        fileSystem:{...fileSystem,rename:async (...args)=>{
            if(fail)throw Object.assign(Error('disk unavailable'),{code:'EACCES'});
            return fileSystem.rename(...args);
        }}});
    let timeout;
    try {
        store.append({id:'new',roomId:'lobby'});
        assert.equal(await store.persist(),false);
        assert.deepEqual(JSON.parse(readFileSync(filePath)).lobby.map(m=>m.id),['old']);
        assert.equal(existsSync(`${filePath}.${process.pid}.tmp`),false);
        assert.equal(store.getPersistence('lobby').state,'failed');
        assert.equal(await store.persist(),false); assert.equal(warnings.length,1);
        store.append({id:'latest',roomId:'lobby'});
        assert.equal(store.getPersistence('lobby').state,'failed');
        fail=false;
        await Promise.race([recovered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('retry timed out')),2000);})]);
        assert.deepEqual(JSON.parse(readFileSync(filePath)).lobby.map(m=>m.id),['old','new','latest']);
        assert.deepEqual(changes.map(s=>s.state),['pending','failed','saved']);
        assert.ok(changes[2].revision > changes[1].revision);
    } finally { clearTimeout(timeout); fail=false; await store.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('messages arriving during a slow failed write respect retry backoff and close still flushes them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-slow-failure-'));
    const filePath = join(directory, 'history.json');
    writeFileSync(filePath, JSON.stringify({ lobby: [{ id: 'old', roomId: 'lobby' }] }));
    let release, attempts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const store = createChatHistoryStore({ filePath, batchMs: 5, retryMs: 1000,
        fileSystem: { ...fileSystem,
            mkdir: async (...args) => {
                attempts++;
                if (attempts === 1) {
                    await gate;
                    throw Object.assign(Error('slow storage failure'), { code: 'EACCES' });
                }
                return fileSystem.mkdir(...args);
            },
        },
    });
    try {
        store.append({ id: 'first', roomId: 'lobby' });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(attempts, 1, 'automatic first batch has started and remains gated');
        store.append({ id: 'second', roomId: 'lobby' });
        store.append({ id: 'other', roomId: 'game' });
        await new Promise(resolve => setTimeout(resolve, 20));
        release();
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.equal(attempts, 1, 'an overlapping batch timer must not immediately retry the failed write');
        assert.equal(store.getPersistence('lobby').state, 'failed');
        assert.equal(store.getPersistence('game').state, 'failed');
        assert.deepEqual(JSON.parse(readFileSync(filePath)).lobby.map(message => message.id), ['old']);
        // Shutdown explicitly drains newer versions without waiting for backoff.
        assert.equal(await store.close(), true);
        assert.equal(attempts, 2);
        const saved = JSON.parse(readFileSync(filePath));
        assert.deepEqual(saved.lobby.map(message => message.id), ['old', 'first', 'second']);
        assert.deepEqual(saved.game.map(message => message.id), ['other']);
        assert.equal(store.getPersistence('lobby').state, 'saved');
        assert.equal(store.getPersistence('game').state, 'saved');
    } finally {
        release(); await store.close(); rmSync(directory, { recursive: true, force: true });
    }
});

test('close flushes queued messages; disabled storage never claims a persistent save', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'webrtc-chat-close-'));
    try {
        const filePath=join(directory,'history.json');
        const store=createChatHistoryStore({filePath,batchMs:60000,onPersistenceChange:()=>{throw Error('UI disconnected');}});
        store.append({id:'last',roomId:'lobby'});
        assert.equal(await store.close(),true);
        assert.equal(JSON.parse(readFileSync(filePath)).lobby[0].id,'last');
        assert.throws(()=>store.append({id:'late',roomId:'lobby'}),/closed/);
        const disabled=createChatHistoryStore();
        disabled.append({id:'temporary',roomId:'lobby'});
        assert.equal(disabled.getPersistence('lobby').state,'disabled');
        assert.equal(await disabled.close(),false);
    } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('corrupt history is ignored without preventing future persistence', async () => {
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
        assert.equal(await store.close(), true);
        assert.equal(warnings.length, 1);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
