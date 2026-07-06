(function exposeVoiceJoinOverlayUI(global) {
    'use strict';

    const { setHidden, setText } = global.VoiceViewUtils;
    let overlayElement;
    let currentOptions = {};

    const createButton = ({ id, className, text }) => {
        const button = global.document.createElement('button');

        button.id = id;
        button.className = className;
        button.type = 'button';
        button.textContent = text;

        return button;
    };

    const createOverlay = () => {
        const overlay = global.document.createElement('div');
        const dialog = global.document.createElement('div');
        const title = global.document.createElement('h3');
        const message = global.document.createElement('p');
        const actions = global.document.createElement('div');
        const cancelButton = createButton({
            id: 'voiceJoinCancel',
            className: 'voice-join-cancel',
            text: '取消',
        });
        const confirmButton = createButton({
            id: 'voiceJoinConfirm',
            className: 'voice-join-confirm',
            text: '进入语音',
        });

        overlay.id = 'voiceJoinOverlay';
        overlay.className = 'voice-join-overlay hidden';
        dialog.className = 'voice-join-dialog';
        title.id = 'voiceJoinChannelName';
        message.textContent = '进入此频道语音？';
        actions.className = 'voice-join-actions';

        actions.append(cancelButton, confirmButton);
        dialog.append(title, message, actions);
        overlay.append(dialog);

        return overlay;
    };

    const getOverlay = () => {
        if (overlayElement?.isConnected) {
            return overlayElement;
        }

        overlayElement =
            global.document.getElementById('voiceJoinOverlay') ||
            createOverlay();

        if (!overlayElement.isConnected) {
            global.document.body.append(overlayElement);
        }

        return overlayElement;
    };

    const getRefs = () => {
        const overlay = getOverlay();

        return {
            overlay,
            title: overlay.querySelector('#voiceJoinChannelName'),
            message: overlay.querySelector('p'),
            confirmButton: overlay.querySelector('#voiceJoinConfirm'),
            cancelButton: overlay.querySelector('#voiceJoinCancel'),
        };
    };

    const hide = () => {
        const overlay =
            overlayElement ||
            global.document.getElementById('voiceJoinOverlay');

        if (!overlay) {
            return;
        }

        setHidden(overlay);
    };

    const handleCancel = () => {
        if (typeof currentOptions.onCancel === 'function') {
            currentOptions.onCancel();
        }

        hide();
    };

    const handleConfirm = () => {
        if (typeof currentOptions.onConfirm === 'function') {
            currentOptions.onConfirm();
        }

        hide();
    };

    const sync = ({
        title = '',
        message = '进入此频道语音？',
        confirmLabel = '进入语音',
        cancelLabel = '取消',
        confirmDisabled = false,
    } = {}) => {
        const {
            title: titleElement,
            message: messageElement,
            confirmButton,
            cancelButton,
        } = getRefs();

        setText(titleElement, title);
        setText(messageElement, message);
        setText(confirmButton, confirmLabel);
        setText(cancelButton, cancelLabel);

        if (confirmButton) {
            confirmButton.disabled = Boolean(confirmDisabled);
        }
    };

    const bind = () => {
        const { overlay, confirmButton, cancelButton } = getRefs();

        confirmButton.onclick = handleConfirm;
        cancelButton.onclick = handleCancel;
        overlay.onclick = (event) => {
            if (event.target === overlay) {
                handleCancel();
            }
        };
    };

    const show = (options = {}) => {
        currentOptions = options;

        sync(options);
        bind();
        setHidden(getOverlay(), false);
    };

    global.document.addEventListener('keydown', (event) => {
        const overlay =
            overlayElement ||
            global.document.getElementById('voiceJoinOverlay');

        if (
            event.key === 'Escape' &&
            overlay &&
            !overlay.classList.contains('hidden')
        ) {
            handleCancel();
        }
    });

    global.VoiceJoinOverlayUI = {
        getOverlay,
        hide,
        show,
        sync,
    };
})(window);
