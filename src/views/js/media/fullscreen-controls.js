(function exposeVoiceFullscreenControls(global) {
    'use strict';

    const { toggleClass } = global.VoiceViewUtils;
    const TEMPORARY_FULLSCREEN_CLASSES = [
        'is-fullscreen',
        'is-expanded',
        'is-focused',
        'is-maximized',
    ];
    const tileEntries = new Map();
    const fullscreenSnapshots = new Map();
    let fullscreenChangeBinding;
    let webFullscreenTile;
    const syncWebButton = (entry) => {
        const active = webFullscreenTile === entry.tile;
        const label = active ? '退出网页内全屏' : '网页内全屏';
        entry.webButton.title = label;
        entry.webButton.setAttribute('aria-label', label);
        entry.webButton.setAttribute('aria-pressed', String(active));
        entry.webButton.textContent = active ? '▣' : '□';
    };
    const exitWebFullscreen = () => {
        const tile = webFullscreenTile;
        webFullscreenTile = undefined;
        tile?.classList.remove('is-web-fullscreen');
        const entry = tileEntries.get(tile);
        if (entry) syncWebButton(entry);
    };

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
        const morphSynced = global.VoiceMorphIconUI?.syncButtonIcon?.(
            button,
            isActive ? 'minimize' : 'maximize'
        );
        if (!morphSynced) {
            let icon = button.querySelector('i');
            if (!icon) {
                icon = global.document.createElement('i');
                icon.setAttribute('aria-hidden', 'true');
                button.append(icon);
            }
            icon.className = getIconClass(isActive);
        }
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(isActive));
        toggleClass(button, 'is-exit', isActive);
    };

    const captureTileState = (tile) => {
        if (!tile || fullscreenSnapshots.has(tile)) {
            return;
        }

        fullscreenSnapshots.set(tile, {
            styleAttribute: tile.getAttribute?.('style') ?? null,
        });
    };

    const restoreTileState = (tile) => {
        const snapshot = fullscreenSnapshots.get(tile);

        if (snapshot) {
            if (snapshot.styleAttribute === null) {
                tile.removeAttribute?.('style');
            } else {
                tile.setAttribute?.('style', snapshot.styleAttribute);
            }
            fullscreenSnapshots.delete(tile);
        }

        TEMPORARY_FULLSCREEN_CLASSES.forEach((className) =>
            tile?.classList?.remove(className)
        );
    };

    const syncFullscreenState = () => {
        const fullscreenElement = getFullscreenElement();

        Array.from(fullscreenSnapshots.keys()).forEach((tile) => {
            if (tile !== fullscreenElement) {
                restoreTileState(tile);
            }
        });

        tileEntries.forEach((entry, tile) => {
            if (
                tile?.isConnected === false ||
                entry.button?.isConnected === false
            ) {
                detachTile(tile);
                return;
            }

            toggleClass(tile, 'is-fullscreen', fullscreenElement === tile);
            syncButtonState(entry.button, tile);
        });
    };

    const updateButtonStates = () => syncFullscreenState();

    const exitFullscreen = async () => {
        if (global.document.exitFullscreen) {
            await global.document.exitFullscreen();
            return;
        }

        if (global.document.webkitExitFullscreen) {
            await global.document.webkitExitFullscreen();
        }
    };

    const requestTileFullscreen = async (tile, video) => {
        if (tile.requestFullscreen) {
            await tile.requestFullscreen();
            return;
        }

        if (tile.webkitRequestFullscreen) {
            await tile.webkitRequestFullscreen();
            return;
        }

        if (video?.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
            return;
        }

        throw new Error('Fullscreen API unavailable');
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
            return false;
        }

        try {
            exitWebFullscreen();
            if (getFullscreenElement() === tile) {
                await exitFullscreen();
            } else {
                if (tile.requestFullscreen || tile.webkitRequestFullscreen) {
                    captureTileState(tile);
                }
                await requestTileFullscreen(tile, video);
            }
            return true;
        } catch (error) {
            if (getFullscreenElement() !== tile) {
                restoreTileState(tile);
            }
            if (typeof onError === 'function') {
                onError(error);
            }
            return false;
        }
    };

    const createButton = () => {
        const button = global.document.createElement('button');

        button.className = 'fullscreen-btn';
        button.classList.add('window-action-button', 'no-drag');
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
            actions || tile.querySelector('.tile-header-actions') || tile;
        let entry = tileEntries.get(tile);

        if (!entry) {
            entry = { button, onError, onUnavailable, tile };
            entry.webButton = global.document.createElement('button');
            entry.webButton.className = 'web-fullscreen-btn window-action-button no-drag';
            entry.webButton.type = 'button';
            entry.toggleWeb = (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                if (getFullscreenElement()) return;
                const wasActive = webFullscreenTile === tile;
                exitWebFullscreen();
                if (!wasActive) {
                    webFullscreenTile = tile;
                    tile.classList.add('is-web-fullscreen');
                }
                syncWebButton(entry);
            };
            entry.webButton.addEventListener('click', entry.toggleWeb);
            entry.toggle = (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                return toggleTileFullscreen({
                    tile,
                    onError: entry.onError,
                    onUnavailable: entry.onUnavailable,
                });
            };
            entry.handleDoubleClick = (event) => {
                if (event.target?.closest?.('.no-drag')) {
                    return;
                }
                void entry.toggle(event);
            };
            button.addEventListener('click', entry.toggle);
            tile.addEventListener('dblclick', entry.handleDoubleClick);
            tileEntries.set(tile, entry);
        } else {
            entry.onError = onError;
            entry.onUnavailable = onUnavailable;
            if (entry.button !== button) {
                entry.button.removeEventListener('click', entry.toggle);
                entry.button = button;
                button.addEventListener('click', entry.toggle);
            }
        }

        if (entry.webButton.parentElement !== targetActions) {
            targetActions.append(entry.webButton);
        }
        if (button.parentElement !== targetActions) {
            targetActions.append(button);
        }

        syncWebButton(entry);
        syncButtonState(button, tile);
        return button;
    };

    function detachTile(tile, { removeButton = true } = {}) {
        const entry = tileEntries.get(tile);

        if (entry) {
            if (webFullscreenTile === tile) exitWebFullscreen();
            entry.webButton.removeEventListener('click', entry.toggleWeb);
            if (removeButton) entry.webButton.remove();
            entry.button.removeEventListener('click', entry.toggle);
            tile.removeEventListener('dblclick', entry.handleDoubleClick);
            if (removeButton) {
                entry.button.remove();
            }
            tileEntries.delete(tile);
        }

        if (getFullscreenElement() === tile) {
            void exitFullscreen().catch(() => {});
        }
        restoreTileState(tile);
    }

    const isTileLayoutWriteBlocked = (tile) =>
        Boolean(
            tile &&
                (getFullscreenElement() === tile ||
                    webFullscreenTile === tile ||
                    fullscreenSnapshots.has(tile) ||
                    tile.classList?.contains('is-fullscreen'))
        );

    const bindFullscreenChange = (root = global.document) => {
        if (fullscreenChangeBinding?.root === root) {
            return fullscreenChangeBinding;
        }

        fullscreenChangeBinding?.destroy();
        const handleFullscreenChange = () => syncFullscreenState();
        const handleEscape = (event) => {
            if (event.key === 'Escape') exitWebFullscreen();
        };
        root.addEventListener('keydown', handleEscape);
        const binding = {
            root,
            destroy: () => {
                root.removeEventListener('keydown', handleEscape);
                root.removeEventListener(
                    'fullscreenchange',
                    handleFullscreenChange
                );
                root.removeEventListener(
                    'webkitfullscreenchange',
                    handleFullscreenChange
                );
                if (fullscreenChangeBinding === binding) {
                    fullscreenChangeBinding = undefined;
                }
            },
            updateButtonStates,
        };

        root.addEventListener('fullscreenchange', handleFullscreenChange);
        root.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        fullscreenChangeBinding = binding;
        syncFullscreenState();
        return binding;
    };

    const destroy = () => {
        fullscreenChangeBinding?.destroy();
        Array.from(tileEntries.keys()).forEach((tile) => detachTile(tile));
        Array.from(fullscreenSnapshots.keys()).forEach((tile) =>
            restoreTileState(tile)
        );
    };

    global.VoiceFullscreenControls = {
        attachTileButton,
        bindFullscreenChange,
        destroy,
        detachTile,
        getFullscreenElement,
        isTileLayoutWriteBlocked,
        toggleTileFullscreen,
        updateButtonStates,
    };
})(window);
