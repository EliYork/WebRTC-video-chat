/* eslint-disable no-await-in-loop -- Fixed serial samples, isolated media only. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Encoded synthetic motion is held constant between App builds. This measures
// nativehost/Pion/receiver playback, not WGC or the physical H.264 encoder.
export async function runNativePerformance({ open, evaluate, click, wait, port, work }) {
    const realWgc = process.argv.includes('--real-wgc');
    if (realWgc && !process.argv.includes('--allow-window')) throw Error('Real WGC requires --allow-window');
    const preset = process.argv.find(a => a.startsWith('--performance='))?.split('=')[1] || '2160p';
    const [width, height, bitrate] = { '1080p': [1920, 1080, 6000000], '1440p': [2560, 1440, 10000000], '2160p': [3840, 2160, 15000000] }[preset] || [];
    assert.ok(width, 'known bounded performance preset');
    const home = resolve('integrations/piik/.build/performance');
    mkdirSync(home, { recursive: true });
    const publisher = await open();
    const viewer = await open();
    const clipsPath = join(home, `motion-${preset}.json`);
    if (!realWgc && !existsSync(clipsPath)) {
        const clips = await evaluate(publisher, `(async()=>{
            const clips=[];
            for(const [width,height,bitrate] of [[${width / 2},${height / 2},${bitrate / 4}],[${width},${height},${bitrate}]]){
                const frames=[], canvas=new OffscreenCanvas(width,height), ctx=canvas.getContext('2d');let failure;
                const encoder=new VideoEncoder({output(chunk){const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);let text='';for(let i=0;i<b.length;i+=8192)text+=String.fromCharCode(...b.subarray(i,i+8192));frames.push({key:chunk.type==='key',data:btoa(text)});},error(e){failure=String(e);}});
                encoder.configure({codec:'avc1.42E034',width,height,framerate:60,bitrate,hardwareAcceleration:'prefer-software',latencyMode:'realtime',avc:{format:'annexb'}});
                for(let i=0;i<60;i++){ctx.fillStyle='hsl('+(i*6)+',75%,35%)';ctx.fillRect(0,0,width,height);for(let j=0;j<8;j++){ctx.fillStyle=j%2?'#fafafa':'#202020';ctx.fillRect((i*17+j*width/8)%width,(j%4)*height/4,width/16,height/3);}const f=new VideoFrame(canvas,{timestamp:Math.round(i*1e6/60),duration:16667});encoder.encode(f,{keyFrame:i%30===0});f.close();if(i%10===9)await encoder.flush();}
                await encoder.flush();encoder.close();if(failure)throw Error(failure);clips.push({width,height,frames});
            }return clips;
        })()`);
        writeFileSync(clipsPath, JSON.stringify(clips));
    }
    let motion, identity, motionError = '', motionText = '';
    const render = [];
    const capture = resolve(process.env.PIIK_PERF_CAPTURE || 'integrations/piik/.build/native-overlay/output/piik-capture.exe');
    if (realWgc) {
        assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process piik-capture -ErrorAction SilentlyContinue).Count'], { windowsHide: true, encoding: 'utf8' }).trim(), '0', 'no existing capture contention');
        execFileSync(process.env.PIIK_GO || 'go', ['build', '-o', join(home, 'owned-wgc.exe'), resolve('scripts/fixtures/piik-owned-wgc.go')], { windowsHide: true });
        motion = spawn(join(home, 'native/motion-window.exe'), [String(width), String(height), '90'], { windowsHide: true, stdio: 'pipe' });
        motion.on('error', e => { motionError = String(e); });
        motion.stdout.on('data', b => { motionText += b; const lines = motionText.split(/\r?\n/); motionText = lines.pop();
            for (const line of lines) { const row = JSON.parse(line); if (row.hwnd) identity = row; else render.push(row); } });
        motion.stderr.on('data', b => { motionError += b; });
        try { await wait(() => { if (motionError) throw Error(motionError); return identity; }, 'owned real-WGC motion window'); }
        catch (e) { motion.kill(); throw e; }
    }
    const fixture = realWgc ? join(home, 'owned-wgc.exe') : resolve('integrations/piik/.build/synthetic-capture.exe');
    const executable = process.env.PIIK_PERF_APP || resolve('integrations/piik/.build/piik-app.exe');
    const tag = process.env.PIIK_PERF_TAG || 'baseline';
    const logDir = join(work, 'native-logs');
    const launches = join(work, 'launches.txt');
    const app = spawn(executable, ['--site', `http://127.0.0.1:${port}`, '--config', join(work, 'app.json'),
        '--capture-process', fixture, '--debug', '--log-dir', logDir], {
        windowsHide: true, stdio: 'pipe', env: { ...process.env, PIIK_MEDIA_TRACE: '', PIIK_CLIENT_GATE_NO_BROWSER: 'true',
            PIIK_PERF_CAPTURE: capture, PIIK_WGC_IDENTITY: JSON.stringify(identity),
            PIIK_SYNTHETIC_CLIPS: clipsPath, PIIK_SYNTHETIC_LAUNCHES: launches,
            PIIK_SYNTHETIC_OPERATIONS: join(work, 'operations.jsonl') },
    });
    let ready = false, failure;
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const logText = () => ['client.log.1', 'client.log'].filter(n => existsSync(join(logDir, n))).map(n => readFileSync(join(logDir, n), 'utf8')).join('\n');
    const logRows = () => logText().split(/\r?\n/).filter(l => l.startsWith('{') && l.endsWith('}')).map(l => JSON.parse(l));
    const realCaptureRows = () => logRows()
        .filter(r => r.event === 'capture-process-started' && r.mode === 'capture-video');
    const ownedChildren = () => [...logText().matchAll(/event=owned-wgc-child pid=(\d+)/g)].map(m => Number(m[1]));
    const capturePids = () => realWgc ? [...realCaptureRows().map(r => r.pid), ...ownedChildren()] : existsSync(launches) ? readFileSync(launches, 'utf8').trim().split(/\s+/).map(Number) : [];
    app.on('error', e => { failure = e; });
    app.stdout.on('data', b => { if (b.toString().includes('instanceToken')) ready = true; });
    app.stderr.on('data', () => {});
    const cpu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `(Get-Process -Id ${app.pid}).CPU`], { windowsHide: true, encoding: 'utf8' }).trim());
    try {
        await wait(() => { if (failure) throw failure; assert.equal(app.exitCode, null); return ready; }, 'performance App ready');
        for (const s of [publisher, viewer]) {
            await click(s, '#stageJoinVoice');
            await wait(() => evaluate(s, `document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`), 'performance voice join');
        }
        await click(publisher, '#shareScreen');
        await evaluate(publisher, `document.querySelector('[data-screen-share-audio]').checked=false`);
        await evaluate(publisher, `(()=>{for(const [sel,val]of [['[data-screen-share-resolution]','${preset}'],['[data-screen-share-frame-rate]','60'],['[data-screen-share-provider]','native']]){const e=document.querySelector(sel);e.value=val;e.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('[data-screen-share-bitrate]').value='${bitrate}';})()`);
        const group = realWgc ? 'window' : 'display';
        await wait(() => evaluate(publisher, `document.querySelector('[data-source-group="${group}"] img')?.naturalWidth>0`), 'authorized source preview');
        if (realWgc) assert.equal(await evaluate(publisher, `document.querySelectorAll('[data-native-source-key]').length`), 1, 'only owned window exposed');
        await click(publisher, `[data-source-group="${group}"] [data-native-source-key]`);
        assert.equal(await evaluate(publisher, `document.querySelector('[data-piik-native-audio]').checked`), false, 'screen audio stays disabled');
        await click(publisher, '[data-screen-share-start]');
        await wait(() => evaluate(viewer, `__mediaStats().then(a=>a.some(r=>r.kind==='video'&&r.framesDecoded>10))`), 'native Pion receive');
        await evaluate(viewer, `(()=>{window.__perfVideo=[...document.querySelectorAll('#video-grid video')].find(v=>v.videoWidth>0&&v.closest('.video-tile').id!=='local-video');window.__perfVisibility=0;document.addEventListener('visibilitychange',()=>__perfVisibility++);window.__perfPresentation={count:0,intervals:[],previous:null};const cb=(now,m)=>{const s=__perfPresentation;s.count=m.presentedFrames;s.callbackTime=now;s.processingDuration=m.processingDuration;s.receiveToPresent=m.presentationTime-m.receiveTime;if(s.previous!==null){s.intervals.push(now-s.previous);if(s.intervals.length>1200)s.intervals.shift();}s.previous=now;__perfVideo.requestVideoFrameCallback(cb);};__perfVideo.requestVideoFrameCallback(cb);window.__perfRead=async()=>{const pcs=[];for(const pc of __pcs){for(const r of(await pc.getStats()).values()){if(r.type==='inbound-rtp'&&r.kind==='video')pcs.push({timestamp:r.timestamp,framesDecoded:r.framesDecoded,framesReceived:r.framesReceived,bytesReceived:r.bytesReceived,framesDropped:r.framesDropped,totalDecodeTime:r.totalDecodeTime,jitterBufferDelay:r.jitterBufferDelay,jitterBufferEmittedCount:r.jitterBufferEmittedCount,packetsLost:r.packetsLost,frameWidth:r.frameWidth,frameHeight:r.frameHeight,decoderImplementation:r.decoderImplementation,powerEfficientDecoder:r.powerEfficientDecoder});}}const q=__perfVideo.getVideoPlaybackQuality();return {now:performance.now(),rtc:pcs,presentation:{...__perfPresentation,intervals:__perfPresentation.intervals.slice()},dropped:q.droppedVideoFrames,total:q.totalVideoFrames,hidden:document.hidden,visibilityChanges:__perfVisibility,width:__perfVideo.videoWidth,height:__perfVideo.videoHeight};};})()`);
        await new Promise(r => setTimeout(r, 3000));
        const samples = [await evaluate(viewer, '__perfRead()')];
        const cpuBefore = cpu(), began = Date.now();
        for (let i = 0; i < 4; i++) {
            await new Promise(r => setTimeout(r, 2000));
            samples.push(await evaluate(viewer, '__perfRead()'));
        }
        const cpuSeconds = cpu() - cpuBefore, elapsed = (Date.now() - began) / 1000;
        const routes = await evaluate(viewer, `(async()=>{const rows=[];for(const pc of __pcs){const stats=await pc.getStats();for(const r of stats.values()){if(r.type!=='inbound-rtp'||r.kind!=='video')continue;const transport=stats.get(r.transportId),pair=stats.get(transport?.selectedCandidatePairId);rows.push({codec:stats.get(r.codecId)?.mimeType,localCandidateType:stats.get(pair?.localCandidateId)?.candidateType,remoteCandidateType:stats.get(pair?.remoteCandidateId)?.candidateType,protocol:stats.get(pair?.localCandidateId)?.protocol});}}return rows;})()`);
        assert.ok(routes.some(r => r.codec?.toLowerCase() === 'video/h264'), 'actual H.264 negotiated');
        const intervals = samples.slice(1).map((b, i) => {
            const a = samples[i], av = a.rtc[0], bv = b.rtc[0];
            assert.ok(av && bv, 'receiver RTC reports');
            const seconds = (bv.timestamp - av.timestamp) / 1000;
            const presentedSeconds = (b.presentation.callbackTime - a.presentation.callbackTime) / 1000;
            const valid = !a.hidden && !b.hidden && a.visibilityChanges === b.visibilityChanges && presentedSeconds >= 1;
            return { rtcWindowMs: seconds * 1000, playbackWindowMs: b.now - a.now, submittedWindowMs: presentedSeconds * 1000,
                receivedFps: (bv.framesReceived - av.framesReceived) / seconds,
                decodedFps: (bv.framesDecoded - av.framesDecoded) / seconds,
                submittedFps: valid ? (b.presentation.count - a.presentation.count) / presentedSeconds : null,
                playbackValid: valid,
                decodeDropped: bv.framesDropped - av.framesDropped, playbackDropped: b.dropped - a.dropped,
                decodeMs: 1000 * (bv.totalDecodeTime - av.totalDecodeTime) / (bv.framesDecoded - av.framesDecoded),
                mbps: (bv.bytesReceived - av.bytesReceived) * 8 / seconds / 1e6,
                lost: bv.packetsLost - av.packetsLost, width: b.width, height: b.height, hidden: b.hidden };
        });
        const logBytes = ['client.log', 'client.log.1'].reduce((sum, n) => sum + (existsSync(join(logDir, n)) ? statSync(join(logDir, n)).size : 0), 0);
        const retained = join(home, `${tag}-${preset}-logs`);
        mkdirSync(retained, { recursive: true });
        for (const name of ['client.log', 'client.log.1']) if (existsSync(join(logDir, name))) copyFileSync(join(logDir, name), join(retained, name));
        if (realWgc) assert.equal(realCaptureRows().length, 1, 'one WGC capture worker retained in filtered log');
        const report = { tag, preset, syntheticReplay: !realWgc, hardwareCaptureMeasured: realWgc, gpuAllowed: process.argv.includes('--gpu-receiver'),
            fixtureLimit: realWgc ? 'owned D3D motion window; real WGC/MFT; headless receiver, not physical display or game; decoder implementation is in rawSamples' : 'prerecorded encoder ignores live bitrate controls; actual RTP bitrate is measured, not assumed from target',
            cpuSeconds, elapsed, appCpuCores: cpuSeconds / elapsed, retainedLogBytes: logBytes,
            captureWorkers: realWgc ? realCaptureRows().length : readFileSync(launches, 'utf8').trim().split(/\s+/).length,
            render, realCapture: realWgc ? capture : null,
            nativeEncoderSamples: realWgc ? logRows().filter(r => r.line?.startsWith('event=encoder-stats')).map(r => r.line) : [],
            senderSamples: realWgc ? logRows().filter(r => r.msg === 'media-sample').map(r => ({ local: r.local, windowMs: r.windowMs, fps: r.fps, bitrateKbps: r.bitrateKbps, width: r.width, height: r.height, output: r.output })) : [],
            intervals, routes, rawSamples: samples, audioOutputMuted: true };
        await click(publisher, '[data-local-share-controls] [data-share-action="stop"]');
        await wait(() => capturePids().every(pid => !alive(pid)), 'performance capture worker cleanup');
        report.captureCleanupPassed = true;
        await wait(() => evaluate(publisher, `document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`), 'stop keeps voice');
        writeFileSync(join(home, `${tag}-${preset}-p2p.json`), JSON.stringify(report, null, 2));
        return report;
    } finally {
        app.stdin.end();
        await new Promise(r => { if (app.exitCode !== null) return r(); app.once('exit', r); const t = setTimeout(() => app.kill(), 3000); t.unref(); });
        if (realWgc) {
            for (const pid of capturePids()) if (alive(pid)) process.kill(pid);
            if (motion.exitCode === null) { motion.kill(); await new Promise(r => motion.once('exit', r)); }
        }
    }
}
