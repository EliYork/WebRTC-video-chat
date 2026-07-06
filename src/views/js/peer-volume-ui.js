(function exposeVoiceRemoteVolumeUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;
    const popoverSelector = '.peer-volume-popover';
    let rootDocument = global.document;

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

    const createPopover = ({ currentVolume = 100, onVolumeInput } = {}) => {
        const popover = rootDocument.createElement('div');
        const title = rootDocument.createElement('div');
        const titleText = rootDocument.createElement('span');
        const icon = rootDocument.createElement('i');
        const range = rootDocument.createElement('input');
        const value = rootDocument.createElement('span');
        const volumePercent = clampVolumePercent(currentVolume);

        popover.className = 'peer-volume-popover';
        title.className = 'peer-volume-title';
        titleText.textContent = '设置用户音量';
        icon.className = 'fas fa-microphone';
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.step = '5';
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

        return popover;
    };

    const openPopover = ({
        event,
        currentVolume = 100,
        onVolumeInput,
    } = {}) => {
        if (!event) {
            return null;
        }

        closePopover();

        const popover = createPopover({
            currentVolume,
            onVolumeInput,
        });

        rootDocument.body.append(popover);
        positionPopover(popover, event);

        return popover;
    };

    const init = ({ root = global.document } = {}) => {
        rootDocument = root;

        rootDocument.addEventListener('click', (event) => {
            if (!event.target.closest(popoverSelector)) {
                closePopover();
            }
        });

        rootDocument.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closePopover();
            }
        });

        return {
            closePopover,
            openPopover,
        };
    };

    global.VoiceRemoteVolumeUI = {
        closePopover,
        init,
        openPopover,
        syncVolumeLabel,
    };
})(window);
