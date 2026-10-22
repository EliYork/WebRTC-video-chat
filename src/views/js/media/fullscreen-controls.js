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
    let nativeRequest;
    let webFullscreenTile;
    let webCloseWatcher;
    const compact = () => global.matchMedia?.('(max-width: 640px), (max-width: 1000px) and (max-height: 550px)').matches === true;
    const syncImmersive = (entry) => {
        const active = compact() && (webFullscreenTile === entry.tile || getFullscreenElement() === entry.tile);
        if (active === entry.immersive) return;
        entry.immersive = active;
        entry.tile.classList.toggle('is-immersive-player', active);
        if (active) entry.reveal();
        else { global.clearTimeout?.(entry.controlsTimer); entry.tile.classList.remove('player-controls-hidden'); }
    };
    const syncWebButton = (entry) => {
        const active = webFullscreenTile === entry.tile;
        const label = active ? '退出网页内全屏' : '网页内全屏';
        entry.webButton.title = label;
        entry.webButton.setAttribute('aria-label', label);
        entry.webButton.setAttribute('aria-pressed', String(active));
        entry.webButton.textContent = active ? '▣' : '□';
        syncButtonState(entry.button, entry.tile);
    };
    const exitWebFullscreen = () => {
        const tile = webFullscreenTile;
        webFullscreenTile = undefined;
        tile?.classList.remove('is-web-fullscreen');
        const entry = tileEntries.get(tile);
        webCloseWatcher?.destroy(); webCloseWatcher = undefined;
        if (entry) { syncWebButton(entry); syncImmersive(entry); }
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

        const isActive = Boolean(tile && (getFullscreenElement() === tile || webFullscreenTile === tile));
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
        if (nativeRequest && nativeRequest.tile === fullscreenElement) nativeRequest.entered = true;
        else if (nativeRequest?.entered) nativeRequest = undefined;

        Array.from(fullscreenSnapshots.keys()).forEach((tile) => {
            if (tile !== fullscreenElement && nativeRequest?.tile !== tile) {
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
            syncImmersive(entry);
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
    const exitTileFullscreen = (tile) => {
        if (nativeRequest?.tile === tile) nativeRequest = undefined;
        if (webFullscreenTile === tile) exitWebFullscreen();
        if (getFullscreenElement() === tile) void exitFullscreen().catch(() => {});
        else restoreTileState(tile);
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

        let request;
        try {
            if (webFullscreenTile === tile) { nativeRequest = undefined; exitWebFullscreen(); return true; }
            exitWebFullscreen();
            if (getFullscreenElement() === tile) {
                nativeRequest = undefined;
                await exitFullscreen();
            } else {
                request = { tile, entered: false };
                nativeRequest = request;
                if (tile.requestFullscreen || tile.webkitRequestFullscreen) {
                    captureTileState(tile);
                }
                await requestTileFullscreen(tile, video);
                if (nativeRequest !== request || tile.isConnected === false) {
                    if (nativeRequest === request) nativeRequest = undefined;
                    // A later request for this same tile still owns fullscreen.
                    if (getFullscreenElement() === tile && nativeRequest?.tile !== tile) await exitFullscreen();
                    if (getFullscreenElement() !== tile && nativeRequest?.tile !== tile) restoreTileState(tile);
                    return false;
                }
                request.entered = getFullscreenElement() === tile;
            }
            return true;
        } catch (error) {
            if (request && (nativeRequest !== request || tile.isConnected === false)) {
                if (nativeRequest === request) nativeRequest = undefined;
                if (getFullscreenElement() !== tile && nativeRequest?.tile !== tile) restoreTileState(tile);
                return false;
            }
            if (nativeRequest === request) nativeRequest = undefined;
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
            entry.reveal = () => {
                global.clearTimeout?.(entry.controlsTimer);
                tile.classList.remove('player-controls-hidden');
                if (!entry.immersive) return;
                entry.controlsTimer = global.setTimeout?.(() => {
                    const editing = entry.keyboardActive || tile.querySelector('.voice-player-menu, .voice-share-stats:not([hidden]), dialog[open], .peer-volume-popover');
                    if (editing) { entry.reveal(); return; }
                    tile.classList.add('player-controls-hidden');
                }, 3000);
            };
            entry.pointer = (event) => {
                entry.keyboardActive = false;
                if (!entry.immersive) return;
                if (event.type === 'pointerup' && event.target?.tagName === 'VIDEO' && !tile.classList.contains('player-controls-hidden')) {
                    global.clearTimeout?.(entry.controlsTimer);
                    tile.classList.add('player-controls-hidden');
                } else entry.reveal();
            };
            entry.keyboard = () => { entry.keyboardActive = true; entry.reveal(); };
            entry.focusout = () => {
                if (!tile.querySelector('.tile-header')?.contains(global.document.activeElement)) entry.keyboardActive = false;
                entry.reveal();
            };
            tile.addEventListener('pointerup', entry.pointer);
            tile.addEventListener('keydown', entry.keyboard);
            tile.addEventListener('focusout', entry.focusout);
            entry.webButton = global.document.createElement('button');
            entry.webButton.className = 'web-fullscreen-btn window-action-button no-drag';
            entry.webButton.type = 'button';
            entry.toggleWeb = (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                if (getFullscreenElement()) return;
                if (nativeRequest) {
                    const pendingTile = nativeRequest.tile;
                    nativeRequest = undefined;
                    restoreTileState(pendingTile);
                }
                const wasActive = webFullscreenTile === tile;
                exitWebFullscreen();
                if (!wasActive) {
                    webFullscreenTile = tile;
                    tile.classList.add('is-web-fullscreen');
                    if (global.CloseWatcher) {
                        webCloseWatcher = new global.CloseWatcher();
                        webCloseWatcher.addEventListener('close', exitWebFullscreen);
                    }
                }
                syncWebButton(entry);
                syncImmersive(entry);
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
        exitTileFullscreen(tile);
        const entry = tileEntries.get(tile);

        if (entry) {
            if (webFullscreenTile === tile) exitWebFullscreen();
            entry.webButton.removeEventListener('click', entry.toggleWeb);
            if (removeButton) entry.webButton.remove();
            entry.button.removeEventListener('click', entry.toggle);
            tile.removeEventListener('dblclick', entry.handleDoubleClick);
            tile.removeEventListener('pointerup', entry.pointer);
            tile.removeEventListener('keydown', entry.keyboard);
            tile.removeEventListener('focusout', entry.focusout);
            global.clearTimeout?.(entry.controlsTimer);
            tile.classList.remove('is-immersive-player', 'player-controls-hidden');
            if (removeButton) {
                entry.button.remove();
            }
            tileEntries.delete(tile);
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
            // Device dialogs/popovers can be outside the player's subtree and
            // register their document handler later than fullscreen does.
            const overlaySelector = '.voice-player-menu, dialog[open], .peer-volume-popover, [data-device-popover].is-open';
            if (event.key === 'Escape' && webFullscreenTile && !event.defaultPrevented && !event.isComposing &&
                !root.querySelector?.(overlaySelector) && !webFullscreenTile.querySelector(overlaySelector)) {
                event.preventDefault?.(); exitWebFullscreen();
            }
        };
        root.addEventListener('keydown', handleEscape);
        const binding = {
            root,
            destroy: () => {
                root.removeEventListener('keydown', handleEscape);
                global.removeEventListener?.('resize', handleFullscreenChange);
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
        global.addEventListener?.('resize', handleFullscreenChange);
        root.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        fullscreenChangeBinding = binding;
        syncFullscreenState();
        return binding;
    };

    const destroy = () => {
        nativeRequest = undefined;
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
        exitTileFullscreen,
        getFullscreenElement,
        isTileLayoutWriteBlocked,
        toggleTileFullscreen,
        updateButtonStates,
    };
})(window);
