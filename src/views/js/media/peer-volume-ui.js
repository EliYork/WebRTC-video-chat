(function exposeVoiceRemoteVolumeUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;
    const popoverSelector = '.peer-volume-popover';
    let rootDocument = global.document;
    let documentBinding;
    let activePopover;
    let popoverAnchor;
    let popoverOpener;
    let closeWatcher;

    const getPopover = () => rootDocument.querySelector(popoverSelector);

    const closePopover = ({ restoreFocus = false } = {}) => {
        const popover = activePopover || getPopover();
        const opener = popoverOpener;
        const ownsFocus = popover?.contains?.(rootDocument.activeElement);
        const watcher = closeWatcher;
        closeWatcher = undefined;
        activePopover = null;
        popoverAnchor = null;
        popoverOpener = null;
        watcher?.destroy();
        popover?.remove();
        if (restoreFocus && ownsFocus && opener?.isConnected) opener.focus();
    };

    const clampVolumePercent = (volume) =>
        Number.isFinite(Number(volume)) ? Math.max(0, Math.min(200, Math.round(Number(volume)))) : 100;

    const syncVolumeLabel = (range, valueLabel, volumePercent) => {
        const clampedVolume = clampVolumePercent(volumePercent);

        if (range) {
            range.value = String(clampedVolume);
        }

        setText(valueLabel, `${clampedVolume}%`);
    };

    const positionPopover = (popover, event) => {
        const viewport = global.visualViewport;
        const width = viewport?.width > 0 ? viewport.width : global.innerWidth;
        const height = viewport?.height > 0 ? viewport.height : global.innerHeight;
        const x = Number.isFinite(viewport?.offsetLeft) ? viewport.offsetLeft : 0;
        const y = Number.isFinite(viewport?.offsetTop) ? viewport.offsetTop : 0;
        const minLeft = x + 8, minTop = y + 8;
        // Constrain the border box before measuring, including keyboard/zoom viewports.
        popover.style.maxWidth = `${Math.max(0, width - 16)}px`;
        popover.style.maxHeight = `${Math.max(0, height - 16)}px`;
        const popoverRect = popover.getBoundingClientRect();
        const left = Math.min(
            Math.max(minLeft, Number.isFinite(event.clientX) ? event.clientX : minLeft),
            Math.max(minLeft, x + width - popoverRect.width - 8)
        );
        const top = Math.min(
            Math.max(minTop, Number.isFinite(event.clientY) ? event.clientY : minTop),
            Math.max(minTop, y + height - popoverRect.height - 8)
        );

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    };

    const createPopover = ({
        currentVolume = 100,
        disabled = false,
        emptyText = '',
        iconClass = 'fas fa-microphone',
        muteLabel = '',
        muted = false,
        onMutedChange,
        onVolumeInput,
        titleText: requestedTitle = '设置用户音量',
    } = {}) => {
        const popover = rootDocument.createElement('div');
        const title = rootDocument.createElement('div');
        const titleText = rootDocument.createElement('span');
        const icon = rootDocument.createElement('i');
        const range = rootDocument.createElement('input');
        const value = rootDocument.createElement('span');
        const volumePercent = clampVolumePercent(currentVolume);

        popover.className = 'peer-volume-popover';
        title.className = 'peer-volume-title';
        titleText.textContent = requestedTitle;
        icon.className = iconClass;
        range.type = 'range';
        range.min = '0';
        range.max = '200';
        range.setAttribute('aria-label', requestedTitle);
        range.step = '5';
        range.disabled = disabled;
        value.className = 'peer-volume-value';

        syncVolumeLabel(range, value, volumePercent);

        range.addEventListener('input', () => {
            const nextVolume = clampVolumePercent(range.value);

            syncVolumeLabel(range, value, nextVolume);

            if (typeof onVolumeInput === 'function') {
                onVolumeInput(nextVolume);
            }
        });

        title.append(titleText, icon);
        popover.append(title, range, value);

        if (muteLabel) {
            const muteButton = rootDocument.createElement('button');
            const syncMuted = (nextMuted) => {
                muted = Boolean(nextMuted);
                muteButton.textContent = `${muteLabel}：${muted ? '开' : '关'}`;
                muteButton.setAttribute('aria-pressed', String(muted));
            };

            muteButton.className = 'peer-volume-mute';
            muteButton.type = 'button';
            muteButton.disabled = disabled;
            syncMuted(muted);
            muteButton.addEventListener('click', () => {
                if (muteButton.disabled) {
                    return;
                }
                syncMuted(!muted);
                onMutedChange?.(muted);
            });
            popover.append(muteButton);
        }

        if (disabled && emptyText) {
            const empty = rootDocument.createElement('p');
            empty.className = 'peer-volume-empty';
            empty.textContent = emptyText;
            popover.append(empty);
        }

        return popover;
    };

    const openPopover = ({
        event,
        currentVolume = 100,
        disabled = false,
        emptyText = '',
        iconClass,
        muteLabel,
        muted = false,
        onMutedChange,
        onVolumeInput,
        titleText,
        controls,
    } = {}) => {
        if (!event) {
            return null;
        }

        closePopover();
        const opener = typeof event.currentTarget?.focus === 'function'
            ? event.currentTarget : rootDocument.activeElement;
        const keyboard = event.detail === 0 && event.clientX === 0 && event.clientY === 0;

        const popover = controls?.length ? rootDocument.createElement('div') : createPopover({
            currentVolume,
            disabled,
            emptyText,
            iconClass,
            muteLabel,
            muted,
            onMutedChange,
            onVolumeInput,
            titleText,
        });
        if (controls?.length) {
            popover.className = 'peer-volume-popover';
            controls.forEach((control) => {
                const section = createPopover(control);
                section.className = 'peer-volume-section';
                popover.append(section);
            });
        }
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', titleText || '成员音量');
        popover.tabIndex = -1;
        // Fullscreen hides everything outside its top-layer subtree.
        const fullscreen = rootDocument.fullscreenElement || rootDocument.webkitFullscreenElement;
        (fullscreen || rootDocument.querySelector('.is-web-fullscreen') || rootDocument.body).append(popover);
        activePopover = popover;
        popoverOpener = opener;
        popoverAnchor = { clientX: event.clientX, clientY: event.clientY };
        if (keyboard && typeof opener?.getBoundingClientRect === 'function') {
            const rect = opener.getBoundingClientRect();
            popoverAnchor = { clientX: rect.left, clientY: rect.bottom + 4 };
        }
        if (global.CloseWatcher) {
            closeWatcher = new global.CloseWatcher();
            closeWatcher.addEventListener('close', () => {
                if (activePopover === popover) closePopover({ restoreFocus: true });
            });
        }
        positionPopover(popover, popoverAnchor);
        if (keyboard) {
            const control = popover.querySelector('input:enabled') || popover.querySelector('button:enabled');
            (control || popover).focus();
        }

        return popover;
    };

    const init = ({ root = global.document } = {}) => {
        if (documentBinding?.root === root) {
            return documentBinding;
        }

        documentBinding?.destroy();
        rootDocument = root;
        const handleDocumentClick = (event) => {
            if (!event.target.closest(popoverSelector)) {
                closePopover();
            }
        };
        const handleDocumentKeydown = (event) => {
            if (event.key === 'Escape' && activePopover && !event.defaultPrevented && !event.isComposing) {
                event.preventDefault();
                closePopover({ restoreFocus: true });
            }
        };
        const viewport = global.visualViewport;
        const reposition = () => {
            if (activePopover && popoverAnchor) positionPopover(activePopover, popoverAnchor);
        };
        const binding = {
            root,
            closePopover,
            destroy: () => {
                root.removeEventListener('click', handleDocumentClick);
                root.removeEventListener('keydown', handleDocumentKeydown);
                root.removeEventListener('fullscreenchange', closePopover);
                root.removeEventListener('webkitfullscreenchange', closePopover);
                global.removeEventListener?.('resize', reposition);
                viewport?.removeEventListener('resize', reposition);
                viewport?.removeEventListener('scroll', reposition);
                closePopover();
                if (documentBinding === binding) {
                    documentBinding = undefined;
                }
            },
            openPopover,
        };

        root.addEventListener('click', handleDocumentClick);
        root.addEventListener('keydown', handleDocumentKeydown);
        root.addEventListener('fullscreenchange', closePopover);
        root.addEventListener('webkitfullscreenchange', closePopover);
        global.addEventListener?.('resize', reposition);
        viewport?.addEventListener('resize', reposition);
        viewport?.addEventListener('scroll', reposition);
        documentBinding = binding;
        return binding;
    };

    const destroy = () => documentBinding?.destroy();

    global.VoiceRemoteVolumeUI = {
        closePopover,
        destroy,
        init,
        openPopover,
        syncVolumeLabel,
    };
})(window);
