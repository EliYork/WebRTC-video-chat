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
        return {
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
    const remove = (tile) => {
        const state = panels.get(tile);
        if (!state) return;
        state.disposed = true;
        state.video?.cancelVideoFrameCallback?.(state.frameCallback);
        state.panel.remove();
        panels.delete(tile);
    };
    const sync = (source) => {
        const tile = source?.tile;
        if (!tile || !source.isScreenSharing) return;
        let state = panels.get(tile);
        if (!state) {
            const panel = global.document.createElement('details');
            panel.className = 'share-diagnostics no-drag';
            const summary = global.document.createElement('summary');
            summary.textContent = '共享诊断';
            const note = global.document.createElement('p');
            note.textContent =
                '每秒采样；null = 待采样或不支持。显示帧率指提交合成器。QP 仅适合同编码对比。编码能效报告不证明硬件选择或性能。SFU仅提供RTP包统计，不提供编码/解码帧率。需对比同一时段双端采样；静止画面低帧率不代表故障。';
            const copy = global.document.createElement('button');
            copy.type = 'button';
            copy.textContent = '复制脱敏诊断';
            const output = global.document.createElement('pre');
            output.tabIndex = 0;
            output.textContent =
                '展开后等待两个采样周期，复现模糊或卡顿再复制。';
            panel.append(summary, note, copy, output);
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
            };
            panels.set(tile, state);
            panel.addEventListener('toggle', () => {
                if (!panel.open) {
                    state.video?.cancelVideoFrameCallback?.(
                        state.frameCallback
                    );
                    state.video = null;
                    state.playbackBaseline = null;
                    state.baselines = new WeakMap();
                }
            });
            copy.addEventListener('click', async () => {
                try {
                    await global.navigator.clipboard.writeText(
                        output.textContent
                    );
                    copy.textContent = '已复制';
                } catch {
                    copy.textContent = '复制失败，请选中下方文本复制';
                }
            });
        }
        if (!state.panel.open || state.busy) return;
        state.busy = true;
        if (state.video !== source.video) {
            state.video?.cancelVideoFrameCallback?.(state.frameCallback);
            state.video = source.video;
            state.presentedFrames = null;
            state.playbackBaseline = null;
            const video = source.video;
            const frame = (_, metadata) => {
                if (
                    state.disposed ||
                    state.video !== video ||
                    !state.panel.open
                )
                    return;
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
        const snapshot = {
            版本: '1.0.5',
            诊断格式: 3,
            角色: source.isLocal ? '共享者' : '观看者',
            ...(source.isLocal ? {} : { 观看路径: source.screenRoute || 'P2P' }),
            采样时间: new Date().toISOString(),
            SFU服务器统计: source.serverHealth || null,
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
            },
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
                    .then(() => pc.getStats())
                    .then(resolve, reject)
                    .finally(() => global.clearTimeout(timer));
            });
        void Promise.all(
            connections.map(async (pc, index) => {
                if (!pc?.getStats)
                    return { 序号: index + 1, 状态: '统计暂不可用' };
                try {
                    const stats = await readStats(pc);
                    const reports = [];
                    stats.forEach((item) => reports.push(item));
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
                    state.baselines.set(pc, next);
                    return {
                        序号: index + 1,
                        路径: pc.screenRoute === 'SFU' ? 'SFU' : 'P2P',
                        发送参数核对: source.isLocal ? global.VoiceScreenSendPolicy?.getReadback(pc) || [] : [],
                        状态: streams.length ? '已采样' : '等待视频统计',
                        视频流: streams,
                    };
                } catch {
                    state.baselines.delete(pc);
                    return {
                        序号: index + 1,
                        状态: '统计读取失败或超时，下次重试',
                    };
                }
            })
        )
            .then((results) => {
                if (!state.disposed && panels.get(tile) === state) {
                    snapshot.连接 = results;
                    state.output.textContent = JSON.stringify(
                        snapshot,
                        null,
                        2
                    );
                }
            })
            .finally(() => {
                state.busy = false;
            });
    };
    global.VoiceShareDiagnostics = { summarize, sync, remove };
})(window);
