(function exposeVoiceCopyLinkUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;
    const timersByButton = new WeakMap();
    const defaultState = {
        defaultLabel: '复制频道链接',
        successLabel: '已复制',
        failureLabel: '复制失败',
        defaultIconClass: 'fas fa-link',
        successIconClass: 'fas fa-check',
        failureIconClass: 'fas fa-exclamation-triangle',
        restoreDelay: 1500,
    };

    const writeClipboardText = (text) =>
        global.navigator.clipboard.writeText(String(text));

    const getVisibleText = (button) => button?.textContent.trim() || '';

    const getButtonLabel = (button, fallback) =>
        getVisibleText(button) ||
        button?.getAttribute('aria-label') ||
        button?.title ||
        fallback;

    const ensureIcon = (button) => {
        let icon = button.querySelector('i');

        if (!icon) {
            icon = global.document.createElement('i');
            button.prepend(icon);
        }

        return icon;
    };

    const setButtonState = (button, label, iconClass, { showText }) => {
        if (!button) {
            return;
        }

        if (showText) {
            setText(button, label);
        }

        const icon = ensureIcon(button);
        icon.className = iconClass;

        button.title = label;
        button.setAttribute('aria-label', label);
        button.classList.toggle(
            'is-copied',
            iconClass === defaultState.successIconClass
        );
    };

    const restoreButton = (button, options) => {
        setButtonState(button, options.defaultLabel, options.defaultIconClass, {
            showText: options.showText,
        });
        timersByButton.delete(button);
    };

    const scheduleRestore = (button, options) => {
        global.clearTimeout(timersByButton.get(button));
        timersByButton.set(
            button,
            global.setTimeout(
                () => restoreButton(button, options),
                options.restoreDelay
            )
        );
    };

    const bindCopyButton = ({
        button,
        getLink,
        onError,
        restoreDelay = defaultState.restoreDelay,
    } = {}) => {
        if (!button || typeof getLink !== 'function') {
            return;
        }

        const options = {
            ...defaultState,
            defaultLabel: getButtonLabel(button, defaultState.defaultLabel),
            showText: Boolean(getVisibleText(button)),
            restoreDelay,
        };

        button.addEventListener('click', async () => {
            try {
                await writeClipboardText(getLink());
                setButtonState(
                    button,
                    options.successLabel,
                    options.successIconClass,
                    {
                        showText: options.showText,
                    }
                );
                scheduleRestore(button, options);
            } catch (error) {
                setButtonState(
                    button,
                    options.failureLabel,
                    options.failureIconClass,
                    {
                        showText: options.showText,
                    }
                );
                scheduleRestore(button, options);

                if (typeof onError === 'function') {
                    onError(error);
                }
            }
        });
    };

    global.VoiceCopyLinkUI = {
        bindCopyButton,
        writeClipboardText,
    };
})(window);
