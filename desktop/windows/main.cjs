const {
    app,
    BrowserWindow,
    session,
    desktopCapturer,
    ipcMain,
    screen,
    Menu,
    webContents,
    clipboard,
    ClipboardItem,
    Tray,
    nativeImage,
} = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { createRefresh, isRefreshKey } = require('./refresh.cjs');
const { createAbout } = require('./about.cjs');
const { createPanels } = require('./panels.cjs');
const { createWindowPreferences } = require('./window-preferences.cjs');
const { createWindowLifecycle } = require('./window-lifecycle.cjs');
const { createWindowStartup } = require('./window-startup.cjs');
const { openRoom } = require('./startup-recovery.cjs');
const { createNativeRuntime } = require('./native-runtime.cjs');
const { createFileLog } = require(app.isPackaged
    ? join(process.resourcesPath, 'file-log.cjs')
    : '../../src/utils/RotatingFileLog.cjs');
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
let updates, panels, pendingNotice, windowLifecycle, windowStartup;
let nativeNeedsRecovery = false;
function nativeChanged({ state, port }) {
    nativePort = port;
    if (quitting) return;
    if (state === 'failed') nativeNeedsRecovery = true;
    if (!nativeNeedsRecovery) return;
    const notice = state === 'ready'
        ? { title: '共享组件已恢复', detail: '语音和聊天保持原状。需要共享时，请重新选择画面并开始共享。' }
        : state === 'starting'
          ? { title: '正在恢复共享组件', detail: '请稍候，语音和聊天仍可继续使用。' }
          : { title: '原生共享组件不可用', detail: '语音和聊天仍可用。可以单独恢复组件，然后重新选择共享画面。', recover: true };
    pendingNotice = state === 'ready' ? null : notice;
    if (state === 'ready') nativeNeedsRecovery = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice:notice', notice);
}
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
const desktopLog = createFileLog({ filePath: () => join(app.getPath('userData'), 'desktop.log') });
function log(text) { desktopLog.write(`${new Date().toISOString()} ${text}`); }
function launchNative() {
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
    native = spawn(smoke && process.env.ELIYORK_TEST_NATIVE || join(runtime, 'piik-app.exe'), args, {
        cwd: runtime,
        windowsHide: true,
        stdio: 'pipe',
        env: { ...process.env, PIIK_CLIENT_GATE_NO_BROWSER: 'true', PIIK_SHARE_AUDIO_HOST_PID: String(process.pid) },
    });
    return native;
}
function startNative() {
    nativeReady = nativeRuntime.start();
    void nativeReady.catch(error => log(`native-unavailable ${error.message}`));
    return nativeReady;
}
async function stopNativeChild(child) {
    if (!child || !Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null)
        return;
    await new Promise((done, reject) => {
        let forced;
        const finish = error => {
            clearTimeout(timer); clearTimeout(forced);
            child.removeListener('exit', exited);
            if (error) reject(error); else done();
        };
        const exited = () => finish();
        const timer = setTimeout(() => {
            forced = setTimeout(() => finish(Error('原生组件未能退出，请重试恢复。')), 5000);
            const kill = spawn(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                { windowsHide: true, stdio: 'ignore' }
            );
            kill.once('exit', code => {
                if (child.exitCode !== null || child.signalCode !== null) finish();
                else if (code !== 0) finish(Error('原生组件清理失败，请重试恢复。'));
            });
            kill.once('error', () => finish(Error('原生组件清理失败，请重试恢复。')));
        }, 8000);
        child.once('exit', exited);
        try { child.stdin.end('\n'); } catch { /* Forced tree cleanup still owns the child. */ }
    });
}
const nativeRuntime = createNativeRuntime({ launch: launchNative, stopChild: stopNativeChild, changed: nativeChanged, log });
const stopNative = () => nativeRuntime.stop();
async function recoverNative() {
    if (quitting) return { ok: false };
    try { await startNative(); return { ok: !quitting }; }
    catch { return { ok: false }; } // The state notification supplies a retry action.
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
        icon: join(__dirname, 'assets/app.png'),
        parent: mainWindow,
        modal: true,
        width: 760,
        height: 680,
        minWidth: 580,
        minHeight: 480,
        frame: false,
        show: false,
        backgroundColor: '#fbf7f9',
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
    window.show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => {
        windowLifecycle?.restore();
    });
    app.whenReady()
        .then(async () => {
            mkdirSync(app.getPath('userData'), { recursive: true });
            const windowPreferences = createWindowPreferences(join(app.getPath('userData'), 'window-preferences.json'), log);
            panels = createPanels({ BrowserWindow, ipcMain, screen, window: () => mainWindow, hidden: smoke, log,
                preferences: windowPreferences, trayAvailable: () => windowLifecycle?.trayAvailable() || false });
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
                    const result = await panels.confirm({
                        title: '允许使用麦克风或摄像头？',
                        detail: '仅授权 voice.eliyork.com；设备仍由频道中的媒体按钮控制。',
                        accept: '允许使用', cancel: '暂不允许',
                    }).catch(() => ({ response: 1 }));
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
                icon: join(__dirname, 'assets/app.png'),
                title: '语音据点',
                titleBarStyle: 'hidden',
                titleBarOverlay: { color: '#f4ebf0', symbolColor: '#49333f', height: 40 },
                autoHideMenuBar: true,
                width: 1440,
                height: 940,
                minWidth: 800,
                minHeight: 600,
                show: false,
                backgroundColor: '#fbf7f9',
                webPreferences: {
                    // Tray mode must keep channel/media timers running.
                    backgroundThrottling: false,
                    preload: join(__dirname, 'preload.cjs'),
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
            mainWindow.webContents.setAudioMuted(smoke);
            const makeStartup = () => {
                windowStartup?.dispose();
                windowStartup = createWindowStartup({
                    window: mainWindow, hidden: smoke, trusted,
                    css: readFileSync(join(__dirname, 'titlebar.css'), 'utf8'), log,
                });
                return windowStartup;
            };
            const refreshPage = createRefresh({
                window: () => mainWindow,
                blocked: () => quitting || Boolean(picker),
                confirm: async () => (await panels.confirm({
                    title: '刷新频道页面？',
                    detail: '刷新会断开当前语音并结束共享。页面加载后需要重新加入语音或开始共享。',
                    accept: '刷新页面', cancel: '留在频道',
                })).response === 0,
            });
            const showAbout = createAbout({ app, panels, window: () => mainWindow,
                updates: () => updates, origin, cancelled: () => quitting });
            windowLifecycle = createWindowLifecycle({
                window: mainWindow, Tray, Menu,
                icon: nativeImage.createFromPath(join(__dirname, 'assets/tray.png')),
                preferences: windowPreferences, panels, showSettings: showAbout,
                quit: () => app.quit(), isQuitting: () => quitting,
                beforeHide: () => picker?.close(), log, enableTray: !smoke,
                canRestore: () => windowStartup?.isReady() || false,
            });
            mainWindow.on('session-end', () => { quitting = true; void stopNative().catch(error => log(error.message)); });
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
            ipcMain.handle('voice:native-recover', (event) => {
                if (!allowedFrame(event)) throw Error('Native recovery denied');
                return recoverNative();
            });
            mainWindow.webContents.on('did-finish-load', () => {
                if (pendingNotice && trusted(mainWindow.webContents.getURL()))
                    mainWindow.webContents.send('voice:notice', pendingNotice);
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
                windowLifecycle?.dispose();
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
                                    click: () => void showAbout().then(() => {
                                        if (!['available', 'downloaded'].includes(updates?.snapshot().status)) void updates?.check();
                                    }).catch(error => log(`settings-error ${error.message}`)),
                                },
                                { type: 'separator' },
                                {
                                    label: '刷新频道页面',
                                    accelerator: 'CmdOrCtrl+R',
                                    click: () =>
                                        void refreshPage().catch((error) => log(`refresh-error ${error.message}`)),
                                },
                                {
                                    label: '恢复原生共享组件',
                                    click: () => void recoverNative(),
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
                    window: () => mainWindow,
                    log,
                    changed: () => buildMenu(),
                    preferences: require('./update-preferences.cjs').createUpdatePreferences(
                        join(app.getPath('userData'), 'update-preferences.json'), log),
                    onStartupUpdate: ({ version }) => {
                        const offer = () => {
                            if (quitting || mainWindow.isDestroyed() || updates.snapshot().status !== 'available' ||
                                updates.snapshot().version !== version || updates.snapshot().ignoredVersion === version) return;
                            void showAbout({ startupPrompt: true }).catch(error => log(`update-prompt-error ${error.message}`));
                        };
                        if (mainWindow.isVisible()) offer();
                        else mainWindow.once('show', offer);
                    },
                    prepareInstall: installUpdate,
                    confirmInstall: async (version) => (await panels.confirm({
                        title: `退出并安装 ${version}？`,
                        detail: '安装会结束当前语音和屏幕共享，然后重新打开客户端。\n选择稍后，下载好的更新会保留，不会自动安装。',
                        accept: '退出并安装', cancel: '稍后安装',
                    })).response === 0,
                });
            }
            buildMenu();
            const opened = await openRoom({
                url: `${origin}/room/lobby`, createStartup: makeStartup,
                confirm: options => smoke ? Promise.resolve({ response: 1 }) : panels.confirm(options),
                cancelled: () => quitting || mainWindow.isDestroyed(), log,
            });
            if (!opened) { app.quit(); return; }
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
                    const settingsWindow = await showAbout();
                    result.aboutDialog = await settingsWindow.webContents.executeJavaScript(`new Promise(resolve=>{const poll=()=>{const c=document.querySelector('#client-version');if(c?.textContent)resolve(document.querySelector('#window-title').textContent==='关于与更新'&&document.querySelector('#web-version').textContent.length>0);else setTimeout(poll,20)};poll()})`);
                    result.aboutMuted = settingsWindow.webContents.isAudioMuted();
                    settingsWindow.close();
                    await mainWindow.webContents.executeJavaScript(`document.querySelector('#stageJoinVoice').click()`);
                    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(document.querySelector('#destroyPeer').dataset.sessionAction==='hangup')resolve();else if(Date.now()>end)reject(Error('fake voice join failed'));else setTimeout(poll,50)};poll()})`);
                    const originalConfirm = panels.confirm;
                    let confirmations = 0;
                    const originalPid = native.pid;
                    try {
                        panels.confirm = async () => { confirmations++; return {response:1}; };
                        await mainWindow.webContents.executeJavaScript(`window.__refreshMarker='preserved';document.querySelector('.desktop-refresh').click()`);
                        await new Promise(done => setTimeout(done, 150));
                        result.refreshCancelled = confirmations === 1 && await mainWindow.webContents.executeJavaScript(`window.__refreshMarker==='preserved' && document.querySelector('#destroyPeer').dataset.sessionAction==='hangup'`);
                        panels.confirm = async () => { confirmations++; return {response:0}; };
                        const reloaded = new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
                        // sendInputEvent targets this hidden test window only.
                        mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'R',modifiers:['control']});
                        mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'R',modifiers:['control']});
                        await reloaded;
                        await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(document.documentElement.dataset.roomBoot==='ready')resolve();else if(Date.now()>end)reject(Error('reload boot failed'));else setTimeout(poll,50)};poll()})`);
                        result.refreshKeptNative = confirmations === 2 && native.pid === originalPid && await mainWindow.webContents.executeJavaScript(`fetch('http://127.0.0.1:${nativePort}/health').then(r=>r.ok)`);
                    } finally {
                        panels.confirm = originalConfirm;
                    }
                    if (!result.refreshCancelled || !result.refreshKeptNative || !result.menuHidden || result.windowTitle !== '语音据点') throw Error(JSON.stringify(result));
                    // Stop only this isolated App. The page and joined voice
                    // membership must survive a component-only recovery.
                    await mainWindow.webContents.executeJavaScript(`document.querySelector('#stageJoinVoice').click()`);
                    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>{if(document.querySelector('#main').dataset.voiceState==='joined')resolve();else if(Date.now()>end)reject(Error('voice rejoin before recovery failed'));else setTimeout(poll,50)};poll()})`);
                    const failedPid = native.pid;
                    await mainWindow.webContents.executeJavaScript(`window.__nativeRecoveryMarker = 'same-room'`);
                    await stopNativeChild(native);
                    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+3000;const poll=()=>{const button=document.querySelector('.desktop-notice button');if(button?.textContent==='恢复共享组件')resolve();else if(Date.now()>end)reject(Error('native recovery notice missing'));else setTimeout(poll,20)};poll()})`);
                    await mainWindow.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
                    await new Promise(resolve => setTimeout(resolve, 150));
                    writeFileSync(join(app.getPath('userData'), 'desktop-native-recovery.png'), (await mainWindow.webContents.capturePage()).toPNG());
                    await mainWindow.webContents.executeJavaScript(`document.querySelector('.desktop-notice button').click()`);
                    await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+35000;const poll=()=>{if(document.querySelector('.desktop-notice strong')?.textContent==='共享组件已恢复')resolve();else if(Date.now()>end)reject(Error('native recovery notice timeout'));else setTimeout(poll,20)};poll()})`);
                    result.nativeRecovery = native.pid !== failedPid &&
                        await mainWindow.webContents.executeJavaScript(`window.__nativeRecoveryMarker === 'same-room' && document.querySelector('#main').dataset.voiceState === 'joined'`);
                    result.recoveredNativeHealth = await mainWindow.webContents.executeJavaScript(`fetch('http://127.0.0.1:${nativePort}/health').then(r=>r.status)`);
                    const recoveredPid = native.pid;
                    await recoverNative();
                    result.healthyNativeKept = native.pid === recoveredPid;
                    if (!result.nativeRecovery || result.recoveredNativeHealth !== 200 || !result.healthyNativeKept)
                        throw Error('Native recovery failed');
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
        .catch(async (error) => {
            if (quitting) return;
            windowStartup?.dispose();
            log(error.stack);
            if (!smoke && panels) await panels.confirm({
                title: '暂时无法打开语音据点',
                detail: '请检查网络后重新打开客户端。原有设置会保留；详细原因已记录在本地日志中。',
                accept: '关闭客户端', cancel: '关闭',
            }).catch(() => {});
            process.exitCode = 1;
            app.quit();
        });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', (event) => {
        updates?.stop();
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        windowStartup?.dispose();
        windowLifecycle?.dispose();
        picker?.close();
        panels?.close();
        void stopNative().catch(error => log(error.message)).finally(() => app.quit());
    });
}
