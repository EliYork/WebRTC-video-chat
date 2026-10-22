/* global voiceSettings */
const $ = (selector) => document.querySelector(selector);
let current,
    previousStatus,
    lastAnnouncement,
    pending = false;
const bytes = (n) => `${((Number(n) || 0) / 1048576).toFixed(1)} MB`;
const duration = (seconds) =>
    seconds >= 60
        ? `${Math.ceil(seconds / 60)} 分钟`
        : `${Math.max(1, Math.ceil(seconds))} 秒`;
function render(state) {
    current = state;
    const prompt = state.kind === 'update';
    document.body.classList.toggle('update-prompt', prompt);
    $('#about').hidden = !['about', 'update'].includes(state.kind);
    $('#confirm').hidden = state.kind !== 'confirm';
    $('#close-choice').hidden = state.kind !== 'close-choice';
    if (state.kind === 'close-choice') {
        $('#window-title').textContent = '关闭窗口';
        document.title = '关闭窗口';
        $('#choose-tray').disabled = !state.trayAvailable;
        if (!state.trayAvailable) {
            $('#choose-quit').checked = true;
            $('#tray-description').textContent =
                '托盘暂不可用，请取消或退出客户端。';
        }
        updateCloseButton();
        $('#close-choice-cancel').focus();
        return;
    }
    if (state.kind === 'confirm') {
        document.title = state.title;
        $('#window-title').textContent = '操作确认';
        $('#confirm-title').textContent = state.title;
        $('#confirm-detail').textContent = state.detail;
        $('#accept').textContent = state.accept || '确认';
        $('#cancel').textContent = state.cancel || '取消';
        $('#cancel').focus();
        return;
    }
    const { info, update: u } = state;
    $('#window-title').textContent = prompt ? '客户端更新' : '关于与更新';
    document.title = prompt ? '客户端更新' : '关于与更新';
    $('#version-details').hidden = prompt;
    $('#prompt-actions').hidden = !prompt;
    $('#ignore-explanation').hidden = !prompt;
    $('#ignore-update').disabled = u?.busy || u?.status !== 'available';
    $('#window-preferences').hidden = !state.preferences;
    if (state.preferences) {
        $('#close-behavior').value = state.preferences.closeBehavior;
        $('#close-behavior option[value="tray"]').disabled =
            !state.trayAvailable;
    }
    $('#client-version').textContent = info.clientVersion;
    $('#web-version').textContent = info.webVersion;
    $('#server-origin').textContent = info.origin;
    $('#version-chip').textContent = `v${info.clientVersion}`;
    const status = u?.status || 'preview',
        progress = u?.progress;
    const views = {
        idle: [
            '保持最新，轻松连接',
            '检查客户端和原生共享组件的可用更新。',
            '检查更新',
            'check',
        ],
        checking: [
            '正在检查更新',
            '正在连接更新服务，请稍候…',
            '正在检查…',
            'check',
        ],
        current: [
            '已经是最新版本',
            `当前客户端 ${info.clientVersion}，无需更新。`,
            '重新检查',
            'check',
        ],
        available: [
            '有新版本可用',
            `版本 ${u?.version} 已发布，下载不会中断当前通话。`,
            '下载更新',
            'download',
        ],
        downloading: [
            '正在下载更新',
            `正在获取版本 ${u?.version}，可关闭此窗口继续使用。`,
            '正在下载…',
            'download',
        ],
        verifying: [
            '正在校验更新',
            '下载已完成，正在验证安装包完整性。',
            '正在校验…',
            'download',
        ],
        downloaded: [
            '更新已准备就绪',
            `版本 ${u?.version} 已通过完整性校验，方便时再安装。`,
            '退出并安装',
            'install',
        ],
        installing: [
            '正在准备安装',
            '正在释放媒体资源。客户端退出后，安装程序将继续完成更新。',
            '正在准备…',
            'install',
        ],
        cancelled: [
            '已取消下载',
            '当前版本可继续使用，需要时可重新检查并下载。',
            '重新检查',
            'check',
        ],
        error: [
            '更新未完成',
            u?.error || '请稍后重试，当前客户端仍可继续使用。',
            '重新检查',
            'check',
        ],
        preview: [
            '本地开发预览',
            info.packaged
                ? '更新服务尚未就绪，请重新打开客户端后重试。'
                : '正式安装版支持在线更新；开发预览不下载安装包。',
            '检查更新',
            'check',
        ],
    };
    const view = views[status] || views.idle;
    if (prompt && status === 'available') view[2] = '更新';
    $('.update-card').dataset.status = status;
    $('#update-title').textContent = view[0];
    $('#update-detail').textContent = view[1];
    $('#primary').textContent = view[2];
    $('#primary').dataset.action = view[3];
    $('#primary').disabled = !u || Boolean(u.busy) || pending;
    $('#secondary').hidden = !u?.canCancel;
    $('#secondary').disabled = pending;
    const spinning = [
        'checking',
        'downloading',
        'verifying',
        'installing',
    ].includes(status);
    $('#status-icon').className =
        `status-icon${spinning ? ' spinning' : status === 'error' ? ' error' : ['current', 'downloaded'].includes(status) ? ' success' : ''}`;
    $('#status-icon').textContent = spinning
        ? ''
        : status === 'error'
          ? '!'
          : ['current', 'downloaded'].includes(status)
            ? '✓'
            : '↻';
    const showProgress = ['downloading', 'verifying', 'installing'].includes(
        status
    );
    $('#progress-area').hidden = !showProgress;
    $('#progress-track').classList.toggle(
        'indeterminate',
        status === 'installing' || status === 'verifying' || !progress?.total
    );
    if (showProgress && progress?.total && status === 'downloading') {
        const percent = Math.min(100, Math.max(0, progress.percent));
        // Do not interpolate the first measurement from the unknown animation's width.
        $('#progress-fill').style.transition =
            $('#progress-track').dataset.measured === 'true' ? '' : 'none';
        $('#progress-track').dataset.measured = 'true';
        $('#progress-fill').style.width = `${percent}%`;
        $('#progress-track').setAttribute(
            'aria-valuenow',
            String(Math.round(percent))
        );
        $('#progress-size').textContent =
            `${bytes(progress.transferred)} / ${bytes(progress.total)}`;
        $('#progress-percent').textContent = `${Math.floor(percent)}%`;
        const stale = Date.now() - progress.updatedAt > 20000,
            speed = progress.bytesPerSecond;
        $('#progress-speed').textContent = stale
            ? '下载较慢，正在等待网络响应…'
            : speed > 0
              ? `${bytes(speed)}/秒 · 预计还需 ${duration(Math.max(0, progress.total - progress.transferred) / speed)}`
              : '正在计算下载速度…';
    } else {
        $('#progress-track').dataset.measured = 'false';
        $('#progress-track').removeAttribute('aria-valuenow');
        $('#progress-size').textContent =
            status === 'verifying'
                ? '正在检查安装包'
                : status === 'installing'
                  ? '正在释放媒体资源'
                  : '正在建立下载连接';
        $('#progress-percent').textContent = '';
        $('#progress-speed').textContent = '';
    }
    $('#checked-at').textContent = u?.lastChecked
        ? `上次检查 ${new Date(u.lastChecked).toLocaleString('zh-CN', { hour12: false })}`
        : '';
    if (lastAnnouncement !== status) {
        $('#announcement').textContent = `${view[0]}。${view[1]}`;
        lastAnnouncement = status;
    }
    if (!previousStatus) $('#primary').focus();
    previousStatus = status;
}
async function action(value, payload) {
    if (pending) return;
    // Keep cancel/close usable during long operations owned by main.
    if (!['check', 'download', 'install'].includes(value)) pending = true;
    try {
        await voiceSettings.action(value, payload);
    } catch {
        $('#feedback').hidden = false;
        $('#feedback').textContent = '操作未完成，请关闭此窗口后重试。';
    } finally {
        pending = false;
        if (current) render(current);
    }
}
$('#close').addEventListener('click', () => void action('close'));
$('#primary').addEventListener(
    'click',
    () => void action($('#primary').dataset.action)
);
$('#secondary').addEventListener('click', () => void action('cancel'));
$('#ignore-update').addEventListener('click', () => void action('ignore-update', current?.update?.version));
$('#dismiss-update').addEventListener('click', () => void action('close'));
$('#accept').addEventListener('click', () => void action('accept'));
$('#cancel').addEventListener('click', () => void action('cancel'));
function updateCloseButton() {
    $('#close-choice-accept').textContent = $('#choose-tray').checked
        ? '最小化到托盘'
        : '退出客户端';
}
for (const radio of document.querySelectorAll('[name="close-action"]'))
    radio.addEventListener('change', updateCloseButton);
$('#close-choice-cancel').addEventListener('click', () => void action('close'));
$('#close-choice-accept').addEventListener(
    'click',
    () =>
        void action('choose-close', {
            action: $('#choose-tray').checked ? 'tray' : 'quit',
            remember: $('#remember-close').checked,
        })
);
$('#close-behavior').addEventListener('change', async () => {
    const select = $('#close-behavior');
    select.disabled = true;
    try {
        await voiceSettings.action('close-behavior', select.value);
        $('#preference-feedback').textContent = '已保存，下次点击 × 时生效。';
    } catch {
        select.value = current.preferences.closeBehavior;
        $('#preference-feedback').textContent = '保存失败，请重试。';
    } finally {
        select.disabled = false;
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
        void action('close');
    }
});
const unsubscribe = voiceSettings.onState(render);
voiceSettings
    .read()
    .then(render)
    .catch(() => {
        $('#window-title').textContent = '设置暂时不可用，请重新打开';
    });
const tick = setInterval(() => {
    if (current?.update?.status === 'downloading') render(current);
}, 1000);
window.addEventListener(
    'unload',
    () => {
        unsubscribe();
        clearInterval(tick);
    },
    { once: true }
);
