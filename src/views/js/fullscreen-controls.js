(function exposeVoiceFullscreenControls(global) {
    'use strict';

    const { setText, toggleClass } = global.VoiceViewUtils;
    const buttonEntries = new Map();

    const getFullscreenElement = () =>
        global.document.fullscreenElement ||
        global.document.webkitFullscreenElement;

    const getButtonLabel = (isActive) => (isActive ? '退出全屏' : '全屏');

    const getIconClass = (isActive) =>
        isActive ? 'fas fa-compress' : 'fas fa-expand';

    const syncButtonState = (button, tile) => {
        if (!button) {
            return;
        }

        const isActive = Boolean(tile && getFullscreenElement() === tile);
        const label = getButtonLabel(isActive);
        const icon = button.querySelector('i');

        setText(button, label);

        if (icon) {
            icon.className = getIconClass(isActive);
        }

        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(isActive));
        toggleClass(button, 'is-exit', isActive);
    };

    const updateButtonStates = () => {
        buttonEntries.forEach((tile, button) => {
            if (!button.isConnected || !tile?.isConnected) {
                buttonEntries.delete(button);
                return;
            }

            syncButtonState(button, tile);
        });
    };

    const exitFullscreen = async () => {
        if (global.document.exitFullscreen) {
            await global.document.exitFullscreen();
            return;
        }

        if (global.document.webkitExitFullscreen) {
            global.document.webkitExitFullscreen();
        }
    };

    const requestTileFullscreen = async (tile, video) => {
        if (tile.requestFullscreen) {
            await tile.requestFullscreen();
            return;
        }

        if (tile.webkitRequestFullscreen) {
            tile.webkitRequestFullscreen();
            return;
        }

        if (video?.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        }
    };

    const toggleTileFullscreen = async ({
        tile,
        onError,
        onUnavailable,
    } = {}) => {
        const video = tile?.querySelector('video');

        if (!tile || !video) {
            if (typeof onUnavailable === 'function') {
                onUnavailable();
            }
            return;
        }

        try {
            if (getFullscreenElement() === tile) {
                await exitFullscreen();
            } else {
                await requestTileFullscreen(tile, video);
            }

            updateButtonStates();
        } catch (error) {
            if (typeof onError === 'function') {
                onError(error);
            }
        }
    };

    const createButton = () => {
        const button = global.document.createElement('button');

        button.className = 'fullscreen-btn';
        button.type = 'button';
        syncButtonState(button);

        return button;
    };

    const attachTileButton = ({
        tile,
        actions,
        onError,
        onUnavailable,
    } = {}) => {
        if (!tile) {
            return null;
        }

        const button = tile.querySelector('.fullscreen-btn') || createButton();
        const targetActions =
            actions || tile.querySelector('.tile-actions') || tile;
        const toggle = () =>
            toggleTileFullscreen({
                tile,
                onError,
                onUnavailable,
            });

        if (!buttonEntries.has(button)) {
            button.addEventListener('click', toggle);
        }

        buttonEntries.set(button, tile);

        if (!button.isConnected) {
            targetActions.append(button);
        }

        tile.ondblclick = toggle;
        syncButtonState(button, tile);

        return button;
    };

    const bindFullscreenChange = (root = global.document) => {
        root.addEventListener('fullscreenchange', updateButtonStates);
        root.addEventListener('webkitfullscreenchange', updateButtonStates);

        return {
            updateButtonStates,
        };
    };

    global.VoiceFullscreenControls = {
        attachTileButton,
        bindFullscreenChange,
        getFullscreenElement,
        toggleTileFullscreen,
        updateButtonStates,
    };
})(window);
