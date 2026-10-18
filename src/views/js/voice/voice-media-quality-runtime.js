(function exposeVoiceMediaQualityRuntime(global) {
    'use strict';

    const SAMPLE_MS = 1000;
    const HIDDEN_SAMPLE_MS = 4000;
    const STANDARD_RESOLUTIONS = new Map([
        ['1280x720', '720p'],
        ['1920x1080', '1080p'],
        ['2560x1440', '1440p'],
        ['3840x2160', '4K'],
    ]);

    const isLiveVideoTrack = (track) =>
        track?.kind === 'video' && track.readyState !== 'ended';
    const getLiveVideoTrack = (stream) =>
        (stream?.getVideoTracks?.() || []).find(isLiveVideoTrack);
    const isClosedPc = (pc) =>
        ['closed', 'failed'].includes(pc?.connectionState) ||
        ['closed', 'failed'].includes(pc?.iceConnectionState);
    const roundPositive = (value) => {
        const number = Math.round(Number(value));
        return Number.isFinite(number) && number > 0 ? number : undefined;
    };
    const formatResolution = (width, height) => {
        const w = roundPositive(width);
        const h = roundPositive(height);
        if (!w || !h) {
            return '';
        }
        return STANDARD_RESOLUTIONS.get(`${w}x${h}`) || `${w}×${h}`;
    };
    const formatLabel = ({ fps, height, width } = {}) => {
        const parts = [];
        const resolution = formatResolution(width, height);
        const roundedFps = Number.isFinite(fps) && fps >= 0 ? Math.round(fps) : undefined;
        if (resolution) {
            parts.push(resolution);
        }
        if (roundedFps !== undefined) {
            parts.push(`${roundedFps}fps`);
        }
        return parts.join(' · ');
    };
    const getReportValue = (report, keys) => {
        for (const key of keys) {
            if (Number(report?.[key]) > 0) {
                return Number(report[key]);
            }
        }
        return undefined;
    };
    const toStatsArray = (stats) =>
        typeof stats?.forEach === 'function'
            ? (() => {
                  const values = [];
                  stats.forEach((value) => values.push(value));
                  return values;
              })()
            : Array.isArray(stats)
              ? stats
              : [];
    const getCounter = (report, key) =>
        Number.isFinite(report?.[key]) && report[key] >= 0 ? report[key] : undefined;
    const selectInboundVideoReport = (stats, track) =>
        toStatsArray(stats)
            .filter(
                (report) =>
                    report?.type === 'inbound-rtp' &&
                    (report.kind === 'video' || report.mediaType === 'video') &&
                    !report.isRemote
            )
            .sort((a, b) => {
                // SFU transport stats include every receiver, including idle
                // RTP rows. Compare like counters, and prefer the playing track.
                const match = Number(b.trackIdentifier === track?.id && Boolean(track?.id)) -
                    Number(a.trackIdentifier === track?.id && Boolean(track?.id));
                return match || Number(b.framesDecoded || 0) - Number(a.framesDecoded || 0) ||
                    Number(b.framesReceived || 0) - Number(a.framesReceived || 0) ||
                    Number(b.bytesReceived || 0) - Number(a.bytesReceived || 0);
            })[0];
    const buildSample = ({ report, state, video, track }) => {
        const width =
            getReportValue(report, ['framesWidth', 'frameWidth']) ||
            roundPositive(video?.videoWidth) ||
            roundPositive(track?.getSettings?.().width);
        const height =
            getReportValue(report, ['framesHeight', 'frameHeight']) ||
            roundPositive(video?.videoHeight) ||
            roundPositive(track?.getSettings?.().height);
        const timestamp = Number(report?.timestamp);
        if (report && Number.isFinite(timestamp)) {
            const last = state.reportTime;
            state.reportTime = { id: report.id, timestamp };
            if (last && last.id === report.id && timestamp <= last.timestamp) {
                state.baseline = null;
                state.fpsSamples = [];
                return { height, width, status: '数据过期', fpsSource: '视频' };
            }
        }
        let fps = getCounter(report, 'framesPerSecond');
        const frameKey = getCounter(report, 'framesDecoded') !== undefined ? 'framesDecoded' : 'framesReceived';
        const fpsSource = fps !== undefined || frameKey === 'framesDecoded' ? '解码' : '完整接收';
        const frames = getCounter(report, frameKey);
        const sameReport = state.baseline?.id === report?.id && state.baseline?.frameKey === frameKey;
        if (!sameReport || (frames !== undefined && frames < state.baseline?.frames)) state.fpsSamples = [];
        if (
            fps === undefined &&
            frames !== undefined &&
            sameReport &&
            state.baseline?.frames !== undefined &&
            timestamp > state.baseline.timestamp
        ) {
            const seconds = (timestamp - state.baseline.timestamp) / 1000;
            const delta = frames - state.baseline.frames;
            if (seconds > 0 && delta >= 0) {
                fps = delta / seconds;
            }
        }
        if (frames !== undefined && Number.isFinite(timestamp)) {
            state.baseline = {
                id: report.id,
                frameKey,
                frames,
                timestamp,
            };
        }
        if (fps !== undefined) {
            // A stopped decoder must not retain an earlier healthy FPS badge.
            if (fps === 0) state.fpsSamples = [];
            state.fpsSamples.push(fps);
            state.fpsSamples = state.fpsSamples.slice(-3);
            fps =
                state.fpsSamples.reduce((sum, value) => sum + value, 0) /
                state.fpsSamples.length;
        }
        return { fps, height, width, fpsSource: fps === undefined ? '视频' : fpsSource };
    };

    const createRuntime = ({
        debug,
        document: documentRef = global.document,
        getQualitySource,
        view,
    } = {}) => {
        const states = new Map();
        const getPlaybackSample = (state, source) => {
            const video = source.video;
            const quality = video?.getVideoPlaybackQuality?.();
            // totalVideoFrames includes dropped frames: never call it playback FPS.
            const frames = Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames)
                ? quality.totalVideoFrames - quality.droppedVideoFrames : undefined;
            const timestamp = global.performance?.now?.() ?? Date.now();
            const previous = state.playbackBaseline;
            let fps;
            if (Number.isFinite(frames) && previous && timestamp > previous.timestamp && frames >= previous.frames) {
                fps = Math.round((frames - previous.frames) * 1000 / (timestamp - previous.timestamp));
            }
            state.playbackBaseline = Number.isFinite(frames) ? { frames, timestamp } : null;
            return { fps, width: video?.videoWidth, height: video?.videoHeight, fpsSource: '播放计数（非提交）' };
        };
        const renderSample = (state, sample) => {
            const label = view?.render?.(state.tile, [formatLabel(sample), sample.status || (sample.fps === undefined ? '帧率不可用/待采样' : '')].filter(Boolean).join(' · '), sample.fpsSource || '视频');
            if (label) label.title = `${sample.fpsSource || '视频'}帧率；RTC 帧率为最近至多 3 次有效采样的均值。播放计数回退扣除丢帧，不等同于合成器提交。各阶段实测值请打开视频统计。`;
        };
        const renderPlaybackSample = (state, source) => {
            renderSample(state, getPlaybackSample(state, source));
        };
        const logOnce = (state, event) => {
            if (!state.logged.has(event.event)) {
                state.logged.add(event.event);
                debug?.(event);
            }
        };
        const stop = (peerId, reason = 'stopped', { remove = false } = {}) => {
            const state = states.get(peerId);
            if (!state) return;
            if (state.timer) global.clearTimeout(state.timer);
            state.generation += 1;
            global.VoiceShareDiagnostics?.remove(state.tile, { ended: reason !== 'source-replaced' });
            view?.hide?.(state.tile);
            if (reason !== 'source-replaced') view?.removeRoute?.(state.tile);
            if (remove) view?.remove?.(state.tile);
            states.delete(peerId);
            debug?.({ event: 'quality-hidden', reason });
        };
        const schedule = (peerId, state) => {
            if (state.timer) global.clearTimeout(state.timer);
            state.timer = global.setTimeout(
                () => void sample(peerId, state.generation),
                documentRef?.hidden ? HIDDEN_SAMPLE_MS : SAMPLE_MS
            );
        };
        const sample = async (peerId, generation) => {
            const state = states.get(peerId);
            if (!state || state.generation !== generation) return;
            const source = getQualitySource?.(peerId);
            if (source?.isScreenSharing && !source.isLocal) source.routeControl?.observe?.(source.pc);
            if (!source?.isLocal) view?.renderRoute?.(state.tile, source?.routeControl);
            const track = getLiveVideoTrack(source?.stream);
            if (source?.isScreenSharing && track &&
                (source.stream !== state.stream || track !== state.track || source.pc !== state.pc)) {
                syncPeer(peerId);
                return;
            }
            if (
                !source?.isScreenSharing ||
                !track ||
                source.stream !== state.stream ||
                (!source.isLocal &&
                    source.video?.srcObject !== source.stream) ||
                isClosedPc(source.pc)
            ) {
                stop(peerId, 'source-invalid');
                return;
            }
            if (source.isLocal) {
                global.VoiceShareDiagnostics?.sync(source);
                const options = source.shareOptions || {};
                const resolution =
                    { auto: '自动', original: '原始分辨率' }[
                        options.resolutionPreset
                    ] || options.resolutionPreset;
                const fps = roundPositive(options.frameRate);
                const label = [
                    resolution,
                    fps ? `${fps}fps` : '',
                ]
                    .filter(Boolean)
                    .join(' · ');
                view?.render?.(state.tile, label, '共享目标');
                schedule(peerId, state);
                return;
            }
            if (typeof source.pc?.getStats !== 'function') {
                global.VoiceShareDiagnostics?.sync(source);
                renderPlaybackSample(state, source);
                logOnce(state, { event: 'stats-unavailable' });
                schedule(peerId, state);
                return;
            }
            const playback = getPlaybackSample(state, source);
            try {
                global.VoiceShareDiagnostics?.sync(source);
                const stats = await source.pc.getStats(track);
                if (
                    states.get(peerId) !== state ||
                    state.generation !== generation
                ) {
                    debug?.({ event: 'stale-sample-ignored' });
                    return;
                }
                const report = selectInboundVideoReport(stats, track);
                source.routeControl?.observe?.(source.pc, stats);
                global.VoiceScreenCodecs?.observeConnection?.(source.pc, stats);
                const quality = buildSample({ report, state, track, video: source.video });
                if (!quality.status && quality.fps === undefined && playback.fps !== undefined) {
                    quality.fps = playback.fps;
                    quality.fpsSource = playback.fpsSource;
                }
                renderSample(state, quality);
                if (quality.fps !== undefined) {
                    logOnce(state, { event: 'first-valid-quality-sample' });
                }
            } catch (error) {
                if (states.get(peerId) !== state) return;
                renderSample(state, playback);
                logOnce(state, {
                    errorType: error?.name || 'Error',
                    event: 'getStats-failed',
                });
            }
            const next = states.get(peerId);
            if (next === state && next.generation === generation) schedule(peerId, next);
        };
        const syncPeer = (peerId) => {
            const source = getQualitySource?.(peerId);
            const track = getLiveVideoTrack(source?.stream);
            if (
                !peerId ||
                !source?.isScreenSharing ||
                !track ||
                !source.tile ||
                !source.video ||
                (!source.isLocal && source.video.srcObject !== source.stream) ||
                isClosedPc(source.pc)
            ) {
                stop(peerId, 'not-screen-live');
                return;
            }
            const current = states.get(peerId);
            const key = `${source.generation || 0}:${track}:${source.pc}`;
            if (
                current?.key === key &&
                current.track === track &&
                current.pc === source.pc &&
                current.tile === source.tile &&
                current.stream === source.stream
            ) {
                global.VoiceShareDiagnostics?.sync(source);
                return;
            }
            stop(peerId, current ? 'source-replaced' : 'source-starting');
            const state = {
                baseline: null,
                fpsSamples: [],
                generation: 1,
                key,
                logged: new Set(),
                stream: source.stream,
                track,
                pc: source.pc,
                tile: source.tile,
                timer: null,
            };
            states.set(peerId, state);
            if (!source.isLocal) view?.renderRoute?.(state.tile, source.routeControl);
            global.VoiceShareDiagnostics?.sync(source);
            if (!source.isLocal) view?.render?.(state.tile, '画质待采样');
            debug?.({
                event: current
                    ? 'quality-source-replaced'
                    : 'quality-sampling-started',
            });
            schedule(peerId, state);
        };
        documentRef?.addEventListener?.('visibilitychange', () => {
            states.forEach((state, peerId) => schedule(peerId, state));
        });
        return {
            formatLabel,
            formatResolution,
            getActivePeerCount: () => states.size,
            stop,
            syncPeer,
        };
    };

    global.VoiceMediaQualityRuntime = {
        createRuntime,
        formatLabel,
        formatResolution,
    };
})(window);
