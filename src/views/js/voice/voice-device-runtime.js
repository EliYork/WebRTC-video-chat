(function exposeVoiceDeviceRuntime(global) {
    'use strict';

    const DEVICE_KINDS = Object.freeze({
        camera: 'videoinput',
        mic: 'audioinput',
        output: 'audiooutput',
    });

    const outputSwitches = new WeakMap();
    const performOutputSwitch = async ({
        deviceId = 'default',
        mediaElement,
        supported = true,
    } = {}) => {
        if (
            !supported ||
            !mediaElement ||
            typeof mediaElement.setSinkId !== 'function'
        ) {
            return { ok: true, unsupported: true };
        }
        const nativeSinkId = deviceId === 'default' ? '' : deviceId;
        try {
            // Newly created players already use the default sink. Reopening
            // that sink during stream replacement can abort on some drivers.
            if (mediaElement.sinkId !== nativeSinkId) {
                await mediaElement.setSinkId(nativeSinkId);
            }
            if (mediaElement.dataset) {
                mediaElement.dataset.outputSinkId = deviceId;
            }
            return { deviceId, ok: true };
        } catch (error) {
            const errorType =
                error?.name === 'AbortError'
                    ? 'operation-aborted'
                    : error?.name === 'NotFoundError'
                      ? 'device-not-found'
                      : error?.name === 'NotAllowedError'
                        ? 'permission-denied'
                        : 'unknown';
            let fallbackApplied = false;
            try {
                if (mediaElement.sinkId !== '') {
                    await mediaElement.setSinkId('');
                }
                if (mediaElement.dataset) {
                    mediaElement.dataset.outputSinkId = 'default';
                }
                fallbackApplied = true;
            } catch {
                fallbackApplied = false;
            }
            return {
                error,
                errorType,
                fallbackApplied,
                ok: false,
            };
        }
    };

    const switchOutputDevice = (options = {}) => {
        const { mediaElement, deviceId = 'default' } = options;
        if (!mediaElement) return performOutputSwitch(options);
        const previous = outputSwitches.get(mediaElement);
        if (previous?.deviceId === deviceId) return previous.promise;
        const promise = (previous?.promise || Promise.resolve())
            .catch(() => {})
            .then(() => performOutputSwitch(options));
        const entry = { deviceId, promise };
        outputSwitches.set(mediaElement, entry);
        void promise.finally(() => {
            if (outputSwitches.get(mediaElement) === entry) {
                outputSwitches.delete(mediaElement);
            }
        });
        return promise;
    };

    const createDeviceRuntime = ({
        clearTimer = global.clearTimeout?.bind(global),
        debounceMs = 180,
        enumerateDevices,
        onDebug,
        onDevices,
        onMissing,
        setTimer = global.setTimeout?.bind(global),
    } = {}) => {
        const devices = { camera: [], mic: [], output: [] };
        const selected = {
            camera: 'default',
            mic: 'default',
            output: 'default',
        };
        let disposed = false;
        let refreshRevision = 0;
        let timer;

        const debug = (event, details = {}) =>
            onDebug?.({ event: `device-${event}`, ...details });

        const setSelected = (type, deviceId = 'default') => {
            if (!Object.hasOwn(selected, type)) {
                return false;
            }
            selected[type] = deviceId || 'default';
            debug('selected', {
                deviceType: type,
                selectedDefault: selected[type] === 'default',
            });
            return true;
        };

        const refresh = async ({ reason = 'manual' } = {}) => {
            if (disposed || typeof enumerateDevices !== 'function') {
                return { ok: false, reason: 'unsupported' };
            }
            const revision = ++refreshRevision;
            debug('refresh-start', { reason, revision });
            try {
                const list = await enumerateDevices();
                if (disposed || revision !== refreshRevision) {
                    return { ok: false, reason: 'stale' };
                }
                Object.entries(DEVICE_KINDS).forEach(([type, kind]) => {
                    devices[type] = (list || []).filter(
                        (device) => device.kind === kind
                    );
                });

                const missingDevices = [];
                Object.keys(DEVICE_KINDS).forEach((type) => {
                    const selectedId = selected[type];
                    if (
                        selectedId !== 'default' &&
                        !devices[type].some(
                            (device) => device.deviceId === selectedId
                        )
                    ) {
                        selected[type] = 'default';
                        debug('fallback', {
                            deviceType: type,
                            reason: 'selected-device-missing',
                        });
                        missingDevices.push({
                            previousDeviceId: selectedId,
                            reason,
                            type,
                        });
                    }
                });
                await Promise.all(
                    missingDevices.map((missing) => onMissing?.(missing))
                );
                onDevices?.({ devices, reason, selected });
                debug('refresh-success', { reason, revision });
                return { devices, ok: true, selected };
            } catch (error) {
                if (revision === refreshRevision && !disposed) {
                    debug('refresh-failure', {
                        errorType: error?.name || 'Error',
                        reason,
                    });
                }
                return { error, ok: false, reason: 'enumerate-failed' };
            }
        };

        const handleDeviceChange = () => {
            if (disposed) {
                return;
            }
            if (timer !== undefined) {
                clearTimer?.(timer);
            }
            debug('change');
            timer = setTimer?.(() => {
                timer = undefined;
                void refresh({ reason: 'devicechange' });
            }, debounceMs);
        };

        const dispose = () => {
            if (disposed) {
                return false;
            }
            disposed = true;
            refreshRevision += 1;
            if (timer !== undefined) {
                clearTimer?.(timer);
                timer = undefined;
            }
            return true;
        };

        return {
            dispose,
            getSnapshot: () => ({
                devices: Object.fromEntries(
                    Object.entries(devices).map(([type, list]) => [
                        type,
                        [...list],
                    ])
                ),
                disposed,
                selected: { ...selected },
            }),
            handleDeviceChange,
            refresh,
            setSelected,
        };
    };

    global.VoiceDeviceRuntime = {
        DEVICE_KINDS,
        createDeviceRuntime,
        switchOutputDevice,
    };
})(window);
