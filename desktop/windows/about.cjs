// Uses the existing updater and a native dialog; no new updater/install bridge.
function createAbout({ app, dialog, window, updates, origin }) {
    let showing = false;
    return async () => {
        const win = window();
        if (showing || !win || win.isDestroyed()) return;
        showing = true;
        try {
            let web = '暂时无法读取';
            try {
                const info = await win.webContents.executeJavaScript('window.voiceBuildInfo || {}');
                if (typeof info.webVersion === 'string') web = info.webVersion.slice(0, 80);
            } catch { /* A loading page must not prevent access to settings. */ }
            const updater = updates();
            const available = app.isPackaged && Boolean(updater);
            const answer = await dialog.showMessageBox(win, {
                type: 'info',
                title: '关于与更新',
                message: '语音据点 · EliYork Voice',
                detail: [
                    `客户端版本：${app.getVersion()}${app.isPackaged ? '' : '（本地开发预览，未发布）'}`,
                    `网页版本：${web}`,
                    `连接地址：${origin}`,
                    available ? `更新：${updater.label()}` : '更新：开发预览不下载安装更新，请使用正式安装版。',
                    '',
                    '刷新只更新网页内容。客户端标题栏与原生共享组件通过客户端更新。',
                    '检查不会自动下载或重启；安装前会再次确认，并结束当前语音和共享。',
                ].join('\n'),
                buttons: available ? ['检查更新', '关闭'] : ['关闭'],
                defaultId: available ? 1 : 0,
                cancelId: available ? 1 : 0,
                noLink: true,
            });
            if (available && answer.response === 0 && !win.isDestroyed()) await updater.check();
        } finally {
            showing = false;
        }
    };
}
module.exports = { createAbout };
