/* eslint-disable no-console */
let socket;

const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const joinBtn = document.querySelector('#join-btn');
const copyRoomLinkBtn = document.getElementById('copyRoomLink');
const chatNameInput = document.getElementById('chatName');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const remoteStreams = {};
const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};
const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name';
const CHAT_MESSAGE_MAX_LENGTH = 500;
const CURSOR_THROTTLE_MS = 40;
const CURSOR_IDLE_MS = 700;
const cursorIdleTimers = {};
let myVideoStream;
let activeStream;
let cameraStream;
let activeVideoTrack;
let localPeerId;
let lastCursorMoveAt = 0;

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
    socket.on('cursor:move', renderRemoteCursor);
    socket.on('cursor:leave', markRemoteCursorIdle);
    socket.on('cursor:remove', removeRemoteCursor);

    return socket;
};

const joinChatRoom = () => {
    const activeSocket = ensureSocket();

    // eslint-disable-next-line no-undef
    activeSocket.emit('chat:join', { roomId: ROOM_ID });
};

const sendChatMessage = () => {
    const content = chatInput?.value.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);

    if (!content) {
        return;
    }

    saveChatName();
    ensureSocket().emit('chat:send', {
        // eslint-disable-next-line no-undef
        roomId: ROOM_ID,
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

const renderRemoteCursor = ({ socketId, x, y, senderName, color }) => {
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

const markRemoteCursorIdle = ({ socketId }) => {
    clearCursorIdleTimer(socketId);
    setCursorIdle(socketId);
};

const removeRemoteCursor = ({ socketId }) => {
    clearCursorIdleTimer(socketId);
    document
        .querySelectorAll(`.shared-cursor[data-socket-id="${socketId}"]`)
        .forEach((cursor) => cursor.remove());
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
        // eslint-disable-next-line no-undef
        roomId: ROOM_ID,
        x: position.x,
        y: position.y,
        senderName: getChatName(),
    });
};

const sendCursorLeave = () => {
    ensureSocket().emit('cursor:leave', {
        // eslint-disable-next-line no-undef
        roomId: ROOM_ID,
    });
};

const enablePageCursorSharing = () => {
    getCursorOverlay();
    document.addEventListener('pointermove', sendCursorMove);
    document.addEventListener('pointerleave', sendCursorLeave);
};

const requestAudioStream = async () => {
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
        });
    } catch (error) {
        console.warn(
            'Could not start microphone with audio processing constraints; retrying with basic audio.',
            error
        );
        return navigator.mediaDevices.getUserMedia({
            audio: true,
        });
    }
};

