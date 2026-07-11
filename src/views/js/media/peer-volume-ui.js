(function exposeVoiceRemoteVolumeUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;
    const popoverSelector = '.peer-volume-popover';
    let rootDocument = global.document;
    let documentBinding;

    const getPopover = () => rootDocument.querySelector(popoverSelector);

    const closePopover = () => {
        getPopover()?.remove();
    };

    const clampVolumePercent = (volume) =>
        Math.max(0, Math.min(100, Math.round(Number(volume))));

    const syncVolumeLabel = (range, valueLabel, volumePercent) => {
        const clampedVolume = clampVolumePercent(volumePercent);

        if (range) {
            range.value = String(clampedVolume);
        }

        setText(valueLabel, `${clampedVolume}%`);
    };

    const positionPopover = (popover, event) => {
        const popoverRect = popover.getBoundingClientRect();
        const left = Math.min(
            Math.max(8, event.clientX),
            global.innerWidth - popoverRect.width - 8
        );
        const top = Math.min(
            Math.max(8, event.clientY),
            global.innerHeight - popoverRect.height - 8
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
        range.max = '100';
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
    } = {}) => {
        if (!event) {
            return null;
        }

        closePopover();

        const popover = createPopover({
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

        rootDocument.body.append(popover);
        positionPopover(popover, event);

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
            if (event.key === 'Escape') {
                closePopover();
            }
        };
        const binding = {
            root,
            closePopover,
            destroy: () => {
                root.removeEventListener('click', handleDocumentClick);
                root.removeEventListener('keydown', handleDocumentKeydown);
                closePopover();
                if (documentBinding === binding) {
                    documentBinding = undefined;
                }
            },
            openPopover,
        };

        root.addEventListener('click', handleDocumentClick);
        root.addEventListener('keydown', handleDocumentKeydown);
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
