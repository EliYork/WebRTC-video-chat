(function exposeVoiceMediaQualityView(global) {
    'use strict';

    const CLASS_NAME = 'voice-media-quality-pill';
    const routeControls = new WeakMap();

    const removeRoute = (tile) => {
        const state = tile && routeControls.get(tile);
        if (!state) return;
        if (state.dialog.open) state.dialog.close();
        state.dialog.remove();
        state.button.remove();
        routeControls.delete(tile);
    };
    const renderRoute = (tile, control) => {
        if (!control) return;
        const quality = ensureOverlay(tile);
        if (!quality) return;
        let state = routeControls.get(tile);
        if (!state) {
            const node = (tag, className, text) => {
                const element = global.document.createElement(tag);
                if (className) element.classList.add(className);
                if (text) element.textContent = text;
                return element;
            };
            const button = node('button', 'voice-route-toggle', '切换');
            button.type = 'button';
            button.classList.add('no-drag');
            button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('aria-label', '切换屏幕共享观看路径');
            const dialog = node('dialog', 'voice-route-dialog');
            dialog.classList.add('no-drag');
            dialog.setAttribute('aria-label', '屏幕共享观看路径');
            const title = node('strong', '', '观看路径');
            const status = node('p', 'voice-route-status');
            status.setAttribute('role', 'status');
            const label = node('label', 'voice-route-auto');
            const auto = node('input');
            auto.type = 'checkbox';
            label.append(auto, node('span', '', '自动切换'));
            const hint = node('p', 'media-device-hint', '关闭自动后可手动选择，不再按卡顿自动换路。连接断开或服务器限制时仍可能回到直连。设置仅影响你观看这位共享者。');
            const choices = node('div', 'voice-route-choices');
            const p2p = node('button', '', 'P2P（可能经过 TURN）');
            const first = node('button', '', 'P2P 优先（实验）');
            const sfu = node('button', '', '服务器转发');
            const close = node('button', 'voice-route-close', '关闭');
            [p2p, first, sfu, close].forEach((item) => { item.type = 'button'; });
            choices.append(p2p, sfu, first);
            hint.textContent += ' P2P 优先先尝试直连，TURN、连接失败、收包但不出帧或发送端持续压力时尝试 SFU；SFU 兜底后可再次点 P2P 优先重试。TURN 仍消耗中继带宽。';
            dialog.append(title, status, label, choices, hint, close);
            tile.append(dialog);
            const actions = tile.querySelector('.tile-header-actions');
            if (actions) actions.before(button);
            else quality.parentElement.append(button);
            state = { button, dialog, status, auto, p2p, sfu, first, control };
            routeControls.set(tile, state);
            const change = async (mode) => {
                const pending = state.control.change(mode);
                renderRoute(tile, state.control);
                try { await pending; } finally {
                    if (routeControls.get(tile) === state) renderRoute(tile, state.control);
                }
            };
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                renderRoute(tile, state.control);
                if (!dialog.open) dialog.showModal();
                button.setAttribute('aria-expanded', 'true');
            });
            dialog.addEventListener('close', () => button.setAttribute('aria-expanded', 'false'));
            close.addEventListener('click', () => dialog.close());
            auto.addEventListener('change', () => change(auto.checked ? 'auto' : state.control.get().route));
            p2p.addEventListener('click', () => change('p2p'));
            sfu.addEventListener('click', () => change('sfu'));
            first.addEventListener('click', () => change('p2p-first'));
        }
        state.control = control;
        const current = control.get();
        const route = current.route === 'sfu' ? '服务器转发' : current.transport === 'TURN' ? 'P2P · TURN 中继' : current.transport === 'direct' ? 'P2P 直连' : 'P2P · 路径待确认';
        const mode = current.mode === 'auto' ? '自动' : current.mode === 'p2p-first' ? 'P2P 优先（实验）' : '手动';
        state.button.title = `当前：${route} · ${mode}`;
        state.status.textContent = current.pending ? '正在切换…' :
            current.error || `当前：${route}（${mode}）`;
        state.auto.checked = current.mode === 'auto';
        state.auto.disabled = current.pending;
        state.first.disabled = current.pending;
        state.first.setAttribute('aria-pressed', String(current.mode === 'p2p-first'));
        state.p2p.disabled = current.pending || current.mode === 'auto';
        state.sfu.disabled = current.pending || current.mode === 'auto' || !current.available;
        state.p2p.setAttribute('aria-pressed', String(current.route === 'p2p'));
        state.sfu.setAttribute('aria-pressed', String(current.route === 'sfu'));
        if (!current.available && !current.pending) state.status.textContent = `当前：${route}；服务器转发未启用或浏览器不支持`;
    };

    const ensureOverlay = (tile) => {
        if (!tile) {
            return undefined;
        }
        const header = tile.querySelector('.tile-header');
        const controls = header?.querySelector('.tile-header-controls');
        if (!header || !controls) {
            return undefined;
        }
        let overlay = tile.querySelector(`.${CLASS_NAME}`);
        if (!overlay) {
            overlay = global.document.createElement('div');
            overlay.className = `${CLASS_NAME} hidden`;
            overlay.classList?.add?.(CLASS_NAME);
            overlay.classList?.add?.('hidden');
            overlay.setAttribute('aria-hidden', 'true');
        }
        const actions = controls.querySelector('.tile-header-actions');
        if (overlay.parentElement !== controls) {
            if (actions) {
                actions.before(overlay);
            } else {
                controls.append(overlay);
            }
        }
        return overlay;
    };

    const render = (tile, text, prefix = '接收') => {
        const overlay = ensureOverlay(tile);
        if (!overlay) {
            return undefined;
        }
        const normalizedText = String(text || '').trim();
        overlay.textContent = normalizedText
            ? `${prefix} ${normalizedText}`
            : '';
        overlay.classList.toggle('hidden', !normalizedText);
        overlay.setAttribute('aria-hidden', String(!normalizedText));
        return overlay;
    };

    const hide = (tile) => {
        const overlay = tile?.querySelector?.(`.${CLASS_NAME}`);
        if (!overlay) {
            return;
        }
        overlay.textContent = '';
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
    };

    const remove = (tile) => {
        removeRoute(tile);
        tile?.querySelector?.(`.${CLASS_NAME}`)?.remove();
    };

    global.VoiceMediaQualityView = {
        CLASS_NAME,
        ensureOverlay,
        hide,
        remove,
        render,
        renderRoute,
        removeRoute,
    };
})(window);
