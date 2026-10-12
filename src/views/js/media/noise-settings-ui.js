(function exposeVoiceNoiseSettingsUI(global) {
    'use strict';

    const { byId, safeStorageGet, safeStorageSet, setText, toggleClass } =
        global.VoiceViewUtils;

    const NOISE_SUPPRESSION_KEY = 'webrtc-noise-suppression';
    const AI_NOISE_EXPERIMENT_KEY = 'webrtc-ai-noise-experiment';
    const NOISE_MODE_KEY = 'webrtc-noise-mode';
    const MIC_GAIN_KEY = 'webrtc-mic-gain';
    const DEFAULT_MIC_GAIN = 100;
    const MIN_MIC_GAIN = 0;
    const MAX_MIC_GAIN = 150;

    const getNoiseMode = () => {
        const saved = safeStorageGet(NOISE_MODE_KEY);
        if (['off', 'browser', 'rnnoise'].includes(saved)) return saved;
        return safeStorageGet(AI_NOISE_EXPERIMENT_KEY) === 'true' ? 'rnnoise' :
            safeStorageGet(NOISE_SUPPRESSION_KEY) === 'false' ? 'off' : 'browser';
    };
    const setNoiseMode = (mode) => {
        if (!['off', 'browser', 'rnnoise'].includes(mode)) return false;
        safeStorageSet(NOISE_MODE_KEY, mode);
        safeStorageSet(NOISE_SUPPRESSION_KEY, mode === 'browser');
        safeStorageSet(AI_NOISE_EXPERIMENT_KEY, mode === 'rnnoise');
        return true;
    };
    const getNoiseSuppressionEnabled = () => getNoiseMode() === 'browser';

    const setNoiseSuppressionEnabled = (enabled) => {
        setNoiseMode(enabled ? 'browser' : 'off');
    };

    const getAiExperimentEnabled = () =>
        getNoiseMode() === 'rnnoise';

    const setAiExperimentEnabled = (enabled) => {
        setNoiseMode(enabled ? 'rnnoise' : 'browser');
    };

    const getAudioConstraints = () => ({
        echoCancellation: true,
        noiseSuppression: getNoiseSuppressionEnabled(),
        autoGainControl: getNoiseMode() === 'browser',
        channelCount: 1,
    });

    const clampMicGain = (percent) =>
        Math.max(MIN_MIC_GAIN, Math.min(MAX_MIC_GAIN, Math.round(percent)));

    const getMicGain = () => {
        const saved = safeStorageGet(MIC_GAIN_KEY);
        if (saved == null || String(saved).trim() === '') {
            return DEFAULT_MIC_GAIN;
        }
        const val = Number(saved);
        return Number.isFinite(val) && val >= MIN_MIC_GAIN && val <= MAX_MIC_GAIN
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

        notice.textContent = '设置已保存';
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

    const setMicGain = (
        percent,
        { refs = {}, onMicGainChange, syncUI = true } = {}
    ) => {
        const clamped = clampMicGain(percent);

        safeStorageSet(MIC_GAIN_KEY, clamped);
        if (syncUI) {
            syncMicGainUI(refs);
        }

        if (typeof onMicGainChange === 'function') {
            onMicGainChange(clamped);
        }
        return clamped;
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
        onModeChange,
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

        resolvedRefs.noiseToggle?.addEventListener('click', async () => {
            const mode = getNoiseSuppressionEnabled() ? 'off' : 'browser';
            if (onModeChange) await onModeChange(mode);
            else setNoiseMode(mode);
            sync();
            if (!onModeChange) showRestartEffectNotice(resolvedRefs, timerState);
        });
        addKeyboardClickProxy(resolvedRefs.noiseToggle);

        resolvedRefs.aiNoiseToggle?.addEventListener('click', async () => {
            if (!isAiExperimentSupported()) {
                return;
            }

            const mode = getAiExperimentEnabled() ? 'browser' : 'rnnoise';
            if (onModeChange) await onModeChange(mode);
            else setNoiseMode(mode);
            updateAiExperimentToggleUI({
                refs: resolvedRefs,
                supported: true,
                noiseMode: getNoiseMode(),
            });
            if (!onModeChange) showRestartEffectNotice(resolvedRefs, timerState);
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
        getNoiseMode,
        setNoiseMode,
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
