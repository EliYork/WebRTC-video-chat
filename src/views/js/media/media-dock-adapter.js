(function exposeVoiceMediaDockAdapter(global) {
    'use strict';

    const REQUIRED_ACTIONS = Object.freeze([
        'joinVoice',
        'leaveVoice',
        'hangUp',
        'toggleMicrophone',
        'toggleCamera',
        'startScreenShare',
        'stopScreenShare',
        'selectMicrophone',
        'selectCamera',
        'selectOutput',
        'setOutputVolume',
        'setOutputMuted',
    ]);

    const OPTIONAL_ACTIONS = Object.freeze([
        'copyRoomLink',
        'refreshDevices',
        'setMicrophoneGain',
        'toggleAiNoiseSuppression',
        'toggleNoiseSuppression',
    ]);

    const cloneDevices = (devices) =>
        Array.isArray(devices)
            ? devices.map((device) => ({
                  deviceId: String(device?.deviceId || ''),
                  kind: String(device?.kind || ''),
                  label: String(device?.label || ''),
              }))
            : [];

    const cloneSnapshot = (snapshot = {}) => ({
        ...snapshot,
        availableCameras: cloneDevices(snapshot.availableCameras),
        availableMicrophones: cloneDevices(snapshot.availableMicrophones),
        availableOutputs: cloneDevices(snapshot.availableOutputs),
        mediaErrors: { ...(snapshot.mediaErrors || {}) },
    });

    const createMediaDockAdapter = ({
        actions = {},
        getSnapshot,
        logger = global.console,
    } = {}) => {
        if (typeof getSnapshot !== 'function') {
            throw new TypeError('Media Dock adapter requires getSnapshot().');
        }

        REQUIRED_ACTIONS.forEach((name) => {
            if (typeof actions[name] !== 'function') {
                throw new TypeError(
                    `Media Dock adapter requires actions.${name}().`
                );
            }
        });

        const listeners = new Set();
        let destroyed = false;

        const readSnapshot = () => cloneSnapshot(getSnapshot() || {});
        const invoke = (name, ...args) => {
            if (destroyed) {
                return false;
            }
            return actions[name]?.(...args);
        };
        const notify = () => {
            if (destroyed) {
                return undefined;
            }

            const snapshot = readSnapshot();
            listeners.forEach((listener) => {
                try {
                    listener(snapshot);
                } catch (error) {
                    logger?.warn?.(
                        'Media Dock subscriber failed while rendering.',
                        error
                    );
                }
            });
            return snapshot;
        };
        const subscribe = (listener) => {
            if (destroyed || typeof listener !== 'function') {
                return () => false;
            }

            listeners.add(listener);
            try {
                listener(readSnapshot());
            } catch (error) {
                listeners.delete(listener);
                throw error;
            }
            let active = true;
            return () => {
                if (!active) {
                    return false;
                }
                active = false;
                return listeners.delete(listener);
            };
        };
        const destroy = () => {
            if (destroyed) {
                return false;
            }
            destroyed = true;
            listeners.clear();
            return true;
        };

        const adapter = {
            destroy,
            getSnapshot: readSnapshot,
            hangUp: (...args) => invoke('hangUp', ...args),
            joinVoice: (...args) => invoke('joinVoice', ...args),
            leaveVoice: (...args) => invoke('leaveVoice', ...args),
            notify,
            selectCamera: (...args) => invoke('selectCamera', ...args),
            selectMicrophone: (...args) => invoke('selectMicrophone', ...args),
            selectOutput: (...args) => invoke('selectOutput', ...args),
            setOutputMuted: (...args) => invoke('setOutputMuted', ...args),
            setOutputVolume: (...args) => invoke('setOutputVolume', ...args),
            startScreenShare: (...args) => invoke('startScreenShare', ...args),
            stopScreenShare: (...args) => invoke('stopScreenShare', ...args),
            subscribe,
            toggleCamera: (...args) => invoke('toggleCamera', ...args),
            toggleMicrophone: (...args) => invoke('toggleMicrophone', ...args),
        };

        OPTIONAL_ACTIONS.forEach((name) => {
            adapter[name] = (...args) => invoke(name, ...args);
        });

        return adapter;
    };

    global.VoiceMediaDockAdapter = {
        OPTIONAL_ACTIONS,
        REQUIRED_ACTIONS,
        createMediaDockAdapter,
    };
})(window);
