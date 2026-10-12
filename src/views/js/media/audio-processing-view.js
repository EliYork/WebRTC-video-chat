(function exposeVoiceAudioProcessingView(global) {
    'use strict';
    const MODE_LABELS = {
        off: '关闭',
        browser: '浏览器内置',
        rnnoise: 'RNNoise',
        raw: '直通',
        unknown: '未报告',
    };
    const flag = (value) =>
        value === true ? '开' : value === false ? '关' : '未报告';
    const aec = (value) =>
        value === 'all'
            ? '系统播放声音'
            : value === 'remote-only'
              ? '远端语音'
              : flag(value);
    const describe = (snapshot = {}) => {
        const state = snapshot.audioProcessing;
        const mode =
            snapshot.requestedNoiseMode ||
            (snapshot.aiNoiseEnabled
                ? 'rnnoise'
                : snapshot.noiseSuppressionEnabled === false
                  ? 'off'
                  : 'browser');
        const requested = `请求：${MODE_LABELS[mode]} · AEC 系统播放声音`;
        if (!state) return `${requested}；麦克风未采集`;
        const actual = state.actual || {};
        const parts = [
            requested,
            `实际：${MODE_LABELS[state.mode]} · 浏览器降噪${flag(actual.noiseSuppression)} · AEC ${aec(actual.echoCancellation)} · 自动增益${flag(actual.autoGainControl)}`,
        ];
        if (state.aecFallback) parts.push('系统 AEC 未确认，使用普通 AEC 请求');
        if (state.fallbackReason) parts.push('处理器不可用，已回退');
        if (state.mode === 'rnnoise') {
            if (state.speechGateSupported === false) parts.push('非语音门控不可用，请刷新加载新版处理器');
            else if (state.speechGateSupported === true) {
                parts.push(`非语音门控${flag(state.speechGateEnabled)}（讲话时的键盘声由 RNNoise 处理）`);
                if (state.speechGateRequested !== state.speechGateEnabled) parts.push('非语音门控切换中');
            }
        }
        if (state.restoreError)
            parts.push('原采集设置恢复失败，请检查实际状态');
        if (state.sourceLive === false) parts.push('麦克风采集已停止');
        if (snapshot.audioSettingsPending) parts.push('切换中，保留当前音频');
        if (snapshot.audioSettingsError) {
            const failure = state.lastSwitchFailure;
            const reasons = {
                'rnnoise-csp-blocked': '浏览器安全策略阻止降噪模型加载',
                'processor-unavailable': '降噪处理器初始化失败',
                'capture-failed': '麦克风采集失败，请检查设备和权限',
            };
            parts.push(failure && reasons[failure.code]
                ? `切换${MODE_LABELS[failure.mode] || '降噪模式'}失败：${reasons[failure.code]}；已保留原音频`
                : '切换失败，已保留原音频');
        }
        if (snapshot.microphoneGain > 100)
            parts.push('增益超过 100%，残留键盘声也会放大，大声讲话可能失真');
        return parts.join('；');
    };
    global.VoiceAudioProcessingView = { MODE_LABELS, describe };
})(window);
