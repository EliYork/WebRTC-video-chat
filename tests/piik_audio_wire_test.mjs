/* eslint-disable no-await-in-loop -- Each client owns an isolated control socket. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {piikClientOverlay} from '../scripts/piik-client-overlay.mjs';

const entry = 'integrations/piik/.deps/upstream/src/client/native/client.ts';
test('pinned native control wire validates independent audio, status identity, errors and legacy compatibility', {skip: !existsSync(entry) && 'Piik upstream must be prepared by build:piik'}, async () => {
    const bundle = await build({entryPoints:[entry],bundle:true,write:false,format:'iife',globalName:'Wire',platform:'browser',define:{'import.meta.env':'{}','import.meta.url':JSON.stringify('http://localhost/fixture.js')},plugins:[piikClientOverlay]});
    for (const independentAudio of [true,false]) {
        const requests=[], sockets=[];
        let failure=false, wrongIdentity=false, malformed=false;
        const health={protocol:10,service:'piik-client',port:39721,instanceToken:'a'.repeat(43),nativeMedia:{video:true,hardwareH264:true,independentAudio,microphone:true}};
        class Socket extends EventTarget {
            static OPEN=1; static CLOSING=2;
            readyState=1; protocol=`piik-client-v10.${health.instanceToken}`;
            constructor(){super();sockets.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
            close(){this.readyState=2;this.dispatchEvent(new Event('close'));}
            send(payload){
                const request=JSON.parse(payload);requests.push(request);
                const fields=request.type==='hello'?{type:'ready'}
                    :failure?{type:'request-failed',code:'operation-failed',reason:'audio-target-invalid'}
                    :request.type==='platform-audio-sources'?{type:request.type,sources:[{pid:42,creationTime:'420',name:'silent.exe',active:false,hasSession:false,icon:''}],systemSafe:true}
                    :request.type==='platform-share-status'?{type:request.type,shareId:wrongIdentity?'other_123456':request.shareId,codec:'h264',hardware:true,state:malformed?'invented':'active',encoder:'Actual MFT',adapter:'Actual GPU',audio:'active'}
                    :{type:'share-started',shareId:request.shareId,audio:request.audio,codec:'h264',sourceAudio:request.audio};
                queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({version:10,id:request.id,...fields})})));
            }
        }
        const context=vm.createContext({WebSocket:Socket,window:{setTimeout,clearTimeout,location:new URL('http://localhost/')},URL,URLSearchParams,performance,crypto,AbortController,AbortSignal,DOMException,Error,
            fetch:async url=>new Response(JSON.stringify(health),{status:url.includes(':39721/')?200:404})});
        vm.runInContext(bundle.outputFiles[0].text,context);
        const client=await context.Wire.NativeClient.connect();assert.ok(client);
        try {
            const input={shareId:'share_123456',source:{kind:'display',sourceId:'7',title:'Screen A'},audio:true,audioMode:'application',audioTarget:{pid:42,creationTime:'420'},microphoneMixing:false,
                adapterIndex:0,encoderIndex:0,edgeCapacity:3,codec:'h264',profile:{resolution:{width:1920,height:1080},maxFramerate:60,maxBitrate:15000000,maxAudioBitrate:128000,degradationPreference:'maintain-resolution'}};
            if (independentAudio) {
                const list=await client.audioSources();assert.equal(list.sources[0].hasSession,false);
                for(const mode of ['none','system','application']) {
                    await client.startShare({...input,audioMode:mode,audio:mode!=='none',audioTarget:mode==='application'?input.audioTarget:undefined});
                    const request=requests.at(-1);assert.equal(request.type,'platform-start-share');assert.equal(request.microphoneMixing,false);assert.equal(request.source.sourceId,'7');
                    if(mode==='application')assert.equal(request.audioTarget.pid,42);else assert.equal('audioTarget' in request,false);
                }
                assert.equal((await client.shareStatus(input.shareId)).encoder,'Actual MFT');
                wrongIdentity=true;await assert.rejects(client.shareStatus(input.shareId),/identity/);wrongIdentity=false;
                malformed=true;await assert.rejects(client.shareStatus(input.shareId),/invalid/);malformed=false;
                failure=true;await assert.rejects(client.startShare(input),error=>error.cause.reason==='audio-target-invalid');failure=false;
                let ended;client.onEvent(event=>{ended=event;});
                sockets[0].dispatchEvent(new MessageEvent('message',{data:JSON.stringify({version:10,type:'share-ended',shareId:input.shareId,failed:true,reason:'encoder-failed'})}));
                assert.equal(ended.reason,'encoder-failed');
            } else {
                const before=requests.length;
                await assert.rejects(client.audioSources(),/升级/);await assert.rejects(client.startShare(input),/升级/);
                assert.equal(await client.shareStatus(input.shareId),null);assert.equal(requests.length,before);
            }
            const legacy={...input};delete legacy.audioMode;delete legacy.audioTarget;
            await client.startShare(legacy);
            const request=requests.at(-1);assert.equal(request.type,'start-share');assert.equal('audioMode' in request,false);assert.equal('audioTarget' in request,false);assert.equal(request.microphoneMixing,false);
        } finally {client.close();}
        assert.equal(sockets[0].readyState,Socket.CLOSING);
    }
});
