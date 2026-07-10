(function exposeVoiceCallProtocol(global) {
    'use strict';

    const MEDIA_DIRECTION_METADATA = 'voiceMediaDirection';
    const MEDIA_GENERATION_METADATA = 'voiceMediaGeneration';
    const MEDIA_KINDS_METADATA = 'voiceMediaKinds';
    const SEND_DIRECTION = 'send';
    const DEBUG_STORAGE_KEY = 'voiceMediaDebug';
    const DEBUG_QUERY_KEY = 'voiceMediaDebug';
    const DEBUG_LIMIT = 200;

    const isDebugEnabled = ({ location, storage } = {}) => {
        let queryEnabled = false;
        let storageEnabled = false;

        try {
            queryEnabled =
                new URLSearchParams(location?.search || '').get(
                    DEBUG_QUERY_KEY
                ) === '1';
        } catch {
            queryEnabled = false;
        }

        try {
            const value = storage?.getItem?.(DEBUG_STORAGE_KEY);
            storageEnabled = value === '1' || value === 'true';
        } catch {
            storageEnabled = false;
        }

        return queryEnabled || storageEnabled;
    };

    const describeTracks = (stream) =>
        (stream?.getTracks?.() || [])
            .filter((track) => track?.readyState !== 'ended')
            .map((track) => ({
                enabled: track.enabled !== false,
                kind: track.kind,
            }));

    const describePeerConnection = (peerConnection) => {
        const mediaSections = (description) =>
            Array.from(
                String(description?.sdp || '').matchAll(/^m=(audio|video)\s/gm),
                (match) => match[1]
            );

        return {
            connectionState: peerConnection?.connectionState,
            iceConnectionState: peerConnection?.iceConnectionState,
            localMediaSections: mediaSections(peerConnection?.localDescription),
            remoteMediaSections: mediaSections(
                peerConnection?.remoteDescription
            ),
            senderKinds: (peerConnection?.getSenders?.() || [])
                .map((sender) => sender.track?.kind)
                .filter(Boolean),
            transceiverKinds: (peerConnection?.getTransceivers?.() || [])
                .map(
                    (transceiver) =>
                        transceiver.sender?.track?.kind ||
                        transceiver.receiver?.track?.kind
                )
                .filter(Boolean),
        };
    };

    const createMediaDebugLog = ({
        console: debugConsole = global.console,
        location = global.location,
        storage = global.localStorage,
    } = {}) => {
        const enabled = isDebugEnabled({ location, storage });
        const entries = [];

        const record = (event = {}) => {
            if (!enabled) {
                return false;
            }

            const entry = {
                ...event,
                at: new Date().toISOString(),
            };
            entries.push(entry);
            if (entries.length > DEBUG_LIMIT) {
                entries.splice(0, entries.length - DEBUG_LIMIT);
            }
            debugConsole?.debug?.('[voice-media]', entry);
            return true;
        };

        return {
            describePeerConnection,
            describeTracks,
            enabled,
            export: () => entries.map((entry) => ({ ...entry })),
            record,
            reset: () => entries.splice(0, entries.length),
        };
    };

    global.VoiceCallProtocol = {
        DEBUG_QUERY_KEY,
        DEBUG_STORAGE_KEY,
        MEDIA_DIRECTION_METADATA,
        MEDIA_GENERATION_METADATA,
        MEDIA_KINDS_METADATA,
        SEND_DIRECTION,
        createMediaDebugLog,
        describePeerConnection,
        describeTracks,
    };
})(window);
