(function exposeVoiceRetryController(global) {
    'use strict';

    const createRetryController = ({
        baseDelay = 500,
        clearTimer = global.clearTimeout?.bind(global),
        jitter = 0.2,
        maxAttempts = 5,
        maxDelay = 8000,
        onDebug,
        random = Math.random,
        setTimer = global.setTimeout?.bind(global),
    } = {}) => {
        let active;
        let attempt = 0;
        let online = true;
        let sequence = 0;

        const debug = (event, details = {}) =>
            onDebug?.({ event: `retry-${event}`, attempt, ...details });

        const getDelay = (attemptNumber = attempt + 1) => {
            const exponential = Math.min(
                maxDelay,
                baseDelay * 2 ** Math.max(0, attemptNumber - 1)
            );
            const spread = exponential * Math.max(0, jitter);
            return Math.max(
                0,
                Math.round(exponential - spread + random() * spread * 2)
            );
        };

        const settle = (operation, result) => {
            if (active !== operation) {
                return;
            }
            active = undefined;
            operation.resolve(result);
        };

        const cancel = (reason = 'cancelled') => {
            sequence += 1;
            if (!active) {
                return false;
            }
            if (active.timer !== undefined) {
                clearTimer?.(active.timer);
            }
            const operation = active;
            debug('cancelled', { epoch: operation.epoch, reason });
            settle(operation, { cancelled: true, ok: false, reason });
            return true;
        };

        const reset = (reason = 'reset') => {
            cancel(reason);
            attempt = 0;
        };

        const scheduleAttempt = (operation, immediate = false) => {
            if (active !== operation || operation.sequence !== sequence) {
                return;
            }
            if (!online) {
                operation.paused = true;
                debug('paused', { epoch: operation.epoch, reason: 'offline' });
                return;
            }
            if (attempt >= maxAttempts) {
                debug('failed', {
                    epoch: operation.epoch,
                    reason: 'max-attempts',
                });
                operation.onExhausted?.({ attempt, epoch: operation.epoch });
                settle(operation, {
                    attempts: attempt,
                    ok: false,
                    reason: 'max-attempts',
                });
                return;
            }

            operation.paused = false;
            const delay = immediate ? 0 : getDelay(attempt + 1);
            debug('scheduled', { delay, epoch: operation.epoch });
            operation.timer = setTimer?.(async () => {
                operation.timer = undefined;
                if (
                    active !== operation ||
                    operation.sequence !== sequence ||
                    !online
                ) {
                    scheduleAttempt(operation, true);
                    return;
                }

                attempt += 1;
                debug('started', { epoch: operation.epoch });
                try {
                    const result = await operation.task({
                        attempt,
                        epoch: operation.epoch,
                    });
                    if (
                        active !== operation ||
                        operation.sequence !== sequence
                    ) {
                        return;
                    }
                    if (result !== false && result?.ok !== false) {
                        debug('succeeded', { epoch: operation.epoch });
                        const attempts = attempt;
                        attempt = 0;
                        settle(operation, {
                            attempts,
                            ok: true,
                            result,
                        });
                        return;
                    }
                    debug('attempt-failed', { epoch: operation.epoch });
                } catch (error) {
                    debug('attempt-failed', {
                        epoch: operation.epoch,
                        errorType: error?.name || 'Error',
                    });
                }
                scheduleAttempt(operation);
            }, delay);
        };

        const run = ({ epoch, immediate = false, onExhausted, task } = {}) => {
            if (typeof task !== 'function') {
                return Promise.resolve({ ok: false, reason: 'missing-task' });
            }
            if (active) {
                return active.promise;
            }

            const operation = {
                epoch,
                onExhausted,
                sequence,
                task,
            };
            operation.promise = new Promise((resolve) => {
                operation.resolve = resolve;
            });
            active = operation;
            scheduleAttempt(operation, immediate);
            return operation.promise;
        };

        const setOnline = (value) => {
            const nextOnline = value !== false;
            if (online === nextOnline) {
                return false;
            }
            online = nextOnline;
            if (!online && active?.timer !== undefined) {
                clearTimer?.(active.timer);
                active.timer = undefined;
                active.paused = true;
                debug('paused', { epoch: active.epoch, reason: 'offline' });
            } else if (online && active?.paused) {
                debug('resumed', { epoch: active.epoch, reason: 'online' });
                scheduleAttempt(active, true);
            }
            return true;
        };

        return {
            cancel,
            getDelay,
            getSnapshot: () => ({
                active: Boolean(active),
                attempt,
                epoch: active?.epoch,
                online,
                paused: Boolean(active?.paused),
            }),
            reset,
            run,
            setOnline,
        };
    };

    global.VoiceRetryController = { createRetryController };
})(window);
