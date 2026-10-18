(function exposeCallDiagnostics(global) {
    'use strict';
    const STORAGE_KEY = 'voice-call-diagnostics-v1';
    const limits = { sessions: 5, events: 200, samples: 24 };
    const copyLimits = { events: 40, samples: 10 };
    const pick = (value, names) => Object.fromEntries(names.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
    // Full settings belong in the current snapshot. History keeps measurements,
    // not repeated codec probes, send-policy requests and route-history arrays.
    const measurement = (state) => ({
        ...pick(state, ['采样时间', '会话', '连接']),
        本机音频: pick(state?.本机音频, ['实际模式', '静音', '轨道静音', '麦克风存活', '输出静音']),
        共享路径变化: pick(state?.共享路径变化, ['state', 'serverViewers', 'hasUplink']),
        共享: (state?.共享 || []).map((share) => ({
            ...pick(share, ['角色', '观看路径', '采样时间', 'SFU服务器统计', '采集轨道设置', '播放画面']),
            连接: (share.连接 || []).map((connection) => pick(connection,
                ['序号', '路径', '实际传输路径', '编码协商', '连接状态', 'ICE状态', '状态', '视频流', '音频流'])),
        })),
    });
    const compactReport = (report) => {
        if (!report?.当前会话) return report;
        const session = report.当前会话;
        const history = session.历史采样 || [];
        const samples = history.length > copyLimits.samples ? [...history.slice(0, 2), ...history.slice(-8)] : history;
        return { ...report, 记录上限: { ...report.记录上限, ...copyLimits }, 当前会话: {
            ...pick(session, ['开始时间', '结束时间', '结束原因', '事件总数', '采样总数']),
            事件: (session.事件 || []).slice(-copyLimits.events).map((event) => {
                if (event.类型 === '状态变化') return { ...event, 内容: measurement(event.内容) };
                if (event.类型 === 'SFU接收回退诊断' || event.类型 === 'SFU接收异常诊断')
                    return { ...event, 内容: pick(event.内容, ['序号', 'reason', '时间']) };
                return event;
            }),
            历史采样: samples.map(measurement),
            截断: Boolean(session.截断 || history.length > copyLimits.samples || session.事件?.length > copyLimits.events),
        }, 日志覆盖说明: '精简诊断：当前完整状态、最多40事件、2次起始及最近8次采样；SFU异常窗口完整保留。完整本机日志可在最近通话日志中下载。' };
    };
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
    const createRuntime = ({ getState, getConnections, getSources, getAudioRole, getReceiverHealth, sanitize, storage } = {}) => {
        let sessions = [];
        let current;
        let socket;
        let timer;
        let saveTimer;
        let copyFeedbackTimer;
        let pending;
        let pendingOwner;
        let lastObserved;
        let lastCheckpoint = 0;
        let storageState = '可用';
        let baselines = new WeakMap();
        // Observation baselines only; events still use the single bounded call log.
        const shareStates = new Map();
        let shareOrdinal = 0;
        const pendingReceiverIssues = new Set();
        const logListeners = new Set();
        const notifyLogs = () => logListeners.forEach((listener) => {
            try { listener(); } catch { /* A log view must never interrupt media operations. */ }
        });
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
            if (['SFU接收异常诊断', 'SFU接收回退诊断'].includes(type) && Number.isInteger(content?.序号)) pendingReceiverIssues.add(content.序号);
            if (pendingReceiverIssues.size > limits.events) pendingReceiverIssues.delete(pendingReceiverIssues.values().next().value);
            current.事件总数++;
            current.事件.push({ 时间: new Date().toISOString(), 相对开始_ms: Date.now() - Date.parse(current.开始时间), 类型: type, 内容: sanitize(content) });
            if (current.事件.length > limits.events) { current.事件.shift(); current.截断 = true; }
            saveSoon();
            notifyLogs();
            if (['共享路径事件', 'SFU接收回退诊断', 'SFU接收异常诊断', '通话结束'].includes(type)) checkpoint(true);
        };
        const beginShare = (tile, isLocal) => {
            if (!current || !tile) return;
            let state = shareStates.get(tile);
            if (!state) {
                state = { ordinal: ++shareOrdinal, role: isLocal ? '共享者' : '观看者', config: new Map() };
                shareStates.set(tile, state);
                record('共享开始', { 视频序号: state.ordinal, 角色: state.role });
            }
            return state;
        };
        const endShare = (tile) => {
            const state = shareStates.get(tile);
            if (!state) return;
            record('共享停止', { 视频序号: state.ordinal, 角色: state.role });
            shareStates.delete(tile);
        };
        const observeShare = (tile, snapshot) => {
            const state = beginShare(tile, snapshot?.角色 === '共享者');
            if (!state || !snapshot) return;
            const scopedRecord = (type, content) => record(type, { 视频序号: state.ordinal, 角色: state.role, ...content });
            const changed = (key, value, type, content) => {
                if (!value || state.config.get(key) === value) return;
                state.config.set(key, value);
                scopedRecord(type, content);
            };
            for (const connection of snapshot.连接 || []) {
                const key = `${connection.路径}:${connection.序号}`;
                changed(`connection:${key}`, connection.连接状态 || connection.状态, '共享连接状态', { 路径: connection.路径, 状态: connection.连接状态 || connection.状态 });
                changed(`transport:${key}`, connection.实际传输路径, '观看路径切换', { 路径: connection.实际传输路径 });
                if (connection.编码协商?.reason) changed(`codec-reason:${key}`, connection.编码协商.reason, '共享编码回退', { 路径: connection.路径, reason: connection.编码协商.reason, primary: connection.编码协商.primary });
                for (const row of connection.视频流 || []) {
                    if (row.统计状态 === '数据过期') continue;
                    changed(`codec:${key}`, row.编码, '共享编码变化', { 路径: connection.路径, 编码: row.编码 });
                    if (row.宽 > 0 && row.高 > 0) changed(`size:${key}`, `${row.宽}x${row.高}`, '共享分辨率变化', { 路径: connection.路径, 宽: row.宽, 高: row.高 });
                    // Browser freeze counters describe a recorded stall; do not
                    // introduce another FPS threshold or route-health state machine.
                    const count = row.累计卡顿次数;
                    if (Number.isFinite(count)) {
                        const before = state.config.get(`freezes:${key}`);
                        state.config.set(`freezes:${key}`, count);
                        if (before !== undefined && count > before) scopedRecord('共享卡顿记录', {
                            路径: connection.路径, 区间卡顿次数: count - before, 区间卡顿时长_ms: row.区间卡顿时长_ms,
                        });
                    }
                }
            }
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
                    // Reuse the existing SFU health decision and ordinal. No second
                    // low-FPS detector, and no guessed mapping to a video tile.
                    for (const receiver of getReceiverHealth?.()?.活跃接收 || []) {
                        const latest = receiver.健康采样?.at(-1);
                        const age = Date.now() - latest?.采样时间_ms;
                        if (pendingReceiverIssues.has(receiver.序号) && latest?.判定有效 && latest.判定解码帧率 >= 5 && age >= 0 && age < 10000) {
                            pendingReceiverIssues.delete(receiver.序号);
                            record('SFU接收恢复诊断', { 序号: receiver.序号, 时间: latest.采样时间_ms,
                                reason: 'decoded-frames-resumed', 区间解码帧率: latest.判定解码帧率 });
                        }
                    }
                    owned.当前状态 = snapshot;
                    owned.采样总数++;
                    owned.历史采样.push(snapshot);
                    // Keep two startup samples and a longer recent window;
                    // idle join samples must not displace active media evidence.
                    if (owned.历史采样.length > limits.samples) { owned.历史采样.splice(2, 1); owned.截断 = true; }
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
            checkpoint();
            timer = global.setTimeout(tick, Date.now() - Date.parse(owned.开始时间) < 15000 && !global.document.hidden ? 1000 : 5000);
        };
        const end = (reason = '离开语音') => {
            if (!current) return;
            [...shareStates.keys()].forEach(endShare);
            record('通话结束', { 状态: reason });
            current.结束时间 = new Date().toISOString();
            current.结束原因 = reason;
            current = null;
            notifyLogs();
            global.clearTimeout(timer);
            global.clearTimeout(saveTimer);
            persist();
        };
        const start = () => {
            end('开始新通话');
            baselines = new WeakMap();
            shareStates.clear();
            pendingReceiverIssues.clear();
            shareOrdinal = 0;
            lastObserved = null;
            lastCheckpoint = 0;
            current = { 开始时间: new Date().toISOString(), 结束时间: null, 事件总数: 0, 采样总数: 0, 事件: [], 历史采样: [], 截断: false };
            sessions.push(current);
            sessions = sessions.slice(-limits.sessions);
            record('通话开始', {});
            observe();
            void tick();
        };
        const report = async () => {
            const state = await sample();
            return {
                版本: '1.0.5', 诊断格式: 4,
                // Keep failure evidence ahead of large histories in the relay's
                // bounded allowlist traversal; do not duplicate it per snapshot.
                ...(getReceiverHealth ? { SFU接收健康: sanitize(getReceiverHealth()) } : {}),
                当前状态: state,
                当前会话: current ? sanitize(current) : null,
                存储状态: storageState,
                记录上限: limits,
                日志覆盖说明: '本机最近5次通话；每次最多200事件，保留前2与最近22次采样；不录音。页面关闭仅能记录最后保存时间。',
            };
        };
        // Save a bounded, sanitized checkpoint while both parties are present.
        // It survives a peer leaving before somebody clicks Copy diagnostics.
        const checkpoint = (critical = false) => {
            if (!current?.当前状态 || !socket?.connected || (!critical && Date.now() - lastCheckpoint < 10000)) return;
            const generation = getState()?.会话?.generation;
            if (!generation) return;
            try {
                const value = compactReport({
                    版本: '1.0.5', 诊断格式: 4,
                    SFU接收健康: sanitize(getReceiverHealth?.() || {}),
                    当前状态: current.当前状态, 当前会话: current,
                });
                // The server cache needs the latest sample and health windows,
                // not another copy of the whole rolling history.
                value.当前会话.历史采样 = [];
                value.当前会话.事件 = value.当前会话.事件.slice(-6);
                socket.emit('voice:diagnostics:checkpoint', { voiceSessionGeneration: generation, critical, report: sanitize(value) });
                lastCheckpoint = Date.now();
            } catch { /* Diagnostic delivery must never interrupt a call. */ }
        };
        const handleRequest = async (payload, ack) => {
            const generation = getState()?.会话?.generation;
            if (typeof ack !== 'function' || !current || !generation || payload?.voiceSessionGeneration !== generation) return;
            const owned = current;
            const value = await report().catch(() => null);
            if (current !== owned || getState()?.会话?.generation !== generation) return ack({ ok: false });
            ack({ ok: Boolean(value), voiceSessionGeneration: generation, report: sanitize(compactReport(value)) });
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
                说明: '各端非严格同步；缓存对端会标注时间，不代表当前状态。无原始设备ID、地址、用户名或音频内容。', 本机: compactReport(local),
                对端: remote?.ok ? remote.results.map((row) => row.数据 ? { ...row, 数据: compactReport(row.数据) } : row) : [],
                未响应原因: remote?.ok ? null : remote?.reason || 'collection-failed', 未收集人数: remote?.omitted || 0 };
        };
        const copyCombined = async (button) => {
            if (button?.disabled) return;
            global.clearTimeout(copyFeedbackTimer);
            if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '正在收集诊断…'; }
            try {
                const data = await collectCombined();
                const text = JSON.stringify(data, null, 2);
                try { await global.navigator.clipboard.writeText(text); if (button) button.textContent = '诊断已复制'; }
                catch {
                    showText(text);
                    if (button) button.textContent = '请在日志窗口手动复制';
                }
            } catch { if (button) button.textContent = '会话已变化，请重试'; }
            finally {
                if (button) {
                    button.disabled = false;
                    button.setAttribute('aria-busy', 'false');
                    copyFeedbackTimer = global.setTimeout(() => { button.textContent = '复制诊断'; copyFeedbackTimer = null; }, 2000);
                }
            }
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
            beginShare, endShare, observeShare,
            getShareOrdinal: (tile) => shareStates.get(tile)?.ordinal,
            attachSocket(next) { socket?.off?.('voice:diagnostics:sample', handleRequest); socket = next; socket?.on?.('voice:diagnostics:sample', handleRequest); },
            getLogs: () => ({ sessions: sessions.map(sanitize), currentIndex: sessions.indexOf(current), storageState }),
            showLogs: (options = {}) => global.VoicePlayerEvents?.show({
                getLogs: () => ({ sessions: sessions.map(sanitize), currentIndex: sessions.indexOf(current), storageState }),
                subscribe(listener) { logListeners.add(listener); return () => logListeners.delete(listener); },
                showRaw: () => showText(JSON.stringify({ 版本: '1.0.5', 诊断格式: 4, 存储状态: storageState, 通话: sessions.map(sanitize) }, null, 2)),
                ...options,
            }),
            clearLogs() { sessions = current ? [current] : []; persist(); notifyLogs(); },
            destroy() { end('页面关闭'); global.clearTimeout(copyFeedbackTimer); socket?.off?.('voice:diagnostics:sample', handleRequest); },
        };
    };
    global.VoiceCallDiagnostics = { createRuntime, audioSummary, compactReport };
})(window);
