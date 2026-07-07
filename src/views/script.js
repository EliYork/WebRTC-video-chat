/* eslint-disable no-console */
console.info('[page-layout] script boot v2 ' + new Date().toISOString());
let socket;

const { byId, formatTime, queryAll } = window.VoiceViewUtils;

const videoGrid = byId('video-grid');
const mainLayout = byId('main');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const callControls = byId('buttons');
const destroyPeerBtn = byId('destroyPeer');
const copyRoomLinkBtn = byId('copyRoomLink');
const chatNameInput = byId('chatName');
const chatMessages = byId('chatMessages');
const chatForm = byId('chatForm');
const chatInput = byId('chatInput');
const treeChannels = queryAll('[data-channel-room]');
const channelMemberLists = queryAll('[data-members-for]');
const channelCountBadges = queryAll('[data-channel-count]');
const chatTitle = byId('chatTitle');
const localUserCard = document.querySelector('.local-user-card');
const localUserName = byId('localUserName');
const localVoiceChannelName = byId('localVoiceChannelName');
const callStatusText = byId('callStatusText');
const callDuration = byId('callDuration');
const screenStatusText = byId('screenStatusText');
const shareScreenBtn = byId('shareScreen');
const controlMenuToggles = queryAll('[data-control-menu]');
const controlPanels = queryAll('[data-control-panel]');
const mobileBackToChannelsBtn = byId('mobileBackToChannels');
const mobilePrevTileBtn = byId('mobilePrevTile');
const mobileNextTileBtn = byId('mobileNextTile');
const mobileTileCount = byId('mobileTileCount');
const noiseSettingsUI = window.VoiceNoiseSettingsUI;
const controlPopoversUI = window.VoiceControlPopoversUI;
const remoteVolumeUI = window.VoiceRemoteVolumeUI;
const copyLinkUI = window.VoiceCopyLinkUI;
const outputVolumeState = window.VoiceOutputVolumeState;
const outputVolumeUI = window.VoiceOutputVolumeUI;
const mediaControlsUI = window.VoiceMediaControlsUI;
const fullscreenControls = window.VoiceFullscreenControls;
const voiceJoinOverlayUI = window.VoiceJoinOverlayUI;
const layoutEditUI = window.PageLayoutEditUI;
const layoutComponentActionsUI = window.PageLayoutComponentActionsUI;
const layoutToolbarUI = window.PageLayoutToolbarUI;
const layoutComponentMenuUI = window.PageLayoutComponentMenuUI;
const layoutRecoveryUI = window.PageLayoutRecoveryUI;
const layoutSnapUtils = window.PageLayoutSnapUtils;
const layoutResizeUtils = window.PageLayoutResizeUtils;
const layoutStorage = window.PageLayoutStorage;
const layoutConfig = window.PageLayoutConfig;
const layoutComponents = window.PageLayoutComponents;
const layoutPlacementUtils = window.PageLayoutPlacementUtils;
const layoutEditorRuntime = window.PageLayoutEditorRuntime;
const layoutComponentRuntime = window.PageLayoutComponentRuntime;
const roomUIState = window.VoiceRoomUIState;
const mobileRoomState = window.VoiceMobileRoomState;
const presenceViewModel = window.VoicePresenceViewModel;
const participantsListUI = window.VoiceParticipantsListUI;
const tileStatusUI = window.VoiceTileStatusUI;
const videoTileStructureUI = window.VoiceVideoTileStructureUI;
const chatMessageUI = window.VoiceChatMessageUI;
const chatFormUI = window.VoiceChatFormUI;
const chatNameState = window.VoiceChatNameState;
const channelSidebarUI = window.VoiceChannelSidebarUI;
const cursorShareUI = window.VoiceCursorShareUI;
const {
    buildParticipantViewModel,
    getMemberMicStatus,
    getMemberStatusIcons,
    getMemberTileText,
} = presenceViewModel;
const {
    PAGE_COMPONENT_TYPES,
    LAYOUT_ITEM_TYPES,
    LEGACY_LAYOUT_ITEM_TYPES,
    AUTO_LAYOUT_GRID_SIZES,
    LAYOUT_PREFERENCE_DEFAULTS,
    getDefaultComponentConfig,
    normalizeComponentConfig,
    getDefaultLayoutPreferences,
    normalizeLayoutPreferences,
    getLayoutPreferenceValue,
} = layoutConfig;
const layoutIds = window.PageLayoutIds;
const {
    getDefaultLayoutItems,
    getLayoutComponentId,
    renderLayoutComponentTile: renderLayoutComponentTileContent,
} = layoutComponents;
const remoteStreams = {};
const getAudioConstraints = () => noiseSettingsUI.getAudioConstraints();

const CHAT_MESSAGE_MAX_LENGTH = 500;
const CURSOR_THROTTLE_MS = 40;
const CURSOR_IDLE_MS = 700;
const MOBILE_BREAKPOINT = 768;
const TILE_MIN_WIDTH = 180;
const TILE_MIN_HEIGHT = 120;
const TILE_BASE_Z_INDEX = 2;
const TILE_RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
const LAYOUT_RESIZE_HOVER_CLASSES = [
    'is-layout-resize-hover',
    ...TILE_RESIZE_DIRECTIONS.map((direction) => `resize-hover-${direction}`),
];
const TILE_RESIZE_CURSORS = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
};
const TILE_RESIZE_EDGE_INSET_PX = 8;
const TILE_RESIZE_EDGE_OUTSET_PX = 8;
const TILE_RESIZE_CORNER_SIZE_PX = 24;
const LAYOUT_MIN_GRID_W = 3;
const LAYOUT_MIN_GRID_H = 2;
const PAGE_GRID_COLUMNS = 32;
const PAGE_GRID_ROWS = 18;
const PAGE_STORAGE_VERSION = 1;
const PAGE_LAYOUT_STORAGE_KEY_PREFIX = 'voicePageLayout:v2';
const PAGE_SINGLETON_TYPES = new Set([
    PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
    PAGE_COMPONENT_TYPES.CHAT_PANEL,
]);
const REAL_DOM_PAGE_TYPES = PAGE_SINGLETON_TYPES;
const PAGE_TILE_MIN_WIDTH = 160;
const PAGE_TILE_MIN_HEIGHT = 80;
let pageLayoutBoard;
let pageLayoutRuntime;
let layoutPreferences = { ...LAYOUT_PREFERENCE_DEFAULTS };

const updateLayoutItemConfig = (id, patch) => {
    const item = getTileLayoutItem(id);
    if (!item) {
        return;
    }
    item.config = normalizeComponentConfig(item.type, {
        ...item.config,
        ...patch,
    });
    layoutItemsById.set(id, item);
    saveLayoutToStorage('配置已更新');
};

const readLayoutPreferencesFromStorage = () => {
    return layoutStorage.readLayoutPreferencesFromStorage({
        storageKey: getLayoutStorageKey(),
        normalizeLayoutPreferences,
        getDefaultLayoutPreferences,
    });
};

