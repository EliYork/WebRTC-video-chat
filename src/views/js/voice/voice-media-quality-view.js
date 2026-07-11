(function exposeVoiceMediaQualityView(global) {
    'use strict';

    const CLASS_NAME = 'voice-media-quality-pill';

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

    const render = (tile, text) => {
        const overlay = ensureOverlay(tile);
        if (!overlay) {
            return undefined;
        }
        const normalizedText = String(text || '').trim();
        overlay.textContent = normalizedText ? `接收 ${normalizedText}` : '';
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

    const remove = (tile) => tile?.querySelector?.(`.${CLASS_NAME}`)?.remove();

    global.VoiceMediaQualityView = {
        CLASS_NAME,
        ensureOverlay,
        hide,
        remove,
        render,
    };
})(window);
