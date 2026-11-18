(function exposeRoomBoot(global) {
    'use strict';
    const root = global.document.documentElement;
    let ready = false;
    let failed = false;
    let applicationReady = false;
    let stylesheetLoaded = false;
    const timers = [];
    const render = (state) => {
        root.dataset.roomBoot = state;
        global.document.querySelectorAll('#main, .workspace-topbar').forEach((node) => {
            node.inert = state !== 'ready';
            node.setAttribute('aria-busy', String(state !== 'ready'));
        });
        const message = global.document.querySelector('[data-room-load-message]');
        if (message) message.textContent = {
            loading: '正在加载界面…',
            slow: '加载比平时慢，仍在继续，请稍候…',
            stalled: '加载仍未完成，可以继续等待或重新加载。',
            fallback: '部分界面未能加载，可以重新加载试试。',
        }[state] || '';
    };
    const finish = (state = 'ready') => {
        if (ready) return;
        if (state === 'ready') {
            applicationReady = true;
            if (!stylesheetLoaded) return;
        }
        ready = state === 'ready';
        failed = state === 'fallback';
        if (ready) global.performance?.mark?.('voice-room-ready');
        timers.forEach((timer) => global.clearTimeout(timer));
        render(state);
    };
    global.VoiceRoomBoot = { finish };
    const waiting = (state) => {
        if (!ready && !failed) render(state);
    };
    timers.push(global.setTimeout(() => waiting('loading'), 1200));
    timers.push(global.setTimeout(() => waiting('slow'), 8000));
    timers.push(global.setTimeout(() => waiting('stalled'), 30000));
    // Deferred downloads can hold DOMContentLoaded indefinitely. The recovery
    // button must already work while those downloads are still pending.
    global.document.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-room-reload]')) global.location.reload();
    });
    const isStartupStylesheet = (target) => target?.matches?.('link[data-room-startup-style]');
    global.document.addEventListener('load', (event) => {
        if (!isStartupStylesheet(event.target)) return;
        stylesheetLoaded = true;
        if (applicationReady) finish();
    }, true);
    global.addEventListener('error', (event) => {
        if (isStartupStylesheet(event.target)) {
            finish('fallback');
            return;
        }
        const source = event.filename || (event.target?.tagName === 'SCRIPT' ? event.target.src : '');
        if (!source) return;
        try {
            const url = new URL(source, global.location.href);
            if (url.origin === global.location.origin &&
                (url.pathname === '/script.js' || url.pathname.startsWith('/js/') ||
                 url.pathname.startsWith('/vendor/') || url.pathname === '/socket.io/socket.io.js'))
                finish('fallback');
        } catch { /* An unrelated invalid resource URL is not a boot failure. */ }
    }, true);
    global.document.addEventListener('DOMContentLoaded', () => {
        render(root.dataset.roomBoot);
    }, { once: true });
})(window);
