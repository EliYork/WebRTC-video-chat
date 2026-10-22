import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const page=readFileSync(new URL('../src/views/script.js',import.meta.url),'utf8');
const section=(start,end)=>{
    const a=page.indexOf(start),b=page.indexOf(end,a);
    assert.ok(a>=0&&b>a);return page.slice(a,b);
};
const fixture=()=>{
    const window={},calls=[];
    for(const name of ['voice-session-runtime','voice-media-operation-runtime'])
        vm.runInNewContext(readFileSync(new URL(`../src/views/js/voice/${name}.js`,import.meta.url),'utf8'),{window});
    const session=window.VoiceSessionRuntime.createSessionRuntime();
    const context=vm.createContext({
        console:{log(){},warn(){}},voiceMediaOperationApi:window.VoiceMediaOperationRuntime,voiceSessionRuntime:session,
        voiceMediaDebug:{record(){}},localMediaTrackStopper:{stopStream:s=>s?.getAudioTracks().forEach(t=>t.stop())},disposeAudioPipeline(){},
        isKnownRoom:r=>['lobby','game'].includes(r),channelSounds:{unlock(){},leave(){}},callDiagnostics:{start(){},end(){}},
        setAudioButtonNoMic(){},setAudioButtonState(){},setCameraButtonState(){},notifyMediaDock(){},syncRoomCompositionState(){},
        createPeerInstance:async()=>({}),rebindLiveLocalTrackEndedHandlers(){},
        iceConfigRuntime:{stop(){}},screenSfuRuntime:{leave(){}},peerRetryController:{reset(){}},
        voicePeerRegistry:{teardown(){}},getVideoTiles:()=>[],updateMobileTileView(){},updateMobileRoomState(){},
        emitLocalPresenceUpdate(){},updateLocalUserCard(){},
        audioSettingsController:{cancel(){calls.push('cancel-settings');}},
        audioProcessingRuntime:{cancelPending(){calls.push('cancel-pipeline');}},
        voiceStatusView:{clearMediaError(){}},
        initiateAudio:async()=>{calls.push('capture');},
    });
    vm.runInContext(`
        let currentPeer,selectedVoiceRoomId,pendingVoiceRoomId,localPeerId,joinedVoiceRoomId;
        let iceConnectionPending=false,localVoiceMediaGeneration=0,localVoiceSessionGeneration=0,myVideoStream;
        let micPermissionDenied=false;
        const socket={connected:true,emit(){}};
        const voiceMediaTargets=new Set(),screenSharers=new Set();
        const resetLocalVoiceState=()=>{localMediaTrackStopper.stopStream(myVideoStream);myVideoStream=undefined;};
        ${section('const mediaOperationController =','const localTrackEndedController =')}
        ${section('const toggleAudio =','const restartLocalMicrophone =')}
        ${section('const handleMicClick =','async function handleUnexpectedLocalTrackEnded')}
        ${section('const leaveVoiceSession =','function removeRemoteTile')}
    `,context);
    return {calls,session,run:code=>vm.runInContext(code,context)};
};

test('fresh page defaults to join with microphone, but does not capture while outside',()=>{
    const f=fixture();assert.equal(f.run("mediaOperationController.getSnapshot('microphone').desired"),true);
    assert.deepEqual(f.calls,[]);f.run("joinVoiceChannel('lobby')");assert.deepEqual(f.calls,['capture']);
});

test('outside microphone choice is retained across join, leave and another channel',async()=>{
    const f=fixture();await f.run('handleMicClick(undefined)');
    assert.equal(f.run("mediaOperationController.getSnapshot('microphone').desired"),false);
    assert.deepEqual(f.calls,[]);f.run("joinVoiceChannel('lobby');leaveVoiceSession();joinVoiceChannel('game')");
    assert.deepEqual(f.calls,[]);f.run('leaveVoiceSession()');await f.run('handleMicClick(undefined)');
    assert.deepEqual(f.calls,[]);f.run("joinVoiceChannel('lobby')");assert.deepEqual(f.calls,['capture']);
});

test('leaving releases capture while keeping the last in-channel mute choice',()=>{
    const f=fixture();f.run("joinVoiceChannel('lobby')");
    // Keep one stable track so toggle and teardown operate on the same object.
    f.run('const localTrack={enabled:true,stops:0,stop(){this.stops++}};myVideoStream={getAudioTracks:()=>[localTrack]};toggleAudio(myVideoStream);leaveVoiceSession();');
    assert.equal(f.run('localTrack.stops'),1);assert.equal(f.run("mediaOperationController.getSnapshot('microphone').desired"),false);
    f.run("joinVoiceChannel('game')");assert.equal(f.calls.filter(c=>c==='capture').length,1);
});

test('leaving an enabled microphone keeps the next join enabled',()=>{
    const f=fixture();f.run("joinVoiceChannel('lobby');leaveVoiceSession();joinVoiceChannel('game')");
    assert.equal(f.run("mediaOperationController.getSnapshot('microphone').desired"),true);
    assert.equal(f.calls.filter(c=>c==='capture').length,2);
});

test('pending microphone can be cancelled and late permission result is stopped',async()=>{
    const f=fixture();f.run("joinVoiceChannel('lobby')");
    f.run(`let releaseCapture;const lateTrack={stops:0,stop(){this.stops++}};
        const pendingCapture=mediaOperationController.run('microphone',()=>new Promise(resolve=>releaseCapture=resolve));`);
    await Promise.resolve();await f.run('handleMicClick({})');
    assert.equal(f.run("mediaOperationController.getSnapshot('microphone').desired"),false);
    f.run('releaseCapture({getAudioTracks:()=>[lateTrack]})');
    assert.equal((await f.run('pendingCapture')).cancelled,true);assert.equal(f.run('lateTrack.stops'),1);
    assert.ok(f.calls.includes('cancel-pipeline'));
});
