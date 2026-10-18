/* eslint-disable no-await-in-loop -- One serialized media scenario. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export async function runNativeScenario({
    open,
    evaluate,
    click,
    wait,
    mediaRequest,
    port,
    work,
}) {
    const a = await open(),
        b = await open(),
        c = await open('game'),
        d = await open();
    // Only this input is synthetic: App control, nativehost, Pion, Piik route
    // authority and the original channel UI all remain the real implementations.
    const clips = await evaluate(
        a,
        `(async()=>{
        const clips=[];
        for(const [width,height] of [[640,360],[1280,720]]) {
            const frames=[], canvas=new OffscreenCanvas(width,height), ctx=canvas.getContext('2d');
            let failure;
            const encoder=new VideoEncoder({output(chunk){const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);let data='';for(const byte of bytes)data+=String.fromCharCode(byte);frames.push({key:chunk.type==='key',data:btoa(data)});},error(error){failure=String(error);}});
            encoder.configure({codec:'avc1.42E01F',width,height,framerate:30,bitrate:1000000,hardwareAcceleration:'prefer-software',latencyMode:'realtime',avc:{format:'annexb'}});
            for(let i=0;i<30;i++){ctx.fillStyle='hsl('+(i*11)+',80%,45%)';ctx.fillRect(0,0,width,height);ctx.fillStyle='white';ctx.fillRect(i*width/30,50,40,height/2);const frame=new VideoFrame(canvas,{timestamp:Math.round(i*1000000/30),duration:33333});encoder.encode(frame,{keyFrame:i%15===0});frame.close();}
            await encoder.flush();encoder.close();if(failure)throw Error(failure);clips.push({width,height,frames});
        }return clips;
    })()`
    );
    const clipsPath = join(work, 'clips.json'),
        launches = join(work, 'capture-launches.txt');
    writeFileSync(clipsPath, JSON.stringify(clips));
    const build = resolve('integrations/piik/.build');
    const fixture = join(build, 'synthetic-capture.exe');
    execFileSync(
        process.env.PIIK_GO || 'go',
        [
            'build',
            '-o',
            fixture,
            resolve('scripts/fixtures/piik-synthetic-capture.go'),
        ],
        { windowsHide: true }
    );
    const origin = `http://127.0.0.1:${port}`;
    const app = spawn(
        join(build, 'piik-app.exe'),
        [
            '--site',
            origin,
            '--config',
            join(work, 'app-config.json'),
            '--capture-process',
            fixture,
        ],
        {
            windowsHide: true,
            stdio: 'pipe',
            env: {
                ...process.env,
                PIIK_CLIENT_GATE_NO_BROWSER: 'true',
                PIIK_SYNTHETIC_CLIPS: clipsPath,
                PIIK_SYNTHETIC_LAUNCHES: launches,
            },
        }
    );
    let appOutput = '';
    app.stdout.on('data', (bytes) => {
        appOutput += bytes;
    });
    let appError = '';
    app.stderr.on('data', (bytes) => {
        appError += bytes;
    });
    let failure;
    app.on('error', (error) => {
        failure = error;
    });
    const alive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };
    const capturePids = () =>
        existsSync(launches)
            ? readFileSync(launches, 'utf8').trim().split(/\s+/).map(Number)
            : [];
    try {
        await wait(() => {
            if (failure) throw failure;
            if (app.exitCode !== null)
                throw Error(`Piik App exited during startup: ${appError}`);
            return appOutput.includes('instanceToken');
        }, 'isolated native App startup');
        const endpoint = JSON.parse(
            appOutput
                .split(/\r?\n/)
                .find((line) => line.includes('instanceToken'))
        );
        assert.equal(
            (
                await fetch(`http://127.0.0.1:${endpoint.port}/health`, {
                    headers: { Origin: 'https://unapproved.invalid' },
                })
            ).status,
            403,
            'unapproved site cannot discover a control capability'
        );
        const health = await (
            await fetch(`http://127.0.0.1:${endpoint.port}/health`, {
                headers: { Origin: origin },
            })
        ).json();
        const unauthenticated = new (await import('ws')).default(
            `ws://127.0.0.1:${endpoint.port}/control`,
            ['piik-client-v10.invalid'],
            { origin }
        );
        let denied = false;
        unauthenticated.on('error', () => {
            denied = true;
        });
        unauthenticated.on('unexpected-response', (_req, res) => {
            denied = res.statusCode === 403;
            res.resume();
        });
        await wait(() => denied, 'invalid App capability rejected');
        unauthenticated.terminate();
        assert.ok(health.nativeMedia.video);
        const localProbe = await evaluate(
            a,
            `(async()=>{try{const response=await fetch('http://127.0.0.1:${endpoint.port}/health');const h=await response.json();return {status:response.status,protocol:h.protocol,video:h.nativeMedia?.video};}catch(error){return {error:String(error)}}})()`
        );
        assert.equal(localProbe.status, 200, JSON.stringify(localProbe));
        for (const s of [a, b, c, d]) {
            await click(s, '#stageJoinVoice');
            await wait(
                () =>
                    evaluate(
                        s,
                        `document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`
                    ),
                'native channel join'
            );
        }
        let checkedResolutionGuard = false;
        const start = async () => {
            await click(a, '#shareScreen');
            await evaluate(
                a,
                `(()=>{for(const [selector,value] of [['[data-screen-share-resolution]','720p'],['[data-screen-share-frame-rate]','30'],['[data-screen-share-provider]','native']]){const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}})()`
            );
            if (!checkedResolutionGuard) {
                for (const preset of ['original', 'auto']) {
                    const state = await evaluate(
                        a,
                        `(()=>{const el=document.querySelector('[data-screen-share-resolution]');el.value='${preset}';el.dispatchEvent(new Event('change',{bubbles:true}));return {valid:el.validity.valid,message:el.validationMessage,hint:document.querySelector('[data-piik-native-config-status]').textContent}})()`
                    );
                    assert.equal(state.valid, false);
                    assert.match(state.message, /请选择.*4K/);
                    assert.equal(state.hint, state.message);
                    await click(a, '[data-screen-share-start]');
                    assert.equal(
                        await evaluate(
                            a,
                            `document.querySelector('[data-screen-share-start]').closest('dialog').open`
                        ),
                        true
                    );
                    assert.equal(
                        capturePids().length,
                        0,
                        'unsupported preset must not start a capture worker'
                    );
                }
                const state = await evaluate(
                    a,
                    `(()=>{const provider=document.querySelector('[data-screen-share-provider]');provider.value='web';provider.dispatchEvent(new Event('change',{bubbles:true}));const el=document.querySelector('[data-screen-share-resolution]');const browserValid=el.validity.valid;el.value='720p';el.dispatchEvent(new Event('change',{bubbles:true}));provider.value='native';provider.dispatchEvent(new Event('change',{bubbles:true}));return {browserValid,nativeValid:el.validity.valid}})()`
                );
                assert.equal(
                    state.browserValid,
                    true,
                    'browser auto/original remains allowed'
                );
                assert.equal(state.nativeValid, true);
                checkedResolutionGuard = true;
            }
            try {
                await wait(
                    () =>
                        evaluate(
                            a,
                            `document.querySelector('[data-piik-native-source]').options[0]?.textContent.includes('Synthetic motion')`
                        ),
                    'native App sources'
                );
            } catch (error) {
                throw new Error(
                    `${error.message}\n${await evaluate(a, `document.querySelector('[data-piik-native-status]').textContent`)}`
                );
            }
            await click(a, '[data-screen-share-start]');
        };
        const decoded = async (s) =>
            (await evaluate(s, '__mediaStats()')).some(
                (row) =>
                    row.kind === 'video' &&
                    row.codec === 'video/H264' &&
                    row.framesDecoded > 0
            );
        for (const s of [a, b]) {
            await click(s, '#toggleAudio');
            await wait(
                () =>
                    evaluate(
                        s,
                        `document.querySelector('#toggleAudio').title.includes('关闭')`
                    ),
                'native scenario fake microphone enabled'
            );
        }
        await start();
        await wait(() => decoded(b), 'native H264 in original viewer stage');
        await wait(() => decoded(d), 'second native viewer');
        const listed = await mediaRequest(b, { action: 'list' });
        assert.equal(
            (
                await mediaRequest(c, {
                    action: 'watch',
                    shareId: listed.shares[0].id,
                })
            ).ok,
            false,
            'native room still requires real same-channel membership'
        );
        const e = await open();
        await click(e, '#stageJoinVoice');
        await wait(() => decoded(e), 'third native viewer');
        const reusedCaptureCount = capturePids().length;
        assert.equal(
            reusedCaptureCount,
            1,
            'three viewers reuse one native capture process'
        );
        const browserVideoSenders = await evaluate(
            a,
            `__pcs.filter(pc=>pc.connectionState==='connected').flatMap(pc=>pc.getSenders()).filter(sender=>sender.track?.kind==='video').length`
        );
        assert.equal(
            browserVideoSenders,
            0,
            'native preview is never encoded again by browser or PeerJS'
        );
        for (const s of [a, b])
            await wait(
                async () =>
                    (await evaluate(s, '__mediaStats()')).some(
                        (row) =>
                            row.kind === 'audio' &&
                            row.type === 'inbound-rtp' &&
                            row.bytesReceived > 0
                    ),
                'bidirectional voice during native sharing'
            );
        await click(b, '#shareScreen');
        await evaluate(
            b,
            `(()=>{const el=document.querySelector('[data-screen-share-codec]');el.value='vp8';el.dispatchEvent(new Event('change',{bubbles:true}));})()`
        );
        await click(b, '[data-screen-share-start]');
        await wait(
            async () =>
                (await evaluate(a, '__mediaStats()')).some(
                    (row) =>
                        row.kind === 'video' &&
                        row.codec === 'video/VP8' &&
                        row.framesDecoded > 0
                ),
            'browser publisher alongside native publisher'
        );
        assert.equal(
            (await mediaRequest(d, { action: 'list' })).shares.length,
            2
        );
        await click(b, '#shareScreen');
        await wait(
            async () =>
                (await mediaRequest(d, { action: 'list' })).shares.length === 1,
            'browser stop preserves native publisher'
        );
        for (let i = 0; i < 3; i++) {
            await click(b, '#destroyPeer');
            await wait(
                () =>
                    evaluate(
                        b,
                        `document.querySelector('#destroyPeer').dataset.sessionAction!=='hangup'`
                    ),
                'viewer explicit departure'
            );
            await click(b, '#stageJoinVoice');
            await wait(() => decoded(b), 'full-room immediate rejoin');
        }
        await evaluate(
            a,
            `document.querySelector('#chatInput').value='Native unified chat';document.querySelector('#chatForm').requestSubmit()`
        );
        await wait(
            () =>
                evaluate(
                    d,
                    `document.querySelector('#chatMessages').textContent.includes('Native unified chat')`
                ),
            'original chat with native fanout'
        );
        const received = await evaluate(d, '__mediaStats()');
        await click(a, '#shareScreen');
        await wait(
            async () =>
                (await mediaRequest(d, { action: 'list' })).shares.length === 0,
            'native stop directory cleanup'
        );
        await wait(
            () => capturePids().every((pid) => !alive(pid)),
            'native capture process cleanup'
        );
        await start();
        await wait(() => decoded(d), 'native stop/start');
        app.kill();
        await wait(
            async () =>
                (await mediaRequest(d, { action: 'list' })).shares.length === 0,
            'App exit clears platform sharing'
        );
        await wait(
            () => capturePids().every((pid) => !alive(pid)),
            'App exit retires capture worker'
        );
        return {
            status: 'passed',
            provider: 'Piik App / nativehost / Pion',
            codec: 'H264',
            syntheticCaptureInput: true,
            physicalHardwareAcceptance: false,
            sourceSize: [1280, 720],
            targetFps: 30,
            reusedCaptureCount,
            browserVideoSenders,
            received,
            checks: [
                'native original/auto blocked with actionable hint before capture; browser presets retained',
                'approved site and capability required',
                'original channel and stage',
                'native H264 Pion fanout to three viewers',
                'single capture worker',
                'no browser re-encoding',
                'same-channel authority',
                'full-room immediate rejoin',
                'existing chat',
                'bidirectional voice during native sharing',
                'simultaneous browser and native publishers',
                'stop/start',
                'App exit cleanup',
            ],
            audioOutputMuted: true,
        };
    } finally {
        if (app.exitCode === null) {
            app.stdin.write('x');
            app.kill();
        }
    }
}
