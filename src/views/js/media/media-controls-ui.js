(function (global) {
    const { byId, setHidden, setText, toggleClass } = global.VoiceViewUtils;
    const CLOSE_DELAY_MS = 220;

    const getRefs = (refs = {}) => ({
        controls: refs.controls || byId('buttons'),
        leaveButton: refs.leaveButton || null,
        micButton: refs.micButton || byId('toggleAudio'),
        cameraButton: refs.cameraButton || byId('toggleVideo'),
        screenButton: refs.screenButton || byId('shareScreen'),
        channelName: refs.channelName || byId('localVoiceChannelName'),
        duration: refs.duration || byId('callDuration'),
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

    const renderDockState = ({
        refs = {},
        channelName = '',
        durationText = '',
    } = {}) => {
        const resolvedRefs = getRefs(refs);
        setText(resolvedRefs.channelName, channelName);
        setText(resolvedRefs.duration, durationText);
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

    const renderScreenShareButtonState = ({
        refs = {},
        sharing = false,
        disabled = false,
    } = {}) => {
        const { screenButton } = getRefs(refs);
        const icon = screenButton?.querySelector('i');

        if (!screenButton || !icon) {
            return false;
        }

        icon.className = sharing ? 'fas fa-desktop' : 'far fa-newspaper';
        toggleClass(screenButton, 'is-off', !sharing);
        screenButton.setAttribute('aria-pressed', String(sharing));
        setButtonLabel(screenButton, sharing ? '停止屏幕共享' : '开始屏幕共享');
        screenButton.disabled = Boolean(disabled);
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
        leaveButton.title = label;
        leaveButton.setAttribute('aria-label', label);

        if (!leaveButton.querySelector('i')) {
            leaveButton.textContent = label;
        }

        return true;
    };

    const getDeviceLabel = (device, index, fallbackPrefix) =>
        device.label || `${fallbackPrefix} ${index + 1}`;

    const getStatusText = (devices, selectedDeviceId) => {
        if (!selectedDeviceId || selectedDeviceId === 'default') {
            return '默认设备';
        }

        return (
            devices.find((device) => device.deviceId === selectedDeviceId)
                ?.label || '已选择设备'
        );
    };

    const renderDeviceList = ({
        type,
        devices = [],
        selectedDeviceId = 'default',
        onSelect,
        unsupported = false,
    } = {}) => {
        const list = global.document.querySelector(
            `[data-device-list="${type}"]`
        );
        const status = byId(
            type === 'mic' ? 'micDeviceStatus' : 'outputDeviceStatus'
        );
        const warning = global.document.querySelector(
            '[data-output-unsupported]'
        );
        const fallbackPrefix = type === 'mic' ? '麦克风' : '输出设备';
        const normalizedSelected = selectedDeviceId || 'default';
        const defaultDevice = {
            deviceId: 'default',
            label: '默认设备',
        };
        const allDevices = [
            defaultDevice,
            ...devices.filter((device) => device.deviceId !== 'default'),
        ];

        if (!list) {
            return;
        }

        list.replaceChildren();
        allDevices.forEach((device, index) => {
            const button = global.document.createElement('button');
            const labelNode = global.document.createElement('span');
            const icon = global.document.createElement('i');
            const isSelected = device.deviceId === normalizedSelected;
            const label =
                device.deviceId === 'default'
                    ? '默认设备'
                    : getDeviceLabel(device, index - 1, fallbackPrefix);

            button.type = 'button';
            button.className = 'media-device-option';
            button.dataset.deviceId = device.deviceId;
            button.setAttribute('aria-pressed', String(isSelected));
            labelNode.textContent = label;
            icon.className = 'fas fa-check';
            icon.setAttribute('aria-hidden', 'true');
            button.append(labelNode, icon);
            button.addEventListener('click', () => {
                if (typeof onSelect === 'function') {
                    onSelect(device.deviceId);
                }
            });
            list.append(button);
        });

        setText(status, getStatusText(allDevices, normalizedSelected));
        warning?.classList.toggle('hidden', !unsupported);
    };

    const bindMediaDevicePopovers = ({
        root = global.document,
        isMobile = () =>
            global.matchMedia?.('(hover: none), (pointer: coarse)').matches,
        onOpen,
    } = {}) => {
        const controls = Array.from(
            root.querySelectorAll('[data-device-control]')
        );
        const popovers = Array.from(
            root.querySelectorAll('[data-device-popover]')
        );
        const toggles = Array.from(
            root.querySelectorAll('[data-control-menu]')
        );
        let openType = null;
        let pinnedType = null;
        let closeTimer;

        const getPopover = (type) =>
            popovers.find((popover) => popover.dataset.devicePopover === type);

        const getControl = (type) =>
            controls.find((control) => control.dataset.deviceControl === type);

        const getToggle = (type) =>
            toggles.find((toggle) => toggle.dataset.controlMenu === type);

        const syncPopoverPosition = (type) => {
            const popover = getPopover(type);

            if (!popover) {
                return;
            }

            popover.style.setProperty('--popover-shift-x', '0px');

            const margin = 8;
            const rect = popover.getBoundingClientRect();
            let shift = 0;

            if (rect.right > global.innerWidth - margin) {
                shift = global.innerWidth - margin - rect.right;
            }

            if (rect.left + shift < margin) {
                shift += margin - (rect.left + shift);
            }

            popover.style.setProperty('--popover-shift-x', `${shift}px`);
        };

        const setExpanded = (type, expanded) => {
            getToggle(type)?.setAttribute('aria-expanded', String(expanded));
        };

        const close = (type = openType, { force = false } = {}) => {
            if (!type || (!force && pinnedType === type)) {
                return;
            }

            getControl(type)?.classList.remove('is-open');
            getPopover(type)?.classList.remove('is-open');
            setExpanded(type, false);

            if (openType === type) {
                openType = null;
            }
        };

        const closeAll = ({ force = false } = {}) => {
            popovers.forEach((popover) =>
                close(popover.dataset.devicePopover, { force })
            );
        };

        const open = (type, { pin = false } = {}) => {
            if (!type) {
                return;
            }

            clearTimeout(closeTimer);
            closeAll({ force: true });
            openType = type;
            pinnedType = pin ? type : pinnedType === type ? pinnedType : null;
            getControl(type)?.classList.add('is-open');
            getPopover(type)?.classList.add('is-open');
            setExpanded(type, true);

            if (typeof onOpen === 'function') {
                onOpen(type);
            }

            global.requestAnimationFrame?.(() => syncPopoverPosition(type));
        };

        const scheduleClose = (type) => {
            clearTimeout(closeTimer);
            closeTimer = global.setTimeout(() => close(type), CLOSE_DELAY_MS);
        };

        const togglePin = (type) => {
            const shouldPin = pinnedType !== type;
            pinnedType = shouldPin ? type : null;

            if (shouldPin) {
                open(type, { pin: true });
            } else {
                close(type, { force: true });
            }
        };

        controls.forEach((control) => {
            const type = control.dataset.deviceControl;
            const mainButton = control.querySelector(
                'button:not(.control-menu-toggle)'
            );

            control.addEventListener('pointerenter', () => open(type));
            control.addEventListener('pointerleave', () => scheduleClose(type));
            control.addEventListener('mouseenter', () => open(type));
            control.addEventListener('mouseleave', () => scheduleClose(type));
            control.addEventListener('focusin', () => open(type));
            control.addEventListener('focusout', () => scheduleClose(type));
            mainButton?.addEventListener('click', () => {
                if (isMobile()) {
                    open(type);
                }
            });
            mainButton?.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                togglePin(type);
            });
        });

        popovers.forEach((popover) => {
            const type = popover.dataset.devicePopover;

            popover.addEventListener('pointerenter', () => open(type));
            popover.addEventListener('pointerleave', () => scheduleClose(type));
            popover.addEventListener('mouseenter', () => open(type));
            popover.addEventListener('mouseleave', () => scheduleClose(type));
            popover.addEventListener('focusin', () => open(type));
            popover.addEventListener('focusout', () => scheduleClose(type));
        });

        toggles.forEach((toggle) => {
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                togglePin(toggle.dataset.controlMenu);
            });
        });

        root.addEventListener('click', (event) => {
            if (
                event.target.closest(
                    '[data-device-control], [data-device-popover]'
                )
            ) {
                return;
            }

            pinnedType = null;
            closeAll({ force: true });
        });

        root.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                pinnedType = null;
                closeAll({ force: true });
            }
        });

        global.addEventListener('resize', () => {
            if (openType) {
                syncPopoverPosition(openType);
            }
        });

        return {
            closeAll,
            open,
            renderDeviceList,
        };
    };

    global.VoiceMediaControlsUI = {
        bindMediaDevicePopovers,
        renderDeviceList,
        renderCallControls,
        renderDockState,
        renderMicButtonState,
        renderCameraButtonState,
        renderLeaveButtonState,
        renderScreenShareButtonState,
    };
})(window);
