(function exposeVoiceMediaDockRuntime(global) {
    'use strict';

    const RESOLUTION_PRESETS = Object.freeze([
        'auto',
        '720p',
        '1080p',
        '1440p',
        'original',
    ]);
    const FRAME_RATES = Object.freeze([15, 30, 60]);
    const DEFAULT_SCREEN_SHARE_OPTIONS = Object.freeze({
        resolutionPreset: '1080p',
        frameRate: 30,
    });
    const CONNECTION_LABELS = Object.freeze({
        degraded: '连接中断，正在重试',
        failed: '语音恢复失败，请重新加入',
        idle: '未加入语音',
        joined: '连接已恢复',
        joining: '正在加入语音',
        leaving: '正在离开语音',
        offline: '网络离线',
        'reconnecting-peer': '语音信令中断，正在重试',
        'reconnecting-socket': '连接中断，正在重试',
        restoring: '正在恢复语音',
    });
    const DEVICE_TYPES = Object.freeze(['mic', 'camera', 'output']);
    const REQUIRED_REFS = Object.freeze({
        aiNoiseToggle: '#aiNoiseToggle',
        aiNoiseStatus: '#aiNoiseStatusText',
        callDuration: '#callDuration',
        callStatus: '#callStatusText',
        cameraButton: '#toggleVideo',
        cameraDeviceStatus: '#cameraDeviceStatus',
        cameraList: '[data-device-list="camera"]',
        channelName: '#localVoiceChannelName',
        copyButton: '#copyRoomLink',
        frameRateSelect: '[data-screen-share-frame-rate]',
        localUserName: '#localUserName',
        micButton: '#toggleAudio',
        micDeviceStatus: '#micDeviceStatus',
        micGainSlider: '#micGainSlider',
        micGainValue: '#micGainValue',
        micList: '[data-device-list="mic"]',
        noiseStatus: '#noiseStatusText',
        noiseToggle: '#noiseToggle',
        outputButton: '#toggleOutput',
        outputDeviceStatus: '#outputDeviceStatus',
        outputList: '[data-device-list="output"]',
        outputSlider: '#outputVolume',
        outputValue: '#outputVolumeValue',
        resolutionSelect: '[data-screen-share-resolution]',
        screenButton: '#shareScreen',
        screenSettingsStatus: '[data-screen-share-settings-status]',
        screenStatus: '#screenStatusText',
        sessionButton: '#destroyPeer',
        statusMessages: '#voiceStatusMessages',
    });

    const clamp = (value, minimum, maximum, fallback) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue)
            ? Math.max(minimum, Math.min(maximum, numericValue))
            : fallback;
    };
    const formatDuration = (durationMs = 0) => {
        const seconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(
            remainingSeconds
        ).padStart(2, '0')}`;
    };
    const normalizeResolutionPreset = (value) =>
        RESOLUTION_PRESETS.includes(value)
            ? value
            : DEFAULT_SCREEN_SHARE_OPTIONS.resolutionPreset;
    const normalizeFrameRate = (value) => {
        const numericValue = Number(value);
        return FRAME_RATES.includes(numericValue)
            ? numericValue
            : DEFAULT_SCREEN_SHARE_OPTIONS.frameRate;
    };
    const setButtonLabel = (button, label) => {
        button.title = label;
        button.setAttribute('aria-label', label);
    };
    const setText = (element, value) => {
        if (element) {
            element.textContent = String(value ?? '');
        }
    };

    const createMediaDockRuntime = ({
        root,
        adapter,
        initialScreenShareOptions = DEFAULT_SCREEN_SHARE_OPTIONS,
        logger = global.console,
        morphIconUI = global.VoiceMorphIconUI,
    } = {}) => {
        if (!root) {
            throw new Error('Media Dock requires a root element.');
        }
        if (!adapter) {
            throw new Error('Media Dock requires an adapter.');
        }

        [
            'getSnapshot',
            'hangUp',
            'joinVoice',
            'leaveVoice',
            'selectCamera',
            'selectMicrophone',
            'selectOutput',
            'setOutputMuted',
            'setOutputVolume',
            'startScreenShare',
            'stopScreenShare',
            'subscribe',
            'toggleCamera',
            'toggleMicrophone',
        ].forEach((name) => {
            if (typeof adapter[name] !== 'function') {
                throw new TypeError(`Media Dock requires adapter.${name}().`);
            }
        });

        let initialized = false;
        let destroyed = false;
        let refs;
        let unsubscribe;
        let lastSnapshot = {};
        let openPopoverType;
        let copyRestoreTimer;
        let restartNoticeTimer;
        let restartNotice;
        let resolutionPreset = normalizeResolutionPreset(
            initialScreenShareOptions.resolutionPreset
        );
        let frameRate = normalizeFrameRate(initialScreenShareOptions.frameRate);
        const pendingActions = new Set();
        const listenerCleanups = [];

        const resolveRefs = () => {
            const resolved = Object.fromEntries(
                Object.entries(REQUIRED_REFS).map(([name, selector]) => [
                    name,
                    root.querySelector(selector),
                ])
            );
            const missing = Object.entries(resolved)
                .filter(([, element]) => !element)
                .map(([name]) => name);

            if (missing.length) {
                throw new Error(
                    `Media Dock is missing required element(s): ${missing.join(', ')}.`
                );
            }
            resolved.outputUnsupported = root.querySelector(
                '[data-output-unsupported]'
            );
            return resolved;
        };
        const listen = (target, type, listener, options) => {
            target?.addEventListener?.(type, listener, options);
            listenerCleanups.push(() =>
                target?.removeEventListener?.(type, listener, options)
            );
        };
        const getSnapshot = () => ({
            ...lastSnapshot,
            screenShareFrameRate: frameRate,
            screenShareResolutionPreset: resolutionPreset,
        });
        const getCurrentAdapterSnapshot = () => {
            lastSnapshot = adapter.getSnapshot() || {};
            return lastSnapshot;
        };
        const isActive = () => initialized && !destroyed;

        const renderToggleButton = ({
            button,
            enabled,
            disabled,
            iconClass,
            iconName,
            label,
            pending,
            unavailable,
        }) => {
            const isOff = unavailable || !enabled;
            button.classList.toggle('is-off', isOff);
            button.disabled = Boolean(disabled || pending);
            button.setAttribute('aria-busy', String(Boolean(pending)));
            button.setAttribute('aria-pressed', String(Boolean(enabled)));
            setButtonLabel(button, label);
            if (!morphIconUI?.syncButtonIcon?.(button, iconName)) {
                const icon = button.querySelector('i');
                if (icon) {
                    icon.className = iconClass;
                }
            }
        };
        const getDeviceLabel = (device, index, fallbackPrefix) =>
            device?.label || `${fallbackPrefix} ${index + 1}`;
        const renderDeviceList = ({
            devices,
            list,
            selectedDeviceId,
            status,
            type,
        }) => {
            const fallbackPrefix =
                type === 'mic'
                    ? '麦克风'
                    : type === 'camera'
                      ? '摄像头'
                      : '输出设备';
            const normalizedSelected = selectedDeviceId || 'default';
            const allDevices = [
                { deviceId: 'default', label: '默认设备' },
                ...(Array.isArray(devices) ? devices : []).filter(
                    (device) => device?.deviceId !== 'default'
                ),
            ];

            list.replaceChildren();
            allDevices.forEach((device, index) => {
                const button = global.document.createElement('button');
                const label = global.document.createElement('span');
                const icon = global.document.createElement('i');
                const isSelected = device.deviceId === normalizedSelected;

                button.type = 'button';
                button.className = 'media-device-option';
                button.dataset.deviceId = device.deviceId;
                button.dataset.deviceType = type;
                button.setAttribute('aria-pressed', String(isSelected));
                label.textContent =
                    device.deviceId === 'default'
                        ? '默认设备'
                        : getDeviceLabel(device, index - 1, fallbackPrefix);
                icon.className = 'fas fa-check';
                icon.setAttribute('aria-hidden', 'true');
                button.append(label, icon);
                list.append(button);
            });

            const selectedDevice = allDevices.find(
                (device) => device.deviceId === normalizedSelected
            );
            setText(
                status,
                normalizedSelected === 'default'
                    ? '默认设备'
                    : selectedDevice?.label || '已选择设备'
            );
        };
        const renderOutput = (snapshot) => {
            const volume = clamp(snapshot.outputVolume, 0, 1, 1);
            const percent = Math.round(volume * 100);
            const muted = Boolean(snapshot.outputMuted);
            const label = refs.outputButton.querySelector('span');

            refs.outputButton.classList.toggle('is-off', muted);
            refs.outputButton.setAttribute('aria-pressed', String(muted));
            setButtonLabel(
                refs.outputButton,
                muted ? `播放已静音，音量 ${percent}%` : `播放音量 ${percent}%`
            );
            if (
                !morphIconUI?.syncButtonIcon?.(
                    refs.outputButton,
                    muted || volume === 0 ? 'volume-x' : 'volume-2'
                )
            ) {
                const icon = refs.outputButton.querySelector('i');
                if (icon) {
                    icon.className =
                        muted || volume === 0
                            ? 'fas fa-volume-mute'
                            : volume < 0.5
                              ? 'fas fa-volume-down'
                              : 'fas fa-volume-up';
                }
            }
            setText(label, muted ? '已静音' : '听筒');
            refs.outputSlider.value = String(volume);
            refs.outputSlider.title = `${percent}%`;
            refs.outputSlider.setAttribute('aria-valuetext', `${percent}%`);
            setText(refs.outputValue, `${percent}%`);
        };
        const renderNoise = (snapshot) => {
            const noiseEnabled = snapshot.noiseSuppressionEnabled !== false;
            const aiSupported = Boolean(snapshot.aiNoiseSupported);
            const aiEnabled = Boolean(snapshot.aiNoiseEnabled);

            refs.noiseToggle.setAttribute('aria-pressed', String(noiseEnabled));
            setText(refs.noiseStatus, noiseEnabled ? '开' : '关');
            refs.aiNoiseToggle.classList.toggle('na', !aiSupported);
            refs.aiNoiseToggle.setAttribute(
                'aria-pressed',
                String(aiSupported && aiEnabled)
            );
            refs.aiNoiseToggle.tabIndex = aiSupported ? 0 : -1;
            setText(
                refs.aiNoiseStatus,
                !aiSupported
                    ? refs.aiNoiseToggle.dataset.notSupportedLabel || 'N/A'
                    : !aiEnabled
                      ? '关'
                      : snapshot.noiseMode === 'rnnoise'
                        ? 'RNNoise'
                        : snapshot.noiseMode === 'passthrough'
                          ? '直通'
                          : snapshot.noiseMode === 'fallback'
                            ? '回退'
                            : '开'
            );

            const micGain = clamp(snapshot.microphoneGain, 0, 150, 100);
            refs.micGainSlider.value = String(micGain);
            setText(refs.micGainValue, `${Math.round(micGain)}%`);
        };
        const renderStatusMessages = (snapshot) => {
            const messages = [];
            const connectionState = snapshot.connectionState || 'idle';

            if (
                snapshot.desiredVoiceJoined &&
                !['joined', 'idle'].includes(connectionState)
            ) {
                messages.push({
                    kind: 'connection',
                    message:
                        CONNECTION_LABELS[connectionState] || connectionState,
                });
            }
            Object.entries(snapshot.mediaErrors || {}).forEach(
                ([kind, message]) => {
                    if (message) {
                        messages.push({ kind, message });
                    }
                }
            );

            refs.statusMessages.replaceChildren();
            messages.forEach(({ kind, message }) => {
                const item = global.document.createElement('span');
                item.className = 'voice-status-message';
                item.dataset.voiceStatusKind = kind;
                item.textContent = message;
                refs.statusMessages.append(item);
            });
            refs.statusMessages.classList.toggle(
                'hidden',
                messages.length === 0
            );
        };
        const renderSessionButton = (snapshot) => {
            const joining =
                snapshot.desiredVoiceJoined && !snapshot.actualVoiceJoined;
            const joined = Boolean(snapshot.actualVoiceJoined);
            const action = joined ? 'hangup' : joining ? 'leave' : 'join';
            const label = joined
                ? '离开当前语音频道'
                : joining
                  ? '取消加入语音'
                  : '加入当前语音频道';
            const icon = refs.sessionButton.querySelector('i');

            refs.sessionButton.classList.remove('hidden');
            refs.sessionButton.dataset.sessionAction = action;
            refs.sessionButton.disabled = pendingActions.has('session');
            refs.sessionButton.setAttribute(
                'aria-busy',
                String(pendingActions.has('session'))
            );
            setButtonLabel(refs.sessionButton, label);
            if (icon) {
                icon.className =
                    action === 'join' ? 'fas fa-phone' : 'fas fa-phone-slash';
            }
        };
        const render = (snapshot = adapter.getSnapshot()) => {
            if (!isActive()) {
                return false;
            }
            lastSnapshot = snapshot || {};
            const mediaAvailable = Boolean(lastSnapshot.mediaControlsAvailable);
            const microphonePending =
                Boolean(lastSnapshot.microphonePending) ||
                pendingActions.has('microphone');
            const cameraPending =
                Boolean(lastSnapshot.cameraPending) ||
                pendingActions.has('camera');
            const screenPending =
                Boolean(lastSnapshot.screenSharePending) ||
                pendingActions.has('screen');
            const sharing = Boolean(lastSnapshot.screenShareEnabled);
            const screenSelectDisabled = sharing || screenPending;

            root.classList.remove('hidden');
            root.dataset.connectionState =
                lastSnapshot.connectionState || 'idle';
            root.dataset.mediaDockInitialized = 'true';
            root.setAttribute(
                'aria-busy',
                String(microphonePending || cameraPending || screenPending)
            );
            setText(refs.localUserName, lastSnapshot.displayName || 'Guest');
            setText(refs.channelName, lastSnapshot.channelName || '');
            setText(
                refs.callDuration,
                formatDuration(lastSnapshot.callDurationMs)
            );
            setText(
                refs.callStatus,
                lastSnapshot.callStatusText ||
                    CONNECTION_LABELS[lastSnapshot.connectionState] ||
                    '未加入语音'
            );

            renderToggleButton({
                button: refs.micButton,
                disabled: !mediaAvailable,
                enabled: Boolean(lastSnapshot.microphoneEnabled),
                iconClass: 'fas fa-microphone',
                iconName: lastSnapshot.microphoneEnabled ? 'mic' : 'mic-off',
                label: lastSnapshot.microphoneError
                    ? '麦克风不可用'
                    : lastSnapshot.microphoneEnabled
                      ? '关闭麦克风'
                      : '打开麦克风',
                pending: microphonePending,
                unavailable:
                    lastSnapshot.microphonePermissionState === 'denied' ||
                    Boolean(lastSnapshot.microphoneError),
            });
            renderToggleButton({
                button: refs.cameraButton,
                disabled: !mediaAvailable,
                enabled: Boolean(lastSnapshot.cameraEnabled),
                iconClass: 'fas fa-video',
                iconName: lastSnapshot.cameraEnabled ? 'video' : 'video-off',
                label: lastSnapshot.cameraError
                    ? '摄像头不可用'
                    : lastSnapshot.cameraEnabled
                      ? '关闭摄像头'
                      : '打开摄像头',
                pending: cameraPending,
                unavailable:
                    lastSnapshot.cameraPermissionState === 'denied' ||
                    Boolean(lastSnapshot.cameraError),
            });
            renderToggleButton({
                button: refs.screenButton,
                disabled: !mediaAvailable,
                enabled: sharing,
                iconClass: sharing ? 'fas fa-desktop' : 'far fa-newspaper',
                iconName: sharing ? 'screen-share' : 'screen-share-off',
                label: sharing ? '停止屏幕共享' : '开始屏幕共享',
                pending: screenPending,
                unavailable: Boolean(lastSnapshot.screenShareError),
            });
            setText(
                refs.screenButton.querySelector('span'),
                sharing ? '停止' : '共享'
            );
            refs.screenStatus.classList.toggle('hidden', !sharing);
            refs.resolutionSelect.value = resolutionPreset;
            refs.frameRateSelect.value = String(frameRate);
            refs.resolutionSelect.disabled = screenSelectDisabled;
            refs.frameRateSelect.disabled = screenSelectDisabled;
            setText(
                refs.screenSettingsStatus,
                sharing
                    ? '停止共享后可修改'
                    : screenPending
                      ? '正在请求共享权限'
                      : '开始共享时生效'
            );

            renderSessionButton(lastSnapshot);
            renderOutput(lastSnapshot);
            renderNoise(lastSnapshot);
            renderDeviceList({
                devices: lastSnapshot.availableMicrophones,
                list: refs.micList,
                selectedDeviceId: lastSnapshot.selectedMicrophoneId,
                status: refs.micDeviceStatus,
                type: 'mic',
            });
            renderDeviceList({
                devices: lastSnapshot.availableCameras,
                list: refs.cameraList,
                selectedDeviceId: lastSnapshot.selectedCameraId,
                status: refs.cameraDeviceStatus,
                type: 'camera',
            });
            renderDeviceList({
                devices: lastSnapshot.availableOutputs,
                list: refs.outputList,
                selectedDeviceId: lastSnapshot.selectedOutputId,
                status: refs.outputDeviceStatus,
                type: 'output',
            });
            refs.outputUnsupported?.classList.toggle(
                'hidden',
                !lastSnapshot.outputSelectionUnsupported
            );
            renderStatusMessages(lastSnapshot);
            return true;
        };

        const runIntent = async (key, action) => {
            if (!isActive() || pendingActions.has(key)) {
                return false;
            }
            pendingActions.add(key);
            render(lastSnapshot);
            try {
                return await action();
            } catch (error) {
                logger?.warn?.(`Media Dock ${key} action failed.`, error);
                return false;
            } finally {
                pendingActions.delete(key);
                if (isActive()) {
                    render(getCurrentAdapterSnapshot());
                }
            }
        };
        const handleSessionClick = () => {
            const snapshot = getCurrentAdapterSnapshot();
            void runIntent('session', () =>
                snapshot.actualVoiceJoined
                    ? adapter.hangUp()
                    : snapshot.desiredVoiceJoined
                      ? adapter.leaveVoice()
                      : adapter.joinVoice()
            );
        };
        const handleMicrophoneClick = () => {
            void runIntent('microphone', () => adapter.toggleMicrophone());
        };
        const handleCameraClick = () => {
            void runIntent('camera', () => adapter.toggleCamera());
        };
        const handleScreenClick = () => {
            const snapshot = getCurrentAdapterSnapshot();
            if (snapshot.screenSharePending) {
                return;
            }
            void runIntent('screen', () =>
                snapshot.screenShareEnabled
                    ? adapter.stopScreenShare()
                    : adapter.startScreenShare({
                          frameRate,
                          resolutionPreset,
                      })
            );
        };
        const handleOutputClick = () => {
            const snapshot = getCurrentAdapterSnapshot();
            void runIntent('output-muted', () =>
                adapter.setOutputMuted(!snapshot.outputMuted)
            );
        };
        const handleOutputInput = () => {
            const volume = clamp(refs.outputSlider.value, 0, 1, 1);
            adapter.setOutputVolume(volume);
        };
        const handleMicGainInput = () => {
            const gain = clamp(refs.micGainSlider.value, 0, 150, 100);
            adapter.setMicrophoneGain?.(gain);
        };
        const showRestartNotice = () => {
            if (!restartNotice) {
                restartNotice = global.document.createElement('span');
                restartNotice.className = 'restart-effect-notice';
                root.querySelector('.media-dock-activity-row')?.append(
                    restartNotice
                );
            }
            restartNotice.textContent = '重进房间后生效';
            restartNotice.classList.add('is-visible');
            global.clearTimeout(restartNoticeTimer);
            restartNoticeTimer = global.setTimeout(
                () => restartNotice?.classList.remove('is-visible'),
                2600
            );
        };
        const handleNoiseClick = () => {
            void runIntent('noise', () => adapter.toggleNoiseSuppression?.());
            showRestartNotice();
        };
        const handleAiNoiseClick = () => {
            if (!getCurrentAdapterSnapshot().aiNoiseSupported) {
                return;
            }
            void runIntent('ai-noise', () =>
                adapter.toggleAiNoiseSuppression?.()
            );
            showRestartNotice();
        };
        const handleKeyboardActivation = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            event.currentTarget.click();
        };
        const setCopyState = (state) => {
            const icon = refs.copyButton.querySelector('i');
            const label = refs.copyButton.querySelector('span');
            const states = {
                default: ['复制频道链接', 'fas fa-link', '链接'],
                failure: ['复制失败', 'fas fa-exclamation-triangle', '失败'],
                success: ['已复制', 'fas fa-check', '已复制'],
            };
            const [buttonLabel, iconClass, visibleLabel] =
                states[state] || states.default;
            setButtonLabel(refs.copyButton, buttonLabel);
            refs.copyButton.classList.toggle('is-copied', state === 'success');
            if (icon) {
                icon.className = iconClass;
            }
            setText(label, visibleLabel);
        };
        const scheduleCopyRestore = () => {
            global.clearTimeout(copyRestoreTimer);
            copyRestoreTimer = global.setTimeout(
                () => setCopyState('default'),
                1500
            );
        };
        const handleCopyClick = () => {
            void runIntent('copy', async () => {
                const copied = await adapter.copyRoomLink?.();
                setCopyState(copied === false ? 'failure' : 'success');
                scheduleCopyRestore();
                return copied;
            });
        };
        const closePopovers = () => {
            root.querySelectorAll('[data-device-control]').forEach((control) =>
                control.classList.remove('is-open')
            );
            root.querySelectorAll('[data-device-popover]').forEach((popover) =>
                popover.classList.remove('is-open')
            );
            root.querySelectorAll('[data-control-menu]').forEach((toggle) =>
                toggle.setAttribute('aria-expanded', 'false')
            );
            openPopoverType = undefined;
        };
        const positionPopover = (type) => {
            const popover = root.querySelector(
                `[data-device-popover="${type}"]`
            );
            if (!popover?.getBoundingClientRect) {
                return;
            }
            popover.style.setProperty('--popover-shift-x', '0px');
            const rect = popover.getBoundingClientRect();
            const margin = 8;
            let shift = 0;
            if (rect.right > global.innerWidth - margin) {
                shift = global.innerWidth - margin - rect.right;
            }
            if (rect.left + shift < margin) {
                shift += margin - (rect.left + shift);
            }
            popover.style.setProperty('--popover-shift-x', `${shift}px`);
        };
        const openPopover = (type) => {
            closePopovers();
            const control = root.querySelector(
                `[data-device-control="${type}"]`
            );
            const popover = root.querySelector(
                `[data-device-popover="${type}"]`
            );
            const toggle = root.querySelector(`[data-control-menu="${type}"]`);
            if (!control || !popover || !toggle) {
                return false;
            }
            control.classList.add('is-open');
            popover.classList.add('is-open');
            toggle.setAttribute('aria-expanded', 'true');
            openPopoverType = type;
            if (DEVICE_TYPES.includes(type)) {
                adapter.refreshDevices?.(type);
            }
            global.requestAnimationFrame?.(() => positionPopover(type));
            return true;
        };
        const handleRootClick = (event) => {
            const menuToggle = event.target.closest?.('[data-control-menu]');
            if (menuToggle && root.contains(menuToggle)) {
                event.preventDefault();
                event.stopPropagation();
                const type = menuToggle.dataset.controlMenu;
                if (openPopoverType === type) {
                    closePopovers();
                } else {
                    openPopover(type);
                }
                return;
            }

            const deviceOption = event.target.closest?.(
                '[data-device-type][data-device-id]'
            );
            if (!deviceOption || !root.contains(deviceOption)) {
                return;
            }
            const type = deviceOption.dataset.deviceType;
            const deviceId = deviceOption.dataset.deviceId;
            const action =
                type === 'mic'
                    ? adapter.selectMicrophone
                    : type === 'camera'
                      ? adapter.selectCamera
                      : adapter.selectOutput;
            void runIntent(`device-${type}`, () => action(deviceId));
        };
        const handleDocumentClick = (event) => {
            if (openPopoverType && !root.contains(event.target)) {
                closePopovers();
            }
        };
        const handleDocumentKeydown = (event) => {
            if (event.key === 'Escape') {
                closePopovers();
            }
        };
        const handleResize = () => {
            if (openPopoverType) {
                positionPopover(openPopoverType);
            }
        };
        const handleResolutionChange = () => {
            resolutionPreset = normalizeResolutionPreset(
                refs.resolutionSelect.value
            );
            render(lastSnapshot);
        };
        const handleFrameRateChange = () => {
            frameRate = normalizeFrameRate(refs.frameRateSelect.value);
            render(lastSnapshot);
        };

        const init = () => {
            if (destroyed) {
                throw new Error(
                    'Destroyed Media Dock runtime cannot be re-initialized.'
                );
            }
            if (initialized) {
                return false;
            }
            if (root.dataset.mediaDockInitialized === 'true') {
                throw new Error('Media Dock root already has an owner.');
            }

            refs = resolveRefs();
            initialized = true;
            root.dataset.mediaDockInitialized = 'true';
            refs.resolutionSelect.value = resolutionPreset;
            refs.frameRateSelect.value = String(frameRate);

            listen(refs.sessionButton, 'click', handleSessionClick);
            listen(refs.micButton, 'click', handleMicrophoneClick);
            listen(refs.cameraButton, 'click', handleCameraClick);
            listen(refs.screenButton, 'click', handleScreenClick);
            listen(refs.outputButton, 'click', handleOutputClick);
            listen(refs.outputSlider, 'input', handleOutputInput);
            listen(refs.micGainSlider, 'input', handleMicGainInput);
            listen(refs.noiseToggle, 'click', handleNoiseClick);
            listen(refs.noiseToggle, 'keydown', handleKeyboardActivation);
            listen(refs.aiNoiseToggle, 'click', handleAiNoiseClick);
            listen(refs.aiNoiseToggle, 'keydown', handleKeyboardActivation);
            listen(refs.copyButton, 'click', handleCopyClick);
            listen(refs.resolutionSelect, 'change', handleResolutionChange);
            listen(refs.frameRateSelect, 'change', handleFrameRateChange);
            listen(root, 'click', handleRootClick);
            listen(global.document, 'click', handleDocumentClick);
            listen(global.document, 'keydown', handleDocumentKeydown);
            listen(global, 'resize', handleResize);

            try {
                unsubscribe = adapter.subscribe(render);
                if (typeof unsubscribe !== 'function') {
                    throw new TypeError(
                        'Media Dock adapter subscription must return an unsubscribe function.'
                    );
                }
                return true;
            } catch (error) {
                listenerCleanups.splice(0).forEach((cleanup) => cleanup());
                initialized = false;
                delete root.dataset.mediaDockInitialized;
                refs = undefined;
                throw error;
            }
        };
        const destroy = () => {
            if (destroyed) {
                return false;
            }
            destroyed = true;
            pendingActions.clear();
            closePopovers();
            listenerCleanups.splice(0).forEach((cleanup) => cleanup());
            unsubscribe?.();
            unsubscribe = undefined;
            global.clearTimeout(copyRestoreTimer);
            global.clearTimeout(restartNoticeTimer);
            restartNotice?.remove();
            restartNotice = undefined;
            delete root.dataset.mediaDockInitialized;
            return true;
        };

        return {
            destroy,
            getRootElement: () => root,
            getSnapshot,
            init,
            render,
        };
    };

    global.VoiceMediaDockRuntime = {
        DEFAULT_SCREEN_SHARE_OPTIONS,
        FRAME_RATES,
        RESOLUTION_PRESETS,
        createMediaDockRuntime,
        formatDuration,
        normalizeFrameRate,
        normalizeResolutionPreset,
    };
})(window);
