/* eslint-disable no-await-in-loop -- One isolated server lifecycle and bounded network waits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

function socketClient(url) {
    const socket = new WebSocket(url), frames = [], waiters = new Set();
    let fault;
    const receive = raw => {
        if (raw === '2') { socket.send('3'); return; }
        frames.push(raw);
        for (const resolve of waiters) resolve();
    };
    socket.on('message', value => receive(value.toString()));
    socket.on('error', error => { fault = error; for (const resolve of waiters) resolve(); });
    const wait = async (predicate, after = 0) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            if (fault) throw fault;
            const match = frames.slice(after).find(predicate);
            if (match) return match;
            await new Promise(resolve => {
                const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve(); };
                const timer = setTimeout(wake, 50); waiters.add(wake);
            });
        }
        throw Error('Socket event timeout: ' + frames.slice(-5).join('\n'));
    };
    const events = () => frames.filter(raw => raw.startsWith('42')).map(raw => JSON.parse(raw.slice(2)));
    return {socket, frames, wait, events,
        async connect() { await wait(raw=>raw.startsWith('0')); socket.send('40'); await wait(raw=>raw.startsWith('40')); },
        async join(roomId) {
            const after=frames.length;
            socket.send('42'+JSON.stringify(['chat:join',{roomId}]));
            const raw=await wait(raw=>raw.startsWith('42') && JSON.parse(raw.slice(2))[0]==='chat:history',after);
            return JSON.parse(raw.slice(2));
        },
        async send(id,roomId,content) {
            socket.send('42'+id+JSON.stringify(['chat:send',{roomId,content,senderName:'Storage test'}]));
            return JSON.parse((await wait(raw=>raw.startsWith('43'+id+'['))).slice(('43'+id).length))[0];
        },
        async state(roomId,state) {
            const raw=await wait(raw=>raw.startsWith('42') && (()=>{
                const event=JSON.parse(raw.slice(2));
                return event[0]==='chat:persistence' && event[1].roomId===roomId && event[1].state===state;
            })());
            return JSON.parse(raw.slice(2))[1];
        },
    };
}

test('real chat broadcasts once, isolates save failures, retries, survives restart and flushes on SIGTERM', {timeout:25000}, async () => {
    const directory=mkdtempSync(join(tmpdir(),'voice-chat-persistence-'));
    const blocker=join(directory,'storage'), filePath=join(blocker,'history.json');
    writeFileSync(blocker,'temporary storage fault');
    let child, output=''; const clients=[];
    const stop = async () => {
        if(!child || child.exitCode!==null)return;
        const exiting=once(child,'exit'); child.send('shutdown');
        const [code]=await exiting; assert.equal(code,0,output);
    };
    try {
        // Use one reserved local port for each sequential isolated server run.
        const {createServer}=await import('node:net');
        const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');
        const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
        const run=async()=>{
            await startWithPort(port);
            let ready=false;
            for(let i=0;i<100;i++){
                if(child.exitCode!==null)throw Error(output);
                try{ready=(await fetch(`http://127.0.0.1:${port}/room/lobby`)).ok;}catch{ /* Listener may still be binding. */ }
                if(ready)break; await new Promise(resolve=>setTimeout(resolve,30));
            }
            assert.ok(ready,output);
        };
        async function startWithPort(port) {
            output='';
            child=spawn(process.execPath,['--input-type=module','-e',
                "await import(process.env.WEBRTC_TEST_SERVER); process.on('message', value => { if(value === 'shutdown') process.emit('SIGTERM'); });"],{
                cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
                env:{...process.env,WEBRTC_TEST_SERVER:new URL('../src/server.js',import.meta.url).href,
                    HOST:'127.0.0.1',PORT:String(port),USE_HTTPS:'false',ENV:'production',SFU_ENABLED:'false',PIIK_ENABLED:'false',CHAT_HISTORY_FILE:filePath},
            });
            child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
        }
        const client=async()=>{const c=socketClient(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);clients.push(c);await c.connect();return c;};
        await run();
        const a=await client(),b=await client(),other=await client();
        await a.join('lobby');await b.join('lobby');await other.join('game');
        const ack=await a.send(10,'lobby','accepted once');
        assert.equal(ack.ok,true);assert.equal(ack.persistence.state,'pending');
        await Promise.all([a.state('lobby','failed'),b.state('lobby','failed')]);
        const wrong=await other.send(11,'lobby','forbidden');assert.equal(wrong.ok,false);
        const game=await other.send(12,'game','separate room');assert.equal(game.ok,true);
        await other.state('game','failed');
        const late=await client(),history=await late.join('lobby');
        assert.equal(history[2].persistence.state,'failed');assert.equal(history[1][0].id,ack.messageId);
        unlinkSync(blocker);mkdirSync(blocker);
        await Promise.all([a.state('lobby','saved'),b.state('lobby','saved'),other.state('game','saved')]);
        for(const c of [a,b]){
            assert.equal(c.events().filter(([event,msg])=>event==='chat:message' && msg.id===ack.messageId).length,1);
            assert.equal(c.events().some(([event,msg])=>event==='chat:persistence' && msg.roomId==='game'),false);
        }
        assert.equal(other.events().some(([event,msg])=>['chat:persistence','chat:message'].includes(event) && msg.roomId==='lobby'),false);
        assert.equal(JSON.parse(readFileSync(filePath)).lobby.length,1);
        await stop();
        await run();
        const restored=await client(),restoredHistory=await restored.join('lobby');
        assert.equal(restoredHistory[1].length,1);assert.equal(restoredHistory[1][0].id,ack.messageId);
        assert.equal(restoredHistory[2].persistence.state,'saved');
        const final=await restored.send(13,'lobby','queued before shutdown');assert.equal(final.ok,true);
        await stop();
        assert.deepEqual(JSON.parse(readFileSync(filePath)).lobby.map(m=>m.id),[ack.messageId,final.messageId]);
    } finally {
        clients.forEach(c=>c.socket.terminate());
        if(child && child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
        rmSync(directory,{recursive:true,force:true});
    }
});
