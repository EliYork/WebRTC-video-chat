/* eslint-disable no-console */
let socket;

const videoGrid = document.getElementById('video-grid');
const mainLayout = document.getElementById('main');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const callControls = document.getElementById('buttons');
const destroyPeerBtn = document.getElementById('destroyPeer');
const copyRoomLinkBtn = document.getElementById('copyRoomLink');
const chatNameInput = document.getElementById('chatName');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const treeChannels = document.querySelectorAll('[data-channel-room]');
const channelMemberLists = document.querySelectorAll('[data-members-for]');
const channelCountBadges = document.querySelectorAll('[data-channel-count]');
const chatTitle = document.getElementById('chatTitle');
const localUserName = document.getElementById('localUserName');
const localVoiceChannelName = document.getElementById('localVoiceChannelName');
const callStatusText = document.getElementById('callStatusText');
const callDuration = document.getElementById('callDuration');
const screenStatusText = document.getElementById('screenStatusText');
const toggleOutputBtn = document.getElementById('toggleOutput');
const outputVolumeInput = document.getElementById('outputVolume');
const shareScreenBtn = document.getElementById('shareScreen');
const controlMenuToggles = document.querySelectorAll('[data-control-menu]');
const controlPanels = document.querySelectorAll('[data-control-panel]');
const mobileBackToChannelsBtn = document.getElementById('mobileBackToChannels');
const mobilePrevTileBtn = document.getElementById('mobilePrevTile');
const mobileNextTileBtn = document.getElementById('mobileNextTile');
const mobileTileCount = document.getElementById('mobileTileCount');
const remoteStreams = {};
const getAudioConstraints = () => {
    const noiseEnabled =
        localStorage.getItem(NOISE_SUPPRESSION_KEY) !== 'false';
    const aiEnabled = localStorage.getItem(AI_NOISE_EXPERIMENT_KEY) === 'true';

    return {
        echoCancellation: true,
        noiseSuppression: noiseEnabled,
        autoGainControl: !aiEnabled,
        channelCount: 1,
    };
};
const getNoiseSuppressionEnabled = () =>
    localStorage.getItem(NOISE_SUPPRESSION_KEY) !== 'false';

const setNoiseSuppressionEnabled = (enabled) => {
    localStorage.setItem(NOISE_SUPPRESSION_KEY, String(enabled));
};

const updateNoiseToggleUI = () => {
    const enabled = getNoiseSuppressionEnabled();
    const toggle = document.getElementById('noiseToggle');
    const status = document.getElementById('noiseStatusText');

    if (toggle) {
        toggle.setAttribute('aria-pressed', String(enabled));
    }

    if (status) {
        status.textContent = enabled ? '开' : '关';
    }
};

const updateAiExperimentToggleUI = () => {
    const supported = isAiExperimentSupported();
    const enabled = getAiExperimentEnabled();
    const toggle = document.getElementById('aiNoiseToggle');
    const status = document.getElementById('aiNoiseStatusText');

    if (!toggle) {
        return;
    }

    if (!supported) {
        toggle.classList.add('na');
        toggle.setAttribute('aria-pressed', 'false');
        toggle.setAttribute('title', '当前浏览器/设备不支持');
        toggle.style.cursor = 'default';

        if (status) {
            status.textContent = toggle.dataset.notSupportedLabel || 'N/A';
        }

        return;
    }

    toggle.classList.remove('na');
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.removeAttribute('title');
    toggle.style.cursor = '';

    if (status) {
        if (!enabled) {
            status.textContent = '关';
        } else if (noiseMode === 'rnnoise') {
            status.textContent = 'RNNoise';
        } else if (noiseMode === 'passthrough') {
            status.textContent = '直通';
        } else if (noiseMode === 'fallback') {
            status.textContent = '回退';
        } else {
            status.textContent = '开';
        }
    }
};

