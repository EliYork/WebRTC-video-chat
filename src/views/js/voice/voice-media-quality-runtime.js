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
        const roundedFps = roundPositive(fps);
        if (resolution) {
            parts.push(resolution);
        }
        if (roundedFps) {
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
    const selectInboundVideoReport = (stats, previous) =>
        toStatsArray(stats)
            .filter(
                (report) =>
                    report?.type === 'inbound-rtp' &&
                    (report.kind === 'video' || report.mediaType === 'video') &&
                    !report.isRemote
            )
            .sort((a, b) => {
                const aGrowth =
                    Number(
                        a.framesDecoded ||
                            a.framesReceived ||
                            a.bytesReceived ||
                            0
                    ) - Number(previous?.frames || previous?.bytes || 0);
                const bGrowth =
                    Number(
                        b.framesDecoded ||
                            b.framesReceived ||
                            b.bytesReceived ||
                            0
                    ) - Number(previous?.frames || previous?.bytes || 0);
                return bGrowth - aGrowth;
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
        let fps = getReportValue(report, ['framesPerSecond']);
        const frames = getReportValue(report, [
            'framesDecoded',
            'framesReceived',
        ]);
        const timestamp = Number(report?.timestamp);
        if (
            !fps &&
            frames &&
            state.baseline?.frames &&
            timestamp > state.baseline.timestamp
        ) {
            const seconds = (timestamp - state.baseline.timestamp) / 1000;
            const delta = frames - state.baseline.frames;
            if (seconds > 0 && delta > 0) {
                fps = delta / seconds;
            }
        }
        if (frames && Number.isFinite(timestamp)) {
            state.baseline = {
                bytes: Number(report.bytesReceived || 0),
                frames,
                timestamp,
            };
        }
        if (fps) {
            state.fpsSamples.push(fps);
            state.fpsSamples = state.fpsSamples.slice(-3);
            fps =
                state.fpsSamples.reduce((sum, value) => sum + value, 0) /
                state.fpsSamples.length;
        }
        return { fps, height, width };
    };

    const createRuntime = ({
        debug,
        document: documentRef = global.document,
        getQualitySource,
        view,
    } = {}) => {
        const states = new Map();
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
            view?.hide?.(state.tile);
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
            const track = getLiveVideoTrack(source?.stream);
            if (
                !source?.isScreenSharing ||
                !track ||
                source.stream !== state.stream ||
                source.video?.srcObject !== source.stream ||
                isClosedPc(source.pc)
            ) {
                stop(peerId, 'source-invalid');
                return;
            }
            if (typeof source.pc?.getStats !== 'function') {
                view?.hide?.(state.tile);
                logOnce(state, { event: 'stats-unavailable' });
                schedule(peerId, state);
                return;
            }
            try {
                const stats = await source.pc.getStats(track);
                if (
                    !states.has(peerId) ||
                    states.get(peerId).generation !== generation
                ) {
                    debug?.({ event: 'stale-sample-ignored' });
                    return;
                }
                const report = selectInboundVideoReport(stats, state.baseline);
                const label = formatLabel(
                    buildSample({ report, state, track, video: source.video })
                );
                if (label) {
                    view?.render?.(state.tile, label);
                    logOnce(state, { event: 'first-valid-quality-sample' });
                } else {
                    view?.hide?.(state.tile);
                }
            } catch (error) {
                view?.hide?.(state.tile);
                logOnce(state, {
                    errorType: error?.name || 'Error',
                    event: 'getStats-failed',
                });
            }
            const next = states.get(peerId);
            if (next?.generation === generation) schedule(peerId, next);
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
                source.video.srcObject !== source.stream ||
                !source.pc ||
                isClosedPc(source.pc)
            ) {
                stop(peerId, 'not-screen-live');
                return;
            }
            const current = states.get(peerId);
            const key = `${source.generation || 0}:${track}:${source.pc}`;
            if (
                current?.key === key &&
                current.tile === source.tile &&
                current.stream === source.stream
            )
                return;
            stop(peerId, current ? 'source-replaced' : 'source-starting');
            const state = {
                baseline: null,
                fpsSamples: [],
                generation: 1,
                key,
                logged: new Set(),
                stream: source.stream,
                tile: source.tile,
                timer: null,
            };
            states.set(peerId, state);
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
