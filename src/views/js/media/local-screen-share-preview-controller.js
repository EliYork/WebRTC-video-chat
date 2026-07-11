(function exposeVoiceLocalScreenSharePreviewController(global) {
    'use strict';

    const createController = ({
        attachMediaElement,
        clearMediaElement,
        exitFullscreen,
        isFullscreen,
    } = {}) => {
        let activeSession;
        let button;
        let currentGeneration = 0;
        let hidden = false;
        let mediaElement;
        let pending = false;
        let placeholder;
        let retiredSessions = new WeakSet();
        let stream;
        let target;
        let tile;

        const setButtonState = () => {
            if (!button) {
                return;
            }

            const label = hidden ? '显示预览' : '隐藏预览';
            button.textContent = label;
            button.title = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', String(hidden));
            button.disabled = pending;
        };

        const renderVisibility = () => {
            tile?.classList?.toggle('is-local-preview-hidden', hidden);
            if (mediaElement) {
                mediaElement.hidden = hidden;
            }
            if (placeholder) {
                placeholder.hidden = !hidden;
            }
            setButtonState();
        };

        const ensurePlaceholder = () => {
            if (!target) {
                return;
            }
            if (!placeholder || placeholder.parentElement !== target) {
                placeholder?.remove?.();
                placeholder = global.document.createElement('div');
                const title = global.document.createElement('strong');
                const status = global.document.createElement('span');

                placeholder.className = 'local-screen-preview-placeholder';
                placeholder.setAttribute('role', 'status');
                title.textContent = '本地预览已隐藏';
                status.textContent = '屏幕仍在共享';
                placeholder.append(title, status);
                target.append(placeholder);
            }
        };

        const handleToggle = async (event) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (pending || !activeSession) {
                return false;
            }

            pending = true;
            setButtonState();
            const session = activeSession;
            try {
                if (!hidden && isFullscreen?.(tile)) {
                    const exited = await exitFullscreen?.(tile);
                    if (
                        exited === false ||
                        activeSession !== session ||
                        isFullscreen?.(tile)
                    ) {
                        return false;
                    }
                }

                if (activeSession !== session) {
                    return false;
                }

                hidden = !hidden;
                if (hidden) {
                    clearMediaElement?.(mediaElement);
                } else if (stream) {
                    attachMediaElement?.(mediaElement, stream);
                }
                renderVisibility();
                return true;
            } finally {
                pending = false;
                setButtonState();
            }
        };

        const ensureButton = () => {
            const actions = tile?.querySelector?.('.tile-header-actions');
            if (!actions) {
                return;
            }
            if (!button) {
                button = global.document.createElement('button');
                button.className = 'local-screen-preview-toggle';
                button.type = 'button';
                button.addEventListener('click', handleToggle);
            }
            if (button.parentElement !== actions) {
                actions.append(button);
            }
        };

        const clearOwnedMediaElement = () => {
            if (mediaElement) {
                clearMediaElement?.(mediaElement);
                mediaElement.hidden = false;
            }
        };

        const release = ({ clearMedia = true } = {}) => {
            if (clearMedia) {
                clearOwnedMediaElement();
            } else if (mediaElement) {
                mediaElement.hidden = false;
            }
            button?.removeEventListener?.('click', handleToggle);
            button?.remove?.();
            placeholder?.remove?.();
            tile?.classList?.remove('is-local-preview-hidden');
            if (
                activeSession &&
                (typeof activeSession === 'object' ||
                    typeof activeSession === 'function')
            ) {
                retiredSessions.add(activeSession);
            }
            activeSession = undefined;
            button = undefined;
            currentGeneration = 0;
            hidden = false;
            mediaElement = undefined;
            pending = false;
            placeholder = undefined;
            stream = undefined;
            target = undefined;
            tile = undefined;
        };

        const bindSource = ({
            generation = 0,
            mediaElement: nextMediaElement,
            session,
            stream: nextStream,
            target: nextTarget,
            tile: nextTile,
        } = {}) => {
            if (!session || !nextMediaElement || !nextStream || !nextTile) {
                return {
                    accepted: false,
                    generation: currentGeneration,
                    hidden,
                };
            }
            if (
                (typeof session === 'object' ||
                    typeof session === 'function') &&
                retiredSessions.has(session)
            ) {
                return {
                    accepted: false,
                    generation: currentGeneration,
                    hidden,
                };
            }

            const nextGeneration = Number(generation) || 0;
            const isNewSession = activeSession !== session;
            if (!isNewSession && nextGeneration < currentGeneration) {
                return {
                    accepted: false,
                    generation: currentGeneration,
                    hidden,
                };
            }

            if (isNewSession) {
                release();
                activeSession = session;
                hidden = false;
            } else if (mediaElement && mediaElement !== nextMediaElement) {
                clearOwnedMediaElement();
            }

            currentGeneration = nextGeneration;
            mediaElement = nextMediaElement;
            stream = nextStream;
            target = nextTarget;
            tile = nextTile;
            ensureButton();
            ensurePlaceholder();

            if (hidden) {
                clearMediaElement?.(mediaElement);
            } else {
                attachMediaElement?.(mediaElement, stream);
            }
            renderVisibility();
            return { accepted: true, generation: currentGeneration, hidden };
        };

        const stopSession = (session = activeSession) => {
            if (!activeSession || (session && session !== activeSession)) {
                return false;
            }
            release();
            return true;
        };

        const getSnapshot = () => ({
            active: Boolean(activeSession),
            generation: currentGeneration,
            hidden,
            mediaElement,
            pending,
            session: activeSession,
            stream,
            tile,
        });

        return {
            bindSource,
            destroy: () => {
                release();
                retiredSessions = new WeakSet();
            },
            getSnapshot,
            hidePreview: () => (hidden ? true : handleToggle()),
            showPreview: () => (hidden ? handleToggle() : true),
            stopSession,
            togglePreview: handleToggle,
        };
    };

    global.VoiceLocalScreenSharePreviewController = {
        createController,
    };
})(window);