const getLayoutPreference = (key) => {
    return getLayoutPreferenceValue(layoutPreferences, key);
};
const cursorSharingMedia = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT}px), (pointer: coarse)`
);
const cursorIdleTimers = {};

const isAiExperimentSupported = () =>
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !isMobileLayout();

const getAiExperimentEnabled = () => noiseSettingsUI.getAiExperimentEnabled();
let myVideoStream;
let activeStream;
let cameraStream;
let activeVideoTrack;
let localPeerId;
let lastCursorMoveAt = 0;
let viewingRoomId;
let selectedVoiceRoomId;
let joinedVoiceRoomId;
let currentPeer;
let isConnectingToPeer = false;
let pendingVoiceRoomId;
let callStartedAt;
let callDurationTimer;
let outputMuted = false;
let outputVolume = 1;
const remotePeerOrder = [];
const screenSharers = new Set();
const peersWithCallHandler = new WeakSet();
const presenceMembersByPeerId = new Map();
const layoutItemsById = new Map();
let tileLayoutZIndex = TILE_BASE_Z_INDEX;
let layoutEditMode = false;
let layoutStorageHydrating = false;
let pageLayoutEditorRuntime;
let pageLayoutComponentRuntime;
const layoutResizeBoundBoards = new WeakSet();
let noiseAudioContext = null;
let noiseProcessorNode = null;
// eslint-disable-next-line no-unused-vars
let noiseProcessorActive = false;
let noiseRawStream = null;
let noiseMode = 'raw';
let noiseGainNode = null;
let noiseSettingsControls;
let micPermissionDenied = false;

const syncNoiseSettingsUI = () => {
    if (noiseSettingsControls) {
        noiseSettingsControls.sync();
        return;
    }

    noiseSettingsUI.updateNoiseToggleUI();
    noiseSettingsUI.updateAiExperimentToggleUI({
        supported: isAiExperimentSupported(),
        noiseMode,
    });
};

// eslint-disable-next-line no-undef
viewingRoomId = ROOM_ID;
// eslint-disable-next-line no-undef
selectedVoiceRoomId = ROOM_ID;

const showCallControls = () => {
    mediaControlsUI.renderCallControls({
        refs: { controls: callControls, leaveButton: destroyPeerBtn },
        visible: true,
    });
    mediaControlsUI.renderLeaveButtonState({
        refs: { leaveButton: destroyPeerBtn },
    });
};

const hideCallControls = () => {
    mediaControlsUI.renderCallControls({
        refs: { controls: callControls, leaveButton: destroyPeerBtn },
        visible: false,
    });
};

const isMobileLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

const getVideoTiles = () =>
    Array.from((pageLayoutBoard || videoGrid).querySelectorAll('.video-tile'));

const mobileRoomController = mobileRoomState.createMobileRoomState({
    refs: {
        count: mobileTileCount,
        mainLayout,
        nextButton: mobileNextTileBtn,
        previousButton: mobilePrevTileBtn,
    },
    getTiles: getVideoTiles,
    getLocalTileId: () => 'local-video',
    getRemotePeerOrder: () => remotePeerOrder,
    isScreenSharingPeer: (peerId) => screenSharers.has(peerId),
    isMobileLayout,
    renderMobileTileNav: roomUIState.renderMobileTileNav,
    toggleRoomClass: roomUIState.toggleClass,
});

const CORE_PAGE_TYPES = [
    PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
    PAGE_COMPONENT_TYPES.CHAT_PANEL,
];

const getPagePanelLabel = (type) =>
    pageLayoutRuntime?.getPagePanelLabel(type) || type;

const syncLayoutGridMetadata = () => {
    pageLayoutRuntime?.syncLayoutGridMetadata();
};

const restoreOriginalStaticLayout = () => {
    pageLayoutRuntime?.restoreOriginalStaticLayout();
};

const ensureLayoutEditModeToggle = () =>
    pageLayoutEditorRuntime?.ensureToolbar().editModeToggle;

const syncLayoutEditModeUI = () =>
    pageLayoutEditorRuntime?.syncEditModeUI();

const setLayoutEditMode = (enabled) =>
    pageLayoutEditorRuntime?.setEditMode(enabled);

const updateMobileTileView = () => mobileRoomController.updateTileView();

const setMobileRoomView = (isInRoom) =>
    mobileRoomController.setRoomView(isInRoom);

const updateMobileRoomState = () => {
    mobileRoomController.updateRoomState(Boolean(joinedVoiceRoomId));
};

const updateCallDuration = () => {
    if (!callStartedAt || !callDuration) {
        return;
    }

    roomUIState.renderCallTimer({
        refs: { duration: callDuration },
        elapsedMs: Date.now() - callStartedAt,
    });
};

const startCallTimer = () => {
    callStartedAt = Date.now();
    updateCallDuration();
    clearInterval(callDurationTimer);
    callDurationTimer = setInterval(updateCallDuration, 1000);
};

const stopCallTimer = () => {
    clearInterval(callDurationTimer);
    callDurationTimer = undefined;
    callStartedAt = undefined;

    roomUIState.renderCallTimer({
        refs: { duration: callDuration },
        text: '00:00',
    });
};

const hasLiveCameraTrack = () =>
    Boolean(
        cameraStream
            ?.getVideoTracks()
            .some((track) => track.readyState === 'live')
    );

const getLocalPresenceState = () => {
    const audioTrack = myVideoStream?.getAudioTracks()[0];

    return {
        peerId: localPeerId,
        hasMic: Boolean(audioTrack),
        micPermissionDenied,
        muted: Boolean(audioTrack && !audioTrack.enabled),
        cameraOn: hasLiveCameraTrack(),
        screenSharing: Boolean(sharingNow),
    };
};

const getLocalPresenceMember = () => ({
    socketId: socket?.id,
    peerId: localPeerId,
    roomId: joinedVoiceRoomId,
    senderName: getChatName(),
    joinedVoice: Boolean(joinedVoiceRoomId),
    ...getLocalPresenceState(),
});

const emitLocalPresenceUpdate = (extra = {}) => {
    if (!joinedVoiceRoomId) {
        return;
    }

    ensureSocket().emit('presence:update', {
        roomId: joinedVoiceRoomId,
        senderName: getChatName(),
        ...getLocalPresenceState(),
        ...extra,
    });

    if (localPeerId) {
        presenceMembersByPeerId.set(localPeerId, getLocalPresenceMember());
    }
    updateAllVideoTileStatus();
};

const getCallStatusLabel = (
    micStatus = getMemberMicStatus(getLocalPresenceMember())
) => {
    if (!joinedVoiceRoomId) {
        return '未进入频道';
    }

    if (micStatus.key === 'speaking') {
        return '正在语音中';
    }

    if (micStatus.key === 'muted') {
        return '静音中';
    }

    if (micStatus.key === 'denied') {
        return '麦克风未授权';
    }

    return '未开麦';
};

const updateLocalUserCard = () => {
    const micStatus = getMemberMicStatus(getLocalPresenceMember());

    roomUIState.renderLocalUserCard({
        refs: {
            card: localUserCard,
            channelName: localVoiceChannelName,
            name: localUserName,
            screenStatus: screenStatusText,
            statusText: callStatusText,
        },
        channelName: getChannelName(joinedVoiceRoomId || viewingRoomId),
        connected: Boolean(joinedVoiceRoomId),
        connecting: isConnectingToPeer,
        displayName: getChatName(),
        micStatusKey: micStatus.key,
        muted: micStatus.key === 'muted',
        screenHidden: true,
        speaking: micStatus.key === 'speaking',
        statusText: isConnectingToPeer
            ? '正在连接语音'
            : getCallStatusLabel(micStatus),
    });

    syncNoiseSettingsUI();
    updateAllVideoTileStatus();
};

const getPeerVolume = (peerId) => outputVolumeState.getPeerVolume(peerId);

const setPeerVolume = (peerId, volume) =>
    outputVolumeState.setPeerVolume(peerId, volume);

const applyOutputSettings = (mediaElement, isRemote) => {
    if (!mediaElement) {
        return;
    }

    if (isRemote && outputMuted) {
        mediaElement.volume = outputVolumeState.getEffectiveOutputVolume(
            0,
            getPeerVolume(mediaElement.closest('.video-tile')?.dataset.peerId)
        );
        mediaElement.muted = true;
    } else {
        const peerId = mediaElement.closest('.video-tile')?.dataset.peerId;
        const peerVolume = isRemote ? getPeerVolume(peerId) : 1;
        mediaElement.volume = outputVolumeState.getEffectiveOutputVolume(
            outputVolume,
            peerVolume
        );
        mediaElement.muted = !isRemote;
    }
};

const applyOutputSettingsToRemoteMedia = () => {
    document.querySelectorAll('.video-tile').forEach((tile) => {
        const mediaElement = tile.querySelector('video, audio');
        applyOutputSettings(mediaElement, tile.id !== 'local-video');
    });
};

const updateOutputButtonState = () => {
    outputVolumeUI.renderState({ muted: outputMuted, volume: outputVolume });
};

const updateScreenShareButtonState = () => {
    const icon = shareScreenBtn?.querySelector('i');
    const label = shareScreenBtn?.querySelector('span');

    if (icon) {
        icon.className = 'far fa-newspaper';
        shareScreenBtn.classList.toggle('is-off', !sharingNow);
        shareScreenBtn.setAttribute('aria-pressed', String(sharingNow));
    }

    if (label) {
        label.textContent = sharingNow ? '共享中' : '共享';
    }
};

const resetLocalVoiceState = () => {
    destroyProcessedAudioStream();
    stopCurrentScreenStream();
    cameraStream?.getTracks().forEach((track) => track.stop());
    myVideoStream?.getTracks().forEach((track) => track.stop());
    myVideoStream = undefined;
    activeStream = undefined;
    cameraStream = undefined;
    activeVideoTrack = undefined;
    currentScreenStream = undefined;
    sharingNow = false;
    micPermissionDenied = false;
    setCameraButtonState(false);
    setAudioButtonNoMic();
    stopCallTimer();
    updateScreenShareButtonState();
    updateLocalUserCard();
};

const getChannelElement = (roomId) =>
    Array.from(treeChannels).find(
        (channel) => channel.dataset.channelRoom === roomId
    );

const getChannelName = (roomId) =>
    getChannelElement(roomId)?.dataset.channelName || roomId;

const getChannelUrl = (roomId) => `${window.location.origin}/room/${roomId}`;

const getCopyRoomId = () => joinedVoiceRoomId || viewingRoomId;

const updateChannelIndicators = () => {
    channelSidebarUI.renderChannelListState(treeChannels, {
        joinedRoomId: joinedVoiceRoomId,
        selectedRoomId: selectedVoiceRoomId,
        viewingRoomId,
    });

    const viewingName = getChannelName(viewingRoomId);
    roomUIState.renderRoomHeader({
        refs: { chatTitle },
        channelName: viewingName,
    });

    updateLocalUserCard();
    updateMobileRoomState();
};

const connectToNewUser = (peer, peerId, stream, options = {}) => {
    console.log(
        `User ${peerId} has joined the socket room. Initiating peer call`
    );

    const call = peer.call(peerId, stream, options);
    setupCallStreamHandler(call, peerId);
};

const addKnownRemotePeer = (peerId) => {
    if (!peerId || peerId === localPeerId) {
        return;
    }

    if (!remotePeerOrder.includes(peerId)) {
        remotePeerOrder.push(peerId);
    }
};

const getKnownRemotePeerIds = (peer) =>
    Array.from(
        new Set([
            ...remotePeerOrder,
            ...Object.keys(peer?.connections || {}),
            ...presenceMembersByPeerId.keys(),
        ])
    ).filter((peerId) => peerId && peerId !== localPeerId);

const handleSocketUserConnected = ({ roomId, peerId }) => {
    console.info('[voice] userConnected', { roomId, peerId });

    if (roomId !== joinedVoiceRoomId || peerId === localPeerId) {
        return;
    }

    if (!currentPeer || currentPeer.destroyed) {
        return;
    }

    addKnownRemotePeer(peerId);
    ensurePresenceTileForPeer(peerId);

    const stream = getActiveStream();

    if (stream.getTracks().length > 0) {
        connectToNewUser(currentPeer, peerId, stream);
    }
};

const handleSocketRemoveUserVideo = ({ roomId, peerId }) => {
    if (roomId !== joinedVoiceRoomId) {
        return;
    }

    const idx = remotePeerOrder.indexOf(peerId);

    if (idx !== -1) {
        remotePeerOrder.splice(idx, 1);
    }

    screenSharers.delete(peerId);
    removeVideoElement(peerId);
};

const bindVoiceSocketHandlers = (activeSocket) => {
    activeSocket.off('userConnected', handleSocketUserConnected);
    activeSocket.off('removeUserVideo', handleSocketRemoveUserVideo);
    activeSocket.on('userConnected', handleSocketUserConnected);
    activeSocket.on('removeUserVideo', handleSocketRemoveUserVideo);
};

const getStoredChatName = () => chatNameState.getStoredChatName();

const getChatName = () => chatNameState.getChatName(chatNameInput?.value);

const saveChatName = () => {
    if (!chatNameInput) {
        return;
    }

    const name = chatNameState.saveChatName(chatNameInput.value);
    chatNameInput.value = name;
};

const getChatMessageViewModel = (message) => ({
    content: message.content,
    isLocal: message.senderName === getChatName(),
    isSystem: message.type === 'system',
    roomId: message.roomId,
    senderName: message.senderName,
    timeText: formatTime(message.createdAt),
    type: message.type || 'normal',
});

const appendChatMessage = (message) => {
    if (!chatMessages || !message?.content) {
        return;
    }

    if (message.roomId && message.roomId !== viewingRoomId) {
        return;
    }

    chatMessageUI.appendChatMessage(
        chatMessages,
        getChatMessageViewModel(message)
    );
};

const renderChatHistory = (messages) => {
    if (!chatMessages) {
        return;
    }

    chatMessageUI.renderChatHistory(
        chatMessages,
        (Array.isArray(messages) ? messages : [])
            .filter(
                (message) => !message.roomId || message.roomId === viewingRoomId
            )
            .map(getChatMessageViewModel)
    );
};

const getMemberTileToggle = (member) => {
    const memberPeerId = member.peerId;

    if (!memberPeerId) {
        return undefined;
    }

    if (memberPeerId === localPeerId) {
        const localTile = document.getElementById('local-video');
        const layoutItem = localTile?.dataset.layoutItemId
            ? getTileLayoutItem(localTile.dataset.layoutItemId)
            : null;
        const isVisible =
            layoutItem?.visible !== false &&
            (!localTile || !localTile.classList.contains('is-layout-hidden'));

        return {
            icon: isVisible ? 'fas fa-eye' : 'fas fa-eye-slash',
            label: '显示/隐藏我的语音组件',
            onClick: () => toggleLocalPeerTileVisibility(),
        };
    }

    const tileForPeer = document.getElementById(memberPeerId);
    const layoutItemId =
        tileForPeer?.dataset.layoutItemId ||
        getRemoteLayoutItemId(memberPeerId, member);
    const layoutItem = getTileLayoutItem(layoutItemId);
    const isVisible =
        layoutItem?.visible !== false &&
        (!tileForPeer || !tileForPeer.classList.contains('is-layout-hidden'));

    return {
        icon: isVisible ? 'fas fa-eye' : 'fas fa-eye-slash',
        label: '显示/隐藏组件',
        onClick: () => toggleMemberTileVisibility(memberPeerId),
    };
};

const getParticipantViewModel = (member) => {
    const isLocal = Boolean(member.socketId && socket?.id === member.socketId);

    return buildParticipantViewModel(member, {
        isLocal,
        roomName: getChannelName(member.roomId),
        tileToggle: getMemberTileToggle(member),
    });
};

const renderPresenceState = ({ channels = [] } = {}) => {
    presenceMembersByPeerId.clear();

    channels.forEach((channel) => {
        (channel.members || []).forEach((member) => {
            if (member.peerId) {
                presenceMembersByPeerId.set(member.peerId, member);
            }
        });
    });

    channelCountBadges.forEach((badge) => {
        const channel = channels.find(
            (currentChannel) =>
                currentChannel.slug === badge.dataset.channelCount
        );

        participantsListUI.renderChannelCountBadge(badge, channel?.count || 0);
    });

    channelMemberLists.forEach((list) => {
        const channel = channels.find(
            (currentChannel) => currentChannel.slug === list.dataset.membersFor
        );
        const membersBySocket = new Map();

        (channel?.members || []).forEach((member) => {
            if (!member.socketId) {
                return;
            }

            membersBySocket.set(member.socketId, member);
        });

        participantsListUI.renderParticipantsList(
            list,
            Array.from(membersBySocket.values()).map(getParticipantViewModel)
        );
    });

    syncPresenceTilesForJoinedRoom(channels);
    updateAllVideoTileStatus();
};

const ensureSocket = () => {
    if (socket) {
        return socket;
    }

    // eslint-disable-next-line no-undef
    socket = io({
        query: {
            // eslint-disable-next-line no-undef
            roomId: ROOM_ID,
        },
    });

    socket.on('chat:history', renderChatHistory);
    socket.on('chat:message', appendChatMessage);
    socket.on('presence:state', renderPresenceState);
    socket.on('cursor:move', renderRemoteCursor);
    socket.on('cursor:leave', markRemoteCursorIdle);
    socket.on('cursor:remove', removeRemoteCursor);
    socket.on('screen:shareStart', ({ peerId }) => {
        screenSharers.add(peerId);
        if (getLayoutPreference('autoShowScreenShare')) {
            const tile = document.getElementById(peerId);
            if (tile && tile.classList.contains('is-layout-hidden')) {
                setTileLayoutItemVisibility(tile.dataset.layoutItemId, true);
                tile.classList.remove('is-layout-hidden');
                bringTileLayoutToFront(tile);
            }
        }
        updateAllVideoTileStatus();
        updateMobileTileView();
    });
    socket.on('screen:shareStop', ({ peerId }) => {
        screenSharers.delete(peerId);
        updateAllVideoTileStatus();
        updateMobileTileView();
    });

    return socket;
};

const joinChatRoom = (roomId = viewingRoomId) => {
    const activeSocket = ensureSocket();

    activeSocket.emit('chat:join', {
        roomId,
        senderName: getChatName(),
    });
};

const getChatFormRefs = () => ({
    form: chatForm,
    input: chatInput,
});

const getPendingChatContent = () =>
    chatFormUI.getMessageContent({
        refs: getChatFormRefs(),
        maxLength: CHAT_MESSAGE_MAX_LENGTH,
    });

const syncChatFormUI = () => {
    const hasContent = Boolean(getPendingChatContent());

    chatFormUI.renderInputState({
        refs: getChatFormRefs(),
        maxLength: CHAT_MESSAGE_MAX_LENGTH,
    });
    chatFormUI.renderSubmitState({
        refs: getChatFormRefs(),
        disabled: !hasContent,
    });
};

const updatePresenceName = () => {
    emitLocalPresenceUpdate();
    updateLocalUserCard();
};

const setViewingRoom = (roomId, { updateHistory = true } = {}) => {
    if (!getChannelElement(roomId)) {
        return;
    }

    viewingRoomId = roomId;
    updateChannelIndicators();
    clearRemoteCursors();
    renderChatHistory([]);
    joinChatRoom(viewingRoomId);

    if (updateHistory) {
        window.history.pushState({ roomId }, '', `/room/${roomId}`);
    }
};

const setVoiceTargetRoom = (roomId) => {
    if (!getChannelElement(roomId)) {
        return;
    }

    if (joinedVoiceRoomId === roomId) {
        console.info(`Already in voice channel ${getChannelName(roomId)}.`);
        return;
    }

    if (joinedVoiceRoomId && joinedVoiceRoomId !== roomId) {
        selectedVoiceRoomId = roomId;
        pendingVoiceRoomId = roomId;
        document.getElementById('destroyPeer')?.click();
        updateChannelIndicators();
        return;
    }

    selectedVoiceRoomId = roomId;
    updateChannelIndicators();
    joinVoiceChannel(roomId);
};

const sendChatMessage = () => {
    const content = getPendingChatContent();

    if (!content) {
        syncChatFormUI();
        return;
    }

    saveChatName();
    updatePresenceName();
    ensureSocket().emit('chat:send', {
        roomId: viewingRoomId,
        senderName: getChatName(),
        content,
    });

    chatFormUI.resetForm({ refs: getChatFormRefs(), focus: true });
    syncChatFormUI();
};

const clampCursorPosition = (position) =>
    Math.min(1, Math.max(0, Number(position) || 0));

const clearCursorIdleTimer = (socketId) => {
    if (!cursorIdleTimers[socketId]) {
        return;
    }

    clearTimeout(cursorIdleTimers[socketId]);
    delete cursorIdleTimers[socketId];
};

const scheduleCursorIdle = (socketId) => {
    clearCursorIdleTimer(socketId);
    cursorIdleTimers[socketId] = setTimeout(
        () => cursorShareUI.setCursorIdle(socketId),
        CURSOR_IDLE_MS
    );
};

const renderRemoteCursor = ({ roomId, socketId, x, y, senderName, color }) => {
    if (shouldDisablePageCursorSharing()) {
        removeCursorOverlay();
        return;
    }

    if (roomId && roomId !== viewingRoomId) {
        return;
    }

    cursorShareUI.renderRemoteCursor({
        color,
        senderName,
        socketId,
        x: clampCursorPosition(x),
        y: clampCursorPosition(y),
    });
    scheduleCursorIdle(socketId);
};

const markRemoteCursorIdle = ({ roomId, socketId }) => {
    if (shouldDisablePageCursorSharing()) {
        removeCursorOverlay();
        return;
    }

    if (roomId && roomId !== viewingRoomId) {
        return;
    }

    clearCursorIdleTimer(socketId);
    cursorShareUI.setCursorIdle(socketId);
};

const removeRemoteCursor = ({ socketId }) => {
    clearCursorIdleTimer(socketId);
    cursorShareUI.removeRemoteCursor(socketId);
};

const clearRemoteCursors = () => {
    Object.keys(cursorIdleTimers).forEach(clearCursorIdleTimer);
    cursorShareUI.clearRemoteCursors();
};

const shouldDisablePageCursorSharing = () => cursorSharingMedia.matches;

const removeCursorOverlay = () => {
    clearRemoteCursors();
    cursorShareUI.removeCursorOverlay();
};

const getViewportCursorPosition = (event) => {
    if (window.innerWidth === 0 || window.innerHeight === 0) {
        return undefined;
    }

    return {
        x: clampCursorPosition(event.clientX / window.innerWidth),
        y: clampCursorPosition(event.clientY / window.innerHeight),
    };
};

const sendCursorMove = (event) => {
    if (shouldDisablePageCursorSharing()) {
        return;
    }

    const now = Date.now();

    if (now - lastCursorMoveAt < CURSOR_THROTTLE_MS) {
        return;
    }

    const position = getViewportCursorPosition(event);

    if (!position) {
        return;
    }

    lastCursorMoveAt = now;
    ensureSocket().emit('cursor:move', {
        roomId: viewingRoomId,
        x: position.x,
        y: position.y,
        senderName: getChatName(),
    });
};

const sendCursorLeave = () => {
    if (shouldDisablePageCursorSharing()) {
        return;
    }

    ensureSocket().emit('cursor:leave', {
        roomId: viewingRoomId,
    });
};

const enablePageCursorSharing = () => {
    if (!shouldDisablePageCursorSharing()) {
        cursorShareUI.getCursorOverlay();
    }

    document.addEventListener('pointermove', sendCursorMove);
    document.addEventListener('pointerleave', sendCursorLeave);
    cursorSharingMedia.addEventListener('change', () => {
        if (shouldDisablePageCursorSharing()) {
            removeCursorOverlay();
        } else {
            cursorShareUI.getCursorOverlay();
        }
    });
};

const requestAudioStream = async () => {
    let rawStream;

    try {
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
        });
    } catch (error) {
        console.warn(
            'Could not start microphone with enhanced constraints; retrying with basic audio.',
            error
        );
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
    }

    try {
        return await createAudioPipeline(rawStream);
    } catch (error) {
        console.warn('[audio] Pipeline init failed, using raw.', error);
        return rawStream;
    }
};

const createAudioPipeline = async (rawStream) => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(rawStream);
    const dest = ctx.createMediaStreamDestination();

    let lastOutNode = source;

    if (getAiExperimentEnabled() && isAiExperimentSupported()) {
        try {
            const wns = await import('/vendor/web-noise-suppressor.js');

            const wasmBinary = await wns.loadRnnoise({
                url: '/wasm/rnnoise.wasm',
                simdUrl: '/wasm/rnnoise_simd.wasm',
            });

            await ctx.audioWorklet.addModule(
                '/audio-worklet/rnnoise-processor.js'
            );

            const rnnoiseNode = new wns.RnnoiseWorkletNode(ctx, {
                wasmBinary,
                maxChannels: 2,
            });

            source.connect(rnnoiseNode);
            lastOutNode = rnnoiseNode;

            const boost = new GainNode(ctx, { gain: 1.35 });
            rnnoiseNode.connect(boost);
            lastOutNode = boost;

            noiseMode = 'rnnoise';
            noiseProcessorNode = rnnoiseNode;
            console.log(
                '[audio-experiment] web-noise-suppressor Rnnoise active'
            );
        } catch (error) {
            console.warn(
                '[audio-experiment] web-noise-suppressor init failed, gain only.',
                error
            );
            noiseMode = 'passthrough';
        }
    }

    const micGainPercent = noiseSettingsUI.getMicGain();
    const micGainNode = new GainNode(ctx, {
        gain: Math.max(0.001, micGainPercent / 100),
    });

    lastOutNode.connect(micGainNode);
    micGainNode.connect(dest);

    noiseAudioContext = ctx;
    noiseGainNode = micGainNode;
    noiseRawStream = rawStream;
    noiseProcessorActive = true;

    return dest.stream;
};

const destroyProcessedAudioStream = () => {
    if (noiseProcessorNode) {
        try {
            if (typeof noiseProcessorNode.destroy === 'function') {
                noiseProcessorNode.destroy();
            }

            noiseProcessorNode.disconnect();
        } catch {
            /* noop */
        }
        noiseProcessorNode = null;
    }

    if (noiseAudioContext) {
        try {
            noiseAudioContext.close();
        } catch {
            /* noop */
        }
        noiseAudioContext = null;
    }

    if (noiseRawStream) {
        noiseRawStream.getTracks().forEach((track) => {
            try {
                track.stop();
            } catch {
                /* noop */
            }
        });
        noiseRawStream = null;
    }

    noiseProcessorActive = false;
    noiseMode = 'raw';
    noiseGainNode = null;
};

const getFullscreenElement = () => fullscreenControls.getFullscreenElement();

const updateFullscreenButtonStates = () => {
    fullscreenControls.updateButtonStates();
};

const addFullscreenControls = (tile) => {
    if (!tile.id || tile.id === 'local-video') {
        return;
    }

    const actions = tile.querySelector('.tile-actions') || tile;
    const existingButton = tile.querySelector('.fullscreen-btn');

    if (existingButton) {
        updateFullscreenButtonStates();
        return;
    }

    fullscreenControls.attachTileButton({
        tile,
        actions,
        onUnavailable: () => {
            console.warn(
                'Fullscreen is only available when this tile has video.'
            );
        },
        onError: (error) => {
            console.warn(
                'Could not toggle fullscreen for this video tile.',
                error
            );
        },
    });
    updateFullscreenButtonStates();
};

const getTileMember = (tile) => {
    const peerId = tile.dataset.peerId;
    const isLocal = tile.id === 'local-video' || peerId === localPeerId;

    if (isLocal) {
        return getLocalPresenceMember();
    }

    const member = presenceMembersByPeerId.get(peerId) || {
        peerId,
        senderName: peerId ? `Peer ${peerId.slice(0, 8)}` : 'Peer',
        hasMic: true,
    };

    return {
        ...member,
        screenSharing: Boolean(
            member.screenSharing || screenSharers.has(peerId)
        ),
    };
};

const getTileType = (tile, hasVideo, member) => {
    const isLocal = tile.id === 'local-video';

    if (isLocal) {
        return member.screenSharing ? 'screen-share' : 'local';
    }

    if (member.screenSharing) {
        return 'screen-share';
    }

    return hasVideo ? 'remote-video' : 'remote-audio';
};

const sanitizeLayoutIdPart = layoutIds.sanitizeLayoutIdPart;

const getRemoteMemberForPeerId = (peerId) =>
    peerId ? presenceMembersByPeerId.get(peerId) || null : null;

const getRemoteLayoutItemId = (
    peerId,
    member = getRemoteMemberForPeerId(peerId)
) =>
    layoutIds.getRemoteLayoutItemId(peerId, member, {
        roomId: joinedVoiceRoomId,
    });

const getLegacyRemoteLayoutPeerId = layoutIds.getLegacyRemoteLayoutPeerId;

const normalizeRemotePeerLayoutId = (id, peerId, member) => {
    return layoutIds.normalizeRemotePeerLayoutId(id, peerId, member, {
        roomId: joinedVoiceRoomId,
    });
};

const getRemoteLayoutAliasIds = (peerId, member, preferredId) => {
    return layoutIds.getRemoteLayoutAliasIds(peerId, member, preferredId, {
        roomId: joinedVoiceRoomId,
    });
};

const getTileLayoutId = (tile, member) => {
    if (tile.dataset.pageLayoutType) {
        return `page-${sanitizeLayoutIdPart(tile.dataset.pageLayoutType)}`;
    }

    if (tile.dataset.layoutComponentType) {
        return `component-${sanitizeLayoutIdPart(
            tile.dataset.layoutComponentType
        )}`;
    }

    const peerId = tile.dataset.peerId;

    if (tile.dataset.tileType === 'screen-share' && peerId) {
        return `screen-${sanitizeLayoutIdPart(peerId)}`;
    }

    if (tile.id === 'local-video') {
        return `local-${sanitizeLayoutIdPart(localPeerId || socket?.id || 'me')}`;
    }

    if (peerId) {
        return getRemoteLayoutItemId(
            peerId,
            member || getRemoteMemberForPeerId(peerId)
        );
    }

    return `peer-${sanitizeLayoutIdPart(tile.id)}`;
};

const getTileLayoutItemId = (tile) =>
    tile.dataset.layoutItemId || tile.dataset.layoutId || getTileLayoutId(tile);

const normalizeTileLayoutZIndex = (value) => {
    const zIndex = Number(value);

    return Number.isFinite(zIndex) && zIndex >= TILE_BASE_Z_INDEX
        ? Math.round(zIndex)
        : TILE_BASE_Z_INDEX;
};

const saveTileLayout = (layoutId, layout) => {
    if (!layoutId) {
        return;
    }

    const item = getTileLayoutItem(layoutId);

    if (item) {
        item.layout = normalizeTileLayout(layout);
        item.grid = convertTileLayoutToGrid(item.layout);
        layoutItemsById.set(layoutId, item);
    }

    saveLayoutToStorage('布局已更新');
};

const getTileLayoutZIndex = (tile) =>
    normalizeTileLayoutZIndex(
        tile.style.zIndex || window.getComputedStyle(tile).zIndex
    );

const applyTileLayoutZIndex = (tile, zIndex) => {
    tile.style.zIndex = String(normalizeTileLayoutZIndex(zIndex));
};

const getNextTileLayoutZIndex = () => {
    const highestTileZIndex = getVideoTiles().reduce(
        (highest, tile) => Math.max(highest, getTileLayoutZIndex(tile)),
        TILE_BASE_Z_INDEX
    );

    tileLayoutZIndex = Math.max(tileLayoutZIndex, highestTileZIndex) + 1;

    return tileLayoutZIndex;
};

const bringTileLayoutToFront = (tile) => {
    if (!tile) {
        return;
    }

    applyTileLayoutZIndex(tile, getNextTileLayoutZIndex());
    syncTileLayoutItemFromElement(tile, {
        layout: {
            ...getCurrentTileLayout(tile),
            zIndex: getTileLayoutZIndex(tile),
        },
    });

    if (tile.classList.contains('is-positioned')) {
        persistCurrentTileLayout(tile);
    } else {
        saveLayoutToStorage('布局已更新');
    }
};

const getLayoutSnapContext = () => ({
    board: pageLayoutBoard || videoGrid,
    columns: PAGE_GRID_COLUMNS,
    rows: PAGE_GRID_ROWS,
    minGridW: LAYOUT_MIN_GRID_W,
    minGridH: LAYOUT_MIN_GRID_H,
    minTileWidth: PAGE_TILE_MIN_WIDTH,
    minTileHeight: PAGE_TILE_MIN_HEIGHT,
    normalizeZIndex: normalizeTileLayoutZIndex,
    findTileForLayoutItem,
    getCurrentTileLayout,
    applyTileLayout,
    applyTileLayoutItemToElement,
    setLayoutItem: (item) => layoutItemsById.set(item.id, item),
});

const getTileBounds = () =>
    layoutSnapUtils.getTileBounds(getLayoutSnapContext());

const clampGridLayout = (layout) =>
    layoutSnapUtils.clampGridLayout(layout, getLayoutSnapContext());

const convertTileLayoutToGrid = (layout) =>
    layoutSnapUtils.convertTileLayoutToGrid(layout, getLayoutSnapContext());

const convertGridLayoutToPixels = (layout) =>
    layoutSnapUtils.convertGridLayoutToPixels(layout, getLayoutSnapContext());

const getLayoutPlacementContext = () => ({
    autoLayoutGridSizes: AUTO_LAYOUT_GRID_SIZES,
    columns: PAGE_GRID_COLUMNS,
    rows: PAGE_GRID_ROWS,
    minGridW: LAYOUT_MIN_GRID_W,
    minGridH: LAYOUT_MIN_GRID_H,
    clampGridLayout,
    convertTileLayoutToGrid,
});

const isAutoPlacedLayoutType = (type) =>
    layoutPlacementUtils.isAutoPlacedLayoutType(
        type,
        getLayoutPlacementContext()
    );

const normalizeLayoutItemType = (type) =>
    LEGACY_LAYOUT_ITEM_TYPES[type] || type;

const getAutoLayoutGridSize = (type) =>
    layoutPlacementUtils.getAutoLayoutGridSize(
        type,
        getLayoutPlacementContext()
    );

const normalizeAutoLayoutGrid = (type, grid = {}) =>
    layoutPlacementUtils.normalizeAutoLayoutGrid(
        type,
        grid,
        getLayoutPlacementContext()
    );

const getFallbackTileLayoutForType = (type, layout = {}) =>
    layoutPlacementUtils.getFallbackTileLayoutForType(
        type,
        layout,
        getLayoutPlacementContext()
    );

const isRectWithinGrid = (rect) =>
    layoutPlacementUtils.isRectWithinGrid(rect, getLayoutPlacementContext());

const getOccupiedLayoutRects = (excludeId) => {
    const rects = [];

    layoutItemsById.forEach((item) => {
        if (!item?.id || item.id === excludeId || item.visible === false) {
            return;
        }

        const grid = clampGridLayout(item.grid || item.layout || {});
        if (isRectWithinGrid(grid)) {
            rects.push({
                id: item.id,
                type: item.type,
                ...grid,
            });
        }
    });

    return rects;
};

const findAvailableLayoutSlot = (type, preferredSize, options = {}) =>
    layoutPlacementUtils.findAvailableLayoutSlot(type, preferredSize, {
        ...getLayoutPlacementContext(),
        ...options,
        occupiedRects: getOccupiedLayoutRects(options.excludeId),
    });

const findTileForLayoutItem = (item) =>
    item?.elementId
        ? document.getElementById(item.elementId)
        : getVideoTiles().find(
              (tile) =>
                  tile.dataset.layoutItemId === item?.id ||
                  tile.dataset.layoutId === item?.id
          );

const showSnapPreview = (tile, layout) => {
    if (!tile || !layout) {
        return;
    }

    const snappedLayout = layoutSnapUtils.snapTileLayoutToGrid(
        layout,
        getLayoutSnapContext()
    );

    layoutEditUI.showSnapPreview({
        board: pageLayoutBoard,
        tile,
        layout: snappedLayout,
    });
};

const hideSnapPreview = () => layoutEditUI.hideSnapPreview();

const finalizeLayoutEditing = () => {
    layoutSnapUtils.snapAllLayoutItemsToGrid(
        layoutItemsById,
        getLayoutSnapContext()
    );
    hideSnapPreview();
    saveLayoutToStorage('布局已吸附');
    setLayoutEditMode(false);
};

const getLayoutStorageKey = () =>
    layoutStorage.getLayoutStorageKey({
        prefix: PAGE_LAYOUT_STORAGE_KEY_PREFIX,
        roomId: viewingRoomId || selectedVoiceRoomId || 'default',
    });

const getKnownLayoutItemTypes = () =>
    new Set([
        ...Object.values(LAYOUT_ITEM_TYPES),
        ...Object.values(PAGE_COMPONENT_TYPES),
    ]);

const serializeLayoutItems = () =>
    layoutStorage.serializeLayoutItems(layoutItemsById, {
        clampGridLayout,
        normalizeZIndex: normalizeTileLayoutZIndex,
        normalizeComponentConfig,
    });

const normalizeLoadedLayoutItems = (payload) =>
    layoutStorage.normalizeLoadedLayoutItems(payload, {
        version: PAGE_STORAGE_VERSION,
        columns: PAGE_GRID_COLUMNS,
        rows: PAGE_GRID_ROWS,
        getKnownLayoutItemTypes,
        normalizeLayoutItemType,
        getLegacyRemoteLayoutPeerId,
        normalizeRemotePeerLayoutId,
        remotePeerType: LAYOUT_ITEM_TYPES.REMOTE_PEER,
        singletonTypes: PAGE_SINGLETON_TYPES,
        normalizeAutoLayoutGrid,
        normalizeZIndex: normalizeTileLayoutZIndex,
        normalizeComponentConfig,
    });

const loadLayoutFromStorage = () =>
    layoutStorage.loadLayoutFromStorage({
        storageKey: getLayoutStorageKey(),
        normalize: normalizeLoadedLayoutItems,
        onInvalid: (error) => {
            console.warn(
                '[layout] saved layout is invalid; using defaults.',
                error
            );
        },
    });

const savedLayoutItemsById = new Map();

const refreshSavedLayoutItems = () => {
    savedLayoutItemsById.clear();
    loadLayoutFromStorage().forEach((item) => {
        savedLayoutItemsById.set(item.id, item);
    });
    layoutPreferences = readLayoutPreferencesFromStorage();
};

const getSavedLayoutItemPreference = (itemId) =>
    savedLayoutItemsById.get(itemId);

const getSavedRemoteLayoutItemPreference = (peerId, member, preferredId) =>
    getRemoteLayoutAliasIds(peerId, member, preferredId)
        .map((aliasId) => savedLayoutItemsById.get(aliasId))
        .find(Boolean);

const showLayoutSaveStatus = (message) =>
    pageLayoutEditorRuntime?.showSaveStatus(message);

const buildLayoutStoragePayload = () =>
    layoutStorage.buildLayoutStoragePayload({
        version: PAGE_STORAGE_VERSION,
        columns: PAGE_GRID_COLUMNS,
        rows: PAGE_GRID_ROWS,
        items: serializeLayoutItems(),
        preferences: layoutPreferences
            ? { ...layoutPreferences }
            : getDefaultLayoutPreferences(),
    });

const saveLayoutToStorage = (message = '已保存') => {
    if (layoutStorageHydrating) {
        return;
    }

    const payload = buildLayoutStoragePayload();
    layoutStorage.saveLayoutToStorage({
        storageKey: getLayoutStorageKey(),
        payload,
    });
    refreshSavedLayoutItems();
    showLayoutSaveStatus(message);
};

const clearSavedLayout = () => {
    layoutStorage.clearSavedLayout({
        storageKey: getLayoutStorageKey(),
    });
    refreshSavedLayoutItems();
};

refreshSavedLayoutItems();

const clampTileLayout = (layout) =>
    layoutSnapUtils.clampTileLayout(layout, getLayoutSnapContext());

const normalizeTileLayout = (layout = {}) => {
    if (layout.grid && !Number.isFinite(Number(layout.x))) {
        return convertGridLayoutToPixels({
            ...layout.grid,
            zIndex: layout.zIndex,
        });
    }

    return clampTileLayout({
        x: Number(layout.x) || 0,
        y: Number(layout.y) || 0,
        width: Number(layout.width) || TILE_MIN_WIDTH,
        height: Number(layout.height) || TILE_MIN_HEIGHT,
        zIndex: layout.zIndex,
    });
};

const hasTileMediaTracks = (tile) => {
    const mediaElement = tile.querySelector('video, audio');

    return Boolean(mediaElement?.srcObject?.getTracks?.().length);
};

const getLayoutItemTypeForTile = (tile, tileType) => {
    if (tile.dataset.pageLayoutType) {
        return tile.dataset.pageLayoutType;
    }

    if (tile.dataset.layoutComponentType) {
        return tile.dataset.layoutComponentType;
    }

    if (tileType === 'screen-share') {
        return LAYOUT_ITEM_TYPES.SCREEN_SHARE;
    }

    if (tile.id === 'local-video') {
        return LAYOUT_ITEM_TYPES.LOCAL_PEER;
    }

    if (tile.dataset.peerId) {
        return LAYOUT_ITEM_TYPES.REMOTE_PEER;
    }

    if (!hasTileMediaTracks(tile)) {
        return LAYOUT_ITEM_TYPES.PLACEHOLDER;
    }

    return LAYOUT_ITEM_TYPES.REMOTE_PEER;
};

const createTileLayoutItem = ({
    id,
    type,
    peerId,
    elementId,
    layout,
    visible = true,
    positioned = false,
    config,
}) => {
    const nextLayout = normalizeTileLayout(
        getFallbackTileLayoutForType(type, layout)
    );

    return {
        id,
        type,
        peerId,
        elementId,
        visible: Boolean(visible),
        positioned: Boolean(positioned),
        layout: nextLayout,
        grid: convertTileLayoutToGrid(nextLayout),
        config: normalizeComponentConfig(type, config),
    };
};

const getTileLayoutItem = (itemId) => layoutItemsById.get(itemId);

const upsertTileLayoutItem = (tile, updates = {}) => {
    const id = updates.id || getTileLayoutItemId(tile);
    const previous = getTileLayoutItem(id);
    const layout =
        updates.layout || previous?.layout || getCurrentTileLayout(tile);
    const tileConfig = tile.classList.contains('is-free-move-enabled')
        ? { freeMove: true }
        : {};
    const mergedConfig = {
        ...(previous?.config || {}),
        ...tileConfig,
        ...(updates.config || {}),
    };
    const item = createTileLayoutItem({
        id,
        type: updates.type || previous?.type || LAYOUT_ITEM_TYPES.PLACEHOLDER,
        peerId: updates.peerId ?? previous?.peerId ?? tile.dataset.peerId,
        elementId: updates.elementId || previous?.elementId || tile.id,
        layout,
        visible: updates.visible ?? previous?.visible ?? true,
        positioned:
            updates.positioned ??
            previous?.positioned ??
            tile.classList.contains('is-positioned'),
        config: mergedConfig,
    });

    layoutItemsById.set(id, item);
    return item;
};

const applyTileLayoutItemToElement = (
    tile,
    item,
    { applyPosition = item.positioned } = {}
) => {
    tile.dataset.layoutItemId = item.id;
    tile.dataset.layoutItemType = item.type;
    tile.dataset.layoutVisible = String(item.visible);
    tile.dataset.layoutGridX = String(item.grid.x);
    tile.dataset.layoutGridY = String(item.grid.y);
    tile.dataset.layoutGridW = String(item.grid.w);
    tile.dataset.layoutGridH = String(item.grid.h);
    tile.classList.toggle('is-layout-hidden', !item.visible);
    tile.classList.toggle(
        'is-free-move-enabled',
        item.config?.freeMove === true
    );

    if (applyPosition) {
        applyTileLayout(tile, item.layout, { syncItem: false });
    } else {
        applyTileLayoutZIndex(tile, item.layout.zIndex);
    }
};

const syncTileLayoutItemFromElement = (tile, updates = {}) => {
    const item = upsertTileLayoutItem(tile, {
        ...updates,
        id: updates.id || getTileLayoutItemId(tile),
        peerId: updates.peerId ?? tile.dataset.peerId,
        elementId: tile.id,
    });

    applyTileLayoutItemToElement(tile, item, {
        applyPosition: false,
    });
    return item;
};

const persistTileLayoutItem = (tile) => {
    const item = syncTileLayoutItemFromElement(tile, {
        layout: getCurrentTileLayout(tile),
        positioned: tile.classList.contains('is-positioned'),
        visible: true,
    });

    saveTileLayout(item.id, {
        ...item.layout,
        grid: convertTileLayoutToGrid(item.layout),
    });
};

const setTileLayoutItemVisibility = (
    itemId,
    visible,
    { syncElement = true } = {}
) => {
    const item = getTileLayoutItem(itemId);

    if (!item) {
        return;
    }

    item.visible = Boolean(visible);
    layoutItemsById.set(itemId, item);

    if (!syncElement) {
        return;
    }

    const tile = document.getElementById(item.elementId);

    if (tile) {
        applyTileLayoutItemToElement(tile, item, {
            applyPosition: false,
        });
    }
};

const isRemoteLayoutAliasForTile = (tile, itemId, nextItemId) => {
    const peerId = tile?.dataset.peerId;

    if (!peerId || !itemId || !nextItemId || itemId === nextItemId) {
        return false;
    }

    return (
        normalizeRemotePeerLayoutId(
            itemId,
            peerId,
            getRemoteMemberForPeerId(peerId)
        ) === nextItemId
    );
};

const retirePreviousTileLayoutItem = (tile, nextItemId) => {
    const previousItemIds = new Set([
        tile.dataset.layoutItemId,
        tile.dataset.layoutId,
    ]);

    previousItemIds.forEach((previousItemId) => {
        if (previousItemId && previousItemId !== nextItemId) {
            if (isRemoteLayoutAliasForTile(tile, previousItemId, nextItemId)) {
                layoutItemsById.delete(previousItemId);
                return;
            }

            setTileLayoutItemVisibility(previousItemId, false, {
                syncElement: false,
            });
        }
    });
};

const applyTileLayout = (tile, layout, { syncItem = true } = {}) => {
    const next = clampTileLayout(layout);

    tile.classList.add('is-positioned');
    tile.style.left = `${next.x}px`;
    tile.style.top = `${next.y}px`;
    tile.style.width = `${next.width}px`;
    tile.style.height = `${next.height}px`;
    applyTileLayoutZIndex(tile, next.zIndex);

    if (syncItem) {
        syncTileLayoutItemFromElement(tile, {
            layout: next,
            positioned: true,
        });
    }

    positionLayoutComponentToolbar(tile);
};

const getCurrentTileLayout = (tile) => {
    const board = pageLayoutBoard || videoGrid;
    const tileRect = tile.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();

    return clampTileLayout({
        x: tileRect.left - boardRect.left + board.scrollLeft,
        y: tileRect.top - boardRect.top + board.scrollTop,
        width: tileRect.width,
        height: tileRect.height,
        zIndex: getTileLayoutZIndex(tile),
    });
};

const persistCurrentTileLayout = (tile) => {
    persistTileLayoutItem(tile);
};

const snapTileLayoutToGridForTile = (tile) => {
    return layoutSnapUtils.snapTileLayoutToGridForTile(
        tile,
        getLayoutSnapContext()
    );
};

const markTileLayoutUserPlaced = (tile) => {
    const item = getLayoutItemForTile(tile);

    if (!item || !isAutoPlacedLayoutType(item.type)) {
        return;
    }

    item.config = normalizeComponentConfig(item.type, {
        ...item.config,
        userPlaced: true,
    });
    layoutItemsById.set(item.id, item);
    applyTileLayoutItemToElement(tile, item, {
        applyPosition: false,
    });
};

const finalizeLayoutItemDrag = (tile) => {
    if (!tile) {
        hideSnapPreview();
        return;
    }

    snapTileLayoutToGridForTile(tile);
    markTileLayoutUserPlaced(tile);
    saveLayoutToStorage('布局已吸附');
    hideSnapPreview();
    positionLayoutComponentToolbar(tile);
};

const finishTileLayoutInteraction = (tile) => {
    resetLayoutResizeCursor();
    finalizeLayoutItemDrag(tile);
};

const clampPositionedTileLayouts = () => {
    if (isMobileLayout()) {
        return;
    }

    getVideoTiles().forEach((tile) => {
        if (tile.classList.contains('is-positioned')) {
            applyTileLayout(tile, getCurrentTileLayout(tile));
            persistCurrentTileLayout(tile);
        }
    });
};

const getPreferredTileLayoutItem = (layoutId, type, options = {}) => {
    const savedItem =
        type === LAYOUT_ITEM_TYPES.REMOTE_PEER
            ? getSavedRemoteLayoutItemPreference(
                  options.peerId,
                  options.member,
                  layoutId
              )
            : getSavedLayoutItemPreference(layoutId);
    const defaultItem = getDefaultLayoutItems().find(
        (candidate) => candidate.type === type
    );
    const generatedGrid =
        !savedItem && isAutoPlacedLayoutType(type)
            ? findAvailableLayoutSlot(type, getAutoLayoutGridSize(type), {
                  excludeId: options.excludeId || layoutId,
              })
            : null;

    return (
        savedItem ||
        (isAutoPlacedLayoutType(type) ? null : defaultItem) ||
        (generatedGrid
            ? {
                  grid: generatedGrid,
                  z: getNextTileLayoutZIndex(),
                  visible: true,
                  config: getDefaultComponentConfig(type),
              }
            : null)
    );
};

const getInitialTileLayoutForSync = (tile, layoutId, tileType, member) => {
    if (!tile || tile.classList.contains('is-positioned')) {
        return null;
    }

    const type = getLayoutItemTypeForTile(tile, tileType);
    const peerId = tile.dataset.peerId;
    const remoteMember = member || getRemoteMemberForPeerId(peerId);
    const layoutItem = getPreferredTileLayoutItem(layoutId, type, {
        excludeId: layoutId,
        peerId,
        member: remoteMember,
    });

    if (!layoutItem?.grid) {
        return null;
    }

    return convertGridLayoutToPixels({
        ...layoutItem.grid,
        zIndex: layoutItem.z || getTileLayoutZIndex(tile),
    });
};

const applySavedTileLayout = (tile) => {
    if (isMobileLayout() || !tile.dataset.layoutId) {
        return;
    }

    const item = getTileLayoutItem(tile.dataset.layoutItemId);
    const type =
        item?.type || getLayoutItemTypeForTile(tile, tile.dataset.tileType);
    const peerId = tile.dataset.peerId;
    const member = getRemoteMemberForPeerId(peerId);
    const savedItem =
        type === LAYOUT_ITEM_TYPES.REMOTE_PEER
            ? getSavedRemoteLayoutItemPreference(
                  peerId,
                  member,
                  tile.dataset.layoutId
              )
            : getSavedLayoutItemPreference(tile.dataset.layoutId);
    const defaultItem = getDefaultLayoutItems().find(
        (candidate) => candidate.type === type
    );
    const generatedGrid =
        !savedItem && isAutoPlacedLayoutType(type)
            ? findAvailableLayoutSlot(type, getAutoLayoutGridSize(type), {
                  excludeId:
                      item?.id ||
                      tile.dataset.layoutItemId ||
                      tile.dataset.layoutId,
              })
            : null;
    const layoutItem =
        savedItem ||
        (isAutoPlacedLayoutType(type) ? null : defaultItem) ||
        (generatedGrid
            ? {
                  grid: generatedGrid,
                  z: getNextTileLayoutZIndex(),
                  visible: true,
                  config: getDefaultComponentConfig(type),
              }
            : null);

    if (layoutItem) {
        const nextLayout = convertGridLayoutToPixels({
            ...layoutItem.grid,
            zIndex: layoutItem.z || getNextTileLayoutZIndex(),
        });

        applyTileLayout(tile, nextLayout);
        const syncedItem = upsertTileLayoutItem(tile, {
            layout: nextLayout,
            visible: layoutItem.visible,
            positioned: true,
            config: layoutItem.config,
        });
        applyTileLayoutItemToElement(tile, syncedItem, {
            applyPosition: false,
        });
        setTileLayoutItemVisibility(
            tile.dataset.layoutItemId,
            layoutItem.visible
        );
        tile.classList.toggle('is-layout-hidden', !layoutItem.visible);
    }
};

const getLayoutComponentDisplayContext = (type) => {
    if (type === LAYOUT_ITEM_TYPES.ROOM) {
        const channelName = getChannelName(viewingRoomId || joinedVoiceRoomId);
        const currentMemberList = document.querySelector(
            `[data-members-for="${viewingRoomId || joinedVoiceRoomId}"]`
        );
        const memberCount =
            currentMemberList?.querySelectorAll('.channel-member').length || 0;

        return {
            channelName,
            joinedVoiceRoomId,
            memberCount,
        };
    }

    if (type === LAYOUT_ITEM_TYPES.CHAT) {
        return {
            chatMessages: Array.from(
                chatMessages?.querySelectorAll('.chat-message') || []
            )
                .slice(-3)
                .map((message) => message.textContent.trim())
                .filter(Boolean),
        };
    }

    return {
        joinedVoiceRoomId,
    };
};

const renderLayoutComponentTile = (tile) => {
    const type = tile.dataset.layoutComponentType;
    if (REAL_DOM_PAGE_TYPES.has(type)) {
        const itemId = tile.dataset.layoutItemId || tile.dataset.layoutId;
        const item = getTileLayoutItem(itemId);
        const savedItem = getSavedLayoutItemPreference(itemId || '');
        const nextLayoutId = getTileLayoutId(tile);
        const config = normalizeComponentConfig(
            type,
            item?.config || savedItem?.config
        );

        tile.dataset.tileType = type;
        tile.dataset.peerLabel = getPagePanelLabel(type);
        tile.classList.add('layout-component-tile');
        tile.classList.toggle('is-layout-editing', layoutEditMode);
        tile.dataset.layoutId = nextLayoutId;
        const syncedItem = syncTileLayoutItemFromElement(tile, {
            id: nextLayoutId,
            type,
            visible: item?.visible !== false,
            positioned: tile.classList.contains('is-positioned'),
            config,
        });
        applyTileLayoutItemToElement(tile, syncedItem, {
            applyPosition: false,
        });

        if (layoutEditMode) {
            ensureLayoutComponentActions();
        }
        return;
    }

    const itemId = tile.dataset.layoutItemId || tile.dataset.layoutId;
    const item = getTileLayoutItem(itemId);
    const savedItem = getSavedLayoutItemPreference(itemId || '');
    const config = normalizeComponentConfig(
        type,
        item?.config || savedItem?.config
    );
    const syncRequest = renderLayoutComponentTileContent(tile, {
        bindCopyButton: copyLinkUI.bindCopyButton,
        config,
        createTileAvatarText,
        displayContext: getLayoutComponentDisplayContext(type),
        ensureTileStructure,
        getCopyLink: () => getChannelUrl(getCopyRoomId()),
        getTileLayoutId,
        layoutEditMode,
        type,
    });

    if (syncRequest) {
        syncTileLayoutItemFromElement(tile, syncRequest);
    }

    if (layoutEditMode) {
        ensureLayoutComponentActions();
    }
};

const getExistingLayoutComponentTile = (type) =>
    pageLayoutComponentRuntime?.getExistingLayoutComponentTile(type);

const addLayoutComponent = (type) =>
    pageLayoutComponentRuntime?.addLayoutComponent(type);

const hideLayoutComponent = (tile) =>
    pageLayoutComponentRuntime?.hideLayoutComponent(tile);

const applyDefaultLayout = () =>
    pageLayoutComponentRuntime?.applyDefaultLayout();

const initializeLayoutFromStorage = () =>
    pageLayoutComponentRuntime?.initializeLayoutFromStorage();

const closeLayoutComponentMenu = () =>
    pageLayoutEditorRuntime?.closeComponentMenu();

const closeLayoutComponentConfig = () =>
    pageLayoutEditorRuntime?.closeComponentConfig();

const renderLayoutComponentMenu = () =>
    pageLayoutEditorRuntime?.renderComponentMenu();

const getLayoutItemForTile = (tile) =>
    getTileLayoutItem(tile?.dataset.layoutItemId || tile?.dataset.layoutId);

const isTileFreeMoveEnabled = (tile) =>
    getLayoutItemForTile(tile)?.config?.freeMove === true;

const canDragLayoutItem = (item) =>
    layoutEditMode || item?.config?.freeMove === true;

const canResizeLayoutItem = (item) =>
    layoutEditMode || item?.config?.freeMove === true;

const shouldIgnoreLayoutDragTarget = (target) =>
    Boolean(
        target?.closest?.(
            [
                'input',
                'textarea',
                'button',
                'select',
                'a',
                'form',
                'label',
                '[contenteditable]',
                '.no-drag',
                '.chat-form',
                '.chat-input',
                '.page-chat-form',
                '.channel-button',
                '[data-channel-room]',
                '.layout-component-toolbar',
                '.layout-component-remove',
                '.layout-component-settings',
                '.fullscreen-btn',
            ].join(', ')
        )
    );

const findLayoutComponentToolbar = (tile) =>
    pageLayoutEditorRuntime?.findComponentToolbar(tile);

const positionLayoutComponentToolbar = (tile) =>
    pageLayoutEditorRuntime?.positionComponentToolbar(tile);

const setActiveLayoutToolbarTile = (tile) =>
    pageLayoutEditorRuntime?.setActiveToolbarTile(tile);

const syncLayoutComponentToolbarState = (tile) =>
    pageLayoutEditorRuntime?.syncComponentToolbarState(tile);

const toggleTileFreeMove = (tile) => {
    const item = getLayoutItemForTile(tile);

    if (!item) {
        return;
    }

    const nextFreeMove = !isTileFreeMoveEnabled(tile);
    updateLayoutItemConfig(
        item.id,
        nextFreeMove ? { freeMove: true } : { freeMove: false }
    );
    syncLayoutComponentToolbarState(tile);
    positionLayoutComponentToolbar(tile);
};

const ensureLayoutComponentActions = () =>
    pageLayoutEditorRuntime?.ensureComponentActions();

const createTileAvatarText = (displayName) =>
    videoTileStructureUI.createTileAvatarText(displayName);

const ensureTileStructure = (tile) => {
    const structure = videoTileStructureUI.ensureTileStructure(tile, {
        resizeDirections: TILE_RESIZE_DIRECTIONS,
    });

    bindTileLayoutControls(tile, structure.header);
    bindLayoutResizeBoardControls();

    return structure;
};

const detectTileResizeDirection = (event, tile) => {
    if (
        !tile ||
        isMobileLayout() ||
        getFullscreenElement() ||
        !canResizeLayoutItem(getLayoutItemForTile(tile))
    ) {
        return null;
    }

    const rect = tile.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return null;
    }

    return layoutResizeUtils.detectTileResizeDirection({
        cornerSizePx: TILE_RESIZE_CORNER_SIZE_PX,
        edgeInsetPx: TILE_RESIZE_EDGE_INSET_PX,
        edgeOutsetPx: TILE_RESIZE_EDGE_OUTSET_PX,
        point: {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        },
        size: {
            height: rect.height,
            width: rect.width,
        },
    });
};

const resetLayoutResizeCursor = (board = pageLayoutBoard || videoGrid) =>
    layoutEditUI.resetResizeCursor({
        board,
        hoverClasses: LAYOUT_RESIZE_HOVER_CLASSES,
    });

const setLayoutResizeCursor = (hit, board = pageLayoutBoard || videoGrid) => {
    layoutEditUI.setResizeCursor({
        hit,
        board,
        cursors: TILE_RESIZE_CURSORS,
        hoverClasses: LAYOUT_RESIZE_HOVER_CLASSES,
    });
};

const updateTileResizeCursor = (event, tile) => {
    if (!tile || shouldIgnoreLayoutDragTarget(event.target)) {
        resetLayoutResizeCursor();
        return;
    }

    const resizeDirection = detectTileResizeDirection(event, tile);
    setLayoutResizeCursor(
        resizeDirection ? { tile, direction: resizeDirection } : null
    );
};

const getResizeTileAtPoint = (event) => {
    if (shouldIgnoreLayoutDragTarget(event.target)) {
        return null;
    }

    return getVideoTiles()
        .filter((tile) => !tile.classList.contains('is-layout-hidden'))
        .sort((a, b) => getTileLayoutZIndex(b) - getTileLayoutZIndex(a))
        .map((tile) => ({
            tile,
            direction: detectTileResizeDirection(event, tile),
        }))
        .find((candidate) => candidate.direction);
};

const bindLayoutResizeBoardControls = () => {
    const board = pageLayoutBoard || videoGrid;

    if (!board || layoutResizeBoundBoards.has(board)) {
        return;
    }

    board.addEventListener('pointermove', (event) => {
        const hit = getResizeTileAtPoint(event);
        setLayoutResizeCursor(hit, board);
    });
    board.addEventListener('pointerleave', () =>
        resetLayoutResizeCursor(board)
    );
    board.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const hit = getResizeTileAtPoint(event);

        if (!hit) {
            return;
        }

        setActiveLayoutToolbarTile(hit.tile);
        startTileResize(event, hit.tile, hit.direction);
    });
    layoutResizeBoundBoards.add(board);
};

const isTilePointerDisabled = (event) =>
    isMobileLayout() ||
    getFullscreenElement() ||
    event.button !== 0 ||
    event.target.closest('.tile-resize-handle') ||
    shouldIgnoreLayoutDragTarget(event.target);

const startTileDrag = (event, tile) => {
    if (
        isTilePointerDisabled(event) ||
        !canDragLayoutItem(getLayoutItemForTile(tile))
    ) {
        return;
    }

    resetLayoutResizeCursor();
    bringTileLayoutToFront(tile);
    const startLayout = getCurrentTileLayout(tile);
    applyTileLayout(tile, startLayout);
    tile.classList.add('is-dragging');
    tile.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    showSnapPreview(tile, startLayout);
    let finished = false;

    const onMove = (moveEvent) => {
        const nextLayout = {
            ...startLayout,
            x: startLayout.x + moveEvent.clientX - startX,
            y: startLayout.y + moveEvent.clientY - startY,
        };
        applyTileLayout(tile, nextLayout);
        showSnapPreview(tile, nextLayout);
        positionLayoutComponentToolbar(tile);
    };

    const onEnd = () => {
        if (finished) {
            return;
        }

        finished = true;
        if (tile.hasPointerCapture?.(event.pointerId)) {
            tile.releasePointerCapture(event.pointerId);
        }
        tile.classList.remove('is-dragging');
        finishTileLayoutInteraction(tile);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
};

const resolveTileResizeLayout = (startLayout, direction, deltaX, deltaY) => {
    const nextLayout = layoutResizeUtils.resolveTileResizeLayout({
        bounds: getTileBounds(),
        deltaX,
        deltaY,
        direction,
        minHeight: PAGE_TILE_MIN_HEIGHT,
        minWidth: PAGE_TILE_MIN_WIDTH,
        startLayout,
    });

    return clampTileLayout(nextLayout);
};

const startTileResize = (event, tile, direction = 'se') => {
    if (
        isMobileLayout() ||
        getFullscreenElement() ||
        event.button !== 0 ||
        shouldIgnoreLayoutDragTarget(event.target) ||
        !canResizeLayoutItem(getLayoutItemForTile(tile))
    ) {
        return;
    }

    bringTileLayoutToFront(tile);
    const startLayout = getCurrentTileLayout(tile);
    applyTileLayout(tile, startLayout);
    tile.classList.add('is-resizing');
    setLayoutResizeCursor({ tile, direction });
    tile.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    showSnapPreview(tile, startLayout);
    let finished = false;

    const onMove = (moveEvent) => {
        const nextLayout = resolveTileResizeLayout(
            startLayout,
            direction,
            moveEvent.clientX - startX,
            moveEvent.clientY - startY
        );
        applyTileLayout(tile, nextLayout);
        showSnapPreview(tile, nextLayout);
        positionLayoutComponentToolbar(tile);
    };

    const onEnd = () => {
        if (finished) {
            return;
        }

        finished = true;
        if (tile.hasPointerCapture?.(event.pointerId)) {
            tile.releasePointerCapture(event.pointerId);
        }
        tile.classList.remove('is-resizing');
        resetLayoutResizeCursor();
        finishTileLayoutInteraction(tile);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
};

const bindTileLayoutControls = (tile, header) => {
    if (!tile.dataset.layoutBound) {
        tile.addEventListener('pointermove', (event) =>
            updateTileResizeCursor(event, tile)
        );
        tile.addEventListener('pointerleave', () => resetLayoutResizeCursor());
        tile.addEventListener(
            'pointerdown',
            (event) => {
                if (shouldIgnoreLayoutDragTarget(event.target)) {
                    return;
                }

                const resizeDirection = detectTileResizeDirection(event, tile);

                if (resizeDirection) {
                    setActiveLayoutToolbarTile(tile);
                    startTileResize(event, tile, resizeDirection);
                    return;
                }

                if (canDragLayoutItem(getLayoutItemForTile(tile))) {
                    setActiveLayoutToolbarTile(tile);
                    startTileDrag(event, tile);
                }
            },
            true
        );
        tile.addEventListener('click', (event) => {
            bringTileLayoutToFront(tile);
            setActiveLayoutToolbarTile(tile);

            if (layoutEditMode) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
        header.addEventListener(
            'pointerdown',
            (event) =>
                !shouldIgnoreLayoutDragTarget(event.target) &&
                canDragLayoutItem(getLayoutItemForTile(tile)) &&
                startTileDrag(event, tile)
        );
        tile.addEventListener('mouseenter', () =>
            setActiveLayoutToolbarTile(tile)
        );
        tile.addEventListener('contextmenu', (event) =>
            showPeerVolumePopover(event, tile)
        );
        tile.dataset.layoutBound = 'true';
    }

    tile.querySelectorAll('.tile-resize-handle').forEach((resizeHandle) => {
        if (resizeHandle.dataset.resizeBound) {
            return;
        }

        resizeHandle.addEventListener('pointerdown', (event) =>
            startTileResize(event, tile, resizeHandle.dataset.resizeDirection)
        );
        resizeHandle.dataset.resizeBound = 'true';
    });
};

pageLayoutComponentRuntime = layoutComponentRuntime.createComponentRuntime({
    document,
    logger: console,
    localPeerType: LAYOUT_ITEM_TYPES.LOCAL_PEER,
    getSingletonTypes: () => PAGE_SINGLETON_TYPES,
    getCorePageTypes: () => CORE_PAGE_TYPES,
    getDefaultLayoutItems,
    getLayoutComponentId,
    getTileLayoutId,
    getSavedLayoutItemPreference,
    getSavedLayoutItems: () => Array.from(savedLayoutItemsById.values()),
    isLayoutStorageHydrating: () => layoutStorageHydrating,
    setLayoutStorageHydrating: (hydrating) => {
        layoutStorageHydrating = Boolean(hydrating);
    },
    getVideoTiles,
    applyTileLayout,
    convertGridLayoutToPixels,
    getNextTileLayoutZIndex,
    setTileLayoutItemVisibility,
    bringTileLayoutToFront,
    clearSavedLayout,
    saveLayoutToStorage,
    upsertTileLayoutItem,
    applyTileLayoutItemToElement,
    findLayoutComponentToolbar,
    closePeerVolumePopover: () => closePeerVolumePopover(),
    renderLayoutComponentMenu,
    updateMobileTileView,
});

pageLayoutEditorRuntime = layoutEditorRuntime.createEditorRuntime({
    document,
    refs: {
        mainLayout,
    },
    layoutToolbarUI,
    layoutComponentMenuUI,
    layoutComponentActionsUI,
    initialEditMode: layoutEditMode,
    getPageLayoutBoard: () => pageLayoutBoard,
    getVideoTiles,
    getCorePageTypes: () => CORE_PAGE_TYPES,
    getExistingLayoutComponentTile,
    getTileLayoutItem,
    getPagePanelLabel,
    onAddComponent: addLayoutComponent,
    onHideComponent: hideLayoutComponent,
    onToggleFreeMove: toggleTileFreeMove,
    isTileFreeMoveEnabled,
    ensureTileStructure,
    syncLayoutGridMetadata,
    onEditModeChange: (enabled) => {
        layoutEditMode = enabled;
    },
    onEnterEditMode: () => {
        closePeerVolumePopover();
    },
    onExitEditMode: () => {
        hideSnapPreview();
        resetLayoutResizeCursor();
    },
    onFinalizeLayoutEditing: finalizeLayoutEditing,
    onApplyDefaultLayout: applyDefaultLayout,
});

pageLayoutRuntime = window.PageLayoutRuntime.createRuntime({
    document,
    logger: console,
    refs: {
        mainLayout,
        videoGrid,
    },
    layoutRecoveryUI,
    pageComponentTypes: PAGE_COMPONENT_TYPES,
    pageGridColumns: PAGE_GRID_COLUMNS,
    pageGridRows: PAGE_GRID_ROWS,
    getDefaultLayoutItems,
    ensureTileStructure,
    createTileAvatarText,
    sanitizeLayoutIdPart,
    syncTileLayoutItemFromElement,
    applyTileLayout,
    convertGridLayoutToPixels,
    getNextTileLayoutZIndex,
    setTileLayoutItemVisibility,
    saveLayoutToStorage,
    loadLayoutFromStorage,
    clearSavedLayout,
    initializeLayoutFromStorage,
    ensureLayoutEditModeToggle,
    syncLayoutEditModeUI,
    getVideoTiles,
    serializeLayoutItems,
    setLayoutEditMode,
    onBoardChange: (board) => {
        pageLayoutBoard = board;
    },
    reload: () => {
        window.location.reload();
    },
});

pageLayoutRuntime.bootstrapRecoveryToolbar();

try {
    pageLayoutRuntime.bootstrap();
    pageLayoutBoard = pageLayoutRuntime.getBoard();
    pageLayoutEditorRuntime.bindToolbarEvents();
    syncLayoutEditModeUI();
} catch (err) {
    console.error('[page-layout] critical init failure', err);
    restoreOriginalStaticLayout();
    pageLayoutRuntime.bootstrapRecoveryToolbar({ visible: true });
}

const closePeerVolumePopover = () => {
    remoteVolumeUI.closePopover();
};

const showPeerVolumePopover = (event, tile) => {
    const peerId = tile.dataset.peerId;

    if (layoutEditMode) {
        event.preventDefault();
        closePeerVolumePopover();
        return;
    }

    if (isMobileLayout() || tile.id === 'local-video' || !peerId) {
        return;
    }

    event.preventDefault();
    const currentVolume = Math.round(getPeerVolume(peerId) * 100);

    remoteVolumeUI.openPopover({
        event,
        currentVolume,
        onVolumeInput: (nextVolume) => {
            setPeerVolume(peerId, nextVolume / 100);
            applyOutputSettingsToRemoteMedia();
        },
    });
};

const updateVideoTileStatus = (tile) => {
    if (!tile) {
        return;
    }

    if (tile.dataset.layoutComponentType) {
        renderLayoutComponentTile(tile);
        return;
    }

    const member = getTileMember(tile);
    const isLocal = tile.id === 'local-video';
    const hasVideo = Boolean(tile.querySelector('video'));
    const displayName = member.senderName || (isLocal ? getChatName() : 'Peer');
    ensureTileStructure(tile);
    const tileType = getTileType(tile, hasVideo, member);
    const peerId = tile.dataset.peerId;
    const previousLayoutItem = getLayoutItemForTile(tile);

    tile.dataset.peerLabel = isLocal ? `${displayName}（我）` : displayName;
    tile.dataset.tileType = tileType;
    const nextLayoutId = getTileLayoutId(tile, member);
    const layoutChanged = tile.dataset.layoutId !== nextLayoutId;
    retirePreviousTileLayoutItem(tile, nextLayoutId);
    tile.dataset.layoutId = nextLayoutId;
    const layoutItemType = getLayoutItemTypeForTile(tile, tileType);
    const initialLayout = getInitialTileLayoutForSync(
        tile,
        nextLayoutId,
        tileType,
        member
    );
    const layoutItem = syncTileLayoutItemFromElement(tile, {
        id: nextLayoutId,
        type: layoutItemType,
        layout: initialLayout,
        visible: true,
        positioned: tile.classList.contains('is-positioned'),
    });
    const hasSavedRemoteLayout =
        layoutItemType === LAYOUT_ITEM_TYPES.REMOTE_PEER &&
        Boolean(
            getSavedRemoteLayoutItemPreference(peerId, member, nextLayoutId)
        );
    const canReplaceTemporaryRemoteLayout =
        hasSavedRemoteLayout && previousLayoutItem?.config?.userPlaced !== true;

    if (
        layoutChanged &&
        (!tile.classList.contains('is-positioned') ||
            canReplaceTemporaryRemoteLayout)
    ) {
        applySavedTileLayout(tile);
    } else {
        applyTileLayoutItemToElement(tile, layoutItem, {
            applyPosition: false,
        });
    }
    if (layoutEditMode) {
        ensureLayoutComponentActions();
    }

    if (member.socketId) {
        tile.dataset.socketId = member.socketId;
    } else {
        delete tile.dataset.socketId;
    }

    const remoteConfigItem = getTileLayoutItem(tile.dataset.layoutItemId);
    let showPeerName = true;
    if (
        remoteConfigItem &&
        remoteConfigItem.type === LAYOUT_ITEM_TYPES.REMOTE_PEER
    ) {
        const remoteConfig = normalizeComponentConfig(
            LAYOUT_ITEM_TYPES.REMOTE_PEER,
            remoteConfigItem.config
        );

        showPeerName = remoteConfig.showPeerName;
    }

    const titleText = isLocal ? `${displayName}（我）` : displayName;
    const statusText = getMemberTileText(member);

    tileStatusUI.renderTileStatus(tile, {
        avatarText: createTileAvatarText(displayName),
        hasVideo,
        isLayoutEditing: layoutEditMode,
        isScreenShare: tileType === 'screen-share',
        showNameLabel: showPeerName,
        statuses: getMemberStatusIcons(member),
        statusText,
        titleText,
    });
};

const updateAllVideoTileStatus = () => {
    document.querySelectorAll('.video-tile').forEach(updateVideoTileStatus);
};

const toggleMemberTileVisibility = (peerId) => {
    if (!peerId) {
        return;
    }

    const tile = document.getElementById(peerId);
    if (!tile) {
        return;
    }

    const isCurrentlyVisible = !tile.classList.contains('is-layout-hidden');

    if (isCurrentlyVisible) {
        hideLayoutComponent(tile);
    } else {
        const itemId = tile.dataset.layoutItemId;
        setTileLayoutItemVisibility(itemId, true);
        tile.classList.remove('is-layout-hidden');
        bringTileLayoutToFront(tile);
        saveLayoutToStorage('布局已更新');
        renderLayoutComponentMenu();
        updateMobileTileView();
    }
};

const toggleLocalPeerTileVisibility = () => {
    const tile = document.getElementById('local-video');
    if (!tile) {
        return;
    }

    const isCurrentlyVisible = !tile.classList.contains('is-layout-hidden');

    if (isCurrentlyVisible) {
        hideLayoutComponent(tile);
    } else {
        const itemId = tile.dataset.layoutItemId;
        setTileLayoutItemVisibility(itemId, true);
        tile.classList.remove('is-layout-hidden');
        bringTileLayoutToFront(tile);
        saveLayoutToStorage('布局已更新');
        renderLayoutComponentMenu();
        updateMobileTileView();
    }
};

const ensurePresenceTileForPeer = (
    peerId,
    member = getRemoteMemberForPeerId(peerId)
) => {
    if (!peerId || peerId === localPeerId) {
        return;
    }

    const existingTile = document.getElementById(peerId);
    const autoShowRemotePeers = getLayoutPreference('autoShowRemotePeers');
    const keepHidden = getLayoutPreference('keepHiddenRemotePeers');
    const layoutItemId = getRemoteLayoutItemId(peerId, member);

    if (!existingTile) {
        console.info('[tile] create presence tile', { peerId });

        let shouldAutoShow = autoShowRemotePeers;

        if (keepHidden) {
            const savedItem = getSavedRemoteLayoutItemPreference(
                peerId,
                member,
                layoutItemId
            );
            if (savedItem && savedItem.visible === false) {
                shouldAutoShow = false;
            }
        }

        addVideoStream(
            document.createElement('video'),
            new MediaStream(),
            peerId
        );

        if (!shouldAutoShow) {
            const tile = document.getElementById(peerId);
            if (tile) {
                tile.classList.add('is-layout-hidden');
                setTileLayoutItemVisibility(tile.dataset.layoutItemId, false);
            }
        }
    } else {
        updateVideoTileStatus(existingTile);
    }
};

const syncPresenceTilesForJoinedRoom = (channels = []) => {
    if (!joinedVoiceRoomId) {
        return;
    }

    const currentChannel = channels.find(
        (channel) => channel.slug === joinedVoiceRoomId
    );
    const activePeerIds = new Set();

    (currentChannel?.members || []).forEach((member) => {
        if (!member.peerId || member.peerId === localPeerId) {
            return;
        }

        activePeerIds.add(member.peerId);
        addKnownRemotePeer(member.peerId);
        ensurePresenceTileForPeer(member.peerId, member);
    });

    getVideoTiles().forEach((tile) => {
        const peerId = tile.dataset.peerId;

        if (tile.id !== 'local-video' && peerId && !activePeerIds.has(peerId)) {
            removeVideoElement(tile.id);
        }
    });
};

const addVideoStream = (video, stream, videoId) => {
    const tileId = videoId || 'local-video';
    let tile = document.getElementById(tileId);
    const hasVideo = stream.getVideoTracks().length > 0;
    const mediaTag = hasVideo ? 'VIDEO' : 'AUDIO';

    if (!tile) {
        tile = document.createElement('div');
        tile.id = tileId;
        tile.className = 'video-tile';
        if (videoId) {
            const localTile = document.getElementById('local-video');
            if (localTile) {
                videoGrid.insertBefore(tile, localTile);
            } else {
                videoGrid.append(tile);
            }
        } else {
            videoGrid.append(tile);
        }
    }

    if (videoId) {
        tile.dataset.peerId = videoId;
    } else if (localPeerId) {
        tile.dataset.peerId = localPeerId;
    }

    const { body, actions } = ensureTileStructure(tile);

    let mediaElement = body.querySelector('video, audio');
    if (!mediaElement || mediaElement.tagName !== mediaTag) {
        body.replaceChildren();
        actions.querySelector('.fullscreen-btn')?.remove();
        mediaElement = hasVideo ? video : document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.playsInline = 'true';
        applyOutputSettings(mediaElement, Boolean(videoId));

        body.append(mediaElement);

        if (!hasVideo) {
            const placeholder = document.createElement('div');
            const avatar = document.createElement('div');
            const title = document.createElement('div');
            const status = document.createElement('div');

            placeholder.className = 'voice-placeholder';
            avatar.className = 'voice-placeholder-avatar';
            title.className = 'voice-placeholder-title';
            status.className = 'voice-placeholder-status';
            title.textContent = videoId ? '远端用户' : '我';
            status.textContent = videoId ? '正在语音' : '未开麦';
            placeholder.append(avatar, title, status);
            body.append(placeholder);
            tile.ondblclick = undefined;
        } else {
            addFullscreenControls(tile);
        }
    }

    mediaElement.srcObject = stream;
    applyOutputSettings(mediaElement, Boolean(videoId));
    mediaElement.onloadedmetadata = () => {
        mediaElement.play();
    };
    updateVideoTileStatus(tile);
    console.info('[tile] add/update', {
        peerId: tile.dataset.peerId,
        layoutId: tile.dataset.layoutId,
        hasVideo,
    });
    resetAutoTileLayoutHeights();
    updateMobileTileView();
};

initializeLayoutFromStorage();

const mergeRemoteStream = (
    peerId,
    incomingStream,
    { clearVideo = false } = {}
) => {
    const remoteStream = remoteStreams[peerId] || new MediaStream();
    const incomingAudioTracks = incomingStream.getAudioTracks();
    const incomingVideoTracks = incomingStream.getVideoTracks();

    if (!remoteStreams[peerId]) {
        remoteStreams[peerId] = remoteStream;
    }

    if (incomingAudioTracks.length > 0) {
        remoteStream.getAudioTracks().forEach((track) => {
            remoteStream.removeTrack(track);
        });
        incomingAudioTracks.forEach((track) => remoteStream.addTrack(track));
    }

    if (incomingVideoTracks.length > 0 || clearVideo) {
        remoteStream.getVideoTracks().forEach((track) => {
            remoteStream.removeTrack(track);
        });
        incomingVideoTracks.forEach((track) => remoteStream.addTrack(track));
    }

    return remoteStream;
};

function setupCallStreamHandler(call, peerId) {
    call.on('stream', (userVideoStream) => {
        console.info('[voice] remote stream received', {
            peerId,
            audioTracks: userVideoStream.getAudioTracks().length,
            videoTracks: userVideoStream.getVideoTracks().length,
        });
        addVideoStream(
            document.createElement('video'),
            mergeRemoteStream(peerId, userVideoStream, {
                clearVideo: call.metadata?.videoState === 'audio-only',
            }),
            peerId
        );
    });
}

const bindPeerCallHandler = (peer) => {
    if (peersWithCallHandler.has(peer)) {
        return;
    }

    peersWithCallHandler.add(peer);
    peer.on('call', (call) => {
        if (peer !== currentPeer || peer.destroyed) {
            call.close?.();
            return;
        }

        console.log('Received a call...');
        console.info('[voice] call received', { peerId: call.peer });
        call.answer(getActiveStream());
        setupCallStreamHandler(call, call.peer);
    });
};
// ----------------------------------------------------------------------------------

// switching between sharing screen and not sharing
var sharingNow = false;
let currentScreenStream;

const getActiveStream = () => {
    const tracks = [...(myVideoStream?.getAudioTracks() || [])];

    if (sharingNow && currentScreenStream) {
        tracks.push(
            ...currentScreenStream
                .getAudioTracks()
                .filter((track) => track.readyState === 'live')
        );
    }

    if (activeVideoTrack?.readyState === 'live') {
        tracks.push(activeVideoTrack);
    }

    activeStream = new MediaStream(tracks);
    return activeStream;
};

const setLocalVideoStream = (stream) => {
    if (!stream) {
        console.warn('Local stream is not available; skipping preview update.');
        return;
    }

    addVideoStream(myVideo, stream);
};

const callPeersWithStream = (peer, stream, options = {}) => {
    if (!stream) {
        console.warn('No stream available for peer call.');
        return;
    }

    const myPeers = getKnownRemotePeerIds(peer);

    myPeers.forEach((peerId) =>
        connectToNewUser(peer, peerId, stream, options)
    );
};

const sendVideoTrackToPeers = (peer, track) => {
    const myPeers = getKnownRemotePeerIds(peer);

    myPeers.forEach((peerId) => {
        const calls = peer.connections[peerId] || [];
        let replacedTrack = false;

        calls.forEach((call) => {
            const sender = call?.peerConnection
                ?.getSenders()
                .find(
                    (currentSender) =>
                        currentSender.track?.kind === 'video' ||
                        currentSender.track === null
                );

            if (!sender) {
                return;
            }

            sender.replaceTrack(track || null).catch((error) => {
                console.warn(
                    `Could not replace video track for peer ${peerId}.`,
                    error
                );
            });
            replacedTrack = true;
        });

        if (!replacedTrack && track) {
            console.warn(
                `No video sender found for peer ${peerId}; starting a video call.`
            );
            connectToNewUser(peer, peerId, new MediaStream([track]));
        }
    });
};

const sendAudioOnlyStateToPeers = (peer) => {
    const audioOnlyStream = new MediaStream(
        myVideoStream?.getAudioTracks() || []
    );

    if (audioOnlyStream.getTracks().length === 0) {
        console.warn('No audio track available for audio-only state update.');
        return;
    }

    callPeersWithStream(peer, audioOnlyStream, {
        metadata: {
            videoState: 'audio-only',
        },
    });
};

const setActiveVideoTrack = (peer, track) => {
    activeVideoTrack = track;
    const stream = getActiveStream();
    setLocalVideoStream(stream);
    sendVideoTrackToPeers(peer, track);

    if (!track) {
        sendAudioOnlyStateToPeers(peer);
    }
};

const setCameraButtonState = (enabled) => {
    const rendered = mediaControlsUI.renderCameraButtonState({ enabled });

    if (!rendered) {
        console.warn('toggleVideo button not found in DOM.');
    }
};

const toggleCamera = async (peer) => {
    const currentCameraTrack = cameraStream?.getVideoTracks()[0];

    if (currentCameraTrack?.readyState === 'live') {
        currentCameraTrack.stop();
        cameraStream = undefined;
        setCameraButtonState(false);
        emitLocalPresenceUpdate();
        updateLocalUserCard();

        if (!sharingNow) {
            setActiveVideoTrack(peer);
        }
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
        });
    } catch (error) {
        console.warn('Could not start camera video source.', error);
        return;
    }

    setCameraButtonState(true);
    emitLocalPresenceUpdate();
    updateLocalUserCard();

    if (!sharingNow) {
        setActiveVideoTrack(peer, cameraStream.getVideoTracks()[0]);
    }
};

const stopCurrentScreenStream = () => {
    const screenStream = currentScreenStream;
    currentScreenStream = undefined;

    screenStream?.getTracks().forEach((track) => {
        track.stop();
    });
};

const restoreCameraAfterScreenShare = (peer, myVideoStream) => {
    const cameraTrack = cameraStream?.getVideoTracks()[0];
    const nextVideoTrack =
        cameraTrack?.readyState === 'live' ? cameraTrack : undefined;

    if (myVideoStream) {
        setActiveVideoTrack(peer, nextVideoTrack);
    } else {
        console.warn(
            'Local camera stream is not ready; skipping preview restore.'
        );
    }

    currentScreenStream = undefined;
    sharingNow = false;
    updateScreenShareButtonState();
    updateLocalUserCard();
};

async function toggleScreenShare(peer, myVideoStream) {
    if (sharingNow === false) {
        var shareScreen = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
        });
        const [track] = shareScreen.getVideoTracks();
        const screenAudioTracks = shareScreen.getAudioTracks();

        if (!track) {
            console.warn('Screen sharing did not provide a video track.');
            return;
        }

        currentScreenStream = shareScreen;
        activeVideoTrack = track;
        sharingNow = true;
        setLocalVideoStream(getActiveStream());
        track.addEventListener('ended', () => {
            if (!sharingNow || currentScreenStream !== shareScreen) {
                return;
            }

            console.warn('Screen sharing stopped by the browser.');
            ensureSocket().emit('screen:shareStop', {
                roomId: joinedVoiceRoomId,
            });
            restoreCameraAfterScreenShare(peer, myVideoStream);
            emitLocalPresenceUpdate();
        });

        sendVideoTrackToPeers(peer, track);
        if (screenAudioTracks.length > 0) {
            console.info('[screen] sending screen audio track', {
                count: screenAudioTracks.length,
            });
            callPeersWithStream(peer, getActiveStream());
        } else {
            console.info('[screen] no screen audio track was provided');
        }

        ensureSocket().emit('screen:shareStart', {
            roomId: joinedVoiceRoomId,
        });
        emitLocalPresenceUpdate();
        updateScreenShareButtonState();
        updateLocalUserCard();
    } else {
        stopCurrentScreenStream();
        ensureSocket().emit('screen:shareStop', {
            roomId: joinedVoiceRoomId,
        });
        restoreCameraAfterScreenShare(peer, myVideoStream);
        emitLocalPresenceUpdate();
        // toggleVideo()
    }
}

// ----------------------------------------------------------------------------------------

//muting my audio
const setAudioButtonState = (enabled) => {
    const rendered = mediaControlsUI.renderMicButtonState({ enabled });

    if (!rendered) {
        console.warn('toggleAudio button not found in DOM.');
    }
};

const setAudioButtonNoMic = () => {
    mediaControlsUI.renderMicButtonState({
        enabled: false,
        unavailable: true,
    });
};

const toggleAudio = (myVideoStream) => {
    const audioTrack = myVideoStream?.getAudioTracks()[0];

    if (!audioTrack) {
        console.warn('No local microphone track is available.');
        return;
    }

    const enabled = audioTrack.enabled;
    if (enabled) {
        audioTrack.enabled = false;
        setAudioButtonState(false);
        micPermissionDenied = false;
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        console.log(`[mic] muted (track.enabled = false)`);
    } else {
        audioTrack.enabled = true;
        setAudioButtonState(true);
        micPermissionDenied = false;
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        console.log(`[mic] unmuted (track.enabled = true)`);
    }
};

const resetAutoTileLayoutHeights = () => {
    getVideoTiles().forEach((tile) => {
        if (!tile.classList.contains('is-positioned')) {
            tile.style.height = '';
        }
    });
};

const initiateAudio = async (peer) => {
    try {
        const stream = await requestAudioStream();

        myVideoStream = stream;
        micPermissionDenied = false;
        setAudioButtonState(stream.getAudioTracks()[0].enabled);
        setLocalVideoStream(getActiveStream());
        if (!callStartedAt) {
            startCallTimer();
        }
        updateLocalUserCard();

        emitLocalPresenceUpdate();

        bindPeerCallHandler(peer);

        getKnownRemotePeerIds(peer).forEach((peerId) => {
            if (peerId !== localPeerId) {
                connectToNewUser(peer, peerId, getActiveStream());
            }
        });
    } catch (error) {
        micPermissionDenied = true;
        emitLocalPresenceUpdate();
        console.warn(
            '[mic] Could not start microphone. User stays in channel without audio.',
            error
        );
        updateLocalUserCard();
    }
};

const handleMicClick = async (peer) => {
    if (myVideoStream) {
        toggleAudio(myVideoStream);
        return;
    }

    console.log('[mic] Requesting microphone...');
    initiateAudio(peer);
};

const joinVoiceChannel = (roomId) => {
    console.log(`Joining voice channel: ${getChannelName(roomId)}`);

    if (isConnectingToPeer) {
        console.warn('Voice channel is already connecting.');
        return;
    }

    if (currentPeer && !currentPeer.destroyed) {
        console.warn('Already joined a voice call.');
        return;
    }

    if (!getChannelElement(roomId)) {
        console.warn(`Voice channel ${roomId} is not available.`);
        return;
    }

    isConnectingToPeer = true;
    selectedVoiceRoomId = roomId;
    const roomToJoin = roomId;
    const isSecurePeerConnection = window.location.protocol === 'https:';
    const peerPort =
        window.location.port || (isSecurePeerConnection ? 443 : 80);

    //connecting to peer from client
    // eslint-disable-next-line no-undef
    var peer = new Peer(undefined, {
        host: window.location.hostname,
        path: '/peerjs',
        port: peerPort,
        secure: isSecurePeerConnection,
        iceServers: [
            // eslint-disable-next-line no-undef
            ...iceServers,
        ],
    });
    currentPeer = peer;

    // first wait to connect to the peer server
    peer.on('open', async (peerId) => {
        localPeerId = peerId;
        myVideo.parentElement?.setAttribute('data-peer-id', localPeerId);
        const activeSocket = ensureSocket();

        joinedVoiceRoomId = roomToJoin;
        selectedVoiceRoomId = roomToJoin;
        isConnectingToPeer = false;
        setAudioButtonNoMic();
        setCameraButtonState(false);

        document.getElementById('toggleAudio').onclick = () =>
            handleMicClick(peer);
        document.getElementById('toggleVideo').onclick = () =>
            toggleCamera(peer);
        document.getElementById('shareScreen').onclick = () =>
            toggleScreenShare(peer, myVideoStream);
        window.addEventListener('resize', resetAutoTileLayoutHeights);
        bindPeerCallHandler(peer);

        console.log('My peer ID is: ' + peerId);

        showCallControls();
        updateOutputButtonState();
        updateScreenShareButtonState();
        updateChannelIndicators();
        startCallTimer();

        activeSocket.emit('joinRoom', roomToJoin, peerId);
        activeSocket.emit('presence:joinVoice', {
            roomId: roomToJoin,
            senderName: getChatName(),
            ...getLocalPresenceState(),
        });

        bindVoiceSocketHandlers(activeSocket);
        setLocalVideoStream(getActiveStream());
        updateLocalUserCard();
    });

    peer.on('error', (error) => {
        console.warn('Peer connection failed.', error);
        isConnectingToPeer = false;
        currentPeer = undefined;
        resetLocalVoiceState();
        hideCallControls();
    });

    peer.on('connection', () => {
        console.log('peer connection established');
    });

    //once disconnected from peer, we tell the server this. The server will tell disconnect this user from websocket (see -DISCONNECT FUNCTION - )
    peer.on('close', (id) => {
        console.log(
            `Peer destroyed : ${peer.destroyed}. Letting Everyone else on in the room know.`
        );
        socket?.emit('voicePeerLeft', {
            roomId: joinedVoiceRoomId,
            peerId: id || localPeerId,
        });
        currentPeer = undefined;
        joinedVoiceRoomId = undefined;
        isConnectingToPeer = false;
        resetLocalVoiceState();
        hideCallControls();
        updateChannelIndicators();

        if (pendingVoiceRoomId) {
            const nextRoomId = pendingVoiceRoomId;
            pendingVoiceRoomId = undefined;
            window.setTimeout(() => joinVoiceChannel(nextRoomId), 150);
        }
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected');
    });

    //client click to end call and stays in browser
    document.getElementById('destroyPeer').onclick = () => {
        console.log('Destroy peer clicked');
        ensureSocket().emit('presence:leaveVoice');
        peer.destroy();
        resetLocalVoiceState();

        //removing all videos for client who is leaving.
        layoutItemsById.forEach((item) => {
            if (!PAGE_SINGLETON_TYPES.has(item.type)) {
                setTileLayoutItemVisibility(item.id, false);
            }
        });
        videoGrid.replaceChildren();
        updateMobileTileView();
        updateMobileRoomState();

        hideCallControls();
        updateChannelIndicators();
    };
};

function removeVideoElement(id) {
    var vidElement = document.getElementById(id);
    delete remoteStreams[id];

    if (vidElement) {
        setTileLayoutItemVisibility(vidElement.dataset.layoutItemId, false);
        vidElement.remove();
        resetAutoTileLayoutHeights();
        updateMobileTileView();
    }
}

if (chatNameInput) {
    chatNameInput.value = getStoredChatName();
    chatNameInput.addEventListener('change', () => {
        saveChatName();
        updatePresenceName();
    });
}

const showVoiceJoinConfirm = (roomId) => {
    voiceJoinOverlayUI.show({
        title: getChannelName(roomId),
        onConfirm: () => {
            setVoiceTargetRoom(roomId);
        },
    });
};

treeChannels.forEach((channel) => {
    const link = channel.querySelector('.tree-channel-link');
    const roomId = channel.dataset.channelRoom;

    link?.addEventListener('click', (event) => {
        event.preventDefault();
        setViewingRoom(roomId);

        if (isMobileLayout()) {
            showVoiceJoinConfirm(roomId);
        }
    });

    link?.addEventListener('dblclick', (event) => {
        event.preventDefault();
        setVoiceTargetRoom(roomId);
    });
});

window.addEventListener('popstate', () => {
    const [, roomId] = window.location.pathname.match(/^\/room\/([^/]+)/) || [];

    if (roomId) {
        setViewingRoom(roomId, { updateHistory: false });
    }
});

chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendChatMessage();
});

chatInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
        return;
    }

    event.preventDefault();
    sendChatMessage();
});

chatInput?.addEventListener('input', syncChatFormUI);

outputVolumeUI.init({
    getState: () => ({ muted: outputMuted, volume: outputVolume }),
    onToggleMuted: () => {
        outputMuted = !outputMuted;
        applyOutputSettingsToRemoteMedia();
    },
    onVolumeInput: (nextVolume) => {
        outputVolume = nextVolume;
        applyOutputSettingsToRemoteMedia();
    },
    onVolumeCommit: (nextVolume) => {
        outputVolume = nextVolume;
        applyOutputSettingsToRemoteMedia();
    },
});

controlPopoversUI.createController({
    toggles: controlMenuToggles,
    panels: controlPanels,
});

remoteVolumeUI.init();

noiseSettingsControls = noiseSettingsUI.init({
    refs: {
        noiseToggle: byId('noiseToggle'),
        noiseStatusText: byId('noiseStatusText'),
        aiNoiseToggle: byId('aiNoiseToggle'),
        aiNoiseStatusText: byId('aiNoiseStatusText'),
        micGainSlider: byId('micGainSlider'),
        micGainValue: byId('micGainValue'),
        restartNoticePanel: document.querySelector('.local-meta-panel'),
    },
    isAiExperimentSupported,
    getNoiseMode: () => noiseMode,
    onMicGainChange: (micGainPercent) => {
        if (noiseGainNode) {
            noiseGainNode.gain.value = Math.max(0.001, micGainPercent / 100);
        }
    },
});

fullscreenControls.bindFullscreenChange();

mobileBackToChannelsBtn?.addEventListener('click', () => {
    if (currentPeer && !currentPeer.destroyed) {
        byId('destroyPeer')?.click();
    }

    setMobileRoomView(false);
});

mobilePrevTileBtn?.addEventListener('click', () => {
    mobileRoomController.goPrevious();
});

mobileNextTileBtn?.addEventListener('click', () => {
    mobileRoomController.goNext();
});

window.addEventListener('resize', () => {
    syncLayoutGridMetadata();
    updateMobileRoomState();
    updateMobileTileView();
    clampPositionedTileLayouts();
    pageLayoutEditorRuntime?.positionActiveToolbarTile();
});

updateChannelIndicators();
updateOutputButtonState();
updateScreenShareButtonState();
syncChatFormUI();
syncNoiseSettingsUI();
joinChatRoom(viewingRoomId);
enablePageCursorSharing();

copyLinkUI.bindCopyButton({
    button: copyRoomLinkBtn,
    getLink: () => getChannelUrl(getCopyRoomId()),
    onError: (error) => {
        console.warn('Could not copy channel link.', error);
    },
});
