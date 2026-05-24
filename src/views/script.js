/* eslint-disable no-console */
let socket;

const videoGrid = document.getElementById('video-grid');
const mainLayout = document.getElementById('main');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const callControls = document.getElementById('buttons');
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
const mobileBackToChannelsBtn = document.getElementById('mobileBackToChannels');
const mobilePrevTileBtn = document.getElementById('mobilePrevTile');
const mobileNextTileBtn = document.getElementById('mobileNextTile');
const mobileTileCount = document.getElementById('mobileTileCount');
const remoteStreams = {};
const getAudioConstraints = () => {
    const noiseEnabled =
        localStorage.getItem(NOISE_SUPPRESSION_KEY) !== 'false';

    return {
        echoCancellation: true,
        noiseSuppression: noiseEnabled,
        autoGainControl: true,
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
        status.textContent = enabled ? '开' : '关';
    }
};

const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name';
const NOISE_SUPPRESSION_KEY = 'webrtc-noise-suppression';
const AI_NOISE_EXPERIMENT_KEY = 'webrtc-ai-noise-experiment';
const CHAT_MESSAGE_MAX_LENGTH = 500;
const CURSOR_THROTTLE_MS = 40;
const CURSOR_IDLE_MS = 700;
const MOBILE_BREAKPOINT = 768;
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
let noiseAudioContext = null;
let noiseProcessorNode = null;
// eslint-disable-next-line no-unused-vars
let noiseProcessorActive = false;
let noiseRawStream = null;

// eslint-disable-next-line no-undef
viewingRoomId = ROOM_ID;
// eslint-disable-next-line no-undef
selectedVoiceRoomId = ROOM_ID;

const showCallControls = () => {
    callControls?.classList.remove('hidden');
};

const hideCallControls = () => {
    callControls?.classList.add('hidden');
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
        callStatusText.textContent = joinedVoiceRoomId
            ? '正在语音中'
            : isConnectingToPeer
              ? '正在连接语音'
              : '未加入语音';
    }

    if (screenStatusText) {
        screenStatusText.textContent = sharingNow
            ? '正在共享屏幕'
            : '未共享屏幕';
    }

    updateNoiseToggleUI();
};

const applyOutputSettings = (mediaElement, isRemote) => {
    if (!mediaElement) {
        return;
    }

    if (isRemote && outputMuted) {
        mediaElement.volume = 0;
        mediaElement.muted = true;
    } else {
        mediaElement.volume = outputVolume;
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

    icon.className = outputMuted
        ? 'fas fa-volume-mute red'
        : 'fas fa-volume-up';

    if (label) {
        label.textContent = outputMuted ? '已静音' : '听筒';
    }
};

const updateScreenShareButtonState = () => {
    const icon = shareScreenBtn?.querySelector('i');
    const label = shareScreenBtn?.querySelector('span');

    if (icon) {
        icon.className = sharingNow
            ? 'far fa-newspaper'
            : 'far fa-newspaper red';
    }

    if (label) {
        label.textContent = sharingNow ? '共享中' : '共享';
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

const connectToNewUser = (peer, peerId, stream) => {
    console.log(
        `User ${peerId} has joined the socket room. Initiating peer call`
    );

    const call = peer.call(peerId, stream);
    setupCallStreamHandler(call, peerId);
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

const renderPresenceState = ({ channels = [] } = {}) => {
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
            const isMe = member.socketId && socket?.id === member.socketId;

            item.className = 'channel-member';
            item.textContent = `${member.senderName || 'Guest'}${isMe ? '（我）' : ''}`;
            list.append(item);
        });
    });
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
        updateMobileTileView();
    });
    socket.on('screen:shareStop', ({ peerId }) => {
        screenSharers.delete(peerId);
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
    if (!joinedVoiceRoomId) {
        return;
    }

    ensureSocket().emit('presence:update', {
        senderName: getChatName(),
    });
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
        return navigator.mediaDevices.getUserMedia({
            audio: true,
        });
    }

    if (getAiExperimentEnabled() && isAiExperimentSupported()) {
        try {
            return await createProcessedAudioStream(rawStream);
        } catch (error) {
            console.warn(
                '[audio-experiment] Passthrough init failed, falling back to raw.',
                error
            );
        }
    }

    return rawStream;
};

