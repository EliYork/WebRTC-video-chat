(function exposeVoiceAudioRecovery(global) {
    'use strict';

    // Recover actual failures, never silence: a quiet or muted microphone is
    // valid and must not cause new permission requests or endless reconnects.
    const createRuntime = ({
        getMediaElements = () => [],
        getProcessingState = () => undefined,
        getPeerStates = () => [],
        onPlaybackBlocked,
        onProcessingFailure,
        onPeerRecovery,
        onPeerFailure,
        now = () => Date.now(),
        setTimer = global.setTimeout?.bind(global),
        clearTimer = global.clearTimeout?.bind(global),
        intervalMs = 1000,
    } = {}) => {
        const players = new Map();
        const peers = new Map();
        const processing = new WeakSet();
        const processingTimers = new Set();
        let disposed = false;
        let timer;
        let started = false;
        let blockedCount = 0;
        let failedPeers = false;

        const playback = (element, userGesture) => {
            const stream = element.srcObject;
            if (
                !stream
                    ?.getTracks?.()
                    .some((track) => track.readyState === 'live')
            ) {
                players.delete(element);
                return;
            }
            let state = players.get(element);
            if (!state || state.stream !== stream) {
                state = { stream, pending: false, blocked: false };
                players.set(element, state);
            }
            if (element.paused === false) {
                state.blocked = false;
                return;
            }
            if (state.pending || (state.blocked && !userGesture)) return;
            state.pending = true;
            // Invoke synchronously so an explicit recovery click retains the
            // browser's user activation, even while another player is pending.
            let result;
            try {
                result = element.play();
            } catch (error) {
                result = Promise.reject(error);
            }
            void Promise.resolve(result)
                .then(
                    () => {
                        if (players.get(element) === state)
                            state.blocked = false;
                    },
                    (error) => {
                        if (
                            players.get(element) === state &&
                            element.srcObject === stream
                        ) {
                            state.blocked = error?.name === 'NotAllowedError';
                        }
                    }
                )
                .finally(() => {
                    state.pending = false;
                });
        };

        const resumeProcessing = () => {
            const state = getProcessingState();
            const context = state?.context;
            if (
                !context ||
                context.state === 'running' ||
                processing.has(context)
            )
                return;
            processing.add(context);
            let timeout;
            let result;
            try {
                result = context.resume();
            } catch (error) {
                result = Promise.reject(error);
            }
            void Promise.race([
                Promise.resolve(result),
                new Promise((_, reject) => {
                    timeout = setTimer(
                        () => reject(new Error('audio-resume-timeout')),
                        1500
                    );
                    processingTimers.add(timeout);
                }),
            ])
                .then(() => {
                    if (context.state !== 'running')
                        throw new Error('audio-context-not-running');
                })
                .catch(() => {
                    if (!disposed && getProcessingState() === state && context.state !== 'running') {
                        return onProcessingFailure?.(state);
                    }
                })
                .catch(() => {})
                .finally(() => {
                    clearTimer(timeout);
                    processingTimers.delete(timeout);
                    processing.delete(context);
                });
        };

        const recoverPeers = (userGesture) => {
            const time = now();
            const present = new Set();
            let failed = false;
            for (const {
                peerId,
                connection,
                hasMedia = true,
            } of getPeerStates()) {
                present.add(peerId);
                if (!hasMedia) {
                    peers.delete(peerId);
                    continue;
                }
                // connectionState includes DTLS; connected ICE alone must not
                // conceal a failed DTLS transport.
                const status =
                    connection?.connectionState ||
                    connection?.iceConnectionState;
                if (status === 'connected' || status === 'completed') {
                    peers.delete(peerId);
                    continue;
                }
                let state = peers.get(peerId);
                if (!state || state.connection !== connection) {
                    state = {
                        connection,
                        since: time,
                        attempts: state?.attempts || 0,
                        nextAttempt: state?.nextAttempt || 0,
                        pending: false,
                    };
                    peers.set(peerId, state);
                }
                if (userGesture) {
                    state.attempts = 0;
                    state.nextAttempt = 0;
                }
                if (state.pending) continue;
                const grace =
                    status === 'failed' || status === 'closed'
                        ? 1000
                        : status === 'disconnected'
                          ? 4000
                          : 12000;
                if (!userGesture && time - state.since < grace) continue;
                if (state.attempts >= 3) {
                    failed = true;
                    continue;
                }
                if (time < state.nextAttempt) continue;
                state.pending = true;
                void Promise.resolve()
                    .then(() => {
                        if (disposed || peers.get(peerId) !== state) return;
                        const current = Array.from(getPeerStates()).find(
                            (peer) => peer.peerId === peerId
                        );
                        if (
                            !current ||
                            current.hasMedia === false ||
                            current.connection !== connection
                        )
                            return;
                        const currentStatus =
                            connection?.connectionState ||
                            connection?.iceConnectionState;
                        if (
                            currentStatus === 'connected' ||
                            currentStatus === 'completed'
                        )
                            return;
                        state.attempts += 1;
                        state.nextAttempt =
                            now() + 3000 * 2 ** (state.attempts - 1);
                        return onPeerRecovery?.(peerId);
                    })
                    .catch(() => {})
                    .finally(() => {
                        state.pending = false;
                    });
            }
            for (const peerId of peers.keys())
                if (!present.has(peerId)) peers.delete(peerId);
            if (failed !== failedPeers) {
                failedPeers = failed;
                onPeerFailure?.(failed);
            }
        };

        const recover = ({ userGesture = false } = {}) => {
            if (disposed) return false;
            const elements = new Set(getMediaElements());
            for (const element of players.keys())
                if (!elements.has(element)) players.delete(element);
            elements.forEach((element) => playback(element, userGesture));
            resumeProcessing();
            recoverPeers(userGesture);
            const count = [...players.values()].filter(
                (state) => state.blocked
            ).length;
            if (count !== blockedCount) {
                blockedCount = count;
                onPlaybackBlocked?.(count > 0);
            }
            return true;
        };
        const tick = () => {
            timer = undefined;
            if (disposed) return;
            recover();
            timer = setTimer(tick, intervalMs);
        };
        return {
            recover,
            start: () => {
                if (!started && !disposed) {
                    started = true;
                    timer = setTimer(tick, intervalMs);
                }
            },
            dispose: () => {
                disposed = true;
                clearTimer(timer);
                processingTimers.forEach(pending => clearTimer(pending));
                processingTimers.clear();
                players.clear();
                peers.clear();
            },
        };
    };
    global.VoiceAudioRecovery = { createRuntime };
})(window);
