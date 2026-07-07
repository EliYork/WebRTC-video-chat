(function exposeVoiceOutputVolumeState(global) {
    'use strict';

    const { readJsonStorage, writeJsonStorage } = global.VoiceViewUtils;
    const PEER_VOLUME_STORAGE_KEY = 'voice-room-peer-volumes-v1';

    const clampVolume = (volume, fallback = 1) => {
        const numericVolume = Number(volume);

        if (!Number.isFinite(numericVolume)) {
            return fallback;
        }

        return Math.min(1, Math.max(0, numericVolume));
    };

    const getPeerVolumes = () =>
        readJsonStorage(PEER_VOLUME_STORAGE_KEY, {}) || {};

    const getPeerVolume = (peerId) => clampVolume(getPeerVolumes()[peerId], 1);

    const setPeerVolume = (peerId, volume) => {
        if (!peerId) {
            return;
        }

        const volumes = getPeerVolumes();
        volumes[peerId] = clampVolume(volume, 1);
        writeJsonStorage(PEER_VOLUME_STORAGE_KEY, volumes);
    };

    const getEffectiveVolume = ({
        muted = false,
        outputVolume = 1,
        peerVolume = 1,
    } = {}) => {
        if (muted) {
            return 0;
        }

        return Math.min(
            1,
            clampVolume(outputVolume, 1) * clampVolume(peerVolume, 1)
        );
    };

    global.VoiceOutputVolumeState = {
        getEffectiveVolume,
        getPeerVolume,
        getPeerVolumes,
        setPeerVolume,
    };
})(window);
