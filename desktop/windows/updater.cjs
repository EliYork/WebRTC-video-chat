// Only the main process owns updates; the remote page gets no install IPC.
function createUpdates({
    updater,
    app,
    dialog,
    window,
    log,
    changed,
    prepareInstall,
}) {
    let status = 'idle',
        version = '',
        busy = false,
        stopped = false;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.logger = {
        info: (message) => log(`update ${message}`),
        warn: (message) => log(`update ${message}`),
        error: (message) => log(`update ${message}`),
        debug: () => {},
    };
    const update = (next) => {
        status = next;
        changed?.(label());
    };
    const label = () =>
        status === 'downloaded'
            ? `安装更新 ${version}…`
            : status === 'available'
              ? `发现新版 ${version}…`
              : status === 'downloading'
                ? `正在下载 ${version}…`
                : status === 'checking'
                  ? '正在检查更新…'
                  : '检查客户端更新…';
    const message = (options) =>
        dialog.showMessageBox(window(), {
            type: 'info',
            buttons: ['确定'],
            noLink: true,
            ...options,
        });
    updater.on('error', (error) => {
        log(`update-error ${error.message}`);
        if (status !== 'downloaded') update('error');
    });
    updater.on('update-available', (info) => {
        version = info.version;
        update('available');
    });
    updater.on('update-not-available', () => update('idle'));
    updater.on('download-progress', (progress) => {
        window()?.setProgressBar(progress.percent / 100);
    });
    updater.on('update-downloaded', () => {
        window()?.setProgressBar(-1);
        update('downloaded');
    });
    async function check(manual = true) {
        if (busy || stopped) return;
        busy = true;
        try {
            if (status === 'downloading') return;
            if (status !== 'downloaded') {
                update('checking');
                await updater.checkForUpdates();
            }
            if (!manual || stopped) return;
            if (status === 'available') {
                const answer = await message({
                    message: `发现 EliYork Voice ${version}`,
                    detail: `当前版本 ${app.getVersion()}。下载会占用网络，可在通话结束后操作。下载完成后由你决定何时退出安装。`,
                    buttons: ['下载更新', '稍后'],
                    defaultId: 1,
                    cancelId: 1,
                });
                if (answer.response !== 0 || stopped) return;
                update('downloading');
                await updater.downloadUpdate();
            }
            if (stopped) return;
            if (status === 'downloaded') {
                const answer = await message({
                    message: `${version} 已下载并通过完整性校验`,
                    detail: '退出安装会结束当前语音和屏幕共享。选择“稍后”不会在关闭客户端时自动安装。',
                    buttons: ['退出并更新', '稍后'],
                    defaultId: 1,
                    cancelId: 1,
                });
                if (answer.response === 0 && !stopped) {
                    await prepareInstall();
                    updater.quitAndInstall(false, true);
                }
            } else if (status === 'idle') {
                await message({
                    message: `当前已是最新版本 ${app.getVersion()}`,
                });
            }
        } catch (error) {
            window()?.setProgressBar(-1);
            update('error');
            log(`update-failed ${error.message}`);
            if (manual && !stopped)
                await message({
                    type: 'warning',
                    message: '客户端更新失败',
                    detail: '当前客户端可继续使用。请检查网络后重试；下载或校验失败的文件不会安装。',
                });
        } finally {
            busy = false;
        }
    }
    // Quiet checks only update the menu. Never download, show a dialog or restart.
    const startup = setTimeout(() => void check(false), 15000);
    const periodic = setInterval(() => void check(false), 6 * 60 * 60 * 1000);
    startup.unref?.();
    periodic.unref?.();
    return {
        check,
        label,
        stop() {
            stopped = true;
            clearTimeout(startup);
            clearInterval(periodic);
        },
    };
}
module.exports = { createUpdates };
