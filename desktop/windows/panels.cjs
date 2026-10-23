const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const creditLinks = new Set([
    'https://github.com/TNTcraftHIM/Piik',
    'https://github.com/pion/webrtc',
    'https://github.com/nlukic97/WebRTC-video-chat',
    'https://github.com/nlukic97/WebSocket-Cursor-Room',
    'https://github.com/peers/peerjs',
    'https://github.com/versatica/mediasoup',
    'https://github.com/sapphi-red/web-noise-suppressor',
    'https://github.com/xiph/rnnoise',
    'https://github.com/shiguredo/rnnoise-wasm',
    'https://github.com/workadventure/noise-suppression',
    'https://github.com/Rikorose/DeepFilterNet',
    'https://github.com/electron/electron',
]);
function createPanels({
    BrowserWindow,
    ipcMain,
    window,
    screen,
    hidden = false,
    log,
    preferences,
    trayAvailable = () => false,
    openExternal = (url) => require('electron').shell.openExternal(url),
}) {
    const entries = new Map();
    const url = pathToFileURL(join(__dirname, 'panel.html')).href;
    let aboutEntry = null, updateEntry = null,
        confirmation = null;
    // A matching URL alone is insufficient: only an owned local window may act.
    const valid = (event) => {
        const entry = entries.get(event.sender.id);
        if (
            !entry ||
            entry.win.isDestroyed() ||
            entry.closing ||
            event.senderFrame !== entry.win.webContents.mainFrame ||
            event.senderFrame.url !== url
        )
            throw Error('Settings action denied');
        return entry;
    };
    const send = (entry) => {
        if (
            !entry.closing &&
            !entry.win.isDestroyed() &&
            !entry.win.webContents.isDestroyed()
        )
            entry.win.webContents.send('voice-panel:state', entry.state);
    };
    ipcMain.handle('voice-panel:read', (event) => valid(event).state);
    ipcMain.handle('voice-panel:action', async (event, action, value) => {
        const entry = valid(event);
        if (action === 'open-credit') {
            if (entry.state.kind !== 'about' || !creditLinks.has(value)) throw Error('Unknown project link');
            await openExternal(value);
            return;
        }
        if (action === 'close') {
            entry.win.close();
            return;
        }
        if (action === 'ignore-update') {
            if (entry.state.kind !== 'update' || typeof value !== 'string') throw Error('Invalid update choice');
            if (entry.updates?.ignoreVersion(value)) entry.win.close();
            return;
        }
        if (entry.state.kind === 'close-choice') {
            if (
                action !== 'choose-close' ||
                !['tray', 'quit', 'cancel'].includes(value?.action) ||
                typeof value.remember !== 'boolean' ||
                (value.action === 'tray' && !entry.state.trayAvailable)
            )
                throw Error('Invalid close choice');
            entry.choice = { action: value.action, remember: value.remember };
            entry.win.close();
            return;
        }
        if (entry.state.kind === 'confirm') {
            if (!['accept', 'cancel'].includes(action))
                throw Error('Unknown confirmation action');
            entry.answer = action === 'accept' ? 0 : 1;
            entry.win.close();
            return;
        }
        if (action === 'close-behavior' && preferences) {
            if (
                !['ask', 'tray', 'quit'].includes(value) ||
                (value === 'tray' && !trayAvailable())
            )
                throw Error('Invalid window preference');
            entry.state.preferences = preferences.setCloseBehavior(value);
            send(entry);
            return;
        }
        if (!['check', 'download', 'cancel', 'install'].includes(action))
            throw Error('Unknown settings action');
        if (entry.updates) await entry.updates[action]();
    });
    function create(state, modal = false) {
        const parent = modal ? (aboutEntry?.win || updateEntry?.win || window()) : window();
        const bounds =
            parent && !parent.isDestroyed() ? parent.getBounds() : null;
        const work = bounds && screen.getDisplayMatching(bounds).workArea;
        const width = Math.min(
            state.kind === 'about' ? 560 : 480,
            work?.width || 560
        );
        const height = Math.min(
            state.kind === 'about'
                ? 790
                : state.kind === 'update' ? 520
                : state.kind === 'close-choice'
                  ? 470
                  : 350,
            work?.height || 650
        );
        const position = bounds && {
            x: Math.max(
                work.x,
                Math.min(
                    bounds.x + Math.round((bounds.width - width) / 2),
                    work.x + work.width - width
                )
            ),
            y: Math.max(
                work.y,
                Math.min(
                    bounds.y + Math.round((bounds.height - height) / 2),
                    work.y + work.height - height
                )
            ),
        };
        const win = new BrowserWindow({
            icon: join(__dirname, 'assets/app.png'),
            // A startup failure must not reveal the still-hidden main window
            // behind its local error dialog.
            ...(parent && !parent.isDestroyed() && parent.isVisible() ? { parent, modal } : {}),
            ...position,
            width,
            height,
            minWidth: Math.min(width, 420),
            minHeight: Math.min(height, 330),
            title: state.kind === 'about' ? '关于与更新' : state.title,
            frame: false,
            show: false,
            resizable: ['about', 'update'].includes(state.kind),
            autoHideMenuBar: true,
            backgroundColor: '#fbf7f9',
            webPreferences: {
                preload: join(__dirname, 'panel-preload.cjs'),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                // Hidden automation must keep its own renderer responsive.
                backgroundThrottling: !hidden,
                offscreen: hidden,
            },
        });
        win.removeMenu();
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event) => event.preventDefault());
        const id = win.webContents.id;
        const entry = {
            win,
            state,
            answer: 1,
            updates: null,
            unsubscribe: null,
            closing: false,
        };
        entries.set(id, entry);
        win.once('close', () => {
            // close() precedes destroyed/closed. A quick reopen must create a
            // fresh window rather than reuse a renderer that is unloading.
            entry.closing = true;
            entry.unsubscribe?.();
            entry.unsubscribe = null;
            if (aboutEntry === entry) aboutEntry = null;
            if (updateEntry === entry) updateEntry = null;
        });
        win.once('closed', () => {
            entries.delete(id);
            entry.unsubscribe?.();
            if (aboutEntry === entry) aboutEntry = null;
            entry.resolve?.(
                entry.state.kind === 'close-choice'
                    ? entry.choice || { action: 'cancel', remember: false }
                    : { response: entry.answer }
            );
        });
        entry.ready = win
            .loadFile(join(__dirname, 'panel.html'))
            .then(() => {
                send(entry);
                if (!hidden && !entry.closing && !win.isDestroyed()) win.show();
                return win;
            })
            .catch((error) => {
                log(`panel-load-error ${error.message}`);
                if (!win.isDestroyed()) win.close();
                throw error;
            });
        return entry;
    }
    return {
        async about(info, updates) {
            if (updateEntry && !updateEntry.win.isDestroyed()) updateEntry.win.close();
            if (
                aboutEntry &&
                !aboutEntry.closing &&
                !aboutEntry.win.isDestroyed()
            ) {
                aboutEntry.state.info = info;
                send(aboutEntry);
                if (!hidden) {
                    aboutEntry.win.restore();
                    aboutEntry.win.focus();
                }
                return aboutEntry.ready;
            }
            const entry = create({
                kind: 'about',
                info,
                update: updates?.snapshot() || null,
                preferences: preferences?.snapshot() || null,
                trayAvailable: trayAvailable(),
            });
            aboutEntry = entry;
            entry.updates = updates;
            entry.unsubscribe = updates?.subscribe((state) => {
                entry.state.update = state;
                send(entry);
            });
            return entry.ready;
        },
        async updatePrompt(info, updates) {
            // An already open settings window already observes the same update.
            if (aboutEntry && !aboutEntry.closing && !aboutEntry.win.isDestroyed()) return aboutEntry.ready;
            if (updateEntry && !updateEntry.closing && !updateEntry.win.isDestroyed()) return updateEntry.ready;
            const entry = create({ kind: 'update', title: '客户端更新', info, update: updates.snapshot() });
            updateEntry = entry;
            entry.updates = updates;
            entry.unsubscribe = updates.subscribe(state => { entry.state.update = state; send(entry); });
            return entry.ready;
        },
        async confirm(options) {
            // Do not stack confirmations or reuse one answer across different actions.
            if (confirmation) return { response: 1 };
            const entry = create({ kind: 'confirm', ...options }, true);
            confirmation = entry;
            try {
                const answer = new Promise((resolve) => {
                    entry.resolve = resolve;
                });
                await entry.ready;
                return await answer;
            } finally {
                confirmation = null;
            }
        },
        async chooseClose(options) {
            if (confirmation) return { action: 'cancel', remember: false };
            const entry = create(
                { kind: 'close-choice', title: '关闭窗口', ...options },
                true
            );
            confirmation = entry;
            try {
                const answer = new Promise((resolve) => {
                    entry.resolve = resolve;
                });
                await entry.ready;
                return await answer;
            } finally {
                confirmation = null;
            }
        },
        close() {
            for (const entry of [...entries.values()]) {
                if (!entry.win.isDestroyed()) entry.win.close();
            }
        },
    };
}
module.exports = { createPanels };
