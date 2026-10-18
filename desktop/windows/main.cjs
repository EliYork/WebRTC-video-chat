const {
    app,
    BrowserWindow,
    session,
    desktopCapturer,
    ipcMain,
    dialog,
    Menu,
    webContents,
} = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, appendFileSync, writeFileSync } = require('node:fs');
const smoke = process.argv.includes('--smoke-test');
const origin = smoke
    ? new URL(process.env.ELIYORK_TEST_ORIGIN || 'http://127.0.0.1:3300').origin
    : 'https://voice.eliyork.com';
if (smoke) {
    app.commandLine.appendSwitch('mute-audio');
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
    app.disableHardwareAcceleration();
    if (process.env.ELIYORK_TEST_USER_DATA)
        app.setPath('userData', process.env.ELIYORK_TEST_USER_DATA);
}
app.setName('EliYork Voice');
app.setAppUserModelId('com.eliyork.voice');
let mainWindow,
    native,
    picker,
    quitting = false,
    nativeReady,
    nativePort;
const mediaAllowed = new Set();
const trusted = (value) => {
    try {
        return new URL(value).origin === origin;
    } catch {
        return false;
    }
};
const owned = (contents, value) =>
    contents === mainWindow?.webContents && trusted(value);
function log(text) {
    appendFileSync(
        join(app.getPath('userData'), 'desktop.log'),
        `${new Date().toISOString()} ${text}\n`
    );
}
function startNative() {
    const directory = join(app.getPath('userData'), 'native');
    mkdirSync(directory, { recursive: true });
    const runtime = app.isPackaged
        ? join(process.resourcesPath, 'native')
        : join(__dirname, '../../integrations/piik/.build');
    const args = [
        '--site',
        origin,
        '--config',
        join(directory, 'app.json'),
        '--debug',
        '--log-dir',
        join(directory, 'logs'),
    ];
    if (smoke && process.env.ELIYORK_TEST_CAPTURE)
        args.push('--capture-process', process.env.ELIYORK_TEST_CAPTURE);
    native = spawn(join(runtime, 'piik-app.exe'), args, {
        cwd: runtime,
        windowsHide: true,
        stdio: 'pipe',
        env: { ...process.env, PIIK_CLIENT_GATE_NO_BROWSER: 'true' },
    });
    const child = native;
    child.stdin.on('error', () => {});
    log(`native-start pid=${child.pid}`);
    let output = '';
    nativeReady = new Promise((resolveReady, reject) => {
        child.stdout.on('data', (bytes) => {
            output = (output + bytes).slice(-65536); // Capability never written to disk or renderer.
            const endpoint = output
                .split(/\r?\n/)
                .find(
                    (line) =>
                        line.startsWith('{') && line.includes('instanceToken')
                );
            if (endpoint) {
                nativePort = JSON.parse(endpoint).port;
                resolveReady();
            }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            log(`native-exit code=${code}`);
            reject(new Error('原生共享组件已退出，请重启客户端。'));
            if (!quitting && !smoke)
                void dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    message: '原生共享组件已退出',
                    detail: '语音和聊天仍可用。需要原生共享时请重启 EliYork Voice。',
                });
        });
    });
    // App's structured diagnostics own native stderr; don't persist raw capability-bearing output.
    child.stderr.on('data', () => {});
    nativeReady.catch((error) => log(error.message));
}
async function stopNative() {
    if (!native || native.exitCode !== null || native.signalCode !== null)
        return;
    const child = native;
    await new Promise((done) => {
        const timer = setTimeout(() => {
            const kill = spawn(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                { windowsHide: true, stdio: 'ignore' }
            );
            kill.once('exit', done);
            kill.once('error', done);
        }, 8000);
        child.once('exit', () => {
            clearTimeout(timer);
            done();
        });
        child.stdin.end('\n');
    });
}
async function chooseSource(request, callback) {
    if (
        !request.frame ||
        !owned(webContents.fromFrame(request.frame), request.frame.url) ||
        request.frame !== mainWindow.webContents.mainFrame ||
        picker
    )
        return callback({});
    if (smoke) return callback({ video: request.frame });
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
    });
    if (quitting || mainWindow.isDestroyed()) return callback({});
    const window = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        width: 760,
        height: 680,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, 'picker-preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    picker = window;
    let answered = false;
    const selected = (event, selection) => {
        if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
        )
            return;
        const source = sources.find((s) => s.id === selection?.id);
        if (!source || answered) return;
        answered = true;
        callback({
            video: source,
            ...(request.audioRequested && selection.audio === true
                ? { audio: 'loopback' }
                : {}),
        });
        window.close();
    };
    ipcMain.on('pick-source', selected);
    window.on('closed', () => {
        ipcMain.off('pick-source', selected);
        picker = null;
        if (!answered) callback({});
    });
    await window.loadFile(join(__dirname, 'picker.html'));
    window.webContents.send('sources', {
        sources: sources.map((s) => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
        })),
        audioRequested: request.audioRequested,
    });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => {
        if (mainWindow) {
            mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady()
        .then(async () => {
            mkdirSync(app.getPath('userData'), { recursive: true });
            startNative();
            const permissions = new Set([
                'fullscreen',
                'speaker-selection',
                'local-network',
                'loopback-network',
                'local-network-access',
                'display-capture',
            ]);
            session.defaultSession.setPermissionCheckHandler(
                (contents, permission, requestingOrigin) =>
                    owned(contents, requestingOrigin) &&
                    (permissions.has(permission) ||
                        (permission === 'media' &&
                            mediaAllowed.has(permission)))
            );
            session.defaultSession.setPermissionRequestHandler(
                async (contents, permission, callback, details) => {
                    if (
                        !owned(
                            contents,
                            details.requestingUrl || contents.getURL()
                        ) ||
                        details.isMainFrame === false
                    )
                        return callback(false);
                    if (permissions.has(permission)) return callback(true);
                    if (permission !== 'media') return callback(false);
                    if (smoke || mediaAllowed.has(permission))
                        return callback(true);
                    const result = await dialog.showMessageBox(mainWindow, {
                        type: 'question',
                        message: '允许 EliYork Voice 使用麦克风或摄像头？',
                        detail: '仅授权 voice.eliyork.com；设备仍由频道中的媒体按钮控制。',
                        buttons: ['允许', '拒绝'],
                        defaultId: 1,
                        cancelId: 1,
                    });
                    if (result.response === 0) mediaAllowed.add(permission);
                    callback(result.response === 0);
                }
            );
            session.defaultSession.setDisplayMediaRequestHandler(
                (request, callback) => {
                    void chooseSource(request, callback).catch((error) => {
                        log(`picker-error ${error.message}`);
                        callback({});
                    });
                }
            );
            mainWindow = new BrowserWindow({
                title: 'EliYork Voice',
                width: 1440,
                height: 940,
                minWidth: 800,
                minHeight: 600,
                show: !smoke,
                backgroundColor: '#151923',
                webPreferences: {
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
            mainWindow.webContents.setAudioMuted(smoke);
            mainWindow.webContents.on('page-title-updated', (event) => {
                event.preventDefault();
                mainWindow.setTitle('EliYork Voice');
            });
            mainWindow.webContents.setWindowOpenHandler(() => ({
                action: 'deny',
            }));
            mainWindow.webContents.on('will-navigate', (event, url) => {
                if (!trusted(url)) event.preventDefault();
            });
            mainWindow.webContents.on('will-redirect', (event, url) => {
                if (!trusted(url)) event.preventDefault();
            });
            Menu.setApplicationMenu(
                Menu.buildFromTemplate([
                    {
                        label: 'EliYork Voice',
                        submenu: [
                            {
                                label: '刷新频道页面',
                                accelerator: 'CmdOrCtrl+R',
                                click: () => mainWindow.webContents.reload(),
                            },
                            {
                                label: '诊断工具',
                                accelerator: 'F12',
                                click: () =>
                                    mainWindow.webContents.toggleDevTools(),
                            },
                            { type: 'separator' },
                            { role: 'quit', label: '退出' },
                        ],
                    },
                ])
            );
            await mainWindow.loadURL(`${origin}/room/lobby`);
            if (smoke) {
                try {
                    await Promise.race([
                        nativeReady,
                        new Promise((_, reject) =>
                            setTimeout(
                                () => reject(Error('native startup timed out')),
                                30000
                            )
                        ),
                    ]);
                    await mainWindow.webContents.executeJavaScript(
                        `new Promise((resolve,reject)=>{const end=Date.now()+15000;const wait=()=>{if(document.documentElement.dataset.roomBoot==='ready')resolve();else if(Date.now()>end)reject(Error('room boot timeout'));else setTimeout(wait,100)};wait()})`
                    );
                    const media =
                        await mainWindow.webContents.executeJavaScript(
                            `(async()=>{const mic=await navigator.mediaDevices.getUserMedia({audio:true});const microphone=mic.getAudioTracks().length;mic.getTracks().forEach(t=>t.stop());const screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const display=screen.getVideoTracks().length;screen.getTracks().forEach(t=>t.stop());return {microphone,display}})()`,
                            true
                        );
                    const result =
                        await mainWindow.webContents.executeJavaScript(
                            `({url:location.origin,secure:isSecureContext,media:!!navigator.mediaDevices,displayCapture:typeof navigator.mediaDevices?.getDisplayMedia,nodeExposed:typeof require!=='undefined',roomReady:document.documentElement.dataset.roomBoot==='ready'})`
                        );
                    result.nativeHealth =
                        await mainWindow.webContents.executeJavaScript(
                            `fetch('http://127.0.0.1:${nativePort}/health').then(r=>r.status)`
                        );
                    if (
                        result.url !== origin ||
                        result.nodeExposed ||
                        !result.media ||
                        media.microphone !== 1 ||
                        media.display !== 1 ||
                        result.nativeHealth !== 200
                    )
                        throw Error(JSON.stringify({ result, media }));
                    writeFileSync(
                        process.env.ELIYORK_TEST_REPORT,
                        JSON.stringify({
                            ...result,
                            ...media,
                            nativePid: native.pid,
                            audioMuted: mainWindow.webContents.isAudioMuted(),
                            sandbox: true,
                        })
                    );
                } catch (error) {
                    log(error.stack);
                    process.exitCode = 1;
                }
                app.quit();
            }
        })
        .catch((error) => {
            log(error.stack);
            if (!smoke)
                dialog.showErrorBox('EliYork Voice 启动失败', error.message);
            process.exitCode = 1;
            app.quit();
        });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        picker?.close();
        void stopNative().finally(() => app.quit());
    });
}
