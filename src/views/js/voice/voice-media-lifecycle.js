(function exposeVoiceMediaLifecycle(global) {
    'use strict';

    const SCREEN_SHARE_DEFAULTS = Object.freeze({
        frameRate: 30,
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

    const normalizeScreenShareOptions = (options = {}) => {
        const requestedFrameRate = Number(options.frameRate);
        const requestedResolution = options.resolutionPreset;
        return {
            frameRate: SCREEN_SHARE_FRAME_RATES.includes(requestedFrameRate)
                ? requestedFrameRate
                : SCREEN_SHARE_DEFAULTS.frameRate,
            resolutionPreset: SCREEN_SHARE_RESOLUTION_PRESETS.includes(
                requestedResolution
            )
                ? requestedResolution
                : SCREEN_SHARE_DEFAULTS.resolutionPreset,
        };
    };

    const buildScreenCaptureConstraints = (options = {}) => {
        const { frameRate, resolutionPreset } =
            normalizeScreenShareOptions(options);
        const frameRateConstraint = {
            ideal: frameRate,
            max: frameRate,
        };

        if (resolutionPreset === 'original') {
            return {
                audio: true,
                video: {
                    frameRate: frameRateConstraint,
                },
            };
        }

        if (resolutionPreset === 'auto') {
            return {
                audio: true,
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
            audio: true,
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

        mediaElement.srcObject = stream || null;
        mediaElement.onloadedmetadata = play;
        if (mediaElement.readyState >= 1) {
            play();
        }
        return true;
    };

    const requestScreenCapture = async ({
        constraints,
        getDisplayMedia,
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
                constraints || buildScreenCaptureConstraints(options)
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
        SCREEN_SHARE_DEFAULTS,
        SCREEN_SHARE_FRAME_RATES,
        SCREEN_SHARE_RESOLUTION_PRESETS,
        attachAndPlayMedia,
        buildScreenCaptureConstraints,
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
