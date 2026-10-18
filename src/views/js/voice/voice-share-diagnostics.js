(function exposeShareDiagnostics(global) {
    'use strict';

    // Export only these derived fields, never raw RTC reports/IDs/candidates.
    const number = (value) => (Number.isFinite(value) ? value : null);
    const rounded = (value) =>
        value === null ? null : Math.round(value * 100) / 100;
    const delta = (report, previous, key) =>
        previous &&
        report.id === previous.id &&
        report.timestamp > previous.timestamp &&
        number(report[key]) !== null &&
        number(previous[key]) !== null &&
        report[key] >= previous[key]
            ? report[key] - previous[key]
            : null;
    const summarize = (reports, report, previous, previousCapture) => {
        const sending = report.type === 'outbound-rtp';
        const elapsed = previous
            ? (report.timestamp - previous.timestamp) / 1000
            : 0;
        const rate = (key, factor = 1) => {
            const change = delta(report, previous, key);
            return change === null || elapsed <= 0
                ? null
                : rounded((change * factor) / elapsed);
        };
        const codec = reports.find((item) => item.id === report.codecId);
        const transport = reports.find(
            (item) => item.id === report.transportId
        );
        const pair = reports.find(
            (item) => item.id === transport?.selectedCandidatePairId
        );
        const remoteCandidate = reports.find((item) => item.id === pair?.remoteCandidateId);
        const remote = reports.find((item) => item.id === report.remoteId);
        const capture = reports.find(
            (item) => item.id === report.mediaSourceId
        );
        const captureFrames = capture ? delta(capture, previousCapture, 'frames') : null;
        const captureFps = captureFrames !== null && capture.timestamp > previousCapture.timestamp
            ? rounded(captureFrames * 1000 / (capture.timestamp - previousCapture.timestamp)) : null;
        const received = delta(report, previous, 'packetsReceived');
        const lost = delta(report, previous, 'packetsLost');
        const frames = delta(
            report,
            previous,
            sending ? 'framesEncoded' : 'framesDecoded'
        );
        const duration = delta(
            report,
            previous,
            sending ? 'totalEncodeTime' : 'totalDecodeTime'
        );
        const average = (total, count, factor = 1) => {
            const sum = delta(report, previous, total);
            const n = delta(report, previous, count);
            return sum !== null && n > 0 ? rounded((sum * factor) / n) : null;
        };
        const metricKeys = sending
            ? { 区间采集帧率: [capture, previousCapture, 'frames'], 区间编码帧率: [report, previous, 'framesEncoded'], 区间发送帧率: [report, previous, 'framesSent'] }
            : { 区间完整接收帧率: [report, previous, 'framesReceived'], 区间解码帧率: [report, previous, 'framesDecoded'] };
        metricKeys.码率_Mbps = [report, previous, sending ? 'bytesSent' : 'bytesReceived'];
        const metricStates = Object.fromEntries(Object.entries(metricKeys).map(([key, [now, before, counter]]) => [key,
            number(now?.[counter]) === null ? '未提供' : !before || now.id !== before.id || now[counter] < before[counter]
                ? '未采样' : now.timestamp <= before.timestamp ? '数据过期' : number(before[counter]) === null ? '未采样' : '已采样']));
        return {
            指标状态: metricStates,
            统计状态: previous && report.id === previous.id && report.timestamp <= previous.timestamp ? '数据过期' : '已采样',
            方向: sending ? '发送' : '接收',
            传输协议: ['udp', 'tcp'].includes(remoteCandidate?.protocol) ? remoteCandidate.protocol : null,
            编码: /^video\/(VP8|VP9|H264|H265|AV1|AV1X)$/i.test(
                codec?.mimeType || ''
            )
                ? codec.mimeType
                : null,
            宽: number(report.frameWidth),
            高: number(report.frameHeight),
            ...(sending
                ? { 采集实际帧率: number(capture?.framesPerSecond),
                    区间采集帧率: captureFps,
                    编码能效报告: typeof report.powerEfficientEncoder === 'boolean' ? report.powerEfficientEncoder : null }
                : {}),
            实际帧率:
                number(report.framesPerSecond) ??
                rate(sending ? 'framesEncoded' : 'framesDecoded'),
            浏览器报告帧率: number(report.framesPerSecond),
            帧率口径: sending
                ? '编码帧率（兼容旧字段）'
                : '解码帧率（不是网络收帧率）',
            采样间隔_ms:
                previous && report.id === previous.id && elapsed > 0
                    ? rounded(elapsed * 1000)
                    : null,
            ...(sending
                ? {
                      区间编码帧率: rate('framesEncoded'),
                      区间发送帧率: rate('framesSent'),
                      编码目标码率_Mbps:
                          number(report.targetBitrate) === null
                              ? null
                              : rounded(report.targetBitrate / 1000000),
                      区间重传码率_Mbps: rate(
                          'retransmittedBytesSent',
                          8 / 1000000
                      ),
                      每包发送等待_ms: average(
                          'totalPacketSendDelay',
                          'packetsSent',
                          1000
                      ),
                  }
                : {
                      区间完整接收帧率: rate('framesReceived'),
                      区间解码帧率: rate('framesDecoded'),
                      区间卡顿次数: delta(report, previous, 'freezeCount'),
                      区间卡顿时长_ms:
                          delta(report, previous, 'totalFreezesDuration') ===
                          null
                              ? null
                              : rounded(
                                    delta(
                                        report,
                                        previous,
                                        'totalFreezesDuration'
                                    ) * 1000
                                ),
                      每帧抖动缓冲等待_ms: average(
                          'jitterBufferDelay',
                          'jitterBufferEmittedCount',
                          1000
                      ),
                      每帧目标缓冲等待_ms: average(
                          'jitterBufferTargetDelay',
                          'jitterBufferEmittedCount',
                          1000
                      ),
                      每帧组装耗时_ms: average(
                          'totalAssemblyTime',
                          'framesAssembledFromMultiplePackets',
                          1000
                      ),
                  }),
            区间平均QP: average(
                'qpSum',
                sending ? 'framesEncoded' : 'framesDecoded'
            ),
            区间NACK次数: delta(report, previous, 'nackCount'),
            区间PLI次数: delta(report, previous, 'pliCount'),
            码率_Mbps: rate(
                sending ? 'bytesSent' : 'bytesReceived',
                8 / 1000000
            ),
            '区间丢包率_%':
                received !== null && lost !== null && received + lost > 0
                    ? rounded((lost * 100) / (received + lost))
                    : null,
            累计丢包: number(
                sending ? remote?.packetsLost : report.packetsLost
            ),
            抖动_ms: rounded(
                number(sending ? remote?.jitter : report.jitter) === null
                    ? null
                    : (sending ? remote.jitter : report.jitter) * 1000
            ),
            往返延迟_ms: rounded(
                number(pair?.currentRoundTripTime) === null
                    ? null
                    : pair.currentRoundTripTime * 1000
            ),
            本端连接估计可用上行_Mbps: rounded(
                number(pair?.availableOutgoingBitrate) === null
                    ? null
                    : pair.availableOutgoingBitrate / 1000000
            ),
            每帧编解码_ms:
                frames > 0 && duration !== null
                    ? rounded((duration * 1000) / frames)
                    : null,
            区间解码丢帧: sending
                ? null
                : delta(report, previous, 'framesDropped'),
            累计卡顿次数: sending ? null : number(report.freezeCount),
            编码受限原因:
                sending &&
                ['none', 'cpu', 'bandwidth', 'other'].includes(
                    report.qualityLimitationReason
                )
                    ? report.qualityLimitationReason
                    : null,
        };
    };
    const panels = new WeakMap();
    const remove = (tile, { ended = true } = {}) => {
        const state = panels.get(tile);
        if (!state) return;
        state.disposed = true;
        state.video?.cancelVideoFrameCallback?.(state.frameCallback);
        state.view?.remove();
        global.VoicePlayerMenu?.remove(tile);
        state.panel.remove();
        panels.delete(tile);
        if (ended) global.document.dispatchEvent?.(new global.CustomEvent('voice:share-ended', { detail: { tile } }));
    };
    const sync = (source, { force = false } = {}) => {
        const tile = source?.tile;
        if (!tile || !source.isScreenSharing) return;
        global.VoicePlayerMenu?.sync(source);
        if (!source.isLocal) source.routeControl?.observe?.(source.pc);
        let state = panels.get(tile);
        if (!state) {
            const panel = global.document.createElement('details');
            panel.className = 'share-diagnostics no-drag';
            panel.hidden = true; // Cached collector; readable presentation lives in the video overlay.
            const summary = global.document.createElement('summary');
            summary.textContent = '共享诊断';
            const note = global.document.createElement('p');
            note.textContent =
                '每秒采样；null = 待采样或不支持。显示帧率指提交合成器。QP 仅适合同编码对比。编码能效报告不证明硬件选择或性能。SFU仅提供RTP包统计，不提供编码/解码帧率。需对比同一时段双端采样；静止画面低帧率不代表故障。';
            const output = global.document.createElement('pre');
            output.tabIndex = 0;
            output.textContent =
                '展开后等待两个采样周期；复现模糊或卡顿后，可从页面右上角复制诊断。';
            panel.append(summary, note, output);
            panel.addEventListener('dblclick', (event) =>
                event.stopPropagation()
            );
            tile.append(panel);
            state = {
                panel,
                output,
                baselines: new WeakMap(),
                disposed: false,
                busy: false,
                view: global.VoiceShareStatsView?.create(tile),
            };
            panels.set(tile, state);
            global.document.dispatchEvent?.(new global.CustomEvent('voice:share-started', { detail: { tile, isLocal: source.isLocal } }));
            panel.addEventListener('toggle', () => {
                if (!panel.open && !state.autoSampling) {
                    state.video?.cancelVideoFrameCallback?.(
                        state.frameCallback
                    );
                    state.video = null;
                    state.playbackBaseline = null;
                    state.baselines = new WeakMap();
                }
            });
        }
        if (state.sourceStream !== source.stream || state.sourcePc !== source.pc || state.sourceVideo !== source.video) {
            state.sourceStream = source.stream;
            state.sourcePc = source.pc;
            state.sourceVideo = source.video;
            state.epoch = (state.epoch || 0) + 1;
            state.snapshot = undefined;
            state.baselines = new WeakMap();
            state.playbackBaseline = null;
        }
        // Repaint ages at the existing sampling cadence, including failed/in-flight reads.
        state.view?.update(state.snapshot);
        if ((!force && !state.panel.open && !state.view?.isVisible()) || state.busy) return state.pending;
        if (force) state.autoSampling = true;
        state.busy = true;
        const epoch = state.epoch;
        if (state.video !== source.video || state.frameCallback == null) {
            state.video?.cancelVideoFrameCallback?.(state.frameCallback);
            state.video = source.video;
            state.presentedFrames = null;
            state.playbackBaseline = null;
            const video = source.video;
            const frame = (_, metadata) => {
                if (
                    state.disposed ||
                    state.video !== video ||
                    (!state.panel.open && !state.autoSampling && !state.view?.isVisible())
                ) {
                    state.frameCallback = null;
                    return;
                }
                state.presentedFrames = metadata.presentedFrames;
                state.frameCallback = video.requestVideoFrameCallback(frame);
            };
            state.frameCallback = video?.requestVideoFrameCallback?.(frame);
        }
        const playback = {
            id: 'playback',
            timestamp: global.performance?.now?.() ?? Date.now(),
            presented: state.presentedFrames,
            dropped:
                source.video?.getVideoPlaybackQuality?.().droppedVideoFrames,
        };
        const lastPlayback = state.playbackBaseline;
        const presentedDelta = delta(playback, lastPlayback, 'presented');
        const displayedFps =
            presentedDelta === null
                ? null
                : rounded(
                      (presentedDelta * 1000) /
                          (playback.timestamp - lastPlayback.timestamp)
                  );
        state.playbackBaseline = playback;
        const track = source.stream
            ?.getVideoTracks?.()
            .find((item) => item.readyState !== 'ended');
        const settings = track?.getSettings?.() || {};
        const connections = source.isLocal
            ? source.outgoingConnections || []
            : [source.pc];
        const audio = source.localAudioProcessing;
        const processing = audio?.state;
        const snapshot = {
            版本: '1.0.5',
            诊断格式: 4,
            角色: source.isLocal ? '共享者' : '观看者',
            ...(source.isLocal ? {} : { 观看路径: source.screenRoute || 'P2P' }),
            采样时间: new Date().toISOString(),
            SFU服务器统计: source.serverHealth || null,
            本机音频: {
                请求模式: audio?.requestedMode || null,
                实际模式: processing?.mode || null,
                降噪模型: processing?.engine || null,
                模型回退: processing?.engineFallback || null,
                模型预检p95_ms: processing?.probeP95Ms ?? null,
                麦克风增益_百分比: number(audio?.microphoneGain),
                浏览器降噪: processing?.actual?.noiseSuppression ?? null,
                AEC: processing?.actual?.echoCancellation ?? null,
                AEC采集方式: processing?.aecAcquisition || null,
                AEC回退: processing?.aecFallback || null,
                自动增益: processing?.actual?.autoGainControl ?? null,
                非语音门控启用: Boolean(processing?.speechGateSupported && processing?.speechGateEnabled),
                处理器回退: processing?.fallbackReason || null,
                最近切换失败: processing?.lastSwitchFailure || null,
                麦克风存活: processing?.sourceLive ?? null,
                放大播放: source.outputGain || null,
            },
            共享路径变化: source.routeStatus || null,
            ...(source.isLocal ? { 共享音频采集: source.captureAudio || global.VoiceMediaLifecycle?.describeScreenAudio(source.stream) || null } : {}),
            ...(source.isLocal
                ? {
                      采集轨道设置: {
                          宽: number(settings.width),
                          高: number(settings.height),
                          帧率: number(settings.frameRate),
                      },
                      共享目标: source.shareOptions || null,
                      编码器选择: source.codecDecision || null,
                  }
                : {}),
            播放画面: {
                宽: number(source.video?.videoWidth),
                高: number(source.video?.videoHeight),
                提交合成器帧率: displayedFps,
                区间播放丢帧: delta(playback, lastPlayback, 'dropped'),
                暂停: Boolean(source.video?.paused),
                就绪状态: number(source.video?.readyState),
                页面后台: Boolean(global.document.hidden),
                预览隐藏: Boolean(source.isLocal && source.previewHidden),
            },
            播放指标状态: typeof source.video?.requestVideoFrameCallback !== 'function' ? '不支持' : displayedFps === null ? '未采样' : '已采样',
            连接: [],
        };
        // One bounded read per connection. A stalled browser promise must not
        // freeze subsequent samples or retain an ended share's UI forever.
        const readStats = (pc) =>
            new Promise((resolve, reject) => {
                const timer = global.setTimeout(
                    () => reject(new Error('timeout')),
                    2500
                );
                Promise.resolve()
                    .then(() => pc.getStats(source.isLocal ? undefined : track))
                    .then(resolve, reject)
                    .finally(() => global.clearTimeout(timer));
            });
        state.pending = Promise.all(
            connections.map(async (pc, index) => {
                if (!pc?.getStats)
                    return { 序号: index + 1, 状态: '统计暂不可用' };
                try {
                    const stats = await readStats(pc);
                    const reports = [];
                    stats.forEach((item) => reports.push(item));
                    if (!source.isLocal && !state.disposed && state.epoch === epoch) source.routeControl?.observe?.(pc, reports);
                    if (!state.disposed && state.epoch === epoch) global.VoiceScreenCodecs?.observeConnection?.(pc, reports);
                    const previous = state.baselines.get(pc) || new Map();
                    const next = new Map();
                    const videoReports = reports.filter(
                        (item) =>
                            item.type ===
                                (source.isLocal
                                    ? 'outbound-rtp'
                                    : 'inbound-rtp') &&
                            (item.kind === 'video' ||
                                item.mediaType === 'video') &&
                            !item.isRemote
                    );
                    const streams = videoReports.map((report) => {
                        const result = summarize(
                            reports,
                            report,
                            previous.get(report.id),
                            previous.get(report.mediaSourceId)
                        );
                        next.set(report.id, report);
                        const capture = reports.find((item) => item.id === report.mediaSourceId);
                        if (capture) next.set(capture.id, capture);
                        return result;
                    });
                    if (state.epoch === epoch) state.baselines.set(pc, next);
                    return {
                        序号: index + 1,
                        路径: pc.screenRoute === 'SFU' ? 'SFU' : 'P2P',
                        实际传输路径: global.VoiceScreenCodecs?.describePath?.(pc, reports) || 'unknown',
                        连接状态: pc.connectionState || null,
                        ICE状态: pc.iceConnectionState || null,
                        编码协商: global.VoiceScreenCodecs?.getConnectionState?.(pc) || null,
                        发送参数核对: source.isLocal ? global.VoiceScreenSendPolicy?.getReadback(pc) || [] : [],
                        状态: streams.length ? '已采样' : '等待视频统计',
                        视频流: streams,
                    };
                } catch {
                    if (!state.disposed && state.epoch === epoch) global.VoiceScreenCodecs?.observeConnection?.(pc, []);
                    if (state.epoch === epoch) state.baselines.delete(pc);
                    return {
                        序号: index + 1,
                        状态: '统计读取失败或超时，下次重试',
                    };
                }
            })
        )
            .then((results) => {
                if (!state.disposed && panels.get(tile) === state && state.epoch === epoch) {
                    snapshot.连接 = results;
                    if (state.panel.open) state.output.textContent = JSON.stringify(
                        snapshot,
                        null,
                        2
                    );
                    state.snapshot = snapshot;
                    source.onSample?.(snapshot);
                    state.view?.update(snapshot);
                    global.document.dispatchEvent?.(new global.CustomEvent('voice:share-sample', { detail: { tile, snapshot } }));
                }
                return state.epoch === epoch ? snapshot : undefined;
            })
            .finally(() => {
                state.busy = false;
            });
        return state.pending;
    };
    global.VoiceShareDiagnostics = {
        summarize, sync, remove,
        getCached: (tile) => panels.get(tile)?.snapshot,
        isVisible: (tile) => Boolean(panels.get(tile)?.view?.isVisible()),
        toggle: (tile) => panels.get(tile)?.view?.toggle(),
    };
})(window);
