// Only main and its trusted local settings window own update privileges.
function createUpdates({
    updater,
    app,
    window,
    log,
    changed,
    prepareInstall,
    confirmInstall,
    onStartupUpdate,
    preferences,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
}) {
    let status = 'idle',
        version = '',
        busy = false,
        stopped = false;
    let progress = null,
        error = '',
        lastChecked = null,
        token = null;
    let cancelled = false,
        phase = 'check';
    const listeners = new Set();
    const prompted = new Set();
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
    const label = () =>
        ({
            downloaded: `安装更新 ${version}…`,
            available: `发现新版 ${version}…`,
            downloading: `正在下载 ${version}…`,
            verifying: '正在校验更新…',
            installing: '正在退出并安装…',
            checking: '正在检查更新…',
            error: '更新未完成，点击重试…',
            cancelled: '更新下载已取消…',
        })[status] || '检查客户端更新…';
    const snapshot = () => ({
        status,
        version,
        currentVersion: app.getVersion(),
        busy,
        progress: progress && { ...progress },
        error,
        lastChecked,
        canCancel: status === 'downloading' && Boolean(token),
        ignoredVersion: preferences?.getIgnoredVersion() || '',
    });
    const publish = () => {
        if (stopped) return;
        changed?.(label());
        for (const listener of listeners) listener(snapshot());
    };
    const update = (next) => {
        status = next;
        publish();
    };
    const taskbar = (value) => {
        const win = window();
        if (win && !win.isDestroyed()) win.setProgressBar(value);
    };
    const failed = (failure) => {
        if (stopped) return;
        taskbar(-1);
        if (cancelled) {
            error = '';
            update('cancelled');
            return;
        }
        log(`update-${phase}-failed ${failure.message}`);
        error =
            phase === 'check'
                ? '暂时无法连接更新服务，请检查网络后重试。'
                : phase === 'install'
                  ? '未能启动安装，请重试。当前客户端仍可继续使用。'
                  : '下载或完整性校验失败。请重新检查更新，未通过校验的文件不会安装。';
        update('error');
    };
    // Keep an error listener after stop: late updater events must not crash Electron.
    updater.on('error', (failure) => {
        if (status !== 'downloaded') failed(failure);
        else log(`update-error ${failure.message}`);
    });
    updater.on('update-available', (info) => {
        if (stopped) return;
        version = info.version;
        update('available');
    });
    updater.on('update-not-available', () => {
        if (!stopped) {
            version = '';
            update('current');
        }
    });
    updater.on('download-progress', (value) => {
        if (
            stopped ||
            cancelled ||
            !['downloading', 'verifying'].includes(status)
        )
            return;
        const number = (n) => (Number.isFinite(n) ? Math.max(0, n) : 0);
        progress = {
            percent: Math.min(100, number(value.percent)),
            transferred: number(value.transferred),
            total: number(value.total),
            bytesPerSecond: number(value.bytesPerSecond),
            updatedAt: Date.now(),
        };
        taskbar(progress.percent / 100);
        update(progress.percent >= 100 ? 'verifying' : 'downloading');
    });
    updater.on('update-downloaded', (info) => {
        if (stopped || cancelled) return;
        if (info?.version) version = info.version;
        taskbar(-1);
        update('downloaded');
    });
    async function check(options) {
        if (busy || stopped || ['downloaded', 'installing'].includes(status))
            return;
        busy = true;
        phase = 'check';
        error = '';
        progress = null;
        token = null;
        cancelled = false;
        update('checking');
        try {
            const result = await updater.checkForUpdates();
            if (stopped) return;
            if (!result) throw Error('Update service unavailable');
            token = result.cancellationToken || null;
            lastChecked = new Date().toISOString();
            if (status === 'checking')
                update(result.isUpdateAvailable ? 'available' : 'current');
        } catch (failure) {
            failed(failure);
        } finally {
            busy = false;
            publish();
        }
        if (options?.startup && !stopped && status === 'available' && version &&
            version !== preferences?.getIgnoredVersion() && !prompted.has(version)) {
            prompted.add(version);
            try { await onStartupUpdate?.(snapshot()); }
            catch (failure) { log(`update-prompt-failed ${failure.message}`); }
        }
    }
    async function download() {
        if (busy || stopped || status !== 'available') return;
        busy = true;
        phase = 'download';
        cancelled = false;
        error = '';
        progress = null;
        taskbar(2);
        update('downloading');
        try {
            await updater.downloadUpdate(token || undefined);
        } catch (failure) {
            failed(failure);
        } finally {
            busy = false;
            if (status !== 'downloading') taskbar(-1);
            publish();
        }
    }
    function cancel() {
        if (stopped || status !== 'downloading' || !token) return;
        cancelled = true;
        token.cancel();
        taskbar(-1);
        update('cancelled');
    }
    async function install() {
        if (busy || stopped || status !== 'downloaded') return;
        busy = true;
        phase = 'install';
        publish();
        try {
            if (!(await confirmInstall(version)) || stopped) return;
            update('installing');
            taskbar(2);
            await prepareInstall();
            if (!stopped) updater.quitAndInstall(false, true);
        } catch (failure) {
            failed(failure);
        } finally {
            busy = false;
            publish();
        }
    }
    function ignoreVersion(expectedVersion) {
        if (busy || stopped || status !== 'available' || expectedVersion !== version) return false;
        if (!preferences) throw Error('Update preferences unavailable');
        preferences.setIgnoredVersion(version);
        publish();
        return true;
    }
    // Startup may offer a new version. Scheduled checks stay quiet; neither
    // path downloads or installs until an owned local window requests it.
    const startup = timers.setTimeout(() => void check({ startup: true }), 3000);
    const periodic = timers.setInterval(() => void check(), 6 * 60 * 60 * 1000);
    startup.unref?.();
    periodic.unref?.();
    return {
        check,
        download,
        cancel,
        install,
        ignoreVersion,
        label,
        snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        stop() {
            stopped = true;
            token?.cancel();
            taskbar(-1);
            listeners.clear();
            timers.clearTimeout(startup);
            timers.clearInterval(periodic);
        },
    };
}
module.exports = { createUpdates };
