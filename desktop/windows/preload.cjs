const { contextBridge, ipcRenderer } = require('electron');
// Component errors are passive, dismissible notices, never system sound dialogs.
let notice;
function showNotice() {
    if (!notice || !document.body) return;
    document.querySelector('.desktop-notice')?.remove();
    const element = document.createElement('aside');
    element.className = 'desktop-notice'; element.setAttribute('role', 'status');
    const title = document.createElement('strong'); title.textContent = notice.title;
    const detail = document.createElement('p'); detail.textContent = notice.detail;
    if (notice.recover) {
        const recover = document.createElement('button'); recover.textContent = '恢复共享组件';
        recover.type = 'button';
        recover.addEventListener('click', async () => {
            recover.disabled = true;
            recover.textContent = '正在恢复…';
            try { await ipcRenderer.invoke('voice:native-recover'); }
            catch { recover.disabled = false; recover.textContent = '重试恢复'; }
        });
        element.append(recover);
    }
    const close = document.createElement('button'); close.textContent = '知道了';
    close.addEventListener('click', () => { notice = null; element.remove(); });
    element.prepend(title, detail); element.append(close); document.body.append(element);
}
ipcRenderer.on('voice:notice', (_event, value) => { notice = value; showNotice(); });
ipcRenderer.on('voice:show-call-tools', () => {
    const tools = document.querySelector('[data-call-log-actions]');
    if (!tools?.showPopover || tools.matches(':popover-open')) return;
    tools.showPopover();
    tools.querySelector('button')?.focus();
});

let updateButton, updateState, updateAction;
function renderUpdateButton() {
    if (!updateButton) return;
    const state = updateState;
    const downloading = Number.isFinite(state?.percent) ? `下载 ${Math.floor(state.percent)}%` : '正在下载';
    const views = {
        available: ['更新', 'download'],
        checking: ['正在检查'],
        downloading: [downloading],
        verifying: ['正在校验'],
        downloaded: ['退出并安装', 'install'],
        installing: ['正在准备安装'],
        cancelled: ['重试更新', 'check'],
        error: ['重试更新', 'check'],
    };
    const [label, action] = views[state?.status] || [];
    updateButton.hidden = !state?.version || !label;
    updateAction = updateButton.hidden || state.busy ? null : action;
    updateButton.disabled = !updateAction;
    if (updateButton.hidden) return;
    updateButton.textContent = label;
    const description = state.status === 'downloaded'
        ? `${label} ${state.version}，安装会结束通话和共享`
        : `${label} ${state.version}`;
    updateButton.title = state.error || description;
    updateButton.setAttribute('aria-label', description);
}
ipcRenderer.on('voice:update-state', (_event, value) => {
    updateState = value;
    renderUpdateButton();
});
// Write-only bridge: diagnostic collection can outlive Chromium's user gesture.
// Main validates the sender/frame/origin and length for every invocation.
contextBridge.exposeInMainWorld(
    'EliYorkDesktop',
    Object.freeze({
        waitForNativeShare: () => ipcRenderer.invoke('voice:native-share-ready'),
        refreshPage: () => ipcRenderer.invoke('voice:refresh'),
        writeClipboardText: (text) =>
            ipcRenderer.invoke('voice:clipboard-write', text),
    })
);

// DOM only: no privileged Node API or native capability enters the page.
// Reuse the actual page header/actions rather than adding another toolbar.
window.addEventListener('DOMContentLoaded', () => {
    showNotice();
    document.documentElement.dataset.desktopChrome = 'windows';
    if (document.querySelector('[data-call-log-actions]')?.showPopover)
        document.documentElement.dataset.desktopCallTools = '';
    let header = document.querySelector('.workspace-topbar');
    if (!header) {
        header = document.createElement('header');
        header.className = 'workspace-topbar';
        document.body.prepend(header);
    }
    let brand = header.querySelector('.workspace-brand');
    if (!brand) {
        brand = document.createElement('div');
        brand.className = 'workspace-brand';
        header.prepend(brand);
    }
    if (!brand.querySelector('.workspace-mark') || !brand.querySelector('strong')) {
        const icon = document.createElement('img');
        icon.className = 'workspace-mark';
        icon.src = '/assets/brand/voice.svg?v=brand-20261022';
        icon.alt = '';
        const title = document.createElement('strong');
        title.textContent = '语音据点';
        brand.replaceChildren(icon, title);
    }
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'desktop-menu';
    menu.title = '客户端设置';
    menu.setAttribute('aria-label', '客户端设置');
    menu.textContent = '⚙ 设置';
    menu.addEventListener('click', () => ipcRenderer.invoke('voice:menu').catch(() => {}));
    const actions = header.querySelector('.workspace-actions');
    if (actions) actions.append(menu);
    else header.append(menu);
    updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'desktop-update';
    updateButton.addEventListener('click', (event) => {
        if (event.isTrusted && updateAction)
            ipcRenderer.invoke('voice:update-toolbar-action', updateAction).catch(() => {});
    });
    const chat = actions?.querySelector('#stageChatToggle');
    if (chat) chat.before(updateButton);
    else menu.before(updateButton);
    renderUpdateButton();
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'desktop-refresh';
    refresh.title = '刷新（Ctrl+R）';
    refresh.setAttribute('aria-label', '刷新页面');
    refresh.textContent = '↻';
    refresh.addEventListener('click', () => {
        ipcRenderer.invoke('voice:refresh').catch(() => {});
    });
    header.append(refresh);
    // The boot recovery action must use the same confirmation as Ctrl+R.
    document.addEventListener('click', (event) => {
        if (!event.target.closest('[data-room-reload]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        ipcRenderer.invoke('voice:refresh').catch(() => {});
    }, true);
}, { once: true });
