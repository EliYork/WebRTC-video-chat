(function exposeRoomBoot(global) {
    'use strict';
    const root = global.document.documentElement;
    let timer;
    const finish = (state = 'ready') => {
        global.clearTimeout(timer);
        root.dataset.roomBoot = state;
        if (state === 'fallback') {
            const message = global.document.querySelector('[data-room-load-message]');
            if (message) message.textContent = '界面加载未完成，可以刷新重试';
        }
    };
    global.VoiceRoomBoot = { finish };
    timer = global.setTimeout(() => finish('fallback'), 8000);
    global.addEventListener('error', (event) => {
        if (event.filename?.includes('/script.js') || event.target?.src?.includes('/script.js'))
            finish('fallback');
    }, true);
    global.document.addEventListener('DOMContentLoaded', () => {
        global.document.querySelector('[data-room-reload]')?.addEventListener('click', () => global.location.reload());
    }, { once: true });
})(window);
