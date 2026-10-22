(function exposePlayerMenu(global) {
    'use strict';
    const entries = new WeakMap();
    let actions = {};
    let active;
    const position = (tile, menu, x, y, viewportWidth, viewportHeight) => {
        const left = Math.max(tile.left, 0) + 8;
        const top = Math.max(tile.top, 0) + 8;
        const right = Math.min(tile.right, viewportWidth) - 8;
        const bottom = Math.min(tile.bottom, viewportHeight) - 8;
        return { left: Math.max(left, Math.min(x, right - menu.width)) - tile.left,
            top: Math.max(top, Math.min(y, bottom - menu.height)) - tile.top,
            maxWidth: Math.max(0, right - left), maxHeight: Math.max(0, bottom - top) };
    };
    const remove = (tile) => {
        const entry = entries.get(tile);
        if (!entry) return;
        entry.close(false);
        entry.video.removeEventListener('contextmenu', entry.context);
        entry.video.removeEventListener('keydown', entry.keyboard);
        if (entry.previousTabIndex === null) entry.video.removeAttribute?.('tabindex');
        else entry.video.setAttribute('tabindex', entry.previousTabIndex);
        entry.button.remove();
        entries.delete(tile);
    };
    const sync = (source) => {
        const { tile, video, isLocal } = source || {};
        if (!tile || !video || !source.isScreenSharing) return;
        const previous = entries.get(tile);
        if (previous?.video === video) return;
        remove(tile);
        const doc = global.document;
        const node = (tag, text) => { const el = doc.createElement(tag); if (text) el.textContent = text; return el; };
        const button = node('button', '更多');
        button.type = 'button'; button.className = 'voice-player-more no-drag';
        button.setAttribute('aria-label', '共享视频更多选项');
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
        (tile.querySelector('.tile-header-actions') || tile).append(button);
        let menu, returnFocus, closeWatcher;
        const close = (restore = true) => {
            if (!menu) return;
            closeWatcher?.destroy(); closeWatcher = undefined;
            menu.remove(); menu = null;
            button.setAttribute('aria-expanded', 'false');
            doc.removeEventListener('pointerdown', outside, true);
            doc.removeEventListener('fullscreenchange', dismiss);
            doc.removeEventListener('webkitfullscreenchange', dismiss);
            global.removeEventListener?.('resize', dismiss);
            if (active === close) active = null;
            if (restore && returnFocus?.isConnected) returnFocus.focus();
        };
        const outside = (event) => { if (!menu?.contains(event.target) && event.target !== button) close(false); };
        const dismiss = () => close();
        const open = (event, trigger) => {
            event.preventDefault(); event.stopPropagation();
            active?.();
            actions.beforeOpen?.();
            trigger.focus(); returnFocus = trigger;
            const rect = trigger.getBoundingClientRect();
            const keyboard = !Number.isFinite(event.clientX) || (event.clientX === 0 && event.clientY === 0);
            const x = keyboard ? rect.left + 12 : event.clientX;
            const y = keyboard ? rect.bottom : event.clientY;
            const volumeEvent = { clientX: x, clientY: y, preventDefault() {} };
            menu = node('div'); menu.className = 'voice-player-menu no-drag';
            menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '共享视频选项');
            const items = [];
            const item = (text, action, checked) => {
                const el = node('button', text); el.type = 'button'; el.tabIndex = -1;
                el.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
                if (checked !== undefined) el.setAttribute('aria-checked', String(checked));
                el.addEventListener('click', (click) => { click.preventDefault(); click.stopPropagation(); close(); action(); });
                items.push(el); menu.append(el);
            };
            const visible = Boolean(global.VoiceShareDiagnostics?.isVisible(tile));
            item(visible ? '隐藏视频统计' : '显示视频统计', () => global.VoiceShareDiagnostics?.toggle(tile), visible);
            item('查看播放事件', () => actions.showEvents?.(tile));
            if (!isLocal) item('调整音量…', () => actions.onVolume?.(volumeEvent, tile)?.querySelector('input')?.focus());
            const route = tile.querySelector('.voice-route-toggle');
            if (route) item('连接方式…', () => route.click());
            const webFullscreen = tile.querySelector('.web-fullscreen-btn');
            if (webFullscreen) item(webFullscreen.getAttribute('aria-label') || '网页内全屏', () => webFullscreen.click());
            menu.addEventListener('contextmenu', (context) => { context.preventDefault(); context.stopPropagation(); });
            menu.addEventListener('dblclick', (double) => double.stopPropagation());
            menu.addEventListener('keydown', (key) => {
                const index = items.indexOf(doc.activeElement);
                let next;
                if (key.key === 'ArrowDown') next = (index + 1) % items.length;
                if (key.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
                if (key.key === 'Home') next = 0;
                if (key.key === 'End') next = items.length - 1;
                if (next !== undefined) { key.preventDefault(); key.stopPropagation(); items[next].focus(); }
                else if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); close(); }
                else if (key.key === 'Tab') close();
                else if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); key.stopPropagation(); items[index]?.click(); }
            });
            tile.append(menu);
            const placement = position(tile.getBoundingClientRect(), menu.getBoundingClientRect(), x, y, global.innerWidth, global.innerHeight);
            for (const [key, value] of Object.entries(placement)) menu.style[key] = `${value}px`;
            items[0].focus(); button.setAttribute('aria-expanded', 'true');
            doc.addEventListener('pointerdown', outside, true);
            doc.addEventListener('fullscreenchange', dismiss);
            doc.addEventListener('webkitfullscreenchange', dismiss);
            global.addEventListener?.('resize', dismiss);
            active = close;
            if (global.CloseWatcher) {
                closeWatcher = new global.CloseWatcher();
                closeWatcher.addEventListener('close', dismiss);
            }
        };
        const context = (event) => open(event, video);
        const keyboard = (event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event, video); };
        const previousTabIndex = video.getAttribute('tabindex');
        if (previousTabIndex === null || previousTabIndex === undefined) video.tabIndex = 0;
        video.addEventListener('contextmenu', context);
        video.addEventListener('keydown', keyboard);
        button.addEventListener('click', (event) => { if (menu) { event.stopPropagation(); close(); } else open(event, button); });
        button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') open(event, button); });
        entries.set(tile, { video, button, context, keyboard, close, previousTabIndex: previousTabIndex ?? null });
    };
    global.VoicePlayerMenu = { sync, remove, position, configure: (next) => { actions = next; } };
})(window);