const createProcessedAudioStream = async (rawStream) => {
    const ctx = new AudioContext({ sampleRate: 48000 });

    await ctx.audioWorklet.addModule('/audio-worklet/passthrough-processor.js');

    const source = ctx.createMediaStreamSource(rawStream);
    const processor = new AudioWorkletNode(ctx, 'passthrough-processor');
    const dest = ctx.createMediaStreamDestination();

    source.connect(processor).connect(dest);

    noiseAudioContext = ctx;
    noiseProcessorNode = processor;
    noiseRawStream = rawStream;
    noiseProcessorActive = true;

    console.log('[audio-experiment] Passthrough processor active');
    return dest.stream;
};

const destroyProcessedAudioStream = () => {
    if (noiseProcessorNode) {
        try {
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
};

const requestTileFullscreen = async (tile) => {
    const video = tile.querySelector('video');

    if (!video) {
        console.warn('Fullscreen is only available when this peer has video.');
        return;
    }

    try {
        if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        } else {
            await video.requestFullscreen();
        }
    } catch (error) {
        console.warn('Could not enter fullscreen for this video.', error);
    }
};

const addFullscreenControls = (tile) => {
    if (!tile.id || tile.id === 'local-video') {
        return;
    }

    const button = document.createElement('button');
    button.className = 'fullscreen-btn';
    button.type = 'button';
    button.innerText = '全屏';
    button.addEventListener('click', () => requestTileFullscreen(tile));

    tile.append(button);
    tile.ondblclick = () => requestTileFullscreen(tile);
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
        tile.dataset.peerLabel = `Peer ${videoId.slice(0, 8)}`;
    } else if (localPeerId) {
        tile.dataset.peerId = localPeerId;
        tile.dataset.peerLabel = `我 ${localPeerId.slice(0, 8)}`;
    } else {
        tile.dataset.peerLabel = '我';
    }

    let mediaElement = tile.querySelector('video, audio');
    if (!mediaElement || mediaElement.tagName !== mediaTag) {
        tile.replaceChildren();
        mediaElement = hasVideo ? video : document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.playsInline = 'true';
        applyOutputSettings(mediaElement, Boolean(videoId));

        tile.append(mediaElement);

        if (!hasVideo) {
            const placeholder = document.createElement('div');
            placeholder.className = 'voice-placeholder';
            placeholder.innerText = videoId ? 'Audio only' : 'Local audio only';
            tile.append(placeholder);
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
    setHeightOfVideos(); //added
    updateMobileTileView();
};

const mergeRemoteStream = (peerId, incomingStream) => {
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

    remoteStream.getVideoTracks().forEach((track) => {
        remoteStream.removeTrack(track);
    });
    incomingVideoTracks.forEach((track) => remoteStream.addTrack(track));

    return remoteStream;
};

function setupCallStreamHandler(call, peerId) {
    call.on('stream', (userVideoStream) => {
        console.log('got stream of other person');
        addVideoStream(
            document.createElement('video'),
            mergeRemoteStream(peerId, userVideoStream),
            peerId
        );
    });
}
// ----------------------------------------------------------------------------------

// switching between sharing screen and not sharing
var sharingNow = false;
let currentScreenStream;

const getActiveStream = () => {
    const tracks = [...(myVideoStream?.getAudioTracks() || [])];

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

const callPeersWithStream = (peer, stream) => {
    if (!stream) {
        console.warn('No stream available for peer call.');
        return;
    }

    const myPeers = Object.keys(peer.connections);

    myPeers.forEach((peerId) => connectToNewUser(peer, peerId, stream));
};

const sendVideoTrackToPeers = (peer, track) => {
    const myPeers = Object.keys(peer.connections);

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

    callPeersWithStream(peer, audioOnlyStream);
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
    icon.className = enabled ? 'fas fa-video' : 'fas fa-video-slash red';
    btn.setAttribute('aria-pressed', String(!enabled));
};

const toggleCamera = async (peer) => {
    const currentCameraTrack = cameraStream?.getVideoTracks()[0];

    if (currentCameraTrack?.readyState === 'live') {
        currentCameraTrack.stop();
        cameraStream = undefined;
        setCameraButtonState(false);

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
        var shareScreen = await navigator.mediaDevices.getDisplayMedia();
        const [track] = shareScreen.getVideoTracks();

        if (!track) {
            console.warn('Screen sharing did not provide a video track.');
            return;
        }

        currentScreenStream = shareScreen;
        activeVideoTrack = track;
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
        });

        sendVideoTrackToPeers(peer, track);

        sharingNow = true;
        ensureSocket().emit('screen:shareStart', {
            roomId: joinedVoiceRoomId,
        });
        updateScreenShareButtonState();
        updateLocalUserCard();
    } else {
        stopCurrentScreenStream();
        ensureSocket().emit('screen:shareStop', {
            roomId: joinedVoiceRoomId,
        });
        restoreCameraAfterScreenShare(peer, myVideoStream);
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
    icon.className = enabled
        ? 'fas fa-microphone'
        : 'fas fa-microphone-slash red';
    btn.setAttribute('aria-pressed', String(!enabled));
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
        console.log(`[mic] muted (track.enabled = false)`);
    } else {
        audioTrack.enabled = true;
        setAudioButtonState(true);
        console.log(`[mic] unmuted (track.enabled = true)`);
    }
};

const setHeightOfVideos = () => {
    var videos = document.querySelectorAll('.video-tile');
    videos.forEach((video) => {
        video.style.height = '';
    });
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

        document.getElementById('toggleAudio').onclick = () =>
            toggleAudio(myVideoStream);
        document.getElementById('toggleVideo').onclick = () =>
            toggleCamera(peer);
        document.getElementById('shareScreen').onclick = () =>
            toggleScreenShare(peer, myVideoStream);
        window.addEventListener('resize', setHeightOfVideos);

        console.log('My peer ID is: ' + peerId);

        // after that wait for media stream
        requestAudioStream()
            .then((stream) => {
                myVideoStream = stream;
                setAudioButtonState(myVideoStream.getAudioTracks()[0].enabled);
                setLocalVideoStream(getActiveStream());
                showCallControls();
                joinedVoiceRoomId = roomToJoin;
                selectedVoiceRoomId = roomToJoin;
                isConnectingToPeer = false;
                startCallTimer();
                updateOutputButtonState();
                updateChannelIndicators();

                peer.on('call', (call) => {
                    console.log('Received a call...');

                    call.answer(getActiveStream());
                    setupCallStreamHandler(call, call.peer);
                });

                activeSocket.emit('joinRoom', roomToJoin, peerId);
                activeSocket.emit('presence:joinVoice', {
                    roomId: roomToJoin,
                    senderName: getChatName(),
                    peerId,
                });

                activeSocket.on('userConnected', ({ roomId, peerId }) => {
                    if (roomId !== joinedVoiceRoomId) {
                        return;
                    }

                    if (!remotePeerOrder.includes(peerId)) {
                        remotePeerOrder.push(peerId);
                    }

                    connectToNewUser(peer, peerId, getActiveStream());
                });

                //removing video of user who has disconnected from websocket
                activeSocket.on('removeUserVideo', ({ roomId, peerId }) => {
                    if (roomId !== joinedVoiceRoomId) {
                        return;
                    }

                    const idx = remotePeerOrder.indexOf(peerId);

                    if (idx !== -1) {
                        remotePeerOrder.splice(idx, 1);
                    }

                    screenSharers.delete(peerId);
                    removeVideoElement(peerId);
                });

                // -DISCONNECT FUNCTION - disconnecting this user from websocket. This will trigger the on.disconnected listener on the server.
                //this will tell other sockets to remove the video of the user who has just disconnected (video id is the same as the userId)
                activeSocket.on('forceDisconnect', () => {
                    activeSocket.close();
                    socket = undefined;
                    joinChatRoom();
                    console.log(
                        `You have been disconnected from websocket. The road ends here. `
                    );
                });
            })
            .catch((error) => {
                console.warn('Could not start microphone audio source.', error);
                isConnectingToPeer = false;
                currentPeer = undefined;
                resetLocalVoiceState();
                hideCallControls();
            });
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

const noiseToggleEl = document.getElementById('noiseToggle');

noiseToggleEl?.addEventListener('click', () => {
    const next = !getNoiseSuppressionEnabled();

    setNoiseSuppressionEnabled(next);
    updateNoiseToggleUI();

    if (joinedVoiceRoomId) {
        console.warn(
            `[noise] Noise suppression will ${next ? 'enable' : 'disable'} on next voice join.`
        );
    }
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

    if (joinedVoiceRoomId) {
        console.warn(
            `[audio-experiment] Will ${next ? 'enable' : 'disable'} on next voice join.`
        );
    }
});

aiNoiseToggleEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        aiNoiseToggleEl.click();
    }
});

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
