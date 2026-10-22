// Closing the visible window is separate from quitting the application.
function createWindowLifecycle({
    window: win,
    Tray,
    Menu,
    icon,
    preferences,
    panels,
    showSettings,
    quit,
    isQuitting,
    beforeHide = () => {},
    log = () => {},
    enableTray = true,
    canRestore = () => true,
}) {
    let tray = null,
        pending = false,
        disposed = false,
        endingSession = false;
    function restore() {
        if (disposed || isQuitting() || win.isDestroyed() || !canRestore()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }
    if (enableTray) {
        try {
            tray = new Tray(icon);
            tray.setToolTip('语音据点');
            tray.setContextMenu(
                Menu.buildFromTemplate([
                    { label: '打开语音据点', click: restore },
                    {
                        label: '设置…',
                        click: () => {
                            restore();
                            void Promise.resolve()
                                .then(showSettings)
                                .catch(() => log('tray-settings-failed'));
                        },
                    },
                    { type: 'separator' },
                    { label: '退出（结束通话与共享）', click: quit },
                ])
            );
            tray.on('click', restore);
            tray.on('double-click', restore);
        } catch {
            tray?.destroy();
            tray = null;
            log('tray-create-failed');
        }
    }
    async function requestClose() {
        if (
            pending ||
            disposed ||
            endingSession ||
            isQuitting() ||
            win.isDestroyed()
        )
            return;
        pending = true;
        try {
            let action = preferences.snapshot().closeBehavior;
            if (action === 'ask' || (action === 'tray' && !tray)) {
                const answer = await panels.chooseClose({
                    trayAvailable: Boolean(tray),
                });
                action = answer.action;
                if (
                    disposed ||
                    isQuitting() ||
                    endingSession ||
                    win.isDestroyed()
                )
                    return;
                if (
                    !['tray', 'quit'].includes(action) ||
                    (action === 'tray' && !tray)
                )
                    return;
                if (answer.remember) {
                    try {
                        preferences.setCloseBehavior(action);
                    } catch {
                        log('window-preferences-write-failed');
                    } // This close still works; ask again next time.
                }
            }
            if (action === 'tray' && tray) {
                beforeHide();
                panels.close();
                win.hide();
            } else if (action === 'quit') quit();
        } finally {
            pending = false;
        }
    }
    const onClose = (event) => {
        if (disposed || isQuitting() || endingSession) return;
        event.preventDefault();
        void requestClose().catch(() => log('window-close-failed'));
    };
    const onSessionEnd = () => {
        endingSession = true;
    };
    win.on('close', onClose);
    win.on('query-session-end', onSessionEnd);
    return {
        restore,
        requestClose,
        trayAvailable: () => Boolean(tray),
        dispose() {
            disposed = true;
            win.removeListener('close', onClose);
            win.removeListener('query-session-end', onSessionEnd);
            tray?.destroy();
            tray = null;
        },
    };
}
module.exports = { createWindowLifecycle };
