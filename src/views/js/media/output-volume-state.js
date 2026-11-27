(function exposeVoiceOutputVolumeState(global) {
    'use strict';

    const { safeStorageGet, writeJsonStorage } = global.VoiceViewUtils;
    const PEER_VOLUME_STORAGE_KEY = 'voice-room-peer-volumes-v1';
    const peerVolumeLimit = 256;
    let cachedRaw = null;
    let cachedVolumes = {};

    const clampVolume = (volume, fallback = 1) => {
        const numericVolume = Number(volume);

        if (!Number.isFinite(numericVolume)) {
            return fallback;
        }

        return Math.min(2, Math.max(0, numericVolume));
    };

    const readPeerVolumes = () => {
        const raw = safeStorageGet(PEER_VOLUME_STORAGE_KEY);
        if (raw === cachedRaw) return cachedVolumes;
        cachedRaw = raw;
        let saved;
        try { saved = JSON.parse(raw); } catch { /* Ignore malformed storage. */ }
        cachedVolumes = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        return cachedVolumes;
    };

    const getPeerVolumes = () => ({ ...readPeerVolumes() });
    const getPeerVolume = (peerId) => {
        const volumes = readPeerVolumes();
        return Object.hasOwn(volumes, peerId) ? clampVolume(volumes[peerId], 1) : 1;
    };

    const setPeerVolume = (peerId, volume) => {
        if (!peerId) {
            return;
        }

        const volumes = getPeerVolumes();
        delete volumes[peerId];
        const recent = Object.entries(volumes).slice(1 - peerVolumeLimit);
        recent.push([peerId, clampVolume(volume, 1)]);
        writeJsonStorage(PEER_VOLUME_STORAGE_KEY, Object.fromEntries(recent));
    };

    const getEffectiveOutputVolume = (outputVolume = 1, peerVolume = 1) =>
        clampVolume(outputVolume) * clampVolume(peerVolume);

    const getEffectiveVolume = ({
        muted = false,
        outputVolume = 1,
        peerVolume = 1,
    } = {}) => (muted ? 0 : getEffectiveOutputVolume(outputVolume, peerVolume));

    global.VoiceOutputVolumeState = {
        PEER_VOLUME_STORAGE_KEY,
        clampVolume,
        getEffectiveOutputVolume,
        getEffectiveVolume,
        getPeerVolume,
        getPeerVolumes,
        setPeerVolume,
    };
})(window);
