// Exercise only an owned, silent Node process through Windows application
// loopback. Never capture the system endpoint, desktop or user's applications.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const helper=resolve(process.env.PIIK_AUDIO_TEST_HELPER || 'integrations/piik/.deps/upstream/build/platform-share-check/piik-capture.exe');
const directory=resolve('integrations/piik/artifacts/independent-audio');mkdirSync(directory,{recursive:true});
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
let capture;
try {
    const created=execFileSync('powershell.exe',['-NoProfile','-Command',`[Diagnostics.Process]::GetProcessById(${child.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`],{windowsHide:true,encoding:'utf8'}).trim();
    const sources=JSON.parse(execFileSync(helper,['--list-audio-applications'],{windowsHide:true,encoding:'utf8'}));
    assert.ok(sources.some(source=>source.pid===child.pid && source.creationTime===created),'an owned application with no window/session must appear');
    const start=timestamp=>{
        const process=spawn(helper,['--capture-audio','window',String(child.pid),timestamp],{windowsHide:true,stdio:'pipe'});
        const bytes=[];let stderr='';process.stdout.on('data',part=>bytes.push(part));process.stderr.on('data',part=>{stderr+=part;});
        const closed=once(process,'exit');return {process,bytes,closed,stderr:()=>stderr};
    };
    const reused=start((BigInt(created)+1n).toString());
    const [invalidCode]=await reused.closed;
    assert.notEqual(invalidCode,0);assert.equal(Buffer.concat(reused.bytes).length,0,'stale lifetime must emit no PCM or ready state');
    capture=start(created);
    await new Promise(resolve=>setTimeout(resolve,2200));
    assert.equal(capture.process.exitCode,null,'a quiet application must stay capturable');
    const captured=Buffer.concat(capture.bytes);
    assert.ok(captured.length>=32,'ready status required');
    let cursor=0,pcm=0,status=0,peak=0,sumSquares=0,samples=0;
    while(cursor+32<=captured.length) {
        assert.equal(captured.toString('ascii',cursor,cursor+4),'SMED');
        const kind=captured[cursor+5],length=captured.readUInt32BE(cursor+28);
        assert.ok(cursor+32+length<=captured.length);
        const data=captured.subarray(cursor+32,cursor+32+length);
        if(kind===1){pcm++;for(let i=0;i+1<data.length;i+=2){const value=data.readInt16LE(i);peak=Math.max(peak,Math.abs(value));sumSquares+=value*value;samples++;}}
        else if(kind===3){status++;assert.equal(JSON.parse(data).audio,true);}
        else assert.fail(`unexpected frame ${kind}`);
        cursor+=32+length;
    }
    assert.ok(status>0 && pcm>0);
    process.stdout.write(JSON.stringify({silentPeakPCM:peak,silentRmsPCM:Math.sqrt(sumSquares/Math.max(1,samples))})+'\n');
    assert.ok(peak<=4,'owned silent app output must remain at the 16-bit conversion noise floor');
    const quit=Buffer.alloc(33);quit.write('SMED');quit[4]=2;quit[5]=7;quit.writeUInt32BE(1,28);quit[32]=81;
    capture.process.stdin.end(quit);const [stopCode]=await capture.closed;assert.equal(stopCode,0,'explicit stop must release native audio');
    capture=start(created);await new Promise(resolve=>setTimeout(resolve,200));
    child.kill();await capture.closed;
    assert.notEqual(capture.process.exitCode,0,'target exit must terminate process capture');
    capture=null;
    const result={passed:true,api:'ActivateAudioInterfaceAsync / PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE',ownedSilentProcess:true,windowlessAppListed:true,staleCreationEmittedBytes:0,quietAliveMs:2200,statusFrames:status,silentPCMFrames:pcm,silentPeakPCM:peak,explicitStopAndRestart:true,targetExitStops:true,systemCapture:false};
    writeFileSync(resolve(directory,'result.json'),JSON.stringify(result,null,2));
    process.stdout.write(JSON.stringify(result)+'\n');
} finally {
    capture?.process.kill();child.kill();
}
