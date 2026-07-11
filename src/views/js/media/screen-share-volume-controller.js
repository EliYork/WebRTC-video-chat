(function exposeVoiceScreenShareVolumeController(global) {
    'use strict';

    const SCREEN_AUDIO_ROLE = 'screen-share-audio';
    const PARTICIPANT_AUDIO_ROLE = 'participant-audio';

    const clampVolume = (value, fallback = 1) => {
        const numeric = Number(value);
        return Number.isFinite(numeric)
            ? Math.min(1, Math.max(0, numeric))
            : fallback;
    };

    const getLiveTracks = (stream, kind) =>
        (stream?.getTracks?.() || []).filter(
            (track) => track?.kind === kind && track.readyState !== 'ended'
        );

    const getScreenAudioTrackIds = (trackRoles = []) =>
        new Set(
            trackRoles
                .filter(
                    (entry) =>
                        entry?.role === SCREEN_AUDIO_ROLE && entry.trackId
                )
                .map((entry) => entry.trackId)
        );

    const buildTrackRoles = ({ screenStream, stream } = {}) => {
        const screenTracks = new Set(screenStream?.getAudioTracks?.() || []);
        return (stream?.getAudioTracks?.() || []).map((track) => ({
            role: screenTracks.has(track)
                ? SCREEN_AUDIO_ROLE
                : PARTICIPANT_AUDIO_ROLE,
            trackId: track.id,
        }));
    };

    const createController = ({
        MediaStreamCtor = global.MediaStream,
        applyElementState,
        attachMediaElement,
        clearMediaElement,
        createAudioElement = () => global.document.createElement('audio'),
    } = {}) => {
        const states = new Map();
        const bindings = new Map();

        const getState = (ownerKey) =>
            states.get(ownerKey) || { muted: false, volume: 1 };

        const ensureState = (ownerKey) => {
            let state = states.get(ownerKey);
            if (!state) {
                state = { muted: false, volume: 1 };
                states.set(ownerKey, state);
            }
            return state;
        };

        const applyBinding = (ownerKey) => {
            const binding = bindings.get(ownerKey);
            if (!binding?.element) {
                return false;
            }
            const state = ensureState(ownerKey);
            applyElementState?.({
                element: binding.element,
                muted: state.muted,
                ownerKey,
                volume: state.volume,
            });
            return true;
        };

        const clearBinding = (ownerKey, { generation } = {}) => {
            const binding = bindings.get(ownerKey);
            if (
                !binding ||
                (generation !== undefined &&
                    Number(generation) !== binding.generation)
            ) {
                return false;
            }
            if (binding.element) {
                clearMediaElement?.(binding.element);
                binding.element.remove?.();
            }
            bindings.delete(ownerKey);
            return true;
        };

        const bindSource = ({
            generation = 0,
            ownerKey,
            sourceStream,
            target,
            trackRoles = [],
        } = {}) => {
            if (!ownerKey || !sourceStream || !MediaStreamCtor) {
                return {
                    accepted: false,
                    hasScreenAudio: false,
                    primaryStream: sourceStream,
                };
            }

            const normalizedGeneration = Number(generation) || 0;
            const current = bindings.get(ownerKey);
            if (current && normalizedGeneration < current.generation) {
                return {
                    accepted: false,
                    hasScreenAudio: Boolean(current.element),
                    primaryStream: current.primaryStream,
                };
            }

            const screenTrackIds = getScreenAudioTrackIds(trackRoles);
            const audioTracks = getLiveTracks(sourceStream, 'audio');
            const videoTracks = getLiveTracks(sourceStream, 'video');
            const screenAudioTracks = audioTracks.filter((track) =>
                screenTrackIds.has(track.id)
            );
            const participantAudioTracks = audioTracks.filter(
                (track) => !screenTrackIds.has(track.id)
            );
            const signature = [
                normalizedGeneration,
                ...participantAudioTracks.map((track) => `p:${track.id}`),
                ...screenAudioTracks.map((track) => `s:${track.id}`),
                ...videoTracks.map((track) => `v:${track.id}`),
            ].join('|');

            if (current?.signature === signature) {
                return {
                    accepted: true,
                    element: current.element,
                    hasScreenAudio: Boolean(current.element),
                    primaryStream: current.primaryStream,
                };
            }

            clearBinding(ownerKey);
            const primaryStream = screenAudioTracks.length
                ? new MediaStreamCtor([
                      ...participantAudioTracks,
                      ...videoTracks,
                  ])
                : sourceStream;
            const binding = {
                element: null,
                generation: normalizedGeneration,
                primaryStream,
                signature,
            };

            if (screenAudioTracks.length) {
                const element = createAudioElement();
                const screenStream = new MediaStreamCtor(screenAudioTracks);
                element.autoplay = true;
                element.className = 'screen-share-audio';
                element.dataset.mediaTarget = SCREEN_AUDIO_ROLE;
                element.playsInline = true;
                target?.append?.(element);
                attachMediaElement?.(element, screenStream);
                binding.element = element;
                binding.screenStream = screenStream;
                ensureState(ownerKey);
            }

            bindings.set(ownerKey, binding);
            applyBinding(ownerKey);
            return {
                accepted: true,
                element: binding.element,
                hasScreenAudio: Boolean(binding.element),
                primaryStream,
            };
        };

        const setVolume = (ownerKey, volume, { generation } = {}) => {
            const binding = bindings.get(ownerKey);
            if (
                !binding?.element ||
                (generation !== undefined &&
                    Number(generation) !== binding.generation)
            ) {
                return false;
            }
            ensureState(ownerKey).volume = clampVolume(volume);
            return applyBinding(ownerKey);
        };

        const setMuted = (ownerKey, muted, { generation } = {}) => {
            const binding = bindings.get(ownerKey);
            if (
                !binding?.element ||
                (generation !== undefined &&
                    Number(generation) !== binding.generation)
            ) {
                return false;
            }
            ensureState(ownerKey).muted = Boolean(muted);
            return applyBinding(ownerKey);
        };

        const getSnapshot = (ownerKey) => {
            const binding = bindings.get(ownerKey);
            const state = getState(ownerKey);
            return {
                element: binding?.element,
                generation: binding?.generation,
                hasAudio: Boolean(binding?.element),
                muted: state.muted,
                volume: state.volume,
            };
        };

        const cleanup = (ownerKey) => {
            clearBinding(ownerKey);
            return states.delete(ownerKey);
        };

        const destroy = () => {
            Array.from(bindings.keys()).forEach((ownerKey) =>
                clearBinding(ownerKey)
            );
            states.clear();
        };

        return {
            bindSource,
            cleanup,
            destroy,
            getBindingCount: () => bindings.size,
            getPrimaryStream: (ownerKey) =>
                bindings.get(ownerKey)?.primaryStream,
            getSnapshot,
            reapplyAll: () =>
                Array.from(bindings.keys()).forEach((ownerKey) =>
                    applyBinding(ownerKey)
                ),
            setMuted,
            setVolume,
            unbind: clearBinding,
        };
    };

    global.VoiceScreenShareVolumeController = {
        PARTICIPANT_AUDIO_ROLE,
        SCREEN_AUDIO_ROLE,
        buildTrackRoles,
        createController,
    };
})(window);
