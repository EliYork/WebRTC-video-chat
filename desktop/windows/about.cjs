// Local settings remain available independently of the channel page loading.
function createAbout({ app, panels, window, updates, origin, cancelled = () => false }) {
    return async ({ startupPrompt = false } = {}) => {
        const win = window();
        if (!win || win.isDestroyed()) return;
        let webVersion = '暂时无法读取';
        let probeTimer;
        try {
            const info = await Promise.race([
                win.webContents.executeJavaScript(
                    'window.voiceBuildInfo || {}'
                ),
                new Promise((resolve) => {
                    probeTimer = setTimeout(() => resolve({}), 1000);
                }),
            ]);
            if (typeof info.webVersion === 'string')
                webVersion = info.webVersion.slice(0, 80);
        } catch {
            /* A loading page must not block settings. */
        } finally {
            clearTimeout(probeTimer);
        }
        if (cancelled() || win.isDestroyed() || window() !== win) return;
        const service = app.isPackaged ? updates() : null;
        const state = startupPrompt ? service?.snapshot() : null;
        if (startupPrompt && (!state || state.status !== 'available' || state.ignoredVersion === state.version)) return;
        return (startupPrompt ? panels.updatePrompt : panels.about)(
            {
                clientVersion: app.getVersion(),
                webVersion,
                origin,
                packaged: app.isPackaged,
            },
            service
        );
    };
}
module.exports = { createAbout };