const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name';
const NOISE_SUPPRESSION_KEY = 'webrtc-noise-suppression';
const AI_NOISE_EXPERIMENT_KEY = 'webrtc-ai-noise-experiment';
const MIC_GAIN_KEY = 'webrtc-mic-gain';
const TILE_LAYOUT_STORAGE_KEY = 'voice-room-tile-layouts-v1';
const PEER_VOLUME_STORAGE_KEY = 'voice-room-peer-volumes-v1';
const CHAT_MESSAGE_MAX_LENGTH = 500;
const CURSOR_THROTTLE_MS = 40;
const CURSOR_IDLE_MS = 700;
const MOBILE_BREAKPOINT = 768;
const TILE_MIN_WIDTH = 180;
const TILE_MIN_HEIGHT = 120;
const cursorSharingMedia = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT}px), (pointer: coarse)`
);
const cursorIdleTimers = {};

const isAiExperimentSupported = () =>
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !isMobileLayout();

const getAiExperimentEnabled = () =>
    localStorage.getItem(AI_NOISE_EXPERIMENT_KEY) === 'true';

const setAiExperimentEnabled = (enabled) => {
    localStorage.setItem(AI_NOISE_EXPERIMENT_KEY, String(enabled));
};
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
let activeMobileTileIndex = 0;
const remotePeerOrder = [];
const screenSharers = new Set();
const peersWithCallHandler = new WeakSet();
const presenceMembersByPeerId = new Map();
let noiseAudioContext = null;
let noiseProcessorNode = null;
// eslint-disable-next-line no-unused-vars
let noiseProcessorActive = false;
let noiseRawStream = null;
let noiseMode = 'raw';
let noiseGainNode = null;
let micPermissionDenied = false;

const getMicGain = () => {
    const val = Number(localStorage.getItem(MIC_GAIN_KEY));
    return !Number.isNaN(val) && val >= 0 && val <= 150 ? val : 100;
};

const ensureDefaultMicGain = () => {
    if (localStorage.getItem(MIC_GAIN_KEY) === null) {
        localStorage.setItem(MIC_GAIN_KEY, '100');
    }
};

// eslint-disable-next-line no-undef
viewingRoomId = ROOM_ID;
// eslint-disable-next-line no-undef
selectedVoiceRoomId = ROOM_ID;

const showCallControls = () => {
    callControls?.classList.remove('hidden');
    destroyPeerBtn?.classList.remove('hidden');
};

const hideCallControls = () => {
    callControls?.classList.add('hidden');
    destroyPeerBtn?.classList.add('hidden');
};

const isMobileLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

const getVideoTiles = () =>
    Array.from(videoGrid.querySelectorAll('.video-tile'));

const getOrderedTiles = () => {
    const tiles = getVideoTiles();
    const localTile = tiles.find((t) => t.id === 'local-video');
    const remoteTiles = tiles.filter((t) => t.id !== 'local-video');

    remoteTiles.sort((a, b) => {
        const aSharing = screenSharers.has(a.id);
        const bSharing = screenSharers.has(b.id);

        if (aSharing && !bSharing) return -1;
        if (!aSharing && bSharing) return 1;

        return remotePeerOrder.indexOf(a.id) - remotePeerOrder.indexOf(b.id);
    });

    if (localTile) {
        remoteTiles.push(localTile);
    }

    return remoteTiles;
};

const updateMobileTileView = () => {
    const orderedTiles = getOrderedTiles();
    const totalTiles = orderedTiles.length;

    if (totalTiles === 0) {
        activeMobileTileIndex = 0;
    } else {
        activeMobileTileIndex = Math.min(activeMobileTileIndex, totalTiles - 1);
    }

    getVideoTiles().forEach((tile) =>
        tile.classList.remove('is-mobile-active')
    );

    const activeTile = orderedTiles[activeMobileTileIndex];

    if (activeTile) {
        activeTile.classList.add('is-mobile-active');
    }

    if (mobileTileCount) {
        mobileTileCount.textContent =
            totalTiles === 0
                ? '0 / 0'
                : `${activeMobileTileIndex + 1} / ${totalTiles}`;
    }

    if (mobilePrevTileBtn) {
        mobilePrevTileBtn.disabled = totalTiles <= 1;
    }

    if (mobileNextTileBtn) {
        mobileNextTileBtn.disabled = totalTiles <= 1;
    }
};

const setMobileRoomView = (isInRoom) => {
    mainLayout?.classList.toggle('mobile-in-room', isInRoom);
    updateMobileTileView();
};

const updateMobileRoomState = () => {
    setMobileRoomView(Boolean(joinedVoiceRoomId) && isMobileLayout());
};

const formatDuration = (durationMs) => {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const updateCallDuration = () => {
    if (!callStartedAt || !callDuration) {
        return;
    }

    callDuration.textContent = formatDuration(Date.now() - callStartedAt);
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

    if (callDuration) {
        callDuration.textContent = '00:00';
    }
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

const getMemberMicStatus = (member = {}) => {
    if (member.micPermissionDenied) {
        return {
            key: 'denied',
            label: '未授权',
            icon: 'fas fa-triangle-exclamation',
        };
    }

    if (!member.hasMic) {
        return {
            key: 'no-mic',
            label: '未开麦',
            icon: 'fas fa-microphone-slash',
        };
    }

    if (member.muted) {
        return {
            key: 'muted',
            label: '静音',
            icon: 'fas fa-microphone-slash',
        };
    }

    return {
        key: 'speaking',
        label: '开麦',
        icon: 'fas fa-microphone',
    };
};

const getMemberTileText = (member = {}) => {
    const micStatus = getMemberMicStatus(member);

    if (member.screenSharing) {
        return '正在共享屏幕';
    }

    if (micStatus.key === 'speaking') {
        return '正在语音';
    }

    if (micStatus.key === 'muted') {
        return '静音中';
    }

    if (micStatus.key === 'denied') {
        return '麦克风未授权';
    }

    return '未开麦';
};

const getCallStatusLabel = () => {
    if (!joinedVoiceRoomId) {
        return '未进入频道';
    }

    const micStatus = getMemberMicStatus(getLocalPresenceMember());

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
    if (localUserName) {
        localUserName.textContent = getChatName();
    }

    if (localVoiceChannelName) {
        localVoiceChannelName.textContent = getChannelName(
            joinedVoiceRoomId || viewingRoomId
        );
    }

    if (callStatusText) {
        callStatusText.textContent = isConnectingToPeer
            ? '正在连接语音'
            : getCallStatusLabel();
    }

    if (screenStatusText) {
        screenStatusText.textContent = '';
        screenStatusText.classList.add('hidden');
    }

    updateNoiseToggleUI();
    updateAllVideoTileStatus();
};

const getPeerVolumes = () => {
    try {
        return JSON.parse(localStorage.getItem(PEER_VOLUME_STORAGE_KEY)) || {};
    } catch {
        return {};
    }
};

const getPeerVolume = (peerId) => {
    const value = Number(getPeerVolumes()[peerId]);

    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
};

const setPeerVolume = (peerId, volume) => {
    if (!peerId) {
        return;
    }

    const volumes = getPeerVolumes();
    volumes[peerId] = Math.min(1, Math.max(0, Number(volume)));
    localStorage.setItem(PEER_VOLUME_STORAGE_KEY, JSON.stringify(volumes));
};

const applyOutputSettings = (mediaElement, isRemote) => {
    if (!mediaElement) {
        return;
    }

    if (isRemote && outputMuted) {
        mediaElement.volume = 0;
        mediaElement.muted = true;
    } else {
        const peerId = mediaElement.closest('.video-tile')?.dataset.peerId;
        const peerVolume = isRemote ? getPeerVolume(peerId) : 1;
        mediaElement.volume = Math.min(1, outputVolume * peerVolume);
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
    const icon = toggleOutputBtn?.querySelector('i');
    const label = toggleOutputBtn?.querySelector('span');

    if (!icon) {
        return;
    }

    icon.className = 'fas fa-volume-up';
    toggleOutputBtn?.classList.toggle('is-off', outputMuted);
    toggleOutputBtn?.setAttribute('aria-pressed', String(outputMuted));

    if (label) {
        label.textContent = outputMuted ? '已静音' : '听筒';
    }
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

const closeControlMenus = (exceptWrap) => {
    controlMenuToggles.forEach((toggle) => {
        const wrap = toggle.closest('.control-button-wrap');
        const panel = document.querySelector(
            `[data-control-panel="${toggle.dataset.controlMenu}"]`
        );

        if (wrap && wrap !== exceptWrap) {
            wrap.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
            panel?.classList.remove('is-open');
        }
    });

    if (!exceptWrap) {
        controlPanels.forEach((panel) => panel.classList.remove('is-open'));
    }
};

const setCopyRoomLinkCopied = (isCopied) => {
    if (!copyRoomLinkBtn) {
        return;
    }

    const icon = copyRoomLinkBtn.querySelector('i');
    copyRoomLinkBtn.classList.toggle('is-copied', isCopied);
    copyRoomLinkBtn.title = isCopied ? '已复制' : '复制频道链接';
    copyRoomLinkBtn.setAttribute(
        'aria-label',
        isCopied ? '已复制' : '复制频道链接'
    );

    if (icon) {
        icon.className = isCopied ? 'fas fa-check' : 'fas fa-link';
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
    treeChannels.forEach((channel) => {
        const roomId = channel.dataset.channelRoom;
        channel.classList.toggle('is-viewing', roomId === viewingRoomId);
        channel.classList.toggle('is-voice', roomId === joinedVoiceRoomId);
        channel.classList.toggle(
            'is-voice-target',
            !joinedVoiceRoomId && roomId === selectedVoiceRoomId
        );
    });

    const viewingName = getChannelName(viewingRoomId);

    if (chatTitle) {
        chatTitle.textContent = `${viewingName}聊天`;
    }

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

const createGuestName = () =>
    `Guest-${Math.floor(1000 + Math.random() * 9000)}`;

const getStoredChatName = () => {
    const storedName = localStorage.getItem(CHAT_NAME_STORAGE_KEY);

    if (storedName) {
        return storedName;
    }

    const guestName = createGuestName();
    localStorage.setItem(CHAT_NAME_STORAGE_KEY, guestName);
    return guestName;
};

const getChatName = () => {
    const name = chatNameInput?.value.trim().slice(0, 32);
    return name || getStoredChatName();
};

const saveChatName = () => {
    if (!chatNameInput) {
        return;
    }

    const name = chatNameInput.value.trim().slice(0, 32) || createGuestName();
    chatNameInput.value = name;
    localStorage.setItem(CHAT_NAME_STORAGE_KEY, name);
};

const formatChatTime = (createdAt) =>
    new Date(createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });

const appendChatMessage = (message) => {
    if (!chatMessages || !message?.content) {
        return;
    }

    if (message.roomId && message.roomId !== viewingRoomId) {
        return;
    }

    const item = document.createElement('li');
    const meta = document.createElement('div');
    const content = document.createElement('div');
    const senderName =
        message.senderName === getChatName()
            ? `${message.senderName} (我)`
            : message.senderName;

    item.className = 'chat-message';
    meta.className = 'chat-message-meta';
    content.className = 'chat-message-content';
    meta.textContent = `${senderName} · ${formatChatTime(message.createdAt)}`;
    content.textContent = message.content;

    item.append(meta, content);
    chatMessages.append(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
};

const renderChatHistory = (messages) => {
    if (!chatMessages) {
        return;
    }

    chatMessages.replaceChildren();
    (Array.isArray(messages) ? messages : []).forEach(appendChatMessage);
};

const createMemberStatusIcon = ({ key, label, icon }) => {
    const status = document.createElement('span');
    const statusIcon = document.createElement('i');

    status.className = `member-status member-status-${key}`;
    status.title = label;
    status.setAttribute('aria-label', label);
    statusIcon.className = icon;
    status.append(statusIcon);

    return status;
};

const getMemberStatusIcons = (member) => {
    const statuses = [getMemberMicStatus(member)];

    if (member.cameraOn) {
        statuses.push({
            key: 'camera',
            label: '摄像头开启',
            icon: 'fas fa-video',
        });
    }

    if (member.screenSharing) {
        statuses.push({
            key: 'screen',
            label: '共享中',
            icon: 'far fa-newspaper',
        });
    }

    return statuses;
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

        badge.textContent = String(channel?.count || 0);
    });

    channelMemberLists.forEach((list) => {
        const channel = channels.find(
            (currentChannel) => currentChannel.slug === list.dataset.membersFor
        );
        const membersBySocket = new Map();

        list.replaceChildren();
        (channel?.members || []).forEach((member) => {
            if (!member.socketId) {
                return;
            }

            membersBySocket.set(member.socketId, member);
        });

        membersBySocket.forEach((member) => {
            const item = document.createElement('li');
            const name = document.createElement('span');
            const statuses = document.createElement('span');
            const isMe = member.socketId && socket?.id === member.socketId;

            item.className = 'channel-member';
            name.className = 'channel-member-name';
            name.textContent = `${member.senderName || 'Guest'}${isMe ? '（我）' : ''}`;
            statuses.className = 'channel-member-statuses';
            getMemberStatusIcons(member).forEach((status) => {
                statuses.append(createMemberStatusIcon(status));
            });

            item.append(name, statuses);
            list.append(item);
        });
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
    const content = chatInput?.value.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);

    if (!content) {
        return;
    }

    saveChatName();
    updatePresenceName();
    ensureSocket().emit('chat:send', {
        roomId: viewingRoomId,
        senderName: getChatName(),
        content,
    });

    chatInput.value = '';
};

const clampCursorPosition = (position) =>
    Math.min(1, Math.max(0, Number(position) || 0));

const getCursorOverlay = () => {
    let overlay = document.getElementById('cursorOverlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cursorOverlay';
        overlay.className = 'cursor-overlay';
        document.body.append(overlay);
    }

    return overlay;
};

const setCursorIdle = (socketId) => {
    const cursor = document.querySelector(
        `.shared-cursor[data-socket-id="${socketId}"]`
    );

    if (cursor) {
        cursor.classList.add('is-idle');
    }
};

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
        () => setCursorIdle(socketId),
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

    const overlay = getCursorOverlay();
    let cursor = overlay.querySelector(
        `.shared-cursor[data-socket-id="${socketId}"]`
    );

    if (!cursor) {
        cursor = document.createElement('div');
        const pointer = document.createElement('div');
        const label = document.createElement('div');

        cursor.className = 'shared-cursor';
        cursor.dataset.socketId = socketId;
        pointer.className = 'shared-cursor-pointer';
        label.className = 'shared-cursor-label';

        cursor.append(pointer, label);
        overlay.append(cursor);
    }

    cursor.style.left = `${clampCursorPosition(x) * 100}vw`;
    cursor.style.top = `${clampCursorPosition(y) * 100}vh`;
    cursor.style.setProperty('--cursor-color', color);
    cursor.querySelector('.shared-cursor-label').textContent =
        senderName || 'Guest';
    cursor.classList.remove('is-idle');
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
    setCursorIdle(socketId);
};

const removeRemoteCursor = ({ socketId }) => {
    clearCursorIdleTimer(socketId);
    document
        .querySelectorAll(`.shared-cursor[data-socket-id="${socketId}"]`)
        .forEach((cursor) => cursor.remove());
};

const clearRemoteCursors = () => {
    Object.keys(cursorIdleTimers).forEach(clearCursorIdleTimer);
    document.querySelectorAll('.shared-cursor').forEach((cursor) => {
        cursor.remove();
    });
};

const shouldDisablePageCursorSharing = () => cursorSharingMedia.matches;

const removeCursorOverlay = () => {
    clearRemoteCursors();
    document.getElementById('cursorOverlay')?.remove();
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
        getCursorOverlay();
    }

    document.addEventListener('pointermove', sendCursorMove);
    document.addEventListener('pointerleave', sendCursorLeave);
    cursorSharingMedia.addEventListener('change', () => {
        if (shouldDisablePageCursorSharing()) {
            removeCursorOverlay();
        } else {
            getCursorOverlay();
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

    const micGainPercent = getMicGain();
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

const getFullscreenElement = () =>
    document.fullscreenElement || document.webkitFullscreenElement;

const updateFullscreenButtonStates = () => {
    const fullscreenElement = getFullscreenElement();

    document.querySelectorAll('.fullscreen-btn').forEach((button) => {
        const tile = button.closest('.video-tile');
        const isFullscreen = tile && fullscreenElement === tile;
        const label = isFullscreen ? '退出全屏' : '全屏';

        button.textContent = label;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(Boolean(isFullscreen)));
        button.classList.toggle('is-exit', Boolean(isFullscreen));
    });
};

const toggleTileFullscreen = async (tile) => {
    const video = tile.querySelector('video');

    if (!video) {
        console.warn('Fullscreen is only available when this peer has video.');
        return;
    }

    try {
        if (getFullscreenElement() === tile) {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else if (tile.requestFullscreen) {
            await tile.requestFullscreen();
        } else if (tile.webkitRequestFullscreen) {
            tile.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        } else {
            console.warn('Fullscreen API is not available for this browser.');
        }
        updateFullscreenButtonStates();
    } catch (error) {
        console.warn('Could not toggle fullscreen for this video tile.', error);
    }
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

    const button = document.createElement('button');
    button.className = 'fullscreen-btn';
    button.type = 'button';
    button.title = '全屏';
    button.setAttribute('aria-label', '全屏');
    button.textContent = '全屏';
    button.addEventListener('click', () => toggleTileFullscreen(tile));

    actions.append(button);
    tile.ondblclick = () => toggleTileFullscreen(tile);
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

const sanitizeLayoutIdPart = (value) =>
    String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

const getTileLayoutId = (tile) => {
    const peerId = tile.dataset.peerId;

    if (tile.dataset.tileType === 'screen-share' && peerId) {
        return `screen-${sanitizeLayoutIdPart(peerId)}`;
    }

    if (tile.id === 'local-video') {
        return `local-${sanitizeLayoutIdPart(localPeerId || socket?.id || 'me')}`;
    }

    return `peer-${sanitizeLayoutIdPart(peerId || tile.id)}`;
};

const getSavedTileLayouts = () => {
    try {
        return JSON.parse(localStorage.getItem(TILE_LAYOUT_STORAGE_KEY)) || {};
    } catch {
        return {};
    }
};

const saveTileLayout = (layoutId, layout) => {
    if (!layoutId) {
        return;
    }

    const layouts = getSavedTileLayouts();
    layouts[layoutId] = {
        x: Math.round(layout.x),
        y: Math.round(layout.y),
        width: Math.round(layout.width),
        height: Math.round(layout.height),
    };
    localStorage.setItem(TILE_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
};

const getTileBounds = () => {
    const gridRect = videoGrid.getBoundingClientRect();
    const fallbackRect = videoGrid.parentElement?.getBoundingClientRect();

    return {
        width: Math.max(
            TILE_MIN_WIDTH,
            gridRect.width || fallbackRect?.width || TILE_MIN_WIDTH
        ),
        height: Math.max(
            TILE_MIN_HEIGHT,
            gridRect.height || fallbackRect?.height || TILE_MIN_HEIGHT
        ),
    };
};

const clampTileLayout = ({ x, y, width, height }) => {
    const bounds = getTileBounds();
    const nextWidth = Math.min(Math.max(width, TILE_MIN_WIDTH), bounds.width);
    const nextHeight = Math.min(
        Math.max(height, TILE_MIN_HEIGHT),
        bounds.height
    );

    return {
        x: Math.min(Math.max(0, x), Math.max(0, bounds.width - nextWidth)),
        y: Math.min(Math.max(0, y), Math.max(0, bounds.height - nextHeight)),
        width: nextWidth,
        height: nextHeight,
    };
};

const applyTileLayout = (tile, layout) => {
    const next = clampTileLayout(layout);

    tile.classList.add('is-positioned');
    tile.style.left = `${next.x}px`;
    tile.style.top = `${next.y}px`;
    tile.style.width = `${next.width}px`;
    tile.style.height = `${next.height}px`;
};

const getCurrentTileLayout = (tile) => {
    const tileRect = tile.getBoundingClientRect();
    const gridRect = videoGrid.getBoundingClientRect();

    return clampTileLayout({
        x: tileRect.left - gridRect.left + videoGrid.scrollLeft,
        y: tileRect.top - gridRect.top + videoGrid.scrollTop,
        width: tileRect.width,
        height: tileRect.height,
    });
};

const persistCurrentTileLayout = (tile) => {
    saveTileLayout(tile.dataset.layoutId, getCurrentTileLayout(tile));
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

const applySavedTileLayout = (tile) => {
    if (isMobileLayout() || !tile.dataset.layoutId) {
        return;
    }

    const layout = getSavedTileLayouts()[tile.dataset.layoutId];

    if (layout) {
        applyTileLayout(tile, layout);
    }
};

const createTileAvatarText = (displayName) =>
    String(displayName || 'Guest')
        .trim()
        .slice(0, 1)
        .toUpperCase() || 'G';

const ensureTileStructure = (tile) => {
    let header = tile.querySelector('.tile-header');
    let body = tile.querySelector('.tile-body');
    let overlay = tile.querySelector('.tile-overlay');
    let actions = tile.querySelector('.tile-actions');
    let footer = tile.querySelector('.tile-footer');
    let resizeHandle = tile.querySelector('.tile-resize-handle');

    if (!header) {
        header = document.createElement('div');
        header.className = 'tile-header';
        header.setAttribute('data-drag-handle', 'true');

        const avatar = document.createElement('div');
        avatar.className = 'tile-avatar';

        const title = document.createElement('div');
        title.className = 'tile-title';

        const badges = document.createElement('div');
        badges.className = 'tile-badges';

        header.append(avatar, title, badges);
        tile.prepend(header);
    }

    if (!body) {
        body = document.createElement('div');
        body.className = 'tile-body';
        tile.append(body);
    }

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'tile-overlay';
        tile.append(overlay);
    }

    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'tile-footer';
        tile.append(footer);
    }

    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'tile-actions';
        tile.append(actions);
    }

    if (!resizeHandle) {
        resizeHandle = document.createElement('div');
        resizeHandle.className = 'tile-resize-handle';
        resizeHandle.setAttribute('aria-hidden', 'true');
        tile.append(resizeHandle);
    }

    bindTileLayoutControls(tile, header, resizeHandle);

    return { header, body, overlay, actions, footer };
};

const isTilePointerDisabled = (event) =>
    isMobileLayout() ||
    getFullscreenElement() ||
    event.button !== 0 ||
    event.target.closest('button, input, textarea, a, .fullscreen-btn');

const startTileDrag = (event, tile) => {
    if (isTilePointerDisabled(event)) {
        return;
    }

    const startLayout = getCurrentTileLayout(tile);
    applyTileLayout(tile, startLayout);
    tile.classList.add('is-dragging');
    tile.setPointerCapture(event.pointerId);
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent) => {
        applyTileLayout(tile, {
            ...startLayout,
            x: startLayout.x + moveEvent.clientX - startX,
            y: startLayout.y + moveEvent.clientY - startY,
        });
    };

    const onEnd = () => {
        tile.classList.remove('is-dragging');
        persistCurrentTileLayout(tile);
        tile.removeEventListener('pointermove', onMove);
        tile.removeEventListener('pointerup', onEnd);
        tile.removeEventListener('pointercancel', onEnd);
    };

    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onEnd);
    tile.addEventListener('pointercancel', onEnd);
};

const startTileResize = (event, tile) => {
    if (isMobileLayout() || getFullscreenElement() || event.button !== 0) {
        return;
    }

    const startLayout = getCurrentTileLayout(tile);
    applyTileLayout(tile, startLayout);
    tile.classList.add('is-resizing');
    tile.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent) => {
        applyTileLayout(tile, {
            ...startLayout,
            width: startLayout.width + moveEvent.clientX - startX,
            height: startLayout.height + moveEvent.clientY - startY,
        });
    };

    const onEnd = () => {
        tile.classList.remove('is-resizing');
        persistCurrentTileLayout(tile);
        tile.removeEventListener('pointermove', onMove);
        tile.removeEventListener('pointerup', onEnd);
        tile.removeEventListener('pointercancel', onEnd);
    };

    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onEnd);
    tile.addEventListener('pointercancel', onEnd);
};

const bindTileLayoutControls = (tile, header, resizeHandle) => {
    if (!tile.dataset.layoutBound) {
        header.addEventListener('pointerdown', (event) =>
            startTileDrag(event, tile)
        );
        resizeHandle.addEventListener('pointerdown', (event) =>
            startTileResize(event, tile)
        );
        tile.addEventListener('contextmenu', (event) =>
            showPeerVolumePopover(event, tile)
        );
        tile.dataset.layoutBound = 'true';
    }
};

const closePeerVolumePopover = () => {
    document.querySelector('.peer-volume-popover')?.remove();
};

const showPeerVolumePopover = (event, tile) => {
    const peerId = tile.dataset.peerId;

    if (isMobileLayout() || tile.id === 'local-video' || !peerId) {
        return;
    }

    event.preventDefault();
    closePeerVolumePopover();

    const popover = document.createElement('div');
    const title = document.createElement('div');
    const titleText = document.createElement('span');
    const icon = document.createElement('i');
    const range = document.createElement('input');
    const value = document.createElement('span');
    const currentVolume = Math.round(getPeerVolume(peerId) * 100);

    popover.className = 'peer-volume-popover';
    title.className = 'peer-volume-title';
    titleText.textContent = '设置用户音量';
    icon.className = 'fas fa-microphone';
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '5';
    range.value = String(currentVolume);
    value.className = 'peer-volume-value';
    value.textContent = `${currentVolume}%`;

    title.append(titleText, icon);
    popover.append(title, range, value);
    document.body.append(popover);

    const popoverRect = popover.getBoundingClientRect();
    const left = Math.min(
        Math.max(8, event.clientX),
        window.innerWidth - popoverRect.width - 8
    );
    const top = Math.min(
        Math.max(8, event.clientY),
        window.innerHeight - popoverRect.height - 8
    );

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    range.addEventListener('input', () => {
        const nextVolume = Number(range.value);
        setPeerVolume(peerId, nextVolume / 100);
        value.textContent = `${nextVolume}%`;
        applyOutputSettingsToRemoteMedia();
    });
};

const updateVideoTileStatus = (tile) => {
    if (!tile) {
        return;
    }

    const member = getTileMember(tile);
    const isLocal = tile.id === 'local-video';
    const hasVideo = Boolean(tile.querySelector('video'));
    const displayName = member.senderName || (isLocal ? getChatName() : 'Peer');
    const { header, overlay, footer } = ensureTileStructure(tile);
    const tileType = getTileType(tile, hasVideo, member);

    tile.dataset.peerLabel = isLocal ? `${displayName}（我）` : displayName;
    tile.dataset.tileType = tileType;
    const nextLayoutId = getTileLayoutId(tile);
    const layoutChanged = tile.dataset.layoutId !== nextLayoutId;
    tile.dataset.layoutId = nextLayoutId;
    if (layoutChanged && !tile.classList.contains('is-positioned')) {
        applySavedTileLayout(tile);
    }
    tile.classList.toggle('has-video', hasVideo);
    tile.classList.toggle('is-audio-only', !hasVideo);
    tile.classList.toggle('is-screen-share', tileType === 'screen-share');

    if (member.socketId) {
        tile.dataset.socketId = member.socketId;
    } else {
        delete tile.dataset.socketId;
    }

    const avatar = header.querySelector('.tile-avatar');
    const title = header.querySelector('.tile-title');
    const badges = header.querySelector('.tile-badges');

    if (avatar) {
        avatar.textContent = createTileAvatarText(displayName);
    }

    if (title) {
        title.textContent = isLocal ? `${displayName}（我）` : displayName;
    }

    if (badges) {
        badges.replaceChildren();
    }

    overlay.replaceChildren();
    getMemberStatusIcons(member).forEach((status) => {
        const badge = document.createElement('span');
        const icon = document.createElement('i');

        badge.className = `tile-status-badge tile-status-${status.key}`;
        badge.title = status.label;
        icon.className = status.icon;
        badge.append(icon, document.createTextNode(status.label));
        overlay.append(badge);

        if (badges) {
            const compactBadge = document.createElement('span');
            const compactIcon = document.createElement('i');

            compactBadge.className = `tile-badge tile-badge-${status.key}`;
            compactBadge.title = status.label;
            compactIcon.className = status.icon;
            compactBadge.append(compactIcon);
            badges.append(compactBadge);
        }
    });

    const placeholder = tile.querySelector('.voice-placeholder');
    if (placeholder && !tile.querySelector('video')) {
        const placeholderAvatar = placeholder.querySelector(
            '.voice-placeholder-avatar'
        );
        const placeholderTitle = placeholder.querySelector(
            '.voice-placeholder-title'
        );
        const placeholderStatus = placeholder.querySelector(
            '.voice-placeholder-status'
        );

        if (placeholderAvatar) {
            placeholderAvatar.textContent = createTileAvatarText(displayName);
        }

        if (placeholderTitle) {
            placeholderTitle.textContent = isLocal
                ? `${displayName}（我）`
                : displayName;
        }

        if (placeholderStatus) {
            placeholderStatus.textContent = getMemberTileText(member);
        }
    }

    footer.textContent = getMemberTileText(member);
};

const updateAllVideoTileStatus = () => {
    document.querySelectorAll('.video-tile').forEach(updateVideoTileStatus);
};

const ensurePresenceTileForPeer = (peerId) => {
    if (!peerId || peerId === localPeerId) {
        return;
    }

    if (!document.getElementById(peerId)) {
        console.info('[tile] create presence tile', { peerId });
        addVideoStream(
            document.createElement('video'),
            new MediaStream(),
            peerId
        );
    } else {
        updateVideoTileStatus(document.getElementById(peerId));
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
        ensurePresenceTileForPeer(member.peerId);
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
    setHeightOfVideos(); //added
    updateMobileTileView();
};

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
    const btn = document.getElementById('toggleVideo');
    const icon = btn?.querySelector('i');
    if (!icon) {
        console.warn('toggleVideo button not found in DOM.');
        return;
    }
    icon.className = 'fas fa-video';
    btn.classList.toggle('is-off', !enabled);
    btn.setAttribute('aria-pressed', String(!enabled));
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
    const btn = document.getElementById('toggleAudio');
    const icon = btn?.querySelector('i');
    if (!icon) {
        console.warn('toggleAudio button not found in DOM.');
        return;
    }
    icon.className = 'fas fa-microphone';
    btn.classList.toggle('is-off', !enabled);
    btn.setAttribute('aria-pressed', String(!enabled));
};

const setAudioButtonNoMic = () => {
    const btn = document.getElementById('toggleAudio');
    const icon = btn?.querySelector('i');

    if (!icon) {
        return;
    }

    icon.className = 'fas fa-microphone';
    btn.classList.add('is-off');
    btn.setAttribute('aria-pressed', 'true');
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

const setHeightOfVideos = () => {
    var videos = document.querySelectorAll('.video-tile');
    videos.forEach((video) => {
        video.style.height = '';
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
        window.addEventListener('resize', setHeightOfVideos);
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
        videoGrid.replaceChildren();
        updateMobileTileView();

        hideCallControls();
        updateChannelIndicators();
    };
};

function removeVideoElement(id) {
    var vidElement = document.getElementById(id);
    delete remoteStreams[id];

    if (vidElement) {
        vidElement.remove();
        setHeightOfVideos();
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

const voiceJoinOverlay = () => {
    let overlay = document.getElementById('voiceJoinOverlay');

    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'voiceJoinOverlay';
    overlay.className = 'voice-join-overlay hidden';
    overlay.innerHTML = `
        <div class="voice-join-dialog">
            <h3 id="voiceJoinChannelName"></h3>
            <p>进入此频道语音？</p>
            <div class="voice-join-actions">
                <button id="voiceJoinCancel" class="voice-join-cancel" type="button">取消</button>
                <button id="voiceJoinConfirm" class="voice-join-confirm" type="button">进入语音</button>
            </div>
        </div>
    `;

    document.body.append(overlay);
    return overlay;
};

const showVoiceJoinConfirm = (roomId) => {
    const overlay = voiceJoinOverlay();
    const nameEl = document.getElementById('voiceJoinChannelName');

    if (nameEl) {
        nameEl.textContent = getChannelName(roomId);
    }

    overlay.classList.remove('hidden');

    const onConfirm = () => {
        setVoiceTargetRoom(roomId);
        hideVoiceJoinConfirm();
    };

    const onCancel = () => {
        hideVoiceJoinConfirm();
    };

    document.getElementById('voiceJoinConfirm').onclick = onConfirm;
    document.getElementById('voiceJoinCancel').onclick = onCancel;
    overlay.onclick = (event) => {
        if (event.target === overlay) {
            onCancel();
        }
    };
};

const hideVoiceJoinConfirm = () => {
    const overlay = document.getElementById('voiceJoinOverlay');

    if (overlay) {
        overlay.classList.add('hidden');
    }
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

toggleOutputBtn?.addEventListener('click', () => {
    outputMuted = !outputMuted;
    updateOutputButtonState();
    applyOutputSettingsToRemoteMedia();
});

outputVolumeInput?.addEventListener('input', () => {
    outputVolume = Number(outputVolumeInput.value);
    applyOutputSettingsToRemoteMedia();
});

controlMenuToggles.forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const wrap = toggle.closest('.control-button-wrap');
        const panel = document.querySelector(
            `[data-control-panel="${toggle.dataset.controlMenu}"]`
        );
        const shouldOpen = !wrap?.classList.contains('is-open');

        closeControlMenus(wrap);

        if (!wrap) {
            return;
        }

        wrap.classList.toggle('is-open', shouldOpen);
        panel?.classList.toggle('is-open', shouldOpen);
        toggle.setAttribute('aria-expanded', String(shouldOpen));
    });
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.peer-volume-popover')) {
        closePeerVolumePopover();
    }

    if (event.target.closest('.control-button-wrap, .control-popover')) {
        return;
    }

    closeControlMenus();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closePeerVolumePopover();
        closeControlMenus();
    }
});

const noiseToggleEl = document.getElementById('noiseToggle');
let restartNoticeTimer;

const showRestartEffectNotice = () => {
    const panel = document.querySelector('.local-meta-panel');

    if (!panel) {
        return;
    }

    let notice = panel.querySelector('.restart-effect-notice');
    if (!notice) {
        notice = document.createElement('div');
        notice.className = 'restart-effect-notice';
        panel.append(notice);
    }

    notice.textContent = '重进房间后生效';
    notice.classList.add('is-visible');
    clearTimeout(restartNoticeTimer);
    restartNoticeTimer = window.setTimeout(() => {
        notice.classList.remove('is-visible');
    }, 2600);
};

noiseToggleEl?.addEventListener('click', () => {
    const next = !getNoiseSuppressionEnabled();

    setNoiseSuppressionEnabled(next);
    updateNoiseToggleUI();
    showRestartEffectNotice();
});

noiseToggleEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        noiseToggleEl.click();
    }
});

const aiNoiseToggleEl = document.getElementById('aiNoiseToggle');

aiNoiseToggleEl?.addEventListener('click', () => {
    if (!isAiExperimentSupported()) {
        return;
    }

    const next = !getAiExperimentEnabled();

    setAiExperimentEnabled(next);
    updateAiExperimentToggleUI();
    showRestartEffectNotice();
});

aiNoiseToggleEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        aiNoiseToggleEl.click();
    }
});

const micGainSlider = document.getElementById('micGainSlider');
const micGainValueEl = document.getElementById('micGainValue');

ensureDefaultMicGain();

const setMicGain = (percent) => {
    const clamped = Math.max(0, Math.min(150, Math.round(percent)));
    localStorage.setItem(MIC_GAIN_KEY, String(clamped));

    if (micGainSlider) {
        micGainSlider.value = String(clamped);
    }

    if (micGainValueEl) {
        micGainValueEl.textContent = clamped + '%';
    }

    if (noiseGainNode) {
        noiseGainNode.gain.value = Math.max(0.001, clamped / 100);
    }
};

if (micGainSlider) {
    micGainSlider.value = String(getMicGain());

    if (micGainValueEl) {
        micGainValueEl.textContent = getMicGain() + '%';
    }

    micGainSlider.addEventListener('input', () => {
        setMicGain(Number(micGainSlider.value));
    });
}

document.addEventListener('fullscreenchange', updateFullscreenButtonStates);
document.addEventListener(
    'webkitfullscreenchange',
    updateFullscreenButtonStates
);

mobileBackToChannelsBtn?.addEventListener('click', () => {
    if (currentPeer && !currentPeer.destroyed) {
        document.getElementById('destroyPeer')?.click();
    }

    setMobileRoomView(false);
});

mobilePrevTileBtn?.addEventListener('click', () => {
    const totalTiles = getVideoTiles().length;

    if (totalTiles <= 1) {
        return;
    }

    activeMobileTileIndex =
        (activeMobileTileIndex - 1 + totalTiles) % totalTiles;
    updateMobileTileView();
});

mobileNextTileBtn?.addEventListener('click', () => {
    const totalTiles = getVideoTiles().length;

    if (totalTiles <= 1) {
        return;
    }

    activeMobileTileIndex = (activeMobileTileIndex + 1) % totalTiles;
    updateMobileTileView();
});

window.addEventListener('resize', () => {
    updateMobileRoomState();
    updateMobileTileView();
    clampPositionedTileLayouts();
});

updateChannelIndicators();
updateOutputButtonState();
updateScreenShareButtonState();
updateNoiseToggleUI();
updateAiExperimentToggleUI();
joinChatRoom(viewingRoomId);
enablePageCursorSharing();

copyRoomLinkBtn?.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(getChannelUrl(getCopyRoomId()));
        setCopyRoomLinkCopied(true);
        setTimeout(() => {
            setCopyRoomLinkCopied(false);
        }, 1500);
    } catch (error) {
        console.warn('Could not copy channel link.', error);
    }
});
