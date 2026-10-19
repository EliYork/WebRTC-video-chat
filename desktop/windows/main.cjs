const {
    app,
    BrowserWindow,
    session,
    desktopCapturer,
    ipcMain,
    dialog,
    Menu,
    webContents,
    clipboard,
    ClipboardItem,
} = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, appendFileSync, writeFileSync, readFileSync } = require('node:fs');
const { createRefresh, isRefreshKey } = require('./refresh.cjs');
const { createAbout } = require('./about.cjs');
const smoke = process.argv.includes('--smoke-test');
// Explicit development preview only; installed clients keep the fixed origin.
const previewArg = !app.isPackaged && process.argv.find(arg => arg.startsWith('--preview-origin='));
const preview = previewArg && new URL(previewArg.slice('--preview-origin='.length));
if (preview && (preview.protocol !== 'http:' || preview.hostname !== '127.0.0.1' || preview.username || preview.password || preview.pathname !== '/' || preview.search || preview.hash))
    throw Error('Preview requires a plain loopback HTTP origin');
const origin = smoke
    ? new URL(process.env.ELIYORK_TEST_ORIGIN || 'http://127.0.0.1:3300').origin
    : preview ? preview.origin : 'https://voice.eliyork.com';
if (preview) app.setPath('userData', process.env.ELIYORK_PREVIEW_USER_DATA || join(app.getPath('appData'), 'EliYork Voice UI Preview'));
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
let updates;
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
            ipcMain.handle('voice:clipboard-write', async (event, text) => {
                if (
                    !owned(event.sender, event.senderFrame?.url) ||
                    event.senderFrame !== mainWindow.webContents.mainFrame ||
                    typeof text !== 'string' ||
                    Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024
                )
                    throw Error('Clipboard write denied');
                await clipboard.writeText(text);
            });
            const permissions = new Set([
                'fullscreen',
                'speaker-selection',
                'local-network',
                'loopback-network',
                'local-network-access',
                'display-capture',
                'clipboard-sanitized-write',
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
                title: '语音据点',
                titleBarStyle: 'hidden',
                titleBarOverlay: { color: '#f4ebf0', symbolColor: '#49333f', height: 40 },
                autoHideMenuBar: true,
                width: 1440,
                height: 940,
                minWidth: 800,
                minHeight: 600,
                show: !smoke,
                backgroundColor: '#151923',
                webPreferences: {
                    preload: join(__dirname, 'preload.cjs'),
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
            mainWindow.webContents.setAudioMuted(smoke);
            const refreshPage = createRefresh({
                window: () => mainWindow,
                blocked: () => quitting || Boolean(picker),
                confirm: async (win) => (await dialog.showMessageBox(win, {
                    type: 'question',
                    message: '刷新频道页面？',
                    detail: '刷新会断开当前语音并结束共享。页面加载后需要重新加入语音或开始共享。',
                    buttons: ['取消', '刷新页面'],
                    defaultId: 0,
                    cancelId: 0,
                    noLink: true,
                })).response === 1,
            });
            const showAbout = createAbout({ app, dialog, window: () => mainWindow,
                updates: () => updates, origin });
            const allowedFrame = (event) =>
                owned(event.sender, event.senderFrame?.url) &&
                event.senderFrame === mainWindow.webContents.mainFrame;
            ipcMain.handle('voice:refresh', (event) => {
                if (!allowedFrame(event)) throw Error('Refresh denied');
                return refreshPage();
            });
            ipcMain.handle('voice:menu', (event) => {
                if (!allowedFrame(event)) throw Error('Menu denied');
                Menu.getApplicationMenu()?.items[0]?.submenu?.popup({ window: mainWindow });
            });
            mainWindow.webContents.on('dom-ready', () => {
                if (trusted(mainWindow.webContents.getURL()))
                    void mainWindow.webContents.insertCSS(readFileSync(join(__dirname, 'titlebar.css'), 'utf8'));
            });
            mainWindow.webContents.on('before-input-event', (event, input) => {
                if (isRefreshKey(input)) {
                    event.preventDefault();
                    void refreshPage().catch((error) => log(`refresh-error ${error.message}`));
                } else if (input.type === 'keyDown' && input.key === 'F12') {
                    event.preventDefault();
                    mainWindow.webContents.toggleDevTools();
                }
            });
            mainWindow.webContents.on('page-title-updated', (event) => {
                event.preventDefault();
                mainWindow.setTitle('语音据点');
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
            const installUpdate = async () => {
                quitting = true;
                picker?.close();
                await stopNative();
            };
            const buildMenu = () => {
                Menu.setApplicationMenu(
                    Menu.buildFromTemplate([
                        {
                            label: '应用',
                            submenu: [
                                {
                                    label: '关于与更新…',
                                    click: () => void showAbout().catch(error => log(`about-error ${error.message}`)),
                                },
                                {
                                    label:
                                        updates?.label() || '检查更新（开发预览不可用）',
                                    enabled: Boolean(updates),
                                    click: () => void updates?.check(),
                                },
                                { type: 'separator' },
                                {
                                    label: '刷新频道页面',
                                    accelerator: 'CmdOrCtrl+R',
                                    click: () =>
                                        void refreshPage().catch((error) => log(`refresh-error ${error.message}`)),
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
                // Keep the menu available via ⋯ without another native row.
                mainWindow.removeMenu();
            };
            if (!smoke && app.isPackaged) {
                updates = require('./updater.cjs').createUpdates({
                    updater: require('electron-updater').autoUpdater,
                    app,
                    dialog,
                    window: () => mainWindow,
                    log,
                    changed: () => buildMenu(),
                    prepareInstall: installUpdate,
                });
            }
            buildMenu();
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
                    result.updaterLoaded =
                        typeof require('electron-updater').NsisUpdater ===
                        'function';
                    result.qualityLabelFits = await mainWindow.webContents
                        .executeJavaScript(`(() => {
                        const tile = document.createElement('div');
                        tile.className = 'video-tile is-screen-share';
                        tile.style.width = '220px';
                        tile.innerHTML = '<div class="tile-header"><div class="window-title-region">测试共享</div><div class="tile-header-controls"><div class="tile-header-actions"><button class="fullscreen-btn">⛶</button></div></div></div>';
                        document.body.append(tile);
                        const badge = VoiceMediaQualityView.render(tile, '4K · 60fps', '播放');
                        const fits = badge.scrollWidth <= badge.clientWidth && badge.textContent.includes('60fps');
                        tile.remove(); return fits;
                    })()`);
                    result.nativeHealth =
                        await mainWindow.webContents.executeJavaScript(
                            `fetch('http://127.0.0.1:${nativePort}/health').then(r=>r.status)`
                        );
                    const chromeGeometry = () => mainWindow.webContents.executeJavaScript(`(() => {
                        const r = document.querySelector('.desktop-refresh').getBoundingClientRect();
                        const h = document.querySelector('.workspace-topbar').getBoundingClientRect();
                        const a = navigator.windowControlsOverlay.getTitlebarAreaRect();
                        return { overlay: navigator.windowControlsOverlay.visible, area: {x:a.x,y:a.y,width:a.width,height:a.height},
                            refresh: {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right},
                            header: {x:h.x,y:h.y,width:h.width,height:h.height},
                            drag: getComputedStyle(document.querySelector('.workspace-topbar')).webkitAppRegion,
                            noDrag: getComputedStyle(document.querySelector('.desktop-refresh')).webkitAppRegion,
                            titleCount: [...document.querySelectorAll('.workspace-brand strong, .server-navigation strong')].filter(n=>n.getBoundingClientRect().width>0).map(n=>n.textContent) };
                    })()`);
                    result.chromeCases = [];
                    for (const size of [[1440,940,1], [800,600,1], [1920,1080,1.25], [2560,1440,1.5], [3840,2160,2]]) {
                        mainWindow.setSize(size[0], size[1]);
                        mainWindow.webContents.setZoomFactor(size[2]);
                        // eslint-disable-next-line no-await-in-loop -- Wait for this hidden window's geometry.
                        await new Promise(done => setTimeout(done, 150));
                        // eslint-disable-next-line no-await-in-loop -- Measure each size/zoom.
                        const geometry = await chromeGeometry();
                        if (!geometry.overlay || geometry.header.x !== 0 || geometry.header.y !== 0 ||
                            Math.abs(geometry.refresh.right - geometry.area.width) > 2 ||
                            geometry.drag !== 'drag' || geometry.noDrag !== 'no-drag' ||
                            geometry.titleCount.join() !== '语音据点') throw Error(JSON.stringify(geometry));
                        result.chromeCases.push({ size, geometry });
                    }
                    mainWindow.setSize(1440, 940);
                    mainWindow.webContents.setZoomFactor(1);
                    result.windowTitle = mainWindow.getTitle();
                    result.menuHidden = !mainWindow.isMenuBarVisible();
                    result.settingsEntry = await mainWindow.webContents.executeJavaScript(`document.querySelector('.desktop-menu')?.textContent.includes('设置')`);
                    const settingsDialog = dialog.showMessageBox;
                    try {
                        dialog.showMessageBox = async (_, options) => {
                            result.aboutDialog = options.title === '关于与更新' &&
                                options.detail.includes('客户端版本：') && options.detail.includes('网页版本：');
                            return {response: options.cancelId};
                        };
                        await showAbout();
                    } finally { dialog.showMessageBox = settingsDialog; }
                    await mainWindow.webContents.executeJavaScript(`document.querySelector('#stageJoinVoice').click()`);
                    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(document.querySelector('#destroyPeer').dataset.sessionAction==='hangup')resolve();else if(Date.now()>end)reject(Error('fake voice join failed'));else setTimeout(poll,50)};poll()})`);
                    const originalConfirm = dialog.showMessageBox;
                    let confirmations = 0;
                    const originalPid = native.pid;
                    try {
                        dialog.showMessageBox = async () => { confirmations++; return {response:0}; };
                        await mainWindow.webContents.executeJavaScript(`window.__refreshMarker='preserved';document.querySelector('.desktop-refresh').click()`);
                        await new Promise(done => setTimeout(done, 150));
                        result.refreshCancelled = confirmations === 1 && await mainWindow.webContents.executeJavaScript(`window.__refreshMarker==='preserved' && document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`);
                        dialog.showMessageBox = async () => { confirmations++; return {response:1}; };
                        const reloaded = new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
                        // sendInputEvent targets this hidden test window only.
                        mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'R',modifiers:['control']});
                        mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'R',modifiers:['control']});
                        await reloaded;
                        await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(document.documentElement.dataset.roomBoot==='ready')resolve();else if(Date.now()>end)reject(Error('reload boot failed'));else setTimeout(poll,50)};poll()})`);
                        result.refreshKeptNative = confirmations === 2 && native.pid === originalPid && await mainWindow.webContents.executeJavaScript(`fetch('http://127.0.0.1:${nativePort}/health').then(r=>r.ok)`);
                    } finally {
                        dialog.showMessageBox = originalConfirm;
                    }
                    if (!result.refreshCancelled || !result.refreshKeptNative || !result.menuHidden || result.windowTitle !== '语音据点') throw Error(JSON.stringify(result));
                    writeFileSync(join(app.getPath('userData'), 'desktop-chrome.png'), (await mainWindow.webContents.capturePage()).toPNG());
                    // Verify real renderer -> OS clipboard, without exposing or
                    // losing the user's clipboard. Do not restore over a new copy.
                    const previousClipboard = await Promise.all(
                        (await clipboard.read()).map(async (item) => {
                            const entries = await Promise.all(
                                item.types.map(async (type) => [
                                    type,
                                    await item.getType(type),
                                ])
                            );
                            return new ClipboardItem(
                                Object.fromEntries(entries)
                            );
                        })
                    );
                    const marker = `EliYork clipboard smoke ${Date.now()}`;
                    let writtenText = marker;
                    try {
                        // Same delayed path used by Copy diagnostics, no active
                        // user gesture and no mock navigator.clipboard.
                        await mainWindow.webContents.executeJavaScript(
                            `EliYorkDesktop.writeClipboardText(${JSON.stringify(marker)})`
                        );
                        result.clipboardWrite =
                            (await clipboard.readText()) === marker;
                        await mainWindow.webContents.executeJavaScript(
                            `document.querySelector('[data-copy-call-diagnostics]').click()`
                        );
                        for (let attempt = 0; attempt < 110; attempt++) {
                            // eslint-disable-next-line no-await-in-loop -- Poll this one clipboard operation in order.
                            const value = await clipboard.readText();
                            if (value !== marker) {
                                const data = JSON.parse(value);
                                result.diagnosticsCopied = data.诊断格式 >= 4;
                                result.diagnosticVersions = {
                                    web: data.网页版本,
                                    desktop: data.客户端版本,
                                    schema: data.诊断格式,
                                };
                                writtenText = value;
                                break;
                            }
                            // eslint-disable-next-line no-await-in-loop -- Bound the asynchronous OS clipboard check.
                            await new Promise((done) => setTimeout(done, 100));
                        }
                        result.clipboardReadDenied =
                            await mainWindow.webContents.executeJavaScript(
                                `navigator.clipboard.readText().then(()=>false,()=>true)`
                            );
                    } finally {
                        const currentText = await clipboard.readText();
                        if (currentText === writtenText) {
                            if (previousClipboard.length)
                                await clipboard.write(previousClipboard);
                            else clipboard.clear();
                        }
                    }
                    if (
                        result.url !== origin ||
                        result.nodeExposed ||
                        !result.media ||
                        media.microphone !== 1 ||
                        media.display !== 1 ||
                        result.nativeHealth !== 200 ||
                        !result.clipboardWrite ||
                        !result.clipboardReadDenied ||
                        !result.diagnosticsCopied ||
                        !result.qualityLabelFits
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
                    log(error.stack || String(error));
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
        updates?.stop();
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        picker?.close();
        void stopNative().finally(() => app.quit());
    });
}
