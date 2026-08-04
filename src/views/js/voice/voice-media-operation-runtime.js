(function exposeVoiceMediaOperationRuntime(global) {
    'use strict';

    const ERROR_ALIASES = Object.freeze({
        AbortError: 'operation-aborted',
        ConstraintNotSatisfiedError: 'constraint-failed',
        DevicesNotFoundError: 'device-not-found',
        NotFoundError: 'device-not-found',
        NotReadableError: 'device-busy',
        OverconstrainedError: 'constraint-failed',
        PermissionDeniedError: 'permission-denied',
        SecurityError: 'insecure-context',
        TrackStartError: 'device-busy',
        TypeError: 'insecure-context',
    });

    const classifyMediaError = (
        error,
        { operation, secureContext = global.isSecureContext !== false } = {}
    ) => {
        const name = error?.name || 'Error';
        if (
            operation === 'screen' &&
            (name === 'NotAllowedError' || name === 'AbortError')
        ) {
            return 'user-cancelled';
        }
        if (name === 'NotAllowedError') {
            return 'permission-denied';
        }
        if (name === 'TypeError' && !secureContext) {
            return 'insecure-context';
        }
        return ERROR_ALIASES[name] || 'unknown';
    };

    const createMediaOperationController = ({
        getEpoch = () => 0,
        onDebug,
        stopStream,
    } = {}) => {
        const operations = new Map();
        const desired = {
            camera: false,
            microphone: false,
            screen: false,
        };
        let disposed = false;

        const getRecord = (type) => {
            if (!operations.has(type)) {
                operations.set(type, {
                    errorType: undefined,
                    promise: undefined,
                    state: 'idle',
                    token: 0,
                    value: undefined,
                });
            }
            return operations.get(type);
        };

        const debug = (event, type, record, details = {}) =>
            onDebug?.({
                event: `media-operation-${event}`,
                epoch: getEpoch(),
                mediaType: type,
                operationState: record.state,
                token: record.token,
                ...details,
            });

        const invalidate = (
            type,
            { state = 'idle', stopValue = false } = {}
        ) => {
            const record = getRecord(type);
            record.token += 1;
            record.promise = undefined;
            record.errorType = undefined;
            record.state = state;
            if (stopValue && record.value) {
                stopStream?.(record.value);
                record.value = undefined;
            }
            debug('cancelled', type, record);
            return record.token;
        };

        const run = (
            type,
            operation,
            {
                epoch = getEpoch(),
                state = 'requesting',
                surviveEpochChange = false,
            } = {}
        ) => {
            const record = getRecord(type);
            if (disposed) {
                return Promise.resolve({
                    cancelled: true,
                    ok: false,
                    reason: 'disposed',
                });
            }
            if (record.promise) {
                debug('duplicate', type, record);
                return record.promise;
            }

            record.token += 1;
            const token = record.token;
            record.errorType = undefined;
            record.state = state;
            debug('start', type, record);

            const promise = Promise.resolve()
                .then(operation)
                .then((value) => {
                    if (
                        disposed ||
                        record.token !== token ||
                        (!surviveEpochChange && getEpoch() !== epoch)
                    ) {
                        stopStream?.(value);
                        debug('cancelled', type, record, {
                            reason: 'stale-operation',
                        });
                        return {
                            cancelled: true,
                            ok: false,
                            reason: 'stale-operation',
                        };
                    }
                    record.promise = undefined;
                    record.state = 'active';
                    record.value = value;
                    debug('success', type, record);
                    return { ok: true, token, value };
                })
                .catch((error) => {
                    if (record.token !== token || disposed) {
                        return {
                            cancelled: true,
                            ok: false,
                            reason: 'stale-operation',
                        };
                    }
                    const errorType = classifyMediaError(error, {
                        operation: type,
                    });
                    record.errorType = errorType;
                    record.promise = undefined;
                    record.state =
                        errorType === 'user-cancelled' ? 'idle' : 'failed';
                    debug(
                        errorType === 'user-cancelled'
                            ? 'cancelled'
                            : 'failure',
                        type,
                        record,
                        { errorType }
                    );
                    return { error, errorType, ok: false, token };
                });
            record.promise = promise;
            return promise;
        };

        const setActive = (type, value) => {
            const record = getRecord(type);
            record.token += 1;
            record.promise = undefined;
            record.errorType = undefined;
            record.state = value ? 'active' : 'idle';
            record.value = value;
            return record.token;
        };

        const setDesired = (type, value) => {
            if (Object.hasOwn(desired, type)) {
                desired[type] = Boolean(value);
            }
        };

        const dispose = () => {
            if (disposed) {
                return false;
            }
            disposed = true;
            operations.forEach((_, type) =>
                invalidate(type, { state: 'idle', stopValue: true })
            );
            return true;
        };

        return {
            classifyMediaError,
            dispose,
            getSnapshot: (type) => {
                if (type) {
                    const record = getRecord(type);
                    return { ...record, desired: desired[type] };
                }
                return {
                    desired: { ...desired },
                    disposed,
                    operations: Object.fromEntries(
                        Array.from(operations, ([key, value]) => [
                            key,
                            { ...value, promise: Boolean(value.promise) },
                        ])
                    ),
                };
            },
            invalidate,
            run,
            setActive,
            setDesired,
        };
    };

    const createTrackEndedController = ({
        getEpoch = () => 0,
        isCurrent = () => true,
        onDebug,
        onEnded,
        stopTrack,
    } = {}) => {
        const bindings = new Map();
        const recoveryClaims = new Set();

        const unbind = (type, track) => {
            const binding = bindings.get(type);
            if (!binding || (track && binding.track !== track)) {
                return false;
            }
            binding.track.removeEventListener?.('ended', binding.listener);
            bindings.delete(type);
            return true;
        };

        const bind = (type, track) => {
            if (!track) {
                return false;
            }
            unbind(type);
            const epoch = getEpoch();
            const listener = () => {
                const binding = bindings.get(type);
                if (
                    binding?.track !== track ||
                    binding.epoch !== epoch ||
                    !isCurrent(epoch)
                ) {
                    return;
                }
                bindings.delete(type);
                onDebug?.({
                    epoch,
                    event: 'track-ended',
                    mediaType: type,
                    reason: 'unexpected',
                });
                onEnded?.({ epoch, track, type });
            };
            bindings.set(type, { epoch, listener, track });
            track.addEventListener?.('ended', listener);
            return true;
        };

        const stop = (type, track) => {
            unbind(type, track);
            onDebug?.({
                epoch: getEpoch(),
                event: 'track-ended',
                mediaType: type,
                reason: 'intentional-stop',
            });
            return stopTrack?.(track) !== false;
        };

        const claimRecovery = (type, epoch = getEpoch()) => {
            const key = `${type}:${epoch}`;
            if (recoveryClaims.has(key)) {
                return false;
            }
            recoveryClaims.add(key);
            return true;
        };

        const releaseRecovery = (type, epoch = getEpoch()) =>
            recoveryClaims.delete(`${type}:${epoch}`);

        const clear = () => {
            Array.from(bindings.keys()).forEach((type) => unbind(type));
            recoveryClaims.clear();
        };

        return {
            bind,
            claimRecovery,
            clear,
            getSnapshot: () => ({
                boundTypes: Array.from(bindings.keys()),
                recoveryClaims: Array.from(recoveryClaims),
            }),
            releaseRecovery,
            stop,
            unbind,
        };
    };

    global.VoiceMediaOperationRuntime = {
        classifyMediaError,
        createMediaOperationController,
        createTrackEndedController,
    };
})(window);
