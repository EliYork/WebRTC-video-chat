(function exposeVoiceOutputVolumeUI(global) {
    'use strict';

    const { byId, setText, toggleClass } = global.VoiceViewUtils;
    const MIN_VOLUME = 0;
    const MAX_VOLUME = 1;

    const clampVolume = (volume) => {
        const numericVolume = Number(volume);

        if (!Number.isFinite(numericVolume)) {
            return MAX_VOLUME;
        }

        return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, numericVolume));
    };

    const getVolumePercent = (volume) => Math.round(clampVolume(volume) * 100);

    const getRefs = (refs = {}) => {
        const button = refs.button || byId('toggleOutput');

        return {
            button,
            slider: refs.slider || byId('outputVolume'),
            label: refs.label || button?.querySelector('span'),
            valueLabel: refs.valueLabel || byId('outputVolumeValue'),
        };
    };

    const getIconClass = (muted, volume) => {
        const clampedVolume = clampVolume(volume);

        if (muted || clampedVolume === 0) {
            return 'fas fa-volume-mute';
        }

        if (clampedVolume < 0.5) {
            return 'fas fa-volume-down';
        }

        return 'fas fa-volume-up';
    };

    const getButtonLabel = (muted, volume) => {
        const percent = getVolumePercent(volume);

        return muted ? `播放已静音，音量 ${percent}%` : `播放音量 ${percent}%`;
    };

    const renderState = ({ refs = {}, muted = false, volume = 1 } = {}) => {
        const { button, slider, label, valueLabel } = getRefs(refs);
        const clampedVolume = clampVolume(volume);
        const percent = getVolumePercent(clampedVolume);
        const statusLabel = getButtonLabel(muted, clampedVolume);
        const icon = button?.querySelector('i');

        if (slider) {
            slider.value = String(clampedVolume);
            slider.title = `${percent}%`;
            slider.setAttribute('aria-valuetext', `${percent}%`);
        }

        if (button) {
            toggleClass(button, 'is-off', muted);
            button.title = statusLabel;
            button.setAttribute('aria-label', statusLabel);
            button.setAttribute('aria-pressed', String(muted));
        }

        if (icon) {
            icon.className = getIconClass(muted, clampedVolume);
        }

        setText(label, muted ? '已静音' : '听筒');
        setText(valueLabel, `${percent}%`);
    };

    const init = ({
        refs = {},
        getState = () => ({}),
        onToggleMuted,
        onVolumeInput,
        onVolumeCommit,
    } = {}) => {
        const resolvedRefs = getRefs(refs);

        const sync = () => {
            renderState({
                refs: resolvedRefs,
                ...getState(),
            });
        };

        resolvedRefs.button?.addEventListener('click', () => {
            if (typeof onToggleMuted === 'function') {
                onToggleMuted();
            }

            sync();
        });

        resolvedRefs.slider?.addEventListener('input', () => {
            const nextVolume = clampVolume(resolvedRefs.slider.value);

            renderState({
                refs: resolvedRefs,
                ...getState(),
                volume: nextVolume,
            });

            if (typeof onVolumeInput === 'function') {
                onVolumeInput(nextVolume);
            }
        });

        resolvedRefs.slider?.addEventListener('change', () => {
            const nextVolume = clampVolume(resolvedRefs.slider.value);

            if (typeof onVolumeCommit === 'function') {
                onVolumeCommit(nextVolume);
            }

            sync();
        });

        sync();

        return {
            renderState: sync,
        };
    };

    global.VoiceOutputVolumeUI = {
        clampVolume,
        getVolumePercent,
        init,
        renderState,
    };
})(window);
