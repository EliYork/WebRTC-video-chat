/* eslint-disable no-await-in-loop -- Exercise one isolated local UI lifecycle. */
// Hidden, muted Electron windows and synthetic local update bytes. No installer runs.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { NsisUpdater } = require('electron-updater');
const {
    ElectronHttpExecutor,
} = require('electron-updater/out/electronHttpExecutor');
const { createUpdates } = require('./updater.cjs');
const { createPanels } = require('./panels.cjs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-settings-ui-'));
const artifacts = join(__dirname, '../../integrations/piik/artifacts/settings');
mkdirSync(artifacts, { recursive: true });
const resultPath = join(artifacts, 'result.json');
const results = {};
const fail = (error) => {
    writeFileSync(
        resultPath,
        JSON.stringify({ passed: false, error: error.stack, work, results })
    );
    app.exit(1);
};
process.stdout.on('error', fail);
process.stderr.on('error', fail);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.setPath('userData', work);
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
let mode = 'new',
    downloads = 0;
const bytes = Buffer.alloc(8 * 1024 * 1024, 71); // Synthetic non-executable bytes.
const server = createServer((request, response) => {
    if (request.url.startsWith('/latest.yml')) {
        setTimeout(() => {
            if (mode === 'offline') {
                response.writeHead(503);
                response.end();
                return;
            }
            response.end(
                JSON.stringify({
                    version: '0.1.4',
                    files: [
                        {
                            url: 'fixture.exe',
                            size: bytes.length,
                            sha512: createHash('sha512')
                                .update(bytes)
                                .digest('base64'),
                        },
                    ],
                    releaseDate: new Date().toISOString(),
                })
            );
        }, 250);
        return;
    }
    downloads++;
    response.writeHead(200, {
        'Content-Length': bytes.length,
        'Content-Type': 'application/octet-stream',
    });
    let offset = 0;
    const tick = setInterval(() => {
        response.write(bytes.subarray(offset, offset + 65536));
        offset += 65536;
        if (offset >= bytes.length) {
            clearInterval(tick);
            response.end();
        }
    }, 100);
    response.once('close', () => clearInterval(tick));
});
const until = (win, condition) => {
    results.step = condition;
    return win.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const end=Date.now()+20000;const poll=()=>{if(${condition})resolve(true);else if(Date.now()>end)reject(Error('UI condition timed out: '+${JSON.stringify(condition)}+' '+document.body.textContent));else setTimeout(poll,25)};poll()})`
    );
};
const stateIs = (status) =>
    `document.querySelector('.update-card').dataset.status===${JSON.stringify(status)}`;
const shot = async (win, name) => {
    results.step = `capture:${name}`;
    win.webContents.invalidate();
    writeFileSync(
        join(artifacts, `${name}.png`),
        (await win.webContents.capturePage()).toPNG()
    );
};
app.whenReady()
    .then(async () => {
        const timeout = setTimeout(
            () => fail(Error('Settings UI test deadline')),
            60000
        );
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        const config = join(work, 'update.yml');
        writeFileSync(
            config,
            JSON.stringify({
                provider: 'generic',
                url: `http://127.0.0.1:${server.address().port}/`,
                updaterCacheDirName: 'fixture',
            })
        );
        const adapter = {
            version: '0.1.3',
            name: 'ui-test',
            isPackaged: true,
            appUpdateConfigPath: config,
            userDataPath: work,
            baseCachePath: work,
            whenReady: () => app.whenReady(),
            onQuit: () => {},
        };
        const updater = new NsisUpdater(null, adapter);
        updater.httpExecutor = new ElectronHttpExecutor(() => {});
        updater.disableDifferentialDownload = true;
        updater.quitAndInstall = () => {
            throw Error('Test must never install');
        };
        const parent = new BrowserWindow({
            show: false,
            width: 1000,
            height: 800,
            webPreferences: { sandbox: true },
        });
        parent.webContents.setAudioMuted(true);
        const openedLinks = [];
        let creditOpened;
        const creditClick = new Promise(resolve => { creditOpened = resolve; });
        const panels = createPanels({
            BrowserWindow,
            ipcMain,
            screen,
            window: () => parent,
            hidden: true,
            log: () => {},
            openExternal: async url => { openedLinks.push(url); creditOpened(); },
        });
        let confirmations = 0,
            releaseMedia = 0;
        const controller = createUpdates({
            updater,
            app: { getVersion: () => '0.1.3' },
            window: () => parent,
            log: () => {},
            prepareInstall: async () => {
                releaseMedia++;
            },
            confirmInstall: async () => {
                confirmations++;
                return (
                    (
                        await panels.confirm({
                            title: '退出并安装 0.1.4？',
                            detail: '安装会结束当前语音和屏幕共享，然后重新打开客户端。',
                            accept: '退出并安装',
                            cancel: '稍后安装',
                        })
                    ).response === 0
                );
            },
        });
        const info = {
            clientVersion: '0.1.3',
            webVersion: '1.0.5',
            origin: 'https://voice.eliyork.com',
            packaged: true,
        };
        let win;
        try {
            win = await panels.about(info, controller);
            await until(win, stateIs('idle'));
            assert.equal(await panels.about(info, controller), win);
            results.singleton = true;
            assert.equal(win.isVisible(), false);
            assert.equal(win.webContents.isAudioMuted(), true);
            assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('#project-credits a[href^="https://github.com/"]').length`), 12);
            await win.webContents.executeJavaScript(`document.querySelector('#project-credits').open=true; document.querySelector('#project-credits a').click()`);
            await creditClick;
            assert.deepEqual(openedLinks, ['https://github.com/TNTcraftHIM/Piik']);
            assert.equal(await win.webContents.executeJavaScript(`voiceSettings.action('open-credit', 'https://untrusted.invalid/').then(()=>false,()=>true)`), true);
            assert.equal(openedLinks.length, 1);
            await shot(win, 'credits');
            await win.webContents.executeJavaScript(`document.querySelector('#project-credits').open=false`);
            results.projectCredits = { count: 12, defaultBrowserDispatch: true, unknownURLRejected: true };
            win.webContents.executeJavaScript(
                `document.querySelector('#primary').click()`
            );
            await until(win, stateIs('checking'));
            assert.equal(
                await win.webContents.executeJavaScript(
                    `getComputedStyle(document.querySelector('#status-icon')).animationName`
                ),
                'spin'
            );
            await shot(win, 'checking');
            await until(win, stateIs('available'));
            win.webContents.executeJavaScript(
                `document.querySelector('#primary').click()`
            );
            await until(
                win,
                `document.querySelector('#progress-track').hasAttribute('aria-valuenow')`
            );
            const progress = controller.snapshot().progress;
            assert.ok(
                progress.percent > 0 &&
                    progress.percent < 100 &&
                    progress.bytesPerSecond > 0
            );
            assert.equal(
                await win.webContents.executeJavaScript(
                    `Number(document.querySelector('#progress-track').getAttribute('aria-valuenow'))`
                ),
                Math.round(progress.percent)
            );
            assert.equal(
                await win.webContents.executeJavaScript(
                    `Math.abs(document.querySelector('#progress-fill').getBoundingClientRect().width / document.querySelector('#progress-track').getBoundingClientRect().width * 100 - Number(document.querySelector('#progress-track').getAttribute('aria-valuenow'))) < 1`
                ),
                true
            );
            await shot(win, 'downloading');
            win.webContents.executeJavaScript(
                `document.querySelector('#secondary').click()`
            );
            await until(
                win,
                `${stateIs('cancelled')}&&!document.querySelector('#primary').disabled`
            );
            assert.equal(releaseMedia, 0);
            results.cancelledWithoutMediaInterruption = true;
            win.webContents.executeJavaScript(
                `document.querySelector('#primary').click()`
            );
            await until(win, stateIs('available'));
            win.webContents.executeJavaScript(
                `document.querySelector('#primary').click()`
            );
            await until(win, stateIs('downloading'));
            win.close();
            win = await panels.about(info, controller);
            await until(win, stateIs('downloading'));
            results.reopenedDuringDownload = true;
            await until(
                win,
                `${stateIs('downloaded')}&&!document.querySelector('#primary').disabled`
            );
            assert.equal(downloads, 2);
            assert.equal(releaseMedia, 0);
            await shot(win, 'ready');
            for (const zoom of [1, 1.25, 1.5, 2]) {
                win.webContents.setZoomFactor(zoom);
                assert.equal(
                    await win.webContents.executeJavaScript(
                        `document.documentElement.scrollWidth<=innerWidth+1`
                    ),
                    true
                );
            }
            win.webContents.setZoomFactor(1);
            win.webContents.executeJavaScript(
                `document.querySelector('#primary').click()`
            );
            let confirmation;
            for (let i = 0; i < 100; i++) {
                confirmation = BrowserWindow.getAllWindows().find(
                    (w) =>
                        w !== parent &&
                        w !== win &&
                        w.getTitle().startsWith('退出并安装')
                );
                if (confirmation) break;
                await new Promise((done) => setTimeout(done, 20));
            }
            assert.ok(confirmation);
            await until(
                confirmation,
                `document.querySelector('#cancel').textContent==='稍后安装'`
            );
            assert.equal(
                await confirmation.webContents.executeJavaScript(
                    `document.activeElement.id`
                ),
                'cancel'
            );
            await shot(confirmation, 'confirm-install');
            await confirmation.webContents.executeJavaScript(
                `document.querySelector('#cancel').click()`
            );
            await until(
                win,
                `${stateIs('downloaded')}&&!document.querySelector('#primary').disabled`
            );
            assert.equal(confirmations, 1);
            assert.equal(releaseMedia, 0);
            const rogue = new BrowserWindow({
                show: false,
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true,
                    preload: join(__dirname, 'panel-preload.cjs'),
                },
            });
            await rogue.loadFile(join(__dirname, 'panel.html'));
            results.unownedWindowDenied =
                await rogue.webContents.executeJavaScript(
                    `voiceSettings.action('install').then(()=>false,()=>true)`
                );
            assert.equal(results.unownedWindowDenied, true);
            rogue.destroy();
            win.close();
            controller.stop();
            // A fresh controller exercises offline feedback in the same real UI.
            mode = 'offline';
            const offline = createUpdates({
                updater: new NsisUpdater(null, adapter),
                app: { getVersion: () => '0.1.3' },
                window: () => parent,
                log: () => {},
                prepareInstall: async () => {},
                confirmInstall: async () => false,
            });
            win = await panels.about(info, offline);
            await until(win, stateIs('idle'));
            try {
                win.webContents.executeJavaScript(
                    `document.querySelector('#primary').click()`
                );
                await until(win, stateIs('error'));
                await shot(win, 'offline');
                assert.equal(
                    await win.webContents.executeJavaScript(
                        `document.querySelector('#primary').textContent`
                    ),
                    '重新检查'
                );
                results.offlineRetry = true;
            } finally {
                offline.stop();
            }
            const picker = new BrowserWindow({
                show: false,
                width: 760,
                height: 680,
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true,
                    backgroundThrottling: false,
                    offscreen: true,
                    preload: join(__dirname, 'picker-preload.cjs'),
                },
            });
            picker.webContents.setAudioMuted(true);
            await picker.loadFile(join(__dirname, 'picker.html'));
            const thumbnail =
                'data:image/svg+xml,' +
                encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e5c7d5"/><rect x="24" y="24" width="270" height="130" rx="12" fill="#fff9fc"/></svg>'
                );
            picker.webContents.send('sources', {
                audioRequested: true,
                sources: [
                    { id: 'screen:0:0', name: 'Synthetic monitor', thumbnail },
                    { id: 'window:1:0', name: '测试窗口 <文本>', thumbnail },
                ],
            });
            await until(
                picker,
                `document.querySelectorAll('.source-card').length===2`
            );
            assert.equal(
                await picker.webContents.executeJavaScript(
                    `document.querySelector('#start').disabled&&document.querySelector('#audio').checked`
                ),
                true
            );
            await picker.webContents.executeJavaScript(
                `document.querySelectorAll('.source-card')[1].click()`
            );
            assert.equal(
                await picker.webContents.executeJavaScript(
                    `document.querySelectorAll('[aria-checked="true"]').length===1&&!document.querySelector('#start').disabled`
                ),
                true
            );
            await shot(picker, 'source-picker');
            const picked = new Promise((resolve) =>
                ipcMain.once('pick-source', (event, value) => {
                    assert.equal(event.sender, picker.webContents);
                    resolve(value);
                })
            );
            await picker.webContents.executeJavaScript(
                `document.querySelector('#start').click()`
            );
            assert.deepEqual(await picked, { id: 'window:1:0', audio: true });
            picker.webContents.send('sources', {
                sources: [],
                audioRequested: false,
            });
            await until(
                picker,
                `document.querySelector('#sources').textContent.includes('未找到')&&document.querySelector('#start').disabled`
            );
            picker.destroy();
            results.sourcePicker =
                'selection, groups, actual bridge, requested audio and empty/reset state';
            results.passed = true;
            results.realLocalUpdater = true;
            results.realProgress = progress;
            results.noInstallerExecuted = true;
            results.audioMuted = true;
            results.work = work;
            writeFileSync(resultPath, JSON.stringify(results, null, 2));
        } finally {
            controller.stop();
            panels.close();
            parent.destroy();
            server.close();
            clearTimeout(timeout);
        }
        app.quit();
    })
    .catch(fail);
