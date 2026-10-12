(function exposeVoiceMediaLifecycle(global) {
    'use strict';
    const mediaClearListeners = new Set();

    const SCREEN_SHARE_DEFAULTS = Object.freeze({
        frameRate: 60,
        mode: 'game',
        resolutionPreset: '1080p',
    });
    const SCREEN_SHARE_FRAME_RATES = Object.freeze([15, 30, 60]);
    const SCREEN_SHARE_RESOLUTIONS = Object.freeze({
        '720p': { height: 720, width: 1280 },
        '1080p': { height: 1080, width: 1920 },
        '1440p': { height: 1440, width: 2560 },
    });
    const SCREEN_SHARE_RESOLUTION_PRESETS = Object.freeze([
        'auto',
        ...Object.keys(SCREEN_SHARE_RESOLUTIONS),
        'original',
    ]);

    const describeScreenAudio = (stream, supportedConstraints = {}) => {
        const tracks = stream?.getAudioTracks?.() || [];
        const settings = tracks.map((track) => track.getSettings?.() || {});
        const applied = tracks.length && settings.every((value) => value.restrictOwnAudio === true);
        const surface = stream?.getVideoTracks?.()[0]?.getSettings?.().displaySurface;
        return {
            捕获来源: ['monitor', 'window', 'browser'].includes(surface) ? surface : null,
            音频轨道数: tracks.length,
            排除通话声音支持: supportedConstraints.restrictOwnAudio === true,
            请求排除通话声音: Boolean(stream && supportedConstraints.restrictOwnAudio === true),
            实际排除通话声音: tracks.length ? (applied ? true : settings.every((value) => value.restrictOwnAudio === false) ? false : null) : null,
            共享音频状态: !tracks.length ? '未共享声音' : tracks.some((track) => track.readyState !== 'live') ? '音频轨道已结束' :
                applied ? '浏览器已确认排除本通话页面声音；仍需试听' : '未确认排除通话声音；共享系统声音可能回传观看者语音，优先共享独立标签页或窗口声音',
        };
    };

    const normalizeScreenShareOptions = (options = {}) => {
        const requestedFrameRate = Number(options.frameRate);
        const requestedResolution = options.resolutionPreset;
        return {
            mode: options.mode === 'detail' ? 'detail' : 'game',
            codecMode: ['h264', 'vp8'].includes(options.codecMode) ? options.codecMode : 'auto',
            startBitrate: ['1500', '5500'].includes(String(options.startBitrate)) ? String(options.startBitrate) : 'browser',
            frameRate: SCREEN_SHARE_FRAME_RATES.includes(requestedFrameRate)
                ? requestedFrameRate
                : options.mode === 'detail' ? 30 : SCREEN_SHARE_DEFAULTS.frameRate,
            resolutionPreset: SCREEN_SHARE_RESOLUTION_PRESETS.includes(
                requestedResolution
            )
                ? requestedResolution
                : SCREEN_SHARE_DEFAULTS.resolutionPreset,
        };
    };

    const buildScreenCaptureConstraints = (options = {}, supportedConstraints = {}) => {
        const { frameRate, resolutionPreset } =
            normalizeScreenShareOptions(options);
        const frameRateConstraint = {
            ideal: frameRate,
            max: frameRate,
        };
        // Best effort only: unsupported browsers ignore picker hints. Never
        // disable game audio or local playback to hide a conference echo.
        const audioOptions = {
            audio: supportedConstraints.restrictOwnAudio === true ? { restrictOwnAudio: true } : true,
            selfBrowserSurface: 'exclude',
            windowAudio: 'window',
        };

        if (resolutionPreset === 'original') {
            return {
                ...audioOptions,
                video: {
                    frameRate: frameRateConstraint,
                },
            };
        }

        if (resolutionPreset === 'auto') {
            return {
                ...audioOptions,
                video: {
                    frameRate: frameRateConstraint,
                    height: { ideal: 1080 },
                    width: { ideal: 1920 },
                },
            };
        }

        const resolution =
            SCREEN_SHARE_RESOLUTIONS[resolutionPreset] ||
            SCREEN_SHARE_RESOLUTIONS[SCREEN_SHARE_DEFAULTS.resolutionPreset];
        return {
            ...audioOptions,
            video: {
                frameRate: frameRateConstraint,
                height: {
                    ideal: resolution.height,
                    max: resolution.height,
                },
                width: {
                    ideal: resolution.width,
                    max: resolution.width,
                },
            },
        };
    };

    const createMediaSnapshot = ({
        MediaStreamCtor = global.MediaStream,
        microphoneStream,
        screenStream,
        videoTrack,
    } = {}) => {
        const tracks = (microphoneStream?.getAudioTracks?.() || []).filter(
            (track) => track.readyState === 'live'
        );

        tracks.push(
            ...(screenStream?.getAudioTracks?.() || []).filter(
                (track) => track.readyState === 'live'
            )
        );
        if (videoTrack?.readyState === 'live') {
            tracks.push(videoTrack);
        }

        return new MediaStreamCtor(tracks);
    };

    const createTrackStopper = () => {
        let stoppedTracks = new WeakSet();

        const stopTrack = (track) => {
            if (!track || stoppedTracks.has(track)) {
                return false;
            }

            stoppedTracks.add(track);
            try {
                track.stop?.();
            } catch {
                return false;
            }
            return true;
        };

        return {
            reset: () => {
                stoppedTracks = new WeakSet();
            },
            stopStream: (stream) =>
                (stream?.getTracks?.() || []).reduce(
                    (count, track) => count + Number(stopTrack(track)),
                    0
                ),
            stopTrack,
        };
    };

    const clearMediaElement = ({ mediaElement, onWarning } = {}) => {
        if (!mediaElement) {
            return false;
        }

        mediaElement.onloadedmetadata = null;
        mediaClearListeners.forEach((listener) => listener(mediaElement));
        try {
            mediaElement.pause?.();
        } catch (error) {
            onWarning?.('Could not pause remote media.', error);
        }
        mediaElement.srcObject = null;
        try {
            mediaElement.load?.();
        } catch (error) {
            onWarning?.('Could not reset remote media.', error);
        }
        return true;
    };

    const getLiveTracks = (stream, kind) =>
        (stream?.getTracks?.() || []).filter(
            (track) =>
                track?.readyState === 'live' && (!kind || track.kind === kind)
        );

    const attachAndPlayMedia = ({
        forceRebind = false,
        mediaElement,
        onWarning,
        stream,
    } = {}) => {
        if (!mediaElement) {
            return false;
        }

        const play = () => {
            try {
                const result = mediaElement.play?.();
                result?.catch?.((error) =>
                    onWarning?.('Could not play remote media.', error)
                );
            } catch (error) {
                onWarning?.('Could not play remote media.', error);
            }
        };

        if (forceRebind) {
            clearMediaElement({ mediaElement, onWarning });
        }

        const nextStream = stream || null;
        const changed = mediaElement.srcObject !== nextStream;
        if (changed) mediaElement.srcObject = nextStream;
        mediaElement.onloadedmetadata = play;
        if (mediaElement.readyState >= 1 && (changed || forceRebind || mediaElement.paused !== false)) {
            play();
        }
        return true;
    };

    const requestScreenCapture = async ({
        constraints,
        getDisplayMedia,
        supportedConstraints,
        onPendingChange,
        onWarning,
        options,
    } = {}) => {
        if (typeof getDisplayMedia !== 'function') {
            return { ok: false, reason: 'screen-capture-unavailable' };
        }

        onPendingChange?.(true);
        try {
            const stream = await getDisplayMedia(
                constraints || buildScreenCaptureConstraints(options, supportedConstraints)
            );
            stream?.getVideoTracks?.().forEach((track) =>
                global.VoiceScreenSendPolicy?.register(track, normalizeScreenShareOptions(options))
            );
            return stream
                ? { ok: true, stream }
                : { ok: false, reason: 'screen-capture-empty' };
        } catch (error) {
            const cancelled =
                error?.name === 'NotAllowedError' ||
                error?.name === 'AbortError';
            if (!cancelled) {
                onWarning?.('Could not start screen sharing.', error);
            }
            return {
                cancelled,
                error,
                ok: false,
                reason: cancelled
                    ? 'screen-capture-cancelled'
                    : 'screen-capture-failed',
            };
        } finally {
            onPendingChange?.(false);
        }
    };

    const createPageTeardown = ({
        beforeStopMedia,
        clearLocalState,
        disconnectSocket,
        getMediaStreams,
        getPeer,
        getSocket,
        notifyLeave,
        onWarning,
        stopStream,
        teardownRegistry,
    } = {}) => {
        let completed = false;

        const attempt = (label, operation) => {
            try {
                operation?.();
            } catch (error) {
                onWarning?.(`Could not ${label} during page teardown.`, error);
            }
        };

        const run = (reason = 'page-unload') => {
            if (completed) {
                return false;
            }
            completed = true;

            attempt('invalidate local media session', beforeStopMedia);
            (getMediaStreams?.() || []).forEach((stream) =>
                attempt('stop local media', () => stopStream?.(stream))
            );
            attempt('notify voice leave', notifyLeave);
            attempt('teardown peer registry', () => teardownRegistry?.(reason));

            const peer = getPeer?.();
            if (peer && !peer.destroyed) {
                attempt('destroy PeerJS session', () => peer.destroy?.());
            }

            const socket = getSocket?.();
            attempt('disconnect Socket.IO transport', () => {
                if (disconnectSocket) {
                    disconnectSocket(socket);
                } else {
                    socket?.disconnect?.();
                }
            });
            attempt('clear local media state', clearLocalState);
            return true;
        };

        return {
            isComplete: () => completed,
            run,
        };
    };

    global.VoiceMediaLifecycle = {
        onMediaClear: (listener) => {
            mediaClearListeners.add(listener);
            return () => mediaClearListeners.delete(listener);
        },
        SCREEN_SHARE_DEFAULTS,
        SCREEN_SHARE_FRAME_RATES,
        SCREEN_SHARE_RESOLUTION_PRESETS,
        attachAndPlayMedia,
        buildScreenCaptureConstraints,
        describeScreenAudio,
        clearMediaElement,
        createMediaSnapshot,
        createPageTeardown,
        createTrackStopper,
        getLiveTracks,
        isCurrentScreenCapture: ({
            currentSession,
            currentStream,
            session,
            sharing,
            stream,
        } = {}) =>
            Boolean(
                sharing &&
                    currentSession === session &&
                    currentStream === stream
            ),
        requestScreenCapture,
        normalizeScreenShareOptions,
        shouldTeardownPage: (event) => event?.persisted !== true,
    };
})(window);
