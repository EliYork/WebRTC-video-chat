(function exposeVoiceCallProtocol(global) {
    'use strict';

    const REFRESH_METADATA_FLAG = 'voiceCallRefresh';
    const REFRESH_METADATA_KEY = 'voiceCallRefreshKey';

    const createRefreshRevisionGate = () => {
        const revisions = new Map();

        const apply = (peerId, revision, operation) => {
            const normalizedRevision = Number(revision);
            const previousRevision = revisions.get(peerId) || 0;

            if (
                !peerId ||
                !Number.isInteger(normalizedRevision) ||
                normalizedRevision <= previousRevision
            ) {
                return undefined;
            }

            const result = operation?.();
            if (result) {
                revisions.set(peerId, normalizedRevision);
            }
            return result;
        };

        return {
            apply,
            releasePeer: (peerId) => revisions.delete(peerId),
            reset: () => revisions.clear(),
        };
    };

    global.VoiceCallProtocol = {
        REFRESH_METADATA_FLAG,
        REFRESH_METADATA_KEY,
        createRefreshRevisionGate,
    };
})(window);
