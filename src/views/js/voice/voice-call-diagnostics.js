(function exposeCallDiagnostics(global) {
    'use strict';
    const STORAGE_KEY = 'voice-call-diagnostics-v1';
    const limits = { sessions: 5, events: 200, samples: 24 };
    const finite = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    const audioSummary = (reports, report, previous) => {
        const sending = report.type === 'outbound-rtp';
        const seconds = previous && report.timestamp > previous.timestamp ? (report.timestamp - previous.timestamp) / 1000 : 0;
        const delta = (key) => seconds && Number.isFinite(report[key]) && Number.isFinite(previous[key]) &&
            report[key] >= previous[key] ? report[key] - previous[key] : null;
        const avg = (total, count, factor = 1) => delta(count) > 0 && delta(total) !== null ? finite(delta(total) * factor / delta(count)) : null;
        const codec = reports.find((row) => row.id === report.codecId);
        const remote = reports.find((row) => row.id === report.remoteId);
        const source = sending ? reports.find((row) => row.id === report.mediaSourceId) : report;
        const duration = source && previous?.source && source.totalSamplesDuration - previous.source.totalSamplesDuration;
        const energy = source && previous?.source && source.totalAudioEnergy - previous.source.totalAudioEnergy;
        const count = delta('totalSamplesReceived');
        return {
            方向: sending ? '发送' : '接收',
            编码: /^audio\/(opus|PCMU|PCMA|G722)$/i.test(codec?.mimeType || '') ? codec.mimeType : null,
            采样间隔_ms: seconds ? finite(seconds * 1000) : null,
            码率_Mbps: seconds && delta(sending ? 'bytesSent' : 'bytesReceived') !== null ? finite(delta(sending ? 'bytesSent' : 'bytesReceived') * 8 / seconds / 1000000) : null,
            累计丢包: finite(sending ? remote?.packetsLost : report.packetsLost),
            '区间丢包率_%': delta('packetsReceived') !== null && delta('packetsLost') !== null && delta('packetsReceived') + delta('packetsLost') > 0 ? finite(delta('packetsLost') * 100 / (delta('packetsReceived') + delta('packetsLost'))) : null,
            抖动_ms: finite((sending ? remote?.jitter : report.jitter) * 1000),
            音量: finite(source?.audioLevel),
            能量均方根: duration > 0 && energy >= 0 ? Math.round(Math.sqrt(energy / duration) * 1000000) / 1000000 : null,
            每样本缓冲平均等待_ms: avg('jitterBufferDelay', 'jitterBufferEmittedCount', 1000),
            每样本目标缓冲等待_ms: avg('jitterBufferTargetDelay', 'jitterBufferEmittedCount', 1000),
            '隐藏样本比例_%': count > 0 && delta('concealedSamples') !== null ? finite(delta('concealedSamples') * 100 / count) : null,
            丢弃包数: delta('packetsDiscarded'),
        };
    };
    const browserInfo = () => {
        const ua = global.navigator.userAgent || '';
        const match = ua.match(/(Edg)\/([0-9]+)/) || ua.match(/(Firefox|Chrome|Version)\/([0-9]+)/);
        return {
            浏览器: match ? ({ Edg: 'Edge', Version: 'Safari' }[match[1]] || match[1]) : '其他',
            浏览器主版本: match ? Number(match[2]) : null,
            平台: /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : '其他',
            安全上下文: Boolean(global.isSecureContext),
            输出设备切换支持: typeof global.HTMLMediaElement?.prototype.setSinkId === 'function',
            WebAudio输出切换支持: typeof global.AudioContext?.prototype.setSinkId === 'function',
        };
    };
    const createRuntime = ({ getState, getConnections, getSources, getAudioRole, sanitize, storage } = {}) => {
        let sessions = [];
        let current;
        let socket;
        let timer;
        let saveTimer;
        let pending;
        let pendingOwner;
        let lastObserved;
        let storageState = '可用';
        let baselines = new WeakMap();
        try {
            storage ||= global.localStorage;
            if (!storage) throw new Error('storage-unavailable');
            const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
            if (Array.isArray(saved)) sessions = saved.slice(-limits.sessions).map(sanitize);
            for (const session of sessions) if (!session.结束时间) {
                session.结束时间 = session.当前状态?.采样时间 || session.开始时间;
                session.结束原因 = '页面关闭或中断（结束时间为最后记录）';
            }
        } catch { storageState = '不可用'; }
        const persist = () => {
            saveTimer = null;
            try {
                let encoded = JSON.stringify(sessions);
                while (encoded.length > 1200000 && sessions.length > 1) {
                    sessions.shift();
                    encoded = JSON.stringify(sessions);
                }
                if (encoded.length > 1200000) throw new Error('log-limit');
                storage?.setItem(STORAGE_KEY, encoded);
            } catch { storageState = '保存失败（本页内存仍可导出）'; }
        };
        const saveSoon = () => { if (!saveTimer) saveTimer = global.setTimeout(persist, 1000); };
        const record = (type, content) => {
            if (!current) return;
            current.事件总数++;
            current.事件.push({ 时间: new Date().toISOString(), 相对开始_ms: Date.now() - Date.parse(current.开始时间), 类型: type, 内容: sanitize(content) });
            if (current.事件.length > limits.events) { current.事件.shift(); current.截断 = true; }
            saveSoon();
        };
        const observe = () => {
            if (!current) return;
            const state = sanitize(getState());
            const signature = JSON.stringify(state);
            if (signature === lastObserved) return;
            lastObserved = signature;
            record('状态变化', state);
        };
        const sample = () => {
            if (pending && pendingOwner === current) return pending;
            const owned = current;
            const sampleBaselines = baselines;
            pendingOwner = owned;
            const task = (async () => {
                const local = sanitize(getState());
                const sources = getSources?.() || [];
                const shares = await Promise.all(sources.slice(0, 8).map((source) => global.VoiceShareDiagnostics?.sync(source, { force: true })));
                const seen = new Set();
                const pcs = (getConnections?.() || []).filter((entry) => {
                    const pc = entry?.pc || entry;
                    if (!pc || seen.has(pc)) return false;
                    seen.add(pc);
                    return true;
                }).slice(0, 16);
                const connections = await Promise.all(pcs.map(async (entry, index) => {
                    const pc = entry.pc || entry;
                    let timeout;
                    try {
                        const stats = await Promise.race([
                            Promise.resolve().then(() => pc.getStats()),
                            new Promise((_, reject) => { timeout = global.setTimeout(() => reject(new Error('timeout')), 2500); }),
                        ]);
                        const reports = [...stats.values()];
                        const previous = sampleBaselines.get(pc) || new Map();
                        const next = new Map();
                        const rows = reports.filter((row) => ['outbound-rtp', 'inbound-rtp'].includes(row.type) && (row.kind === 'audio' || row.mediaType === 'audio') && !row.isRemote);
                        const audio = rows.map((row) => {
                            const result = audioSummary(reports, row, previous.get(row.id));
                            result.角色 = getAudioRole?.(pc, row, reports) || '语音或共享音频（浏览器未区分）';
                            next.set(row.id, { ...row, source: row.type === 'outbound-rtp' ? reports.find((item) => item.id === row.mediaSourceId) : row });
                            return result;
                        });
                        sampleBaselines.set(pc, next);
                        return { 序号: index + 1, 参与者序号: entry.ordinal || null, 连接用途: entry.purpose || null, 路径: pc.screenRoute === 'SFU' ? 'SFU' : 'P2P', 连接状态: pc.connectionState || null, ICE状态: pc.iceConnectionState || null, 音频流: audio };
                    } catch { return { 序号: index + 1, 状态: '统计读取失败或超时' }; }
                    finally { global.clearTimeout(timeout); }
                }));
                const snapshot = sanitize({ 采样时间: new Date().toISOString(), 浏览器: browserInfo(), ...local, 共享: shares.filter(Boolean), 连接: connections });
                if (owned && current === owned) {
                    owned.当前状态 = snapshot;
                    owned.采样总数++;
                    owned.历史采样.push(snapshot);
                    // Preserve the first 12 startup samples, plus the last 12.
                    if (owned.历史采样.length > limits.samples) { owned.历史采样.splice(12, 1); owned.截断 = true; }
                    saveSoon();
                }
                return snapshot;
            })().finally(() => { if (pending === task) pending = null; });
            pending = task;
            return pending;
        };
        const tick = async () => {
            const owned = current;
            await sample().catch(() => record('采样失败', {}));
            if (current !== owned || !owned) return;
            timer = global.setTimeout(tick, Date.now() - Date.parse(owned.开始时间) < 15000 && !global.document.hidden ? 1000 : 5000);
        };
        const end = (reason = '离开语音') => {
            if (!current) return;
            record('通话结束', { 状态: reason });
            current.结束时间 = new Date().toISOString();
            current.结束原因 = reason;
            current = null;
            global.clearTimeout(timer);
            global.clearTimeout(saveTimer);
            persist();
        };
        const start = () => {
            end('开始新通话');
            baselines = new WeakMap();
            lastObserved = null;
            current = { 开始时间: new Date().toISOString(), 结束时间: null, 事件总数: 0, 采样总数: 0, 事件: [], 历史采样: [], 截断: false };
            sessions.push(current);
            sessions = sessions.slice(-limits.sessions);
            record('通话开始', {});
            observe();
            void tick();
        };
        const report = async () => ({
            版本: '1.0.5', 诊断格式: 4,
            当前状态: await sample(),
            当前会话: current ? sanitize(current) : null,
            存储状态: storageState,
            记录上限: limits,
            日志覆盖说明: '本机最近5次通话；每次最多200事件，保留前12与最近12次采样；不录音。页面关闭仅能记录最后保存时间。',
        });
        const handleRequest = async (payload, ack) => {
            const generation = getState()?.会话?.generation;
            if (typeof ack !== 'function' || !current || !generation || payload?.voiceSessionGeneration !== generation) return;
            const owned = current;
            const value = await report().catch(() => null);
            if (current !== owned || getState()?.会话?.generation !== generation) return ack({ ok: false });
            ack({ ok: Boolean(value), voiceSessionGeneration: generation, report: sanitize(value) });
        };
        const collectCombined = async () => {
            const owned = current;
            const generation = getState()?.会话?.generation;
            const localPromise = report();
            const remotePromise = new Promise((resolve) => {
                if (!current || !socket?.connected) return resolve({ ok: false, reason: 'not-in-voice' });
                socket.timeout(9000).emit('voice:diagnostics:collect', (error, result) => resolve(error ? { ok: false, reason: 'timeout' } : result));
            });
            const [local, remote] = await Promise.all([localPromise, remotePromise]);
            if (current !== owned || getState()?.会话?.generation !== generation) throw new Error('session-changed');
            return { 版本: '1.0.5', 诊断格式: 4, 收集开始时间: remote?.requestedAt || null,
                说明: '各端各自采样，非严格同步；比较采样时间。无原始设备ID、地址、用户名或音频内容。', 本机: local,
                对端: remote?.ok ? remote.results : [], 未响应原因: remote?.ok ? null : remote?.reason || 'collection-failed', 未收集人数: remote?.omitted || 0 };
        };
        const copyCombined = async (button) => {
            if (button?.disabled) return;
            if (button) { button.disabled = true; button.textContent = '正在收集双方诊断…'; }
            try {
                const data = await collectCombined();
                const text = JSON.stringify(data, null, 2);
                try { await global.navigator.clipboard.writeText(text); if (button) button.textContent = '双方诊断已复制'; }
                catch {
                    showText(text);
                    if (button) button.textContent = '请在日志窗口手动复制';
                }
            } catch { if (button) button.textContent = '会话已变化，请重试'; }
            finally { if (button) button.disabled = false; }
        };
        const showText = (text) => {
            const dialog = global.document.createElement('dialog');
            dialog.className = 'voice-log-dialog no-drag';
            const area = global.document.createElement('textarea');
            area.readOnly = true;
            area.value = text;
            area.setAttribute('aria-label', '脱敏通话日志');
            const close = global.document.createElement('button');
            close.textContent = '关闭';
            close.addEventListener('click', () => dialog.close());
            const download = global.document.createElement('button');
            download.textContent = '下载 JSON 日志';
            download.addEventListener('click', () => {
                const url = global.URL.createObjectURL(new global.Blob([text], { type: 'application/json' }));
                const link = global.document.createElement('a');
                link.href = url;
                link.download = `voice-diagnostics-${Date.now()}.json`;
                link.click();
                global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
            });
            dialog.append(area, download, close);
            dialog.addEventListener('close', () => dialog.remove());
            (global.document.fullscreenElement || global.document.body).append(dialog);
            dialog.showModal();
        };
        return {
            start, end, record, observe, sample, report, collectCombined, copyCombined,
            attachSocket(next) { socket?.off?.('voice:diagnostics:sample', handleRequest); socket = next; socket?.on?.('voice:diagnostics:sample', handleRequest); },
            showLogs: () => showText(JSON.stringify({ 版本: '1.0.5', 诊断格式: 4, 存储状态: storageState, 通话: sessions.map(sanitize) }, null, 2)),
            clearLogs() { sessions = current ? [current] : []; persist(); },
            destroy() { end('页面关闭'); socket?.off?.('voice:diagnostics:sample', handleRequest); },
        };
    };
    global.VoiceCallDiagnostics = { createRuntime, audioSummary };
})(window);
