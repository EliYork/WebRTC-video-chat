(function exposeVoiceConnectionQuality(global) {
    'use strict';

    const valid = value => Number.isFinite(value) && value >= 0;
    const worst = values => values.filter(valid).length ? Math.max(...values.filter(valid)) : null;
    const audio = row => (row.kind || row.mediaType) === 'audio';
    const readConnection = (reports, previous = new Map(), pc = {}) => {
        const transports = reports.filter(row => row.type === 'transport' && row.selectedCandidatePairId);
        const pairs = reports.filter(row => row.type === 'candidate-pair' && row.state === 'succeeded' &&
            (transports.length ? transports.some(transport => transport.selectedCandidatePairId === row.id) : row.selected === true));
        const inbound = reports.filter(row => audio(row) && ['inbound-rtp', 'remote-inbound-rtp'].includes(row.type));
        const loss = inbound.map(row => {
            const before = previous.get(row.id);
            if (row.type === 'remote-inbound-rtp') {
                const fraction = row.fractionLost;
                return valid(fraction) && fraction <= 1 && (!before || row.timestamp > before.timestamp)
                    ? fraction * 100 : null;
            }
            if (!before || !(row.timestamp > before.timestamp)) return null;
            const received = row.packetsReceived - before.packetsReceived;
            const lost = row.packetsLost - before.packetsLost;
            // A counter reset, out-of-order correction or idle interval isn't 0% loss.
            return valid(received) && valid(lost) && received + lost > 0 ? lost * 100 / (received + lost) : null;
        });
        return {
            state: pc.connectionState || pc.iceConnectionState || 'unknown',
            rttMs: worst([...pairs.map(row => valid(row.currentRoundTripTime) ? row.currentRoundTripTime * 1000 : null),
                ...inbound.filter(row => row.type === 'remote-inbound-rtp').map(row => valid(row.roundTripTime) ? row.roundTripTime * 1000 : null)]),
            lossPercent: worst(loss),
            jitterMs: worst(inbound.map(row => valid(row.jitter) ? row.jitter * 1000 : null)),
        };
    };
    const grade = ({ rttMs, lossPercent, jitterMs }) => {
        const hasLatency = valid(rttMs);
        const hasLoss = valid(lossPercent);
        if (!hasLatency && !hasLoss) return null;
        const values = [rttMs, lossPercent, jitterMs];
        const limits = [[100, .5, 15], [200, 2, 30], [350, 4, 50], [600, 8, 80]];
        const index = limits.findIndex(limit => values.every((value, i) => !valid(value) || value <= limit[i]));
        const bars = index < 0 ? 1 : 5 - index;
        // Partial stats can show a problem, but cannot establish a good link.
        return hasLatency && hasLoss ? bars : Math.min(3, bars);
    };
    const createRuntime = ({ now = () => Date.now() } = {}) => {
        let entries = [], measuredAt = 0;
        const reset = () => { entries = []; measuredAt = 0; };
        return {
            reset,
            accept: sample => { entries = sample; measuredAt = now(); },
            snapshot: ({ state = 'idle', online = true } = {}) => {
                const result = (status, label, bars = null, detail = label) => ({ status, label, bars, detail });
                if (!online) return result('disconnected', '网络离线', 0);
                if (['idle', 'leaving', 'disposed'].includes(state)) return result('unknown', '未加入语音');
                if (state !== 'joined') return result('connecting', '语音连接正在恢复或建立');
                if (!entries.length) return result('unknown', '等待通话链路测量（单人频道暂无对端）');
                if (now() - measuredAt > 12000 || now() < measuredAt) return result('unknown', '通话质量数据已过期，等待新测量');
                if (entries.some(entry => ['failed', 'disconnected', 'closed'].includes(entry.state))) return result('disconnected', '存在中断的通话链路', 0);
                if (entries.some(entry => !['connected', 'completed'].includes(entry.state))) return result('connecting', '通话链路正在建立，尚未确认质量');
                const metrics = {
                    rttMs: worst(entries.map(entry => entry.rttMs)),
                    lossPercent: worst(entries.map(entry => entry.lossPercent)),
                    jitterMs: worst(entries.map(entry => entry.jitterMs)),
                };
                const sample = { ...metrics, micKbps: worst(entries.map(entry => entry.micKbps)) };
                const linkGrades = entries.map(grade);
                if (linkGrades.includes(null))
                    return { ...result('unknown', '通话统计不完整，尚未确认质量'), ...sample };
                const bars = Math.min(...linkGrades);
                const label = ['连接较差', '连接一般', '连接尚可', '连接良好', '连接优秀'][bars - 1];
                const number = (value, unit) => valid(value) ? `${Math.round(value * 10) / 10}${unit}` : '未提供';
                return {
                    ...result(bars >= 4 ? 'good' : bars >= 2 ? 'fair' : 'poor', label, bars,
                        `通话质量：${label} · 往返延迟 ${number(metrics.rttMs, 'ms')} · 区间丢包 ${number(metrics.lossPercent, '%')} · 抖动 ${number(metrics.jitterMs, 'ms')}（已测 ${entries.length} 条通话链路最差值；按已提供指标估算，非 Wi-Fi/蜂窝信号）`),
                    ...sample,
                };
            },
        };
    };
    global.VoiceConnectionQuality = { readConnection, grade, createRuntime };
})(window);
