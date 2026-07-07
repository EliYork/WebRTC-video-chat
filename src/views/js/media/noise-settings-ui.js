(function exposeVoiceNoiseSettingsUI(global) {
    'use strict';

    const { byId, safeStorageGet, safeStorageSet, setText, toggleClass } =
        global.VoiceViewUtils;

    const NOISE_SUPPRESSION_KEY = 'webrtc-noise-suppression';
    const AI_NOISE_EXPERIMENT_KEY = 'webrtc-ai-noise-experiment';
    const MIC_GAIN_KEY = 'webrtc-mic-gain';
    const DEFAULT_MIC_GAIN = 100;
    const MIN_MIC_GAIN = 0;
    const MAX_MIC_GAIN = 150;

    const getNoiseSuppressionEnabled = () =>
        safeStorageGet(NOISE_SUPPRESSION_KEY) !== 'false';

    const setNoiseSuppressionEnabled = (enabled) => {
        safeStorageSet(NOISE_SUPPRESSION_KEY, enabled);
    };

    const getAiExperimentEnabled = () =>
        safeStorageGet(AI_NOISE_EXPERIMENT_KEY) === 'true';

    const setAiExperimentEnabled = (enabled) => {
        safeStorageSet(AI_NOISE_EXPERIMENT_KEY, enabled);
    };

    const getAudioConstraints = () => ({
        echoCancellation: true,
        noiseSuppression: getNoiseSuppressionEnabled(),
        autoGainControl: !getAiExperimentEnabled(),
        channelCount: 1,
    });

    const clampMicGain = (percent) =>
        Math.max(MIN_MIC_GAIN, Math.min(MAX_MIC_GAIN, Math.round(percent)));

    const getMicGain = () => {
        const val = Number(safeStorageGet(MIC_GAIN_KEY));
        return !Number.isNaN(val) && val >= MIN_MIC_GAIN && val <= MAX_MIC_GAIN
            ? val
            : DEFAULT_MIC_GAIN;
    };

    const ensureDefaultMicGain = () => {
        if (safeStorageGet(MIC_GAIN_KEY) === null) {
            safeStorageSet(MIC_GAIN_KEY, String(DEFAULT_MIC_GAIN));
        }
    };

    const getRefs = (refs = {}) => ({
        noiseToggle: refs.noiseToggle || byId('noiseToggle'),
        noiseStatusText: refs.noiseStatusText || byId('noiseStatusText'),
        aiNoiseToggle: refs.aiNoiseToggle || byId('aiNoiseToggle'),
        aiNoiseStatusText: refs.aiNoiseStatusText || byId('aiNoiseStatusText'),
        micGainSlider: refs.micGainSlider || byId('micGainSlider'),
        micGainValue: refs.micGainValue || byId('micGainValue'),
        restartNoticePanel:
            refs.restartNoticePanel ||
            global.document.querySelector('.local-meta-panel'),
    });

    const updateNoiseToggleUI = (refs = {}) => {
        const { noiseToggle, noiseStatusText } = getRefs(refs);
        const enabled = getNoiseSuppressionEnabled();

        noiseToggle?.setAttribute('aria-pressed', String(enabled));
        setText(noiseStatusText, enabled ? '开' : '关');
    };

    const getAiStatusLabel = (enabled, noiseMode) => {
        if (!enabled) {
            return '关';
        }

        if (noiseMode === 'rnnoise') {
            return 'RNNoise';
        }

        if (noiseMode === 'passthrough') {
            return '直通';
        }

        if (noiseMode === 'fallback') {
            return '回退';
        }

        return '开';
    };

    const updateAiExperimentToggleUI = ({
        refs = {},
        supported = false,
        noiseMode = 'raw',
    } = {}) => {
        const { aiNoiseToggle, aiNoiseStatusText } = getRefs(refs);

        if (!aiNoiseToggle) {
            return;
        }

        if (!supported) {
            toggleClass(aiNoiseToggle, 'na', true);
            aiNoiseToggle.setAttribute('aria-pressed', 'false');
            aiNoiseToggle.setAttribute('title', '当前浏览器/设备不支持');
            aiNoiseToggle.style.cursor = 'default';

            setText(
                aiNoiseStatusText,
                aiNoiseToggle.dataset.notSupportedLabel || 'N/A'
            );

            return;
        }

        const enabled = getAiExperimentEnabled();

        toggleClass(aiNoiseToggle, 'na', false);
        aiNoiseToggle.setAttribute('aria-pressed', String(enabled));
        aiNoiseToggle.removeAttribute('title');
        aiNoiseToggle.style.cursor = '';
        setText(aiNoiseStatusText, getAiStatusLabel(enabled, noiseMode));
    };

    const showRestartEffectNotice = (refs = {}, timerState) => {
        const { restartNoticePanel } = getRefs(refs);

        if (!restartNoticePanel) {
            return;
        }

        let notice = restartNoticePanel.querySelector('.restart-effect-notice');

        if (!notice) {
            notice = global.document.createElement('div');
            notice.className = 'restart-effect-notice';
            restartNoticePanel.append(notice);
        }

        notice.textContent = '重进房间后生效';
        notice.classList.add('is-visible');
        global.clearTimeout(timerState.restartNoticeTimer);
        timerState.restartNoticeTimer = global.setTimeout(() => {
            notice.classList.remove('is-visible');
        }, 2600);
    };

    const syncMicGainUI = (refs = {}) => {
        const { micGainSlider, micGainValue } = getRefs(refs);
        const micGain = getMicGain();

        if (micGainSlider) {
            micGainSlider.value = String(micGain);
        }

        setText(micGainValue, micGain + '%');
    };

    const setMicGain = (percent, { refs = {}, onMicGainChange } = {}) => {
        const clamped = clampMicGain(percent);

        safeStorageSet(MIC_GAIN_KEY, clamped);
        syncMicGainUI(refs);

        if (typeof onMicGainChange === 'function') {
            onMicGainChange(clamped);
        }
    };

    const addKeyboardClickProxy = (element) => {
        element?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                element.click();
            }
        });
    };

    const init = ({
        refs = {},
        isAiExperimentSupported = () => false,
        getNoiseMode = () => 'raw',
        onMicGainChange,
    } = {}) => {
        const resolvedRefs = getRefs(refs);
        const timerState = {
            restartNoticeTimer: null,
        };
        const sync = () => {
            updateNoiseToggleUI(resolvedRefs);
            updateAiExperimentToggleUI({
                refs: resolvedRefs,
                supported: isAiExperimentSupported(),
                noiseMode: getNoiseMode(),
            });
            syncMicGainUI(resolvedRefs);
        };

        ensureDefaultMicGain();
        sync();

        resolvedRefs.noiseToggle?.addEventListener('click', () => {
            setNoiseSuppressionEnabled(!getNoiseSuppressionEnabled());
            updateNoiseToggleUI(resolvedRefs);
            showRestartEffectNotice(resolvedRefs, timerState);
        });
        addKeyboardClickProxy(resolvedRefs.noiseToggle);

        resolvedRefs.aiNoiseToggle?.addEventListener('click', () => {
            if (!isAiExperimentSupported()) {
                return;
            }

            setAiExperimentEnabled(!getAiExperimentEnabled());
            updateAiExperimentToggleUI({
                refs: resolvedRefs,
                supported: true,
                noiseMode: getNoiseMode(),
            });
            showRestartEffectNotice(resolvedRefs, timerState);
        });
        addKeyboardClickProxy(resolvedRefs.aiNoiseToggle);

        resolvedRefs.micGainSlider?.addEventListener('input', () => {
            setMicGain(Number(resolvedRefs.micGainSlider.value), {
                refs: resolvedRefs,
                onMicGainChange,
            });
        });

        return {
            sync,
        };
    };

    global.VoiceNoiseSettingsUI = {
        getAiExperimentEnabled,
        getAudioConstraints,
        getMicGain,
        getNoiseSuppressionEnabled,
        init,
        setAiExperimentEnabled,
        setMicGain,
        setNoiseSuppressionEnabled,
        syncMicGainUI,
        updateAiExperimentToggleUI,
        updateNoiseToggleUI,
    };
})(window);
