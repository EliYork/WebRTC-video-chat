(function exposeVoiceMediaLifecycle(global) {
    'use strict';

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
        constraints = { audio: true, video: true },
        getDisplayMedia,
        onPendingChange,
        onWarning,
    } = {}) => {
        if (typeof getDisplayMedia !== 'function') {
            return { ok: false, reason: 'screen-capture-unavailable' };
        }

        onPendingChange?.(true);
        try {
            const stream = await getDisplayMedia(constraints);
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
        attachAndPlayMedia,
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
        shouldTeardownPage: (event) => event?.persisted !== true,
    };
})(window);
