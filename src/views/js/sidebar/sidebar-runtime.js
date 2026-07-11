(function exposeVoiceSidebarRuntime(global) {
    'use strict';

    const CONNECTION_STATES = new Set([
        'connecting',
        'connected',
        'reconnecting',
        'offline',
        'failed',
    ]);
    const MEMBER_BOOLEAN_FIELDS = [
        'cameraOn',
        'hasMic',
        'joinedVoice',
        'micPermissionDenied',
        'muted',
        'screenSharing',
    ];

    const createSidebarRuntime = ({
        root,
        transport,
        stateView = global.VoiceChannelSidebarUI,
        participantsView = global.VoiceParticipantsListUI,
        presenceViewModel = global.VoicePresenceViewModel,
        initialViewingRoomId = '',
        initialVoiceRoomId = '',
        initialVoiceTargetRoomId = '',
        onRequestViewRoom = () => true,
        onRequestVoiceRoom = () => true,
        onPresenceSnapshot = () => {},
        onCopyRoomLink = () => {},
        getRoomUrl = (roomId) => `/room/${roomId}`,
        isLocalMember = () => false,
        getMemberTileToggle = () => undefined,
        logger = global.console,
    } = {}) => {
        if (!root) {
            throw new Error('Sidebar requires a root element.');
        }
        if (!transport) {
            throw new Error('Sidebar requires a transport adapter.');
        }

        [
            [
                'stateView.renderChannelListState',
                stateView?.renderChannelListState,
            ],
            [
                'participantsView.renderChannelCountBadge',
                participantsView?.renderChannelCountBadge,
            ],
            [
                'participantsView.renderParticipantsList',
                participantsView?.renderParticipantsList,
            ],
            ['participantsView.clearChildren', participantsView?.clearChildren],
            [
                'presenceViewModel.buildParticipantViewModel',
                presenceViewModel?.buildParticipantViewModel,
            ],
            ['transport.subscribePresence', transport?.subscribePresence],
            [
                'transport.subscribeConnectionState',
                transport?.subscribeConnectionState,
            ],
        ].forEach(([label, value]) => {
            if (typeof value !== 'function') {
                throw new TypeError(`Sidebar requires ${label}().`);
            }
        });

        let initialized = false;
        let destroyed = false;
        let viewingRoomId = initialViewingRoomId;
        let voiceRoomId = initialVoiceRoomId;
        let voiceTargetRoomId = initialVoiceTargetRoomId;
        let connectionState = 'connecting';
        let roomRevision = 0;
        let presenceSignature = '';
        let presenceSnapshot = { channels: [] };
        let roomRefs = new Map();
        let channelElements = [];
        const memberCounts = new Map();
        const subscriptions = [];

        const isActive = () => initialized && !destroyed;
        const hasRoom = (roomId) => roomRefs.has(roomId);
        const getRoomName = (roomId) =>
            roomRefs.get(roomId)?.name || String(roomId || '');
        const getRoomMemberCount = (roomId) => memberCounts.get(roomId) || 0;
        const getRoomElementFromTarget = (target) => {
            const roomElement = target?.closest?.('[data-channel-room]');
            return roomElement && root.contains(roomElement)
                ? roomElement
                : null;
        };
        const resolveRoomRefs = () => {
            const elements = Array.from(
                root.querySelectorAll('[data-channel-room]')
            );
            if (!elements.length) {
                throw new Error(
                    'Sidebar requires at least one channel element.'
                );
            }

            const nextRefs = new Map();
            elements.forEach((element) => {
                const roomId = String(element.dataset.channelRoom || '').trim();
                const link = element.querySelector('.tree-channel-link');
                const count = element.querySelector('[data-channel-count]');
                const members = element.querySelector('[data-members-for]');
                if (!roomId) {
                    throw new Error(
                        'Sidebar channel is missing data-channel-room.'
                    );
                }
                if (nextRefs.has(roomId)) {
                    throw new Error(`Sidebar channel ${roomId} is duplicated.`);
                }
                const missing = Object.entries({ link, count, members })
                    .filter(([, value]) => !value)
                    .map(([key]) => key);
                if (missing.length) {
                    throw new Error(
                        `Sidebar channel ${roomId} is missing required element(s): ${missing.join(', ')}.`
                    );
                }
                nextRefs.set(roomId, {
                    count,
                    element,
                    link,
                    members,
                    name: element.dataset.channelName || roomId,
                });
            });
            return { elements, refs: nextRefs };
        };

        const renderRoomState = () => {
            stateView.renderChannelListState(channelElements, {
                joinedRoomId: voiceRoomId,
                memberCounts,
                selectedRoomId: voiceTargetRoomId,
                viewingRoomId,
            });
        };

        const setViewingRoom = (roomId) => {
            if (!isActive() || !hasRoom(roomId) || viewingRoomId === roomId) {
                return false;
            }
            viewingRoomId = roomId;
            root.dataset.viewingRoomId = roomId;
            renderRoomState();
            return true;
        };

        const setVoiceRoom = (roomId = '', { targetRoomId = '' } = {}) => {
            if (
                !isActive() ||
                (roomId && !hasRoom(roomId)) ||
                (targetRoomId && !hasRoom(targetRoomId))
            ) {
                return false;
            }
            if (voiceRoomId === roomId && voiceTargetRoomId === targetRoomId) {
                return false;
            }
            voiceRoomId = roomId;
            voiceTargetRoomId = targetRoomId;
            root.dataset.voiceRoomId = roomId;
            root.dataset.voiceTargetRoomId = targetRoomId;
            renderRoomState();
            return true;
        };

        const setConnectionState = (state) => {
            if (!CONNECTION_STATES.has(state) || destroyed) {
                return false;
            }
            if (
                connectionState === state &&
                root.dataset.connectionState === state
            ) {
                return false;
            }
            connectionState = state;
            root.dataset.connectionState = state;
            root.classList.toggle('is-reconnecting', state === 'reconnecting');
            root.classList.toggle('is-offline', state === 'offline');
            root.classList.toggle('is-connection-failed', state === 'failed');
            root.setAttribute(
                'aria-busy',
                String(state === 'connecting' || state === 'reconnecting')
            );
            return true;
        };

        const clearConnectionStateDom = () => {
            delete root.dataset.connectionState;
            root.classList.remove(
                'is-reconnecting',
                'is-offline',
                'is-connection-failed'
            );
            root.removeAttribute('aria-busy');
        };

        const clearMemberDom = () => {
            roomRefs.forEach((refs) =>
                participantsView.clearChildren(refs.members)
            );
            memberCounts.clear();
            presenceSnapshot = { channels: [] };
            presenceSignature = '';
        };

        const normalizeMember = (member, roomId) => {
            const normalized = {
                peerId: String(member?.peerId || ''),
                roomId,
                senderName: String(member?.senderName || 'Guest'),
                socketId: String(member?.socketId || ''),
            };
            MEMBER_BOOLEAN_FIELDS.forEach((field) => {
                normalized[field] = member?.[field] === true;
            });
            return normalized;
        };

        const normalizePresence = ({ channels = [] } = {}) => {
            const channelsByRoom = new Map(
                (Array.isArray(channels) ? channels : []).map((channel) => [
                    channel?.slug,
                    channel,
                ])
            );
            return {
                channels: Array.from(roomRefs, ([roomId]) => {
                    const channel = channelsByRoom.get(roomId);
                    const membersBySocket = new Map();
                    (Array.isArray(channel?.members) ? channel.members : [])
                        .map((member) => normalizeMember(member, roomId))
                        .filter((member) => member.socketId)
                        .forEach((member) =>
                            membersBySocket.set(member.socketId, member)
                        );
                    const members = Array.from(membersBySocket.values());
                    const countValue = Number(channel?.count);
                    return {
                        count: Number.isFinite(countValue)
                            ? Math.max(0, countValue)
                            : members.length,
                        members,
                        slug: roomId,
                    };
                }),
            };
        };

        const renderPresence = (snapshot = {}) => {
            if (!isActive()) {
                return false;
            }
            const normalized = normalizePresence(snapshot);
            const nextSignature = JSON.stringify(normalized);
            if (nextSignature === presenceSignature) {
                return false;
            }
            presenceSignature = nextSignature;
            presenceSnapshot = normalized;

            normalized.channels.forEach((channel) => {
                const refs = roomRefs.get(channel.slug);
                const participants = channel.members.map((member) =>
                    presenceViewModel.buildParticipantViewModel(member, {
                        isLocal: Boolean(isLocalMember(member)),
                        roomName: refs.name,
                        tileToggle: getMemberTileToggle(member),
                    })
                );
                memberCounts.set(channel.slug, channel.count);
                participantsView.renderChannelCountBadge(
                    refs.count,
                    channel.count
                );
                participantsView.renderParticipantsList(
                    refs.members,
                    participants
                );
            });
            renderRoomState();
            return true;
        };

        const copyRoomLink = (roomId = viewingRoomId) => {
            if (!isActive() || !hasRoom(roomId)) {
                return false;
            }
            try {
                const result = onCopyRoomLink({
                    roomId,
                    url: getRoomUrl(roomId),
                });
                return result?.then
                    ? Promise.resolve(result).catch((error) => {
                          logger?.warn?.('Sidebar copy link failed.', error);
                          return false;
                      })
                    : result;
            } catch (error) {
                logger?.warn?.('Sidebar copy link failed.', error);
                return false;
            }
        };

        const requestViewRoom = (roomId) => {
            if (!isActive() || !hasRoom(roomId) || roomId === viewingRoomId) {
                return false;
            }
            const revision = ++roomRevision;
            let request;
            try {
                request = onRequestViewRoom(roomId);
            } catch (error) {
                logger?.warn?.('Sidebar room navigation failed.', error);
                return false;
            }
            Promise.resolve(request)
                .then((accepted) => {
                    if (
                        isActive() &&
                        revision === roomRevision &&
                        accepted !== false
                    ) {
                        setViewingRoom(roomId);
                    }
                })
                .catch((error) => {
                    if (isActive() && revision === roomRevision) {
                        logger?.warn?.(
                            'Sidebar room navigation failed.',
                            error
                        );
                    }
                });
            return true;
        };

        const handleClick = (event) => {
            const copyButton = event.target?.closest?.(
                '[data-sidebar-copy-room]'
            );
            if (copyButton && root.contains(copyButton)) {
                event.preventDefault();
                copyRoomLink(
                    copyButton.dataset.sidebarCopyRoom || viewingRoomId
                );
                return;
            }
            const link = event.target?.closest?.('.tree-channel-link');
            const roomElement = getRoomElementFromTarget(link);
            if (!link || !roomElement) {
                return;
            }
            event.preventDefault();
            requestViewRoom(roomElement.dataset.channelRoom);
        };

        const handleDoubleClick = (event) => {
            const link = event.target?.closest?.('.tree-channel-link');
            const roomElement = getRoomElementFromTarget(link);
            if (!link || !roomElement) {
                return;
            }
            event.preventDefault();
            try {
                onRequestVoiceRoom(roomElement.dataset.channelRoom);
            } catch (error) {
                logger?.warn?.('Sidebar voice room request failed.', error);
            }
        };

        const handlePresence = (snapshot) => {
            if (!isActive()) {
                return;
            }
            try {
                onPresenceSnapshot(snapshot);
            } catch (error) {
                logger?.warn?.('Sidebar presence callback failed.', error);
            }
            renderPresence(snapshot);
        };

        const init = () => {
            if (destroyed) {
                throw new Error(
                    'Destroyed Sidebar runtime cannot be re-initialized.'
                );
            }
            if (initialized) {
                return false;
            }

            const resolved = resolveRoomRefs();
            const stagedSubscriptions = [];
            [
                ['viewing room', viewingRoomId],
                ['voice room', voiceRoomId],
                ['voice target room', voiceTargetRoomId],
            ].forEach(([label, roomId]) => {
                if (roomId && !resolved.refs.has(roomId)) {
                    throw new Error(
                        `Sidebar initial ${label} ${roomId} is invalid.`
                    );
                }
            });
            roomRefs = resolved.refs;
            channelElements = resolved.elements;
            initialized = true;
            try {
                stagedSubscriptions.push(
                    transport.subscribePresence(handlePresence)
                );
                stagedSubscriptions.push(
                    transport.subscribeConnectionState(setConnectionState)
                );
                if (
                    stagedSubscriptions.some(
                        (unsubscribe) => typeof unsubscribe !== 'function'
                    )
                ) {
                    throw new TypeError(
                        'Sidebar transport subscriptions must return unsubscribe functions.'
                    );
                }
                subscriptions.push(...stagedSubscriptions);
                root.addEventListener('click', handleClick);
                root.addEventListener('dblclick', handleDoubleClick);
                root.dataset.viewingRoomId = viewingRoomId;
                root.dataset.voiceRoomId = voiceRoomId;
                root.dataset.voiceTargetRoomId = voiceTargetRoomId;
                renderRoomState();
                return true;
            } catch (error) {
                stagedSubscriptions.forEach((unsubscribe) => unsubscribe?.());
                clearMemberDom();
                clearConnectionStateDom();
                initialized = false;
                roomRefs = new Map();
                channelElements = [];
                throw error;
            }
        };

        const focusRoom = (roomId) => {
            if (!isActive() || !hasRoom(roomId)) {
                return false;
            }
            roomRefs.get(roomId).link.focus();
            return true;
        };

        const destroy = () => {
            if (destroyed) {
                return false;
            }
            destroyed = true;
            roomRevision += 1;
            root.removeEventListener('click', handleClick);
            root.removeEventListener('dblclick', handleDoubleClick);
            subscriptions.splice(0).forEach((unsubscribe) => unsubscribe?.());
            clearMemberDom();
            return true;
        };

        return {
            copyRoomLink,
            destroy,
            focusRoom,
            getRootElement: () => root,
            getPresenceSnapshot: () => presenceSnapshot,
            getRoomMemberCount,
            getRoomName,
            hasRoom,
            init,
            renderPresence,
            setConnectionState,
            setViewingRoom,
            setVoiceRoom,
        };
    };

    global.VoiceSidebarRuntime = {
        CONNECTION_STATES,
        createSidebarRuntime,
    };
})(window);