const requestTileFullscreen = async (tile) => {
    if (!tile.querySelector('video')) {
        console.warn('Fullscreen is only available when this peer has video.');
        return;
    }

    try {
        await tile.requestFullscreen();
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
        videoGrid.append(tile);
    }

    if (videoId) {
        tile.dataset.peerId = videoId;
    } else if (localPeerId) {
        tile.dataset.peerId = localPeerId;
    }

    let mediaElement = tile.querySelector('video, audio');
    if (!mediaElement || mediaElement.tagName !== mediaTag) {
        tile.replaceChildren();
        mediaElement = hasVideo ? video : document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.playsInline = 'true';
        mediaElement.muted = !videoId;

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
    mediaElement.onloadedmetadata = () => {
        mediaElement.play();
    };
    setHeightOfVideos(); //added
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

const toggleCamera = async (peer) => {
    const currentCameraTrack = cameraStream?.getVideoTracks()[0];

    if (currentCameraTrack?.readyState === 'live') {
        currentCameraTrack.stop();
        cameraStream = undefined;
        document.getElementById('toggleVideo').firstChild.className =
            'fas fa-video-slash red';

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

    document.getElementById('toggleVideo').firstChild.className =
        'fas fa-video';

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
    document.getElementById('shareScreen').firstChild.className =
        'far fa-newspaper red'; //no good symbol for sharing screen

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
};

async function toggleScreenShare(peer, myVideoStream) {
    if (sharingNow === false) {
        var shareScreen = await navigator.mediaDevices.getDisplayMedia();
        const [track] = shareScreen.getVideoTracks();

        if (!track) {
            console.warn('Screen sharing did not provide a video track.');
            return;
        }

        document.getElementById('shareScreen').firstChild.className =
            'far fa-newspaper';

        currentScreenStream = shareScreen;
        activeVideoTrack = track;
        setLocalVideoStream(getActiveStream());
        track.addEventListener('ended', () => {
            if (!sharingNow || currentScreenStream !== shareScreen) {
                return;
            }

            console.warn('Screen sharing stopped by the browser.');
            restoreCameraAfterScreenShare(peer, myVideoStream);
        });

        sendVideoTrackToPeers(peer, track);

        sharingNow = true;
    } else {
        stopCurrentScreenStream();
        restoreCameraAfterScreenShare(peer, myVideoStream);
        // toggleVideo()
    }
}

// ----------------------------------------------------------------------------------------

//muting my audio
const setAudioButtonState = (enabled) => {
    document.getElementById('toggleAudio').firstChild.className = enabled
        ? 'fas fa-microphone-alt'
        : 'fas fa-microphone-alt-slash red';
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
    } else {
        audioTrack.enabled = true;
        setAudioButtonState(true);
    }
};

const setHeightOfVideos = () => {
    var height = document.getElementById('canvas').clientHeight;
    var videos = document.querySelectorAll('.video-tile');
    videos.forEach((video) => {
        if (videos.length <= 2) {
            video.style.height = height / 2 + 'px';
        } else if (videos.length > 2 && videos.length <= 6) {
            video.style.height = height / 3 + 'px';
        } else if (videos.length >= 7) {
            video.style.height = height / 4 + 'px';
        }
    });
};

const connect = () => {
    joinBtn.classList.add('hidden');

    //connecting to peer from client
    // eslint-disable-next-line no-undef
    var peer = new Peer(undefined, {
        host: window.location.hostname,
        path: '/peerjs',
        // eslint-disable-next-line no-undef
        port: PEER_PORT,
        iceServers: [
            // eslint-disable-next-line no-undef
            ...iceServers,
        ],
    });

    // first wait to connect to the peer server
    peer.on('open', async (peerId) => {
        localPeerId = peerId;
        myVideo.parentElement?.setAttribute('data-peer-id', localPeerId);
        const activeSocket = ensureSocket();

        document
            .getElementById('toggleAudio')
            .addEventListener('click', () => toggleAudio(myVideoStream));
        document
            .getElementById('toggleVideo')
            .addEventListener('click', () => toggleCamera(peer));
        document
            .getElementById('shareScreen')
            .addEventListener('click', () =>
                toggleScreenShare(peer, myVideoStream)
            );
        window.addEventListener('resize', setHeightOfVideos);

        document.querySelector('#buttons').classList.remove('hidden');

        console.log('My peer ID is: ' + peerId);

        // after that wait for media stream
        requestAudioStream()
            .then((stream) => {
                myVideoStream = stream;
                setAudioButtonState(myVideoStream.getAudioTracks()[0].enabled);
                setLocalVideoStream(getActiveStream());

                peer.on('call', (call) => {
                    console.log('Received a call...');

                    call.answer(getActiveStream());
                    setupCallStreamHandler(call, call.peer);
                });

                // eslint-disable-next-line no-undef
                activeSocket.emit('joinRoom', ROOM_ID, peerId);

                activeSocket.on('userConnected', (peerId) =>
                    connectToNewUser(peer, peerId, getActiveStream())
                );

                //removing video of user who has disconnected from websocket
                activeSocket.on('removeUserVideo', (peerId) =>
                    removeVideoElement(peerId)
                );

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
                joinBtn.classList.remove('hidden');
                document.querySelector('#buttons').classList.add('hidden');
            });
    });

    peer.on('connection', () => {
        console.log('peer connection established');
    });

    //once disconnected from peer, we tell the server this. The server will tell disconnect this user from websocket (see -DISCONNECT FUNCTION - )
    peer.on('close', (id) => {
        console.log(
            `Peer destroyed : ${peer.destroyed}. Letting Everyone else on in the room know.`
        );
        socket.emit('peerLeft', id);
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected');
    });

    //client click to end call and stays in browser
    document.getElementById('destroyPeer').addEventListener('click', () => {
        peer.destroy();

        //removing all videos for client who is leaving.
        videoGrid.replaceChildren();

        joinBtn.querySelector('button').innerText = 'Re-join Call';
        joinBtn.classList.remove('hidden');
        document.querySelector('#buttons').classList.add('hidden');
    });
};

function removeVideoElement(id) {
    var vidElement = document.getElementById(id);
    delete remoteStreams[id];

    if (vidElement) {
        vidElement.remove();
        setHeightOfVideos();
    }
}

joinBtn.addEventListener('click', connect);

if (chatNameInput) {
    chatNameInput.value = getStoredChatName();
    chatNameInput.addEventListener('change', saveChatName);
}

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

joinChatRoom();
enablePageCursorSharing();

copyRoomLinkBtn?.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(window.location.href);
        copyRoomLinkBtn.innerText = '已复制';
        setTimeout(() => {
            copyRoomLinkBtn.innerText = '复制频道链接';
        }, 1500);
    } catch (error) {
        console.warn('Could not copy channel link.', error);
    }
});
