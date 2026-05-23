/* eslint-disable no-console */
let socket;

const videoGrid = document.getElementById('video-grid');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const joinBtn = document.querySelector('#join-btn');
const remoteStreams = {};
let myVideoStream;
let activeStream;
let cameraStream;
let activeVideoTrack;

const connectToNewUser = (peer, peerId, stream) => {
    console.log(
        `User ${peerId} has joined the socket room. Initiating peer call`
    );

    const call = peer.call(peerId, stream);
    setupCallStreamHandler(call, peerId);
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
        }
    }

    mediaElement.srcObject = stream;
    mediaElement.addEventListener('loadedmetadata', () => {
        mediaElement.play();
    });
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
const toggleAudio = (myVideoStream) => {
    const enabled = myVideoStream.getAudioTracks()[0].enabled;
    if (enabled) {
        myVideoStream.getAudioTracks()[0].enabled = false;
        document.getElementById('toggleAudio').firstChild.className =
            'fas fa-microphone-alt-slash red';
    } else {
        myVideoStream.getAudioTracks()[0].enabled = true;
        document.getElementById('toggleAudio').firstChild.className =
            'fas fa-microphone-alt';
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
        // eslint-disable-next-line no-undef
        socket = io({
            query: {
                roomId: window.location.pathname.split('/').pop(),
                peerId: peerId,
            },
        });

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
        navigator.mediaDevices
            .getUserMedia({
                audio: true,
            })
            .then((stream) => {
                myVideoStream = stream;
                setLocalVideoStream(getActiveStream());

                peer.on('call', (call) => {
                    console.log('Received a call...');

                    call.answer(getActiveStream());
                    setupCallStreamHandler(call, call.peer);
                });

                // eslint-disable-next-line no-undef
                socket.emit('joinRoom', ROOM_ID, peerId);

                socket.on('userConnected', (peerId) =>
                    connectToNewUser(peer, peerId, getActiveStream())
                );

                //removing video of user who has disconnected from websocket
                socket.on('removeUserVideo', (peerId) =>
                    removeVideoElement(peerId)
                );

                // -DISCONNECT FUNCTION - disconnecting this user from websocket. This will trigger the on.disconnected listener on the server.
                //this will tell other sockets to remove the video of the user who has just disconnected (video id is the same as the userId)
                socket.on('forceDisconnect', () => {
                    socket.close();
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
