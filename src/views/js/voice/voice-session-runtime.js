(function exposeVoiceSessionRuntime(global) {
    'use strict';

    const STATES = Object.freeze({
        DEGRADED: 'degraded',
        DISPOSED: 'disposed',
        FAILED: 'failed',
        IDLE: 'idle',
        JOINED: 'joined',
        JOINING: 'joining',
        LEAVING: 'leaving',
        RECONNECTING_PEER: 'reconnecting-peer',
        RECONNECTING_SOCKET: 'reconnecting-socket',
        RESTORING: 'restoring',
    });

    const ALLOWED = {
        [STATES.IDLE]: [STATES.JOINING, STATES.DISPOSED],
        [STATES.JOINING]: [
            STATES.JOINED,
            STATES.LEAVING,
            STATES.RECONNECTING_SOCKET,
            STATES.RECONNECTING_PEER,
            STATES.RESTORING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.JOINED]: [
            STATES.DEGRADED,
            STATES.LEAVING,
            STATES.RECONNECTING_SOCKET,
            STATES.RECONNECTING_PEER,
            STATES.RESTORING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.DEGRADED]: [
            STATES.JOINED,
            STATES.LEAVING,
            STATES.RECONNECTING_SOCKET,
            STATES.RECONNECTING_PEER,
            STATES.RESTORING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.RECONNECTING_SOCKET]: [
            STATES.DEGRADED,
            STATES.RESTORING,
            STATES.RECONNECTING_PEER,
            STATES.LEAVING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.RECONNECTING_PEER]: [
            STATES.RESTORING,
            STATES.RECONNECTING_SOCKET,
            STATES.LEAVING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.RESTORING]: [
            STATES.JOINED,
            STATES.RECONNECTING_SOCKET,
            STATES.RECONNECTING_PEER,
            STATES.LEAVING,
            STATES.FAILED,
            STATES.DISPOSED,
        ],
        [STATES.FAILED]: [STATES.JOINING, STATES.LEAVING, STATES.DISPOSED],
        [STATES.LEAVING]: [STATES.IDLE, STATES.DISPOSED],
        [STATES.DISPOSED]: [],
    };

    const classifyPeerError = (error) => {
        const type = error?.type || 'unknown';
        if (type === 'peer-unavailable' || type === 'webrtc') {
            return { recoverable: true, scope: 'call', strategy: 'none', type };
        }
        if (
            [
                'browser-incompatible',
                'invalid-id',
                'invalid-key',
                'ssl-unavailable',
            ].includes(type)
        ) {
            return {
                recoverable: false,
                scope: 'session',
                strategy: 'none',
                type,
            };
        }
        if (type === 'unavailable-id') {
            return {
                recoverable: true,
                scope: 'session',
                strategy: 'recreate',
                type,
            };
        }
        if (
            [
                'disconnected',
                'network',
                'server-error',
                'socket-error',
                'socket-closed',
            ].includes(type)
        ) {
            return {
                recoverable: true,
                scope: 'session',
                strategy: 'reconnect',
                type,
            };
        }
        return {
            recoverable: true,
            scope: 'session',
            strategy: 'recreate',
            type,
        };
    };

    const createSessionRuntime = ({ onDebug, onStateChange } = {}) => {
        let desiredVoiceState = 'left';
        let epoch = 0;
        let failureReason;
        let peerId;
        let roomId;
        let serverGeneration = 0;
        let state = STATES.IDLE;

        const snapshot = () => ({
            desiredVoiceState,
            epoch,
            failureReason,
            peerId,
            roomId,
            serverGeneration,
            state,
        });

        const debug = (event, details = {}) =>
            onDebug?.({
                event: `session-${event}`,
                desiredVoiceState,
                epoch,
                state,
                ...details,
            });

        const transition = (nextState, reason = 'state-change') => {
            if (state === nextState) {
                debug('state-duplicate', { reason });
                return true;
            }
            if (!ALLOWED[state]?.includes(nextState)) {
                debug('state-rejected', { nextState, reason });
                return false;
            }
            const previousState = state;
            state = nextState;
            debug('state', { previousState, reason });
            onStateChange?.(snapshot(), { previousState, reason });
            return true;
        };

        const advanceEpoch = (reason) => {
            epoch += 1;
            serverGeneration = 0;
            debug('epoch', { reason });
            return epoch;
        };

        const join = (nextRoomId) => {
            if (state === STATES.DISPOSED || !nextRoomId) {
                return undefined;
            }
            if (
                desiredVoiceState === 'joined' &&
                roomId === nextRoomId &&
                state !== STATES.FAILED
            ) {
                debug('join-duplicate');
                return epoch;
            }
            desiredVoiceState = 'joined';
            roomId = nextRoomId;
            peerId = undefined;
            failureReason = undefined;
            advanceEpoch('join');
            transition(STATES.JOINING, 'join-requested');
            return epoch;
        };

        const leave = ({ dispose = false, reason = 'user-leave' } = {}) => {
            if (state === STATES.DISPOSED) {
                return false;
            }
            desiredVoiceState = 'left';
            advanceEpoch(reason);
            failureReason = undefined;
            peerId = undefined;
            roomId = undefined;
            transition(STATES.LEAVING, reason);
            transition(dispose ? STATES.DISPOSED : STATES.IDLE, reason);
            return true;
        };

        const socketDisconnected = (reason = 'transport-close') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            if (state === STATES.RECONNECTING_SOCKET) {
                debug('socket-disconnect-duplicate', { reason });
                return true;
            }
            advanceEpoch('socket-disconnect');
            transition(STATES.RECONNECTING_SOCKET, reason);
            return true;
        };

        const socketConnected = (reason = 'socket-connect') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            transition(STATES.RESTORING, reason);
            return true;
        };

        const peerDisconnected = (reason = 'peer-disconnected') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            if (state === STATES.RECONNECTING_PEER) {
                debug('peer-disconnect-duplicate', { reason });
                return true;
            }
            transition(STATES.RECONNECTING_PEER, reason);
            return true;
        };

        const peerRecreated = (nextPeerId) => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            advanceEpoch('peer-recreated');
            peerId = nextPeerId;
            transition(STATES.RESTORING, 'peer-recreated');
            return true;
        };

        const markRestoring = (reason = 'restore-started') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            return transition(STATES.RESTORING, reason);
        };

        const markDegraded = (reason = 'signaling-unavailable') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            return transition(STATES.DEGRADED, reason);
        };

        const markJoined = ({
            epoch: eventEpoch = epoch,
            peerId: nextPeerId,
            serverGeneration: nextGeneration,
        } = {}) => {
            if (
                eventEpoch !== epoch ||
                desiredVoiceState !== 'joined' ||
                state === STATES.DISPOSED ||
                !Number.isInteger(nextGeneration) ||
                nextGeneration <= 0 ||
                !nextPeerId
            ) {
                debug('joined-stale', { eventEpoch });
                return false;
            }
            peerId = nextPeerId;
            serverGeneration = nextGeneration;
            failureReason = undefined;
            return transition(STATES.JOINED, 'restore-succeeded');
        };

        const fail = (reason = 'voice-recovery-failed') => {
            if (state === STATES.DISPOSED || desiredVoiceState !== 'joined') {
                return false;
            }
            failureReason = reason;
            return transition(STATES.FAILED, reason);
        };

        const retry = () => {
            if (state !== STATES.FAILED || desiredVoiceState !== 'joined') {
                return false;
            }
            advanceEpoch('manual-retry');
            failureReason = undefined;
            return transition(STATES.JOINING, 'manual-retry');
        };

        return {
            STATES,
            advanceEpoch,
            fail,
            getSnapshot: snapshot,
            isCurrent: (eventEpoch) =>
                state !== STATES.DISPOSED && eventEpoch === epoch,
            join,
            leave,
            markJoined,
            markDegraded,
            markRestoring,
            peerDisconnected,
            peerRecreated,
            retry,
            socketConnected,
            socketDisconnected,
            transition,
        };
    };

    global.VoiceSessionRuntime = {
        STATES,
        classifyPeerError,
        createSessionRuntime,
    };
})(window);
