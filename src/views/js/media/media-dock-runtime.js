(function exposeVoiceMediaDockRuntime(global) {
    'use strict';

    const RESOLUTION_PRESETS = Object.freeze([
        'auto',
        '720p',
        '1080p',
        '1440p',
        '2160p',
        'original',
    ]);
    const FRAME_RATES = Object.freeze([15, 30, 60]);
    const DEFAULT_SCREEN_SHARE_OPTIONS = Object.freeze({
        resolutionPreset: '1080p',
        frameRate: 60,
        mode: 'game',
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
        noiseModeSelect: '[data-audio-noise-mode]',
        speechGateToggle: '[data-rnnoise-speech-gate]',
        processingStatus: '[data-audio-processing-status]',
        outputButton: '#toggleOutput',
        outputDeviceStatus: '#outputDeviceStatus',
        outputList: '[data-device-list="output"]',
        outputSlider: '#outputVolume',
        outputValue: '#outputVolumeValue',
        resolutionSelect: '[data-screen-share-resolution]',
        screenButton: '#shareScreen',
        screenSettingsStatus: '[data-screen-share-settings-status]',
        screenStartButton: '[data-screen-share-start]',
        screenCancelButton: '[data-screen-share-cancel]',
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
        let popoverRevision = 0;
        let closeWatcher;
        let popoverOpenedByHover = false;
        let popovers = [];
        let fallbackPopup;
        let fallbackPlaceholder;
        let fallbackBackdrop;
        let previousFocus;
        let hoverCloseTimer;
        const cancelHoverClose = () => {
            global.clearTimeout(hoverCloseTimer);
            hoverCloseTimer = undefined;
        };
        let copyRestoreTimer;
        let resolutionPreset = normalizeResolutionPreset(
            initialScreenShareOptions.resolutionPreset
        );
        let frameRate = normalizeFrameRate(initialScreenShareOptions.frameRate);
        let shareMode = initialScreenShareOptions.mode === 'detail' ? 'detail' : 'game';
        let codecMode = ['av1', 'h264', 'vp8'].includes(initialScreenShareOptions.codecMode) ? initialScreenShareOptions.codecMode : 'auto';
        let startBitrate = ['1500', '5500'].includes(String(initialScreenShareOptions.startBitrate)) ? String(initialScreenShareOptions.startBitrate) : 'browser';
        let editorMode = 'source';
        let observedSharing = false;
        const screenPanel = () => popovers.find(el => el.dataset.devicePopover === 'screen');
        const screenField = selector => screenPanel()?.querySelector(selector) || root.querySelector(selector);
        const signalDialog = (name, detail) => {
            if (global.CustomEvent) global.document.dispatchEvent(new global.CustomEvent(name, { detail }));
        };
        const pendingActions = new Set();
        const intentRevisions = new Map();
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
            screenShareMode: shareMode,
            screenShareCodecMode: codecMode,
            screenShareStartBitrate: startBitrate,
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
            cancelPending = false,
            unavailable,
        }) => {
            const isOff = unavailable || !enabled;
            button.classList.toggle('is-off', isOff);
            button.disabled = Boolean(disabled || (pending && !cancelPending));
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
            setText(label, muted ? '已静音' : '声音');
            refs.outputSlider.value = String(volume);
            refs.outputSlider.title = `${percent}%`;
            refs.outputSlider.setAttribute('aria-valuetext', `${percent}%`);
            setText(refs.outputValue, `${percent}%`);
        };
        const renderNoise = (snapshot) => {
            const modeSelect = refs.noiseModeSelect;
            if (refs.speechGateToggle) {
                refs.speechGateToggle.checked = snapshot.rnnoiseSpeechGateEnabled !== false;
                refs.speechGateToggle.disabled = snapshot.requestedNoiseMode !== 'rnnoise' ||
                    Boolean(snapshot.audioSettingsPending) ||
                    typeof adapter.setRnnoiseSpeechGate !== 'function' ||
                    (snapshot.audioProcessing?.mode === 'rnnoise' && snapshot.audioProcessing.speechGateSupported === false);
            }
            if (modeSelect) {
                modeSelect.value = snapshot.requestedNoiseMode || 'browser';
                const rnnoiseOption = modeSelect.querySelector('[value="rnnoise"]');
                if (rnnoiseOption) rnnoiseOption.disabled = !snapshot.aiNoiseSupported;
                const enhancedOption = modeSelect.querySelector('[value="deepfilter"]');
                if (enhancedOption) enhancedOption.disabled = !snapshot.aiNoiseSupported;
            }
            const diagnostic = refs.processingStatus;
            if (diagnostic) setText(diagnostic, global.VoiceAudioProcessingView.describe(snapshot));
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
                      : snapshot.audioProcessing?.fallbackReason
                        ? '回退'
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
                if (['output', 'playback', 'audio-connection'].includes(kind)) {
                    const recover = global.document.createElement('button');
                    recover.type = 'button';
                    recover.className = 'voice-status-recover no-drag';
                    recover.textContent = '恢复声音';
                    recover.dataset.audioRecovery = 'true';
                    item.append(recover);
                }
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
            setText(refs.sessionButton.querySelector('[data-session-label]'), joined ? '离开语音' : joining ? '取消加入' : '加入语音');
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
            if (sharing) observedSharing = true;
            if (!lastSnapshot.actualVoiceJoined && !lastSnapshot.desiredVoiceJoined) observedSharing = false;
            const screenSelectDisabled = screenPending;

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
                disabled: !(lastSnapshot.microphoneControlsAvailable ?? mediaAvailable),
                enabled: Boolean(lastSnapshot.microphoneEnabled),
                iconClass: 'fas fa-microphone',
                iconName: lastSnapshot.microphoneEnabled ? 'mic' : 'mic-off',
                label: lastSnapshot.microphoneIntentOnly
                    ? lastSnapshot.microphoneEnabled ? '加入语音后开启麦克风，点击关闭' : '加入语音后保持关闭，点击开启'
                    : lastSnapshot.microphonePending && !lastSnapshot.microphoneEnabled
                    ? '取消开启麦克风'
                    : lastSnapshot.microphoneError
                    ? '麦克风不可用'
                    : lastSnapshot.microphoneEnabled
                      ? '关闭麦克风'
                      : '打开麦克风',
                pending: microphonePending,
                cancelPending: Boolean(lastSnapshot.microphonePending),
                unavailable:
                    !lastSnapshot.microphoneIntentOnly && (
                        lastSnapshot.microphonePermissionState === 'denied' ||
                        Boolean(lastSnapshot.microphoneError)),
            });
            renderToggleButton({
                button: refs.cameraButton,
                disabled: !mediaAvailable,
                enabled: Boolean(lastSnapshot.cameraEnabled),
                iconClass: 'fas fa-video',
                iconName: lastSnapshot.cameraEnabled ? 'video' : 'video-off',
                label: lastSnapshot.cameraPending
                    ? lastSnapshot.cameraEnabled ? '关闭摄像头' : '取消开启摄像头'
                    : lastSnapshot.cameraError
                    ? '摄像头不可用'
                    : lastSnapshot.cameraEnabled
                      ? '关闭摄像头'
                      : '打开摄像头',
                pending: cameraPending,
                cancelPending: Boolean(lastSnapshot.cameraPending),
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
                pending: screenPending && !sharing,
                unavailable: Boolean(lastSnapshot.screenShareError),
            });
            setText(
                refs.screenButton.querySelector('span'),
                sharing ? '停止共享' : '共享'
            );
            const native = screenField('[data-screen-share-provider]')?.value === 'native';
            const sourceReady = !native || (sharing && editorMode === 'quality') || Boolean(screenField('[data-piik-native-source]')?.value);
            const browserUnsupported = !native && lastSnapshot.browserScreenShareSupported === false;
            const pickerUnavailable = browserUnsupported && (!sharing || editorMode !== 'quality');
            const nativeApplication = screenField('[data-native-audio-target]');
            const audioReady = !native || screenField('[data-native-audio-mode]')?.value !== 'application' || (Boolean(nativeApplication?.value) && !nativeApplication?.selectedOptions?.[0]?.disabled);
            refs.screenStartButton.disabled = !mediaAvailable || screenPending || !sourceReady || !audioReady || pickerUnavailable;
            setText(screenField('[data-share-browser-title]'), browserUnsupported ? '此浏览器不支持共享屏幕' : '使用浏览器选择屏幕或窗口');
            setText(screenField('[data-share-browser-hint]'), browserUnsupported ? '你仍可用通话卡片上的“摄像头”分享视频，或观看其他成员的共享。共享电脑屏幕请使用电脑浏览器或 Windows 客户端。' : '点击“选择来源并共享”后，将打开浏览器的来源选择器；选中画面后确认共享。');
            setText(refs.screenStartButton, screenPending ? '正在处理…' : sharing ? (editorMode === 'quality' ? '应用画质' : '切换来源') : native ? '开始共享' : '选择来源并共享');
            refs.screenStatus.classList.toggle('hidden', !sharing && !screenPending && !observedSharing);
            refs.resolutionSelect.value = resolutionPreset;
            refs.frameRateSelect.value = String(frameRate);
            refs.resolutionSelect.disabled = screenSelectDisabled;
            refs.frameRateSelect.disabled = screenSelectDisabled;
            const modeSelect = screenField('[data-screen-share-mode]');
            if (modeSelect) {
                modeSelect.value = shareMode;
                modeSelect.disabled = screenSelectDisabled;
            }
            for (const [selector, value] of [['[data-screen-share-codec]', codecMode], ['[data-screen-share-start-bitrate]', startBitrate]]) {
                const select = screenField(selector);
                if (select) { select.value = value; select.disabled = screenSelectDisabled; }
            }
            const stateText = screenPending ? '正在处理共享…' : sharing ? `正在共享 · ${lastSnapshot.screenShareAudioActive ? '含来源声音' : '不含来源声音'}` : '已停止共享';
            setText(refs.screenStatus, stateText);
            refs.screenStatus.dataset.shareState = screenPending ? 'pending' : sharing ? 'active' : 'stopped';
            const stageControls = global.document.querySelector?.('[data-local-share-controls]');
            if (stageControls) {
                stageControls.hidden = !sharing && !screenPending;
                setText(stageControls.querySelector('[data-local-share-state]'), stateText);
                stageControls.querySelectorAll('[data-share-action]').forEach(button => { button.disabled = screenPending && button.dataset.shareAction !== 'stop'; });
            }
            const stopButton = screenField('[data-share-action="stop"]');
            if (stopButton) stopButton.hidden = !sharing && !screenPending;
            const provider = screenField('[data-screen-share-provider]');
            if (provider) provider.disabled = screenPending || (sharing && editorMode === 'quality');
            screenPanel()?.querySelectorAll('[data-screen-share-cancel]').forEach(button => { button.disabled = screenPending; });
            const sourceSection = screenField('[data-share-source-section]');
            if (sourceSection) sourceSection.hidden = sharing && editorMode === 'quality';
            const browserSource = screenField('[data-share-browser-source]');
            if (browserSource) browserSource.hidden = native;
            const nativeSection = screenField('[data-piik-native-options]');
            if (nativeSection) nativeSection.hidden = !native;
            const webOnly = screenField('[data-share-web-only]');
            if (webOnly) webOnly.hidden = native;
            const modeRow = screenField('[data-share-mode-row]');
            if (modeRow) modeRow.hidden = native;
            screenPanel()?.querySelectorAll('[data-screen-share-audio], [data-screen-share-bitrate], [data-native-audio-mode], [data-native-audio-target]').forEach(el => { el.disabled = screenPending; });
            setText(screenField('[data-share-dialog-title]'), sharing ? (editorMode === 'quality' ? '调整共享画质' : '切换共享内容') : '选择共享内容');
            const old = lastSnapshot.screenShareOptions;
            const audioMode = screenField('[data-native-audio-mode]')?.value || 'none';
            const audio = native ? audioMode !== 'none' : screenField('[data-screen-share-audio]')?.checked === true;
            const restart = sharing && (old?.provider !== (native ? 'native' : 'web') || old?.shareAudio !== audio ||
                (native && (old?.nativeAudioMode !== audioMode || old?.nativeAudioTargetKey !== (screenField('[data-native-audio-target]')?.value || '') || (editorMode === 'source' && !['none', 'source'].includes(audioMode)))) ||
                (!native && (old?.codecMode !== codecMode || !provider || (resolutionPreset === 'original' && old?.resolutionPreset !== 'original'))));
            setText(
                refs.screenSettingsStatus,
                screenPending ? '正在应用，请稍候；可停止共享取消' : restart ? '此项变更需要重建共享，观看画面会短暂中断；语音保持连接' :
                sharing ? (editorMode === 'quality' ? '在当前共享上应用；实际画质以接收端为准' : native ? '选中新来源后切换，语音保持连接' : '取消浏览器选择器将保留当前共享') : '选择来源，再确认画质'
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

        const runIntent = async (key, action, supersede = false) => {
            if (!isActive() || (!supersede && pendingActions.has(key))) {
                return false;
            }
            const revision = (intentRevisions.get(key) || 0) + 1;
            intentRevisions.set(key, revision);
            pendingActions.add(key);
            render(lastSnapshot);
            const isCurrent = () => isActive() && intentRevisions.get(key) === revision;
            try {
                return await action(isCurrent);
            } catch (error) {
                logger?.warn?.(`Media Dock ${key} action failed.`, error);
                return false;
            } finally {
                if (intentRevisions.get(key) === revision) {
                    pendingActions.delete(key);
                    if (isActive()) render(getCurrentAdapterSnapshot());
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
            void runIntent('microphone', () => adapter.toggleMicrophone(),
                Boolean(getCurrentAdapterSnapshot().microphonePending));
        };
        const handleCameraClick = () => {
            void runIntent('camera', () => adapter.toggleCamera(),
                Boolean(getCurrentAdapterSnapshot().cameraPending));
        };
        const handleScreenClick = () => {
            const snapshot = getCurrentAdapterSnapshot();
            if (snapshot.screenSharePending) {
                void runIntent('screen', () => adapter.stopScreenShare(), true);
                return;
            }
            if (snapshot.screenShareEnabled) {
                void runIntent('screen', () => adapter.stopScreenShare());
            } else openPopover('screen');
        };
        const handleScreenStart = () => {
            const snapshot = getCurrentAdapterSnapshot();
            if (!snapshot.mediaControlsAvailable || snapshot.screenSharePending) return;
            if (refs.resolutionSelect.reportValidity?.() === false) return;
            // Call capture directly from this click to preserve browser user activation.
            void runIntent('screen', async (isCurrent) => {
                const dialogRevision = popoverRevision;
                setText(screenField('[data-share-dialog-feedback]'), '');
                const options = {
                          frameRate,
                          resolutionPreset,
                          mode: shareMode,
                          codecMode,
                          startBitrate,
                          provider: screenField('[data-screen-share-provider]')?.value || 'web',
                          nativeSourceKey: screenField('[data-piik-native-source]')?.value || snapshot.screenShareOptions?.nativeSourceKey || '',
                          nativeAudioMode: screenField('[data-native-audio-mode]')?.value || 'none',
                          nativeAudioTargetKey: screenField('[data-native-audio-target]')?.value || '',
                          shareAudio: screenField('[data-screen-share-provider]')?.value === 'native' ? (screenField('[data-native-audio-mode]')?.value || 'none') !== 'none' : screenField('[data-screen-share-audio]')?.checked === true,
                          maxBitrate: Number(screenField('[data-screen-share-bitrate]')?.value) || 15000000,
                      };
                const started = await (snapshot.screenShareEnabled ? adapter.updateScreenShare?.(options, editorMode) : adapter.startScreenShare(options));
                if (!isCurrent() || dialogRevision !== popoverRevision || openPopoverType !== 'screen') return started;
                if (started !== false && started !== undefined) closePopovers();
                else if (openPopoverType === 'screen') setText(screenField('[data-share-dialog-feedback]'), getCurrentAdapterSnapshot().screenShareError || '操作未完成或已取消。请检查来源后重试。');
                return started;
            });
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
        const handleNoiseClick = () => {
            void runIntent('noise', () => adapter.toggleNoiseSuppression?.());
        };
        const handleAiNoiseClick = () => {
            if (!getCurrentAdapterSnapshot().aiNoiseSupported) {
                return;
            }
            void runIntent('ai-noise', () =>
                adapter.toggleAiNoiseSuppression?.()
            );
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
            void runIntent('copy', async (isCurrent) => {
                const copied = await adapter.copyRoomLink?.();
                if (!isCurrent()) return copied;
                setCopyState(copied === false ? 'failure' : 'success');
                scheduleCopyRestore();
                return copied;
            });
        };
        const closePopovers = () => {
            popoverRevision++;
            closeWatcher?.destroy(); closeWatcher = undefined;
            if (openPopoverType === 'screen') signalDialog('voice-share-dialog-close');
            cancelHoverClose();
            root.querySelectorAll('[data-device-control]').forEach((control) =>
                control.classList.remove('is-open')
            );
            popovers.forEach((popover) => {
                if (popover.open && typeof popover.close === 'function') popover.close();
                if (typeof popover.hidePopover === 'function' && popover.matches?.(':popover-open')) popover.hidePopover();
                popover.classList.remove('is-open');
            });
            if (fallbackPopup) {
                fallbackPlaceholder?.replaceWith(fallbackPopup);
                fallbackPopup.classList.remove('media-popover-fallback');
                fallbackBackdrop?.remove();
                fallbackPopup = fallbackPlaceholder = fallbackBackdrop = undefined;
            }
            root.querySelectorAll('[data-control-menu]').forEach((toggle) =>
                toggle.setAttribute('aria-expanded', 'false')
            );
            openPopoverType = undefined;
            popoverOpenedByHover = false;
            previousFocus?.focus?.();
            previousFocus = undefined;
        };
        const positionPopover = (type) => {
            const popover = popovers.find((element) => element.dataset.devicePopover === type);
            if (!popover?.getBoundingClientRect) {
                return;
            }
            if (type === 'screen') return;
            const margin = 8;
            const control = root.querySelector(
                `[data-device-control="${type}"]`
            );
            const anchor = control?.getBoundingClientRect?.();
            if (!anchor) return;
            popover.style.maxHeight = `${Math.max(80, global.innerHeight - margin * 2)}px`;
            const rect = popover.getBoundingClientRect();
            const left = Math.max(
                margin,
                Math.min(anchor.left, global.innerWidth - rect.width - margin)
            );
            const above = anchor.top - rect.height - margin;
            const top =
                above >= margin
                    ? above
                    : Math.max(
                          margin,
                          Math.min(
                              anchor.bottom + margin,
                              global.innerHeight - rect.height - margin
                          )
                      );
            popover.style.left = `${left}px`;
            popover.style.top = `${top}px`;
            popover.style.right = 'auto';
        };
        const cancelShareDialog = () => {
            if (getCurrentAdapterSnapshot().screenSharePending || pendingActions.has('screen')) {
                setText(screenField('[data-share-dialog-feedback]'), '正在处理共享，请使用“停止共享”取消。');
                return;
            }
            closePopovers();
        };
        const openPopover = (type, fromHover = false, mode = 'source') => {
            closePopovers();
            if (type === 'screen') {
                editorMode = mode;
                const options = getCurrentAdapterSnapshot().screenShareOptions;
                if (getCurrentAdapterSnapshot().screenShareEnabled && options) {
                    resolutionPreset = normalizeResolutionPreset(options.resolutionPreset);
                    frameRate = normalizeFrameRate(options.frameRate);
                    shareMode = options.mode;
                    codecMode = options.codecMode;
                    startBitrate = options.startBitrate;
                    const values = [['[data-screen-share-provider]', options.provider], ['[data-screen-share-bitrate]', options.maxBitrate], ['[data-native-audio-mode]', options.nativeAudioMode || (options.shareAudio ? 'source' : 'none')]];
                    values.forEach(([selector, value]) => { const el = screenField(selector); if (el) el.value = String(value); });
                    const audio = screenField('[data-screen-share-audio]');
                    if (audio) audio.checked = options.shareAudio === true;
                }
                setText(screenField('[data-share-dialog-feedback]'), '');
                render(getCurrentAdapterSnapshot());
            }
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
            previousFocus = global.document.activeElement;
            const showNative = type === 'screen' ? popover.showModal : popover.showPopover;
            if (typeof showNative === 'function') showNative.call(popover);
            else {
                // Older embedded browsers need a body-level overlay to escape
                // the draggable window's containing block and stacking context.
                fallbackPopup = popover;
                fallbackPlaceholder = global.document.createComment('media-popup');
                popover.replaceWith(fallbackPlaceholder);
                popover.classList.add('media-popover-fallback');
                if (type === 'screen') {
                    fallbackBackdrop = global.document.createElement('div');
                    fallbackBackdrop.className = 'media-modal-fallback-backdrop';
                    fallbackBackdrop.addEventListener('click', (event) => {
                        event.preventDefault(); event.stopPropagation(); cancelShareDialog();
                    });
                    global.document.body.append(fallbackBackdrop);
                }
                global.document.body.append(popover);
                if (type === 'screen') popover.querySelector('select, button')?.focus();
            }
            toggle.setAttribute('aria-expanded', 'true');
            openPopoverType = type;
            // Modal dialogs already participate in browser close requests.
            // Manual device popovers need an explicit watcher for Android Back.
            if (type !== 'screen' && !fromHover && global.CloseWatcher) {
                closeWatcher = new global.CloseWatcher();
                closeWatcher.addEventListener('close', closePopovers);
            }
            if (type === 'screen') signalDialog('voice-share-dialog-open', { mode, nativeSourceKey: getCurrentAdapterSnapshot().screenShareOptions?.nativeSourceKey, nativeAudioTargetKey: getCurrentAdapterSnapshot().screenShareOptions?.nativeAudioTargetKey });
            popoverOpenedByHover = fromHover;
            if (DEVICE_TYPES.includes(type)) {
                adapter.refreshDevices?.(type);
            }
            global.requestAnimationFrame?.(() => positionPopover(type));
            return true;
        };
        const handleRootClick = (event) => {
            if (event.target.closest?.('[data-control-close]')) {
                event.preventDefault();
                closePopovers();
                return;
            }
            const menuToggle = event.target.closest?.('[data-control-menu]');
            if (menuToggle && root.contains(menuToggle)) {
                event.preventDefault();
                event.stopPropagation();
                const type = menuToggle.dataset.controlMenu;
                if (openPopoverType === type) {
                    if (popoverOpenedByHover) {
                        popoverOpenedByHover = false;
                        cancelHoverClose();
                    } else closePopovers();
                } else {
                    openPopover(type);
                }
                return;
            }

            const deviceOption = event.target.closest?.(
                '[data-device-type][data-device-id]'
            );
            if (!deviceOption || (!root.contains(deviceOption) && !fallbackPopup?.contains(deviceOption))) {
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
            void runIntent(`device-${type}`, () => action(deviceId), true);
        };
        const handleDocumentClick = (event) => {
            const action = event.target.closest?.('[data-share-action]')?.dataset.shareAction;
            if (action) {
                if (action === 'stop') {
                    void runIntent('screen', () => adapter.stopScreenShare(), true);
                    closePopovers();
                } else openPopover('screen', false, action);
                return;
            }
            if (openPopoverType && !root.contains(event.target) && !fallbackPopup?.contains(event.target)) {
                closePopovers();
            }
        };
        const handleDocumentKeydown = (event) => {
            if (event.defaultPrevented || event.isComposing) return;
            if (fallbackPopup && openPopoverType === 'screen' && event.key === 'Tab') {
                const focusable = Array.from(fallbackPopup.querySelectorAll('select, button, input, [tabindex="0"]')).filter((element) => !element.disabled);
                const index = focusable.indexOf(global.document.activeElement);
                if (index < 0 || (!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index === 0)) {
                    event.preventDefault();
                    focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
                }
            }
            if (event.key === 'Escape') {
                if (openPopoverType) event.preventDefault();
                if (openPopoverType === 'screen') { event.preventDefault(); cancelShareDialog(); }
                else closePopovers();
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
            popovers = Array.from(root.querySelectorAll('[data-device-popover]'));
            const shareProvider = screenField('[data-screen-share-provider]');
            if (shareProvider && global.EliYorkDesktop) shareProvider.value = 'native';
            initialized = true;
            root.dataset.mediaDockInitialized = 'true';
            refs.resolutionSelect.value = resolutionPreset;
            refs.frameRateSelect.value = String(frameRate);

            listen(refs.sessionButton, 'click', handleSessionClick);
            listen(refs.micButton, 'click', handleMicrophoneClick);
            listen(refs.cameraButton, 'click', handleCameraClick);
            listen(refs.screenButton, 'click', handleScreenClick);
            listen(refs.screenStartButton, 'click', handleScreenStart);
            root.querySelectorAll('[data-screen-share-cancel]').forEach(button => listen(button, 'click', cancelShareDialog));
            for (const selector of ['[data-screen-share-provider]', '[data-piik-native-source]', '[data-screen-share-audio]', '[data-screen-share-bitrate]', '[data-native-audio-mode]', '[data-native-audio-target]']) listen(screenField(selector), 'change', () => render(getCurrentAdapterSnapshot()));
            listen(refs.outputButton, 'click', handleOutputClick);
            listen(refs.statusMessages, 'click', (event) => {
                if (event.target.closest?.('[data-audio-recovery]')) {
                    adapter.recoverAudio?.();
                }
            });
            listen(refs.outputSlider, 'input', handleOutputInput);
            listen(refs.micGainSlider, 'input', handleMicGainInput);
            listen(refs.noiseModeSelect, 'change', (event) => {
                // The controller handles rapid selections across mode and mic.
                void adapter.selectNoiseMode?.(event.target.value);
            });
            listen(refs.speechGateToggle, 'change', (event) => {
                void adapter.setRnnoiseSpeechGate?.(event.target.checked);
                render(adapter.getSnapshot());
            });
            listen(refs.noiseToggle, 'click', handleNoiseClick);
            listen(refs.noiseToggle, 'keydown', handleKeyboardActivation);
            listen(refs.aiNoiseToggle, 'click', handleAiNoiseClick);
            listen(refs.aiNoiseToggle, 'keydown', handleKeyboardActivation);
            listen(refs.copyButton, 'click', handleCopyClick);
            listen(refs.resolutionSelect, 'change', handleResolutionChange);
            listen(refs.frameRateSelect, 'change', handleFrameRateChange);
            listen(root.querySelector('[data-screen-share-mode]'), 'change', (event) => {
                shareMode = event.target.value === 'detail' ? 'detail' : 'game';
                frameRate = shareMode === 'game' ? 60 : 30;
                render(lastSnapshot);
            });
            listen(root.querySelector('[data-screen-share-codec]'), 'change', (event) => {
                codecMode = ['av1', 'h264', 'vp8'].includes(event.target.value) ? event.target.value : 'auto';
                render(lastSnapshot);
            });
            listen(root.querySelector('[data-screen-share-start-bitrate]'), 'change', (event) => {
                startBitrate = ['1500', '5500'].includes(event.target.value) ? event.target.value : 'browser';
                render(lastSnapshot);
            });
            listen(root, 'click', handleRootClick);
            root.querySelectorAll('[data-device-control]').forEach(
                (control) => {
                    listen(control, 'pointerenter', (event) => {
                        if (event.pointerType !== 'mouse') return;
                        if (control.dataset.deviceControl === 'screen' || openPopoverType === 'screen') return;
                        cancelHoverClose();
                        const type = control.dataset.deviceControl;
                        if (openPopoverType !== type) openPopover(type, true);
                    });
                    listen(control, 'pointerleave', (event) => {
                        if (event.pointerType !== 'mouse') return;
                        if (openPopoverType === 'screen') return;
                        cancelHoverClose();
                        hoverCloseTimer = global.setTimeout(closePopovers, 250);
                    });
                }
            );
            root.querySelectorAll('[data-device-popover]').forEach(
                (popover) => {
                    listen(popover, 'click', (event) => {
                        if (!root.contains(popover)) handleRootClick(event);
                    });
                    if (popover.dataset.devicePopover === 'screen') {
                        listen(popover, 'cancel', (event) => { event.preventDefault(); cancelShareDialog(); });
                        listen(popover, 'click', (event) => {
                            if (event.target !== popover) return;
                            const rect = popover.getBoundingClientRect?.();
                            if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
                                event.preventDefault(); event.stopPropagation(); cancelShareDialog();
                            }
                        });
                        return;
                    }
                    listen(popover, 'pointerenter', cancelHoverClose);
                    listen(popover, 'pointerleave', (event) => {
                        if (event.pointerType !== 'mouse') return;
                        cancelHoverClose();
                        hoverCloseTimer = global.setTimeout(closePopovers, 250);
                    });
                }
            );
            listen(global.document, 'click', handleDocumentClick);
            listen(global.document, 'keydown', handleDocumentKeydown);
            listen(global, 'resize', handleResize);
            listen(global, 'scroll', handleResize, true);

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
