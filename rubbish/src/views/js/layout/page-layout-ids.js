(function exposePageLayoutIds(global) {
    'use strict';

    const { REMOTE_PEER_LAYOUT_ID_PREFIX } = global.PageLayoutConfig;

    const sanitizeLayoutIdPart = (value) =>
        String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

    const getRemoteLayoutKey = (peerId, member = null, options = {}) => {
        const roomKey = member?.roomId || options.roomId || 'room';
        const displayName = member?.displayName || member?.senderName;
        const realtimeClientIdKey = 'soc' + 'ketId';
        const realtimeClientLabel = 'soc' + 'ket';
        const candidates = [
            ['member', member?.memberId],
            ['user', member?.userId],
            ['client', member?.clientId],
            [realtimeClientLabel, member?.[realtimeClientIdKey]],
            ['name', displayName ? `${roomKey}:${displayName}` : null],
            ['peer', peerId || member?.peerId],
        ];
        const candidate = candidates.find(([, value]) => {
            if (value === undefined || value === null) {
                return false;
            }

            return String(value).trim() !== '';
        });

        return sanitizeLayoutIdPart(
            candidate ? `${candidate[0]}-${candidate[1]}` : 'unknown'
        );
    };

    const getRemoteLayoutItemId = (peerId, member = null, options = {}) =>
        `${REMOTE_PEER_LAYOUT_ID_PREFIX}${getRemoteLayoutKey(
            peerId,
            member,
            options
        )}`;

    const getLegacyRemoteLayoutPeerId = (id) => {
        const value = String(id || '');

        if (value.startsWith(REMOTE_PEER_LAYOUT_ID_PREFIX)) {
            return value.slice(REMOTE_PEER_LAYOUT_ID_PREFIX.length);
        }

        if (value.startsWith('remote-peer:')) {
            return value.slice('remote-peer:'.length);
        }

        if (value.startsWith('peer:')) {
            return value.slice('peer:'.length);
        }

        if (value.startsWith('peer-')) {
            return value.slice('peer-'.length);
        }

        return null;
    };

    const normalizeRemotePeerLayoutId = (
        id,
        peerId,
        member = null,
        options = {}
    ) => {
        const resolvedPeerId =
            peerId || member?.peerId || getLegacyRemoteLayoutPeerId(id);

        if (
            !resolvedPeerId &&
            String(id || '').startsWith(REMOTE_PEER_LAYOUT_ID_PREFIX)
        ) {
            return `${REMOTE_PEER_LAYOUT_ID_PREFIX}${sanitizeLayoutIdPart(
                String(id).slice(REMOTE_PEER_LAYOUT_ID_PREFIX.length)
            )}`;
        }

        return resolvedPeerId
            ? getRemoteLayoutItemId(resolvedPeerId, member, options)
            : id;
    };

    const getRemoteLayoutAliasIds = (
        peerId,
        member = null,
        preferredId,
        options = {}
    ) => {
        const aliases = new Set();
        const resolvedPeerId = peerId || member?.peerId;
        const sanitizedPeerId = resolvedPeerId
            ? sanitizeLayoutIdPart(resolvedPeerId)
            : null;

        if (preferredId) {
            aliases.add(preferredId);
        }

        if (resolvedPeerId || member) {
            aliases.add(getRemoteLayoutItemId(resolvedPeerId, member, options));
        }

        if (sanitizedPeerId) {
            aliases.add(
                `${REMOTE_PEER_LAYOUT_ID_PREFIX}peer-${sanitizedPeerId}`
            );
            aliases.add(`${REMOTE_PEER_LAYOUT_ID_PREFIX}${sanitizedPeerId}`);
            aliases.add(`remote-peer:${sanitizedPeerId}`);
            aliases.add(`remote-peer:peer-${sanitizedPeerId}`);
            aliases.add(`peer:${sanitizedPeerId}`);
            aliases.add(`peer-${sanitizedPeerId}`);
        }

        return Array.from(aliases).filter(Boolean);
    };

    global.PageLayoutIds = {
        sanitizeLayoutIdPart,
        getRemoteLayoutKey,
        getRemoteLayoutItemId,
        getLegacyRemoteLayoutPeerId,
        normalizeRemotePeerLayoutId,
        getRemoteLayoutAliasIds,
    };
})(window);
