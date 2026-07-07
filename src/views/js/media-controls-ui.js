(function (global) {
    const { byId, setHidden, toggleClass } = global.VoiceViewUtils;

    const getRefs = (refs = {}) => ({
        controls: refs.controls || byId('buttons'),
        leaveButton: refs.leaveButton || null,
        micButton: refs.micButton || byId('toggleAudio'),
        cameraButton: refs.cameraButton || byId('toggleVideo'),
    });

    const setButtonPressed = (button, pressed) => {
        button?.setAttribute('aria-pressed', String(pressed));
    };

    const setButtonLabel = (button, label) => {
        if (!button || !label) {
            return;
        }

        button.title = label;
        button.setAttribute('aria-label', label);
    };

    const renderCallControls = ({ refs = {}, visible = false } = {}) => {
        const { controls, leaveButton } = getRefs(refs);
        setHidden(controls, !visible);
        setHidden(leaveButton, !visible);
    };

    const renderMicButtonState = ({
        refs = {},
        enabled = false,
        unavailable = false,
        disabled = false,
    } = {}) => {
        const { micButton } = getRefs(refs);
        const icon = micButton?.querySelector('i');

        if (!micButton || !icon) {
            return false;
        }

        const isOff = unavailable || !enabled;
        icon.className = 'fas fa-microphone';
        toggleClass(micButton, 'is-off', isOff);
        setButtonPressed(micButton, isOff);
        setButtonLabel(
            micButton,
            unavailable ? '麦克风不可用' : enabled ? '关闭麦克风' : '打开麦克风'
        );
        micButton.disabled = Boolean(disabled);
        return true;
    };

    const renderCameraButtonState = ({
        refs = {},
        enabled = false,
        disabled = false,
    } = {}) => {
        const { cameraButton } = getRefs(refs);
        const icon = cameraButton?.querySelector('i');

        if (!cameraButton || !icon) {
            return false;
        }

        icon.className = 'fas fa-video';
        toggleClass(cameraButton, 'is-off', !enabled);
        setButtonPressed(cameraButton, !enabled);
        setButtonLabel(cameraButton, enabled ? '关闭摄像头' : '打开摄像头');
        cameraButton.disabled = Boolean(disabled);
        return true;
    };

    const renderLeaveButtonState = ({
        refs = {},
        disabled = false,
        label = '离开',
    } = {}) => {
        const { leaveButton } = getRefs(refs);

        if (!leaveButton) {
            return false;
        }

        leaveButton.disabled = Boolean(disabled);
        leaveButton.textContent = label;
        return true;
    };

    global.VoiceMediaControlsUI = {
        renderCallControls,
        renderMicButtonState,
        renderCameraButtonState,
        renderLeaveButtonState,
    };
})(window);
