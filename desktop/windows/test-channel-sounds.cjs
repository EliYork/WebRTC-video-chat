// Actual Chromium waveform rendering, entirely offline: never connects to speakers.
const { app, BrowserWindow } = require('electron');
const {
    readFileSync,
    mkdtempSync,
    mkdirSync,
    writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'voice-channel-tones-')));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
const artifacts = join(__dirname, '../../integrations/piik/artifacts');
mkdirSync(artifacts, { recursive: true });
app.whenReady()
    .then(async () => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                sandbox: true,
                offscreen: true,
                backgroundThrottling: false,
            },
        });
        win.webContents.setAudioMuted(true);
        await win.loadURL(
            'data:text/html,<title>Offline notification test</title>'
        );
        await win.webContents.executeJavaScript(
            readFileSync(
                join(
                    __dirname,
                    '../../src/views/js/voice/voice-channel-sounds.js'
                ),
                'utf8'
            )
        );
        const result = await win.webContents.executeJavaScript(`(async () => {
        async function render(kind) {
            const ctx = new OfflineAudioContext(1, 19200, 48000);
            const player = VoiceChannelSounds.createTonePlayer({
                getSettings: () => ({enabled:true,volume:0.35}),
                getOutput: () => ({muted:false,volume:1,deviceId:'default'}),
                createContext: () => ({ state:'running', destination:ctx.destination,
                    get currentTime(){return ctx.currentTime}, resume:async()=>{}, close:async()=>{},
                    createGain:()=>ctx.createGain(), createOscillator:()=>ctx.createOscillator() }),
            });
            await player.unlock();
            if (!await player.play(kind)) throw Error('Tone not scheduled');
            const pcm = (await ctx.startRendering()).getChannelData(0);
            function energy(f, start) {
                let real=0, imag=0;
                for(let i=start;i<start+2880;i++) {
                    real+=pcm[i]*Math.cos(2*Math.PI*f*i/48000);
                    imag+=pcm[i]*Math.sin(2*Math.PI*f*i/48000);
                }
                return real*real+imag*imag;
            }
            const frequencies=[523.251,587.330];
            const first=frequencies.map(f=>energy(f,1680));
            const second=frequencies.map(f=>energy(f,8880));
            const peak=pcm.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
            const silentTail=pcm.slice(15000).every(x=>Math.abs(x)<0.00001);
            player.destroy();
            return { first, second, peak, silentTail };
        }
        return {join:await render('join'),leave:await render('leave')};
    })()`);
        assert.ok(result.join.first[0] > result.join.first[1] * 2);
        assert.ok(result.join.second[1] > result.join.second[0] * 2);
        assert.ok(result.leave.first[1] > result.leave.first[0] * 2);
        assert.ok(result.leave.second[0] > result.leave.second[1] * 2);
        assert.ok(
            [result.join, result.leave].every(
                (tone) =>
                    tone.peak > 0.01 && tone.peak < 0.06 && tone.silentTail
            )
        );
        writeFileSync(
            join(artifacts, 'channel-sounds.json'),
            JSON.stringify(
                {
                    passed: true,
                    offlineOnly: true,
                    muted: win.webContents.isAudioMuted(),
                    ...result,
                },
                null,
                2
            )
        );
        win.destroy();
        app.quit();
    })
    .catch((error) => {
        writeFileSync(
            join(artifacts, 'channel-sounds.json'),
            JSON.stringify({ passed: false, error: error.stack })
        );
        app.exit(1);
    });
