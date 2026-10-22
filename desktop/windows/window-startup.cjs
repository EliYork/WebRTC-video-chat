// Never expose the initial empty Chromium surface. Wait for the real room and
// its existing title bar to paint; a deadline returns failures to the local UI.
const presentableScript = `new Promise((resolve, reject) => {
    const until = Date.now() + 18000;
    const check = () => {
        if (Date.now() > until) return reject(Error('room-first-paint-timeout'));
        const root = document.documentElement;
        const main = document.querySelector('#main.stage-layout');
        const header = document.querySelector('.workspace-topbar');
        if (['ready', 'fallback'].includes(root.dataset.roomBoot) &&
            main && getComputedStyle(main).display === 'grid' &&
            getComputedStyle(main).visibility === 'visible' &&
            header && getComputedStyle(header).position === 'fixed' &&
            header.querySelector('.desktop-refresh') && header.querySelector('.desktop-menu')) {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        } else setTimeout(check, 50);
    };
    check();
})`;

function createWindowStartup({ window: win, hidden = false, trusted, css, timeoutMs = 20000, log = () => {} }) {
    let ready = false, cancelled = false, started = false, timer, abort;
    let styleReady = Promise.resolve();
    const onDomReady = () => {
        if (!cancelled && trusted(win.webContents.getURL())) {
            styleReady = win.webContents.insertCSS(css);
            // Also own failures during a later refresh, when load() has returned.
            void styleReady.catch(() => log('titlebar-style-failed'));
        }
    };
    win.webContents.on('dom-ready', onDomReady);
    return {
        isReady: () => ready && !cancelled,
        async load(url) {
            if (started || cancelled) throw Error('window-startup-unavailable');
            started = true;
            const deadline = new Promise((_, reject) => {
                abort = reject;
                timer = setTimeout(() => reject(Error('window-startup-timeout')), timeoutMs);
            });
            try {
                await Promise.race([
                    (async () => {
                        await win.loadURL(url);
                        if (cancelled || win.isDestroyed() || !trusted(win.webContents.getURL())) throw Error('window-startup-cancelled');
                        await styleReady;
                        await win.webContents.executeJavaScript(presentableScript);
                    })(),
                    deadline,
                ]);
                if (cancelled || win.isDestroyed()) throw Error('window-startup-cancelled');
                ready = true;
                if (!hidden) win.show();
            } catch (error) {
                cancelled = true;
                if (!win.isDestroyed()) win.webContents.stop();
                throw error;
            } finally {
                clearTimeout(timer);
                abort = null;
            }
        },
        dispose() {
            cancelled = true;
            clearTimeout(timer);
            abort?.(Error('window-startup-cancelled'));
            win.webContents.removeListener('dom-ready', onDomReady);
        },
    };
}
module.exports = { createWindowStartup };
