// All desktop reload entry points use the same guard. Reload only the page;
// the window and owned native process keep their identity.
const activityScript = `(() => {
    const session = document.querySelector('#destroyPeer');
    const share = document.querySelector('#shareScreen');
    if (!session || !share) return { unknown: true };
    return {
        voice: session.dataset.sessionAction === 'hangup',
        sharing: share.getAttribute('aria-pressed') === 'true',
        pending: [session, share].some(n => n.getAttribute('aria-busy') === 'true')
    };
})()`;

function createRefresh({ window, confirm, blocked = () => false }) {
    let pending = false;
    return async () => {
        const win = window();
        if (pending || !win || win.isDestroyed() || blocked()) return false;
        pending = true;
        try {
            let activity;
            try {
                activity = await win.webContents.executeJavaScript(activityScript);
            } catch {
                activity = { unknown: true };
            }
            if (!activity || activity.unknown || activity.voice || activity.sharing || activity.pending) {
                if (!(await confirm(win))) return false;
            }
            if (win.isDestroyed() || blocked()) return false;
            win.webContents.reload();
            return true;
        } finally {
            pending = false;
        }
    };
}

function isRefreshKey(input) {
    if (input.type !== 'keyDown') return false;
    const key = input.key.toLowerCase();
    return key === 'f5' || (key === 'r' && Boolean(input.control || input.meta) && !input.alt);
}
module.exports = { createRefresh, isRefreshKey };
