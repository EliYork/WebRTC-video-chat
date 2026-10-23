import '/js/shared/morph-icon-ui.js';
import { sanitizeVoiceDiagnostic } from '/js/shared/voice-diagnostic-schema.js';

/* eslint-disable no-console */
console.info('[stage-layout] script boot ' + new Date().toISOString());
let socket;
let callDiagnostics;

const { byId } = window.VoiceViewUtils;

const videoGrid = byId('video-grid');
const mainLayout = byId('main');
const myVideo = document.createElement('video');
myVideo.muted = true; // ensures that we do not hear ourselves
myVideo.playsInline = 'true';

const mediaDockRoot = byId('buttons');
const chatPanelRoot = byId('chat-panel');
const sidebarRoot = byId('channel-sidebar');
const chatTitle = byId('chatTitle');
const noiseSettingsUI = window.VoiceNoiseSettingsUI;
const remoteVolumeUI = window.VoiceRemoteVolumeUI;
const copyLinkUI = window.VoiceCopyLinkUI;
const outputVolumeState = window.VoiceOutputVolumeState;
const mediaDockAdapterApi = window.VoiceMediaDockAdapter;
const mediaDockRuntimeApi = window.VoiceMediaDockRuntime;
const screenShareVolumeControllerApi = window.VoiceScreenShareVolumeController;
const fullscreenControls = window.VoiceFullscreenControls;
const localScreenSharePreviewControllerApi =
    window.VoiceLocalScreenSharePreviewController;
const voiceJoinOverlayUI = window.VoiceJoinOverlayUI;
const roomUIState = window.VoiceRoomUIState;
const presenceViewModel = window.VoicePresenceViewModel;
const participantsListUI = window.VoiceParticipantsListUI;
const tileStatusUI = window.VoiceTileStatusUI;
const videoTileStructureUI = window.VoiceVideoTileStructureUI;
const chatMessageUI = window.VoiceChatMessageUI;
const chatFormUI = window.VoiceChatFormUI;
const chatNameState = window.VoiceChatNameState;
const chatSocketTransportApi = window.VoiceChatSocketTransport;
const chatPanelRuntimeApi = window.VoiceChatPanelRuntime;
const channelSidebarUI = window.VoiceChannelSidebarUI;
const sidebarSocketTransportApi = window.VoiceSidebarSocketTransport;
const sidebarRuntimeApi = window.VoiceSidebarRuntime;
const cursorShareUI = window.VoiceCursorShareUI;
const voiceCallProtocol = window.VoiceCallProtocol;
const voicePeerRegistryApi = window.VoicePeerRegistry;
const voiceMediaLifecycle = window.VoiceMediaLifecycle;
const voiceRetryControllerApi = window.VoiceRetryController;
const voiceSessionRuntimeApi = window.VoiceSessionRuntime;
const voiceMediaOperationApi = window.VoiceMediaOperationRuntime;
const voiceDeviceRuntimeApi = window.VoiceDeviceRuntime;
const voiceStatusViewApi = window.VoiceStatusView;
const voiceMediaQualityView = window.VoiceMediaQualityView;
const voiceMediaQualityRuntimeApi = window.VoiceMediaQualityRuntime;
const { getMemberMicStatus, getMemberStatusIcons, getMemberTileText } =
    presenceViewModel;
const getCameraConstraints = () =>
    selectedCameraDeviceId && selectedCameraDeviceId !== 'default'
        ? { deviceId: { exact: selectedCameraDeviceId } }
        : true;

const CURSOR_THROTTLE_MS = 40;
const CURSOR_IDLE_MS = 700;
const MOBILE_BREAKPOINT = 768;
let stageLayout;
let chatPanelRuntime;
let sidebarRuntime;
let mediaDockAdapter;
let mediaDockRuntime;

const notifyMediaDock = () => {
    callDiagnostics?.observe();
    mediaDockAdapter?.notify();
    stageLayout?.sync();
};

const cursorSharingMedia = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT}px), (pointer: coarse)`
);
const cursorIdleTimers = {};

const isAiExperimentSupported = () =>
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !isMobileLayout();

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
let pendingVoiceRoomId;
let callStartedAt;
let callDurationTimer;
let outputMuted = false;
let outputVolume = 1;
let selectedInputDeviceId = 'default';
let selectedCameraDeviceId = 'default';
let committedCameraDeviceId = selectedCameraDeviceId;
let selectedOutputDeviceId = 'default';
let outputSelectionRevision = 0;
const channelSounds = window.VoiceChannelSounds.createRuntime({
    getOutput: () => ({ muted: outputMuted, volume: outputVolume, deviceId: selectedOutputDeviceId }),
    getIdentity: () => ({ localSocketId: socket?.id, localPeerId }),
    isConnected: () => Boolean(socket?.connected && voiceSessionRuntime.getSnapshot().state === 'joined'),
});
let mediaDevicesCache = {
    camera: [],
    mic: [],
    output: [],
};
const remotePeerOrder = [];
const voiceMediaTargets = new Set();
const screenSharers = new Set();
const peersWithCallHandler = new WeakSet();
const presenceMembersByPeerId = new Map();
const mediaElementVideoTracks = new WeakMap();
const mediaElementAudioTracks = new WeakMap();
let localVoiceMediaGeneration = 0;
let localVoiceSessionGeneration = 0;
let screenShareRequestPending = false;
const localMediaTrackStopper = voiceMediaLifecycle.createTrackStopper();
const voiceMediaDebug = voiceCallProtocol.createMediaDebugLog();
const recordMediaDebug = voiceMediaDebug.record.bind(voiceMediaDebug);
voiceMediaDebug.record = (event) => {
    recordMediaDebug(event);
    callDiagnostics?.record(event.event || 'media', {
        state: event.state,
        mode: event.mode,
        部件: event.type,
        reason: /^[a-z0-9-]{1,80}$/i.test(event.reason || '') ? event.reason : null,
    });
};
const voiceStatusView = voiceStatusViewApi.createStatusView({
    connectionElement: undefined,
    container: undefined,
});
const voiceSessionRuntime = voiceSessionRuntimeApi.createSessionRuntime({
    onDebug: (event) => voiceMediaDebug.record(event),
    onStateChange: () => {
        updateLocalUserCard();
    },
});
const peerRetryController = voiceRetryControllerApi.createRetryController({
    baseDelay: 600,
    jitter: 0.2,
    maxAttempts: 5,
    maxDelay: 8000,
    onDebug: (event) => voiceMediaDebug.record(event),
});
const mediaOperationController =
    voiceMediaOperationApi.createMediaOperationController({
        getEpoch: () => voiceSessionRuntime.getSnapshot().epoch,
        onDebug: (event) => voiceMediaDebug.record(event),
        stopStream: (stream) => {
            disposeAudioPipeline(stream);
            localMediaTrackStopper.stopStream(stream);
        },
    });
// This is a join preference, not permission to capture outside a voice session.
mediaOperationController.setDesired('microphone', true);
const localTrackEndedController =
    voiceMediaOperationApi.createTrackEndedController({
        getEpoch: () => voiceSessionRuntime.getSnapshot().epoch,
        isCurrent: (epoch) => voiceSessionRuntime.isCurrent(epoch),
        onDebug: (event) => voiceMediaDebug.record(event),
        onEnded: ({ epoch, track, type }) =>
            void handleUnexpectedLocalTrackEnded(type, track, epoch),
        stopTrack: (track) => localMediaTrackStopper.stopTrack(track),
    });
let voiceMediaQualityRuntime;
let screenSfuRuntime;
const usingPiik = window.voiceScreenMediaProvider === 'piik';
const remoteScreenSfuSources = new Map();
const remoteP2pTrackRoles = new Map();
const renderRemoteMedia = (peerId, baseStream, generation) => {
    const source = remoteScreenSfuSources.get(peerId);
    const merged = window.VoiceScreenSfuRuntime.mergeScreenMedia({
        baseStream,
        baseTrackRoles: remoteP2pTrackRoles.get(peerId) || [],
        screenStream: source?.stream,
        screenTrackRoles: source?.trackRoles || [],
    });
    const member = presenceMembersByPeerId.get(peerId);
    // replaceTrack(null) does not end the receiver track. Use the channel's
    // media state to remove its cached video, retaining the live voice tracks
    // and the registry's receiver stream for a later camera restart.
    if (member?.cameraOn === false && !member.screenSharing && !screenSharers.has(peerId) &&
        merged.stream?.getVideoTracks().length) {
        merged.stream = new MediaStream(merged.stream.getAudioTracks());
    }
    return addVideoStream(document.createElement('video'), merged.stream, peerId, {
        generation: generation ?? voicePeerRegistry.getQualitySource(peerId)?.generation ?? 0,
        trackRoles: merged.trackRoles,
    });
};
const screenShareVolumeController =
    screenShareVolumeControllerApi.createController({
        MediaStreamCtor: MediaStream,
        applyElementState: ({ element, muted, volume }) =>
            applyScreenShareOutputSettings(element, { muted, volume }),
        attachMediaElement: (mediaElement, stream) =>
            voiceMediaLifecycle.attachAndPlayMedia({
                mediaElement,
                onWarning: (message, error) =>
                    console.warn(message, error || ''),
                stream,
            }),
        clearMediaElement: (mediaElement) =>
            voiceMediaLifecycle.clearMediaElement({
                mediaElement,
                onWarning: (message, error) =>
                    console.warn(message, error || ''),
            }),
        createAudioElement: () => document.createElement('audio'),
    });
const localScreenSharePreviewController =
    localScreenSharePreviewControllerApi.createController({
        attachMediaElement: (mediaElement, stream) =>
            voiceMediaLifecycle.attachAndPlayMedia({
                mediaElement,
                onWarning: (message, error) =>
                    console.warn(message, error || ''),
                stream,
            }),
        clearMediaElement: (mediaElement) =>
            voiceMediaLifecycle.clearMediaElement({
                mediaElement,
                onWarning: (message, error) =>
                    console.warn(message, error || ''),
            }),
        exitFullscreen: (tile) =>
            fullscreenControls.toggleTileFullscreen({
                tile,
                onError: (error) =>
                    console.warn(
                        'Could not exit fullscreen before hiding the local preview.',
                        error
                    ),
            }),
        isFullscreen: (tile) =>
            fullscreenControls.getFullscreenElement() === tile,
    });
const voicePeerRegistry = voicePeerRegistryApi.createRegistry({
    prepareConnection: ({ peer }) => preparePeerConnection(peer),
    attachRemoteStream: ({ generation, metadata, peerId, stream }) => {
        remoteP2pTrackRoles.set(peerId, metadata?.[voiceCallProtocol.MEDIA_TRACK_ROLES_METADATA] || []);
        return renderRemoteMedia(peerId, stream, generation);
    },
    createRemoteStream: ({
        currentStream,
        incomingStream,
        peerId,
        replaceAll,
    }) =>
        mergeRemoteStream(peerId, incomingStream, {
            currentStream,
            replaceAll,
        }),
    detachRemoteStream: ({ peerId, tile }) => {
        if (tile && document.getElementById(peerId) === tile) {
            remoteP2pTrackRoles.delete(peerId);
            renderRemoteMedia(peerId, null);
            return;
        }

        const mediaElement = tile?.querySelector('video, audio');
        voiceMediaLifecycle.clearMediaElement({
            mediaElement,
            onWarning: (message, error) => console.warn(message, error || ''),
        });
    },
    onDebug: (event) => voiceMediaDebug.record(event),
    onPeerCleanup: ({ peerId }) => {
        screenSfuRuntime?.forgetPeer(peerId);
        remoteScreenSfuSources.delete(peerId);
        remoteP2pTrackRoles.delete(peerId);
        screenShareVolumeController.cleanup(peerId);
        voiceMediaQualityRuntime?.stop(peerId, 'peer-cleanup', {
            remove: true,
        });
    },
    onRemoteMediaState: ({ peerId }) =>
        voiceMediaQualityRuntime?.syncPeer(peerId),
    onOutgoingConnected: ({ peerId }) => {
        if (screenSfuRuntime?.usesServer(peerId)) refreshVoiceCallsForLocalMedia(currentPeer);
    },
    onCodecFallback: ({ reason, primary }) => {
        callDiagnostics?.record('共享编码回退', { reason, primary, 路径: 'P2P' });
        if (currentPeer) refreshVoiceCallsForLocalMedia(currentPeer);
    },
    onCodecFeedback: (feedback) => {
        if (joinedVoiceRoomId && localVoiceSessionGeneration)
            ensureSocket().emit('screen:codec-feedback', { ...feedback, voiceSessionGeneration: localVoiceSessionGeneration });
    },
    onWarning: (message, error) => console.warn(message, error || ''),
    removeRemoteTile: ({ peerId, tile }) => removeRemoteTile(peerId, tile),
});
screenSfuRuntime = (usingPiik ? window.PiikScreenMedia : window.VoiceScreenSfuRuntime).createRuntime({
    onPublicationFailure: (message) => {
        if (sharingNow || screenShareRequestPending) stopScreenShare(currentPeer);
        if (typeof message === 'string' && message) {
            voiceStatusView.setMediaError('screen', 'unknown', message);
            notifyMediaDock();
        }
    },
    config: window.voiceScreenSfuConfig || {},
    onRouteEvent: (event) => callDiagnostics?.record('共享路径事件', event),
    onReceiverFailure: (failure) => callDiagnostics?.record('SFU接收回退诊断', failure),
    onReceiverIssue: (issue) => callDiagnostics?.record('SFU接收异常诊断', issue),
    onCodecEvent: (event) => callDiagnostics?.record('共享编码回退', event),
    onRoutes: () => {
        updateScreenP2pBudget();
        if (currentPeer) refreshVoiceCallsForLocalMedia(currentPeer);
        notifyMediaDock();
    },
    onUplinkBudget: () => {
        updateScreenP2pBudget();
        voicePeerRegistry.getPeerIds({ direction: 'outgoing' }).forEach((peerId) => {
            const call = voicePeerRegistry.getSnapshot(peerId)?.outgoingCall;
            void window.VoiceScreenSendPolicy?.apply(
                call?.peerConnection || call?._pc,
                (message, error) => console.warn(message, error || '')
            );
        });
    },
    onRemoteStream: ({ peerId, stream, publicationId, trackRoles }) => {
        callDiagnostics?.record('观看路径切换', {
            参与者序号: voicePeerRegistry.getPeerIds().indexOf(peerId) + 1,
            路径: stream ? 'SFU' : 'P2P（等待画面确认）',
        });
        if (stream) remoteScreenSfuSources.set(peerId, { stream, publicationId, trackRoles });
        else if (remoteScreenSfuSources.get(peerId)?.publicationId === publicationId) remoteScreenSfuSources.delete(peerId);
        if (voiceMediaTargets.has(peerId)) renderRemoteMedia(peerId, voicePeerRegistry.getQualitySource(peerId)?.stream);
    },
    onState: () => {
        updateScreenP2pBudget();
        if (currentPeer) refreshVoiceCallsForLocalMedia(currentPeer);
        notifyMediaDock();
    },
    onWarning: (message, error) => console.warn('[screen-route]', message, error?.message || ''),
});
const getDiagnosticQualitySource = (peerId) => {
        if (peerId === 'local-video') {
            const tile = document.getElementById('local-video');
            return {
                isLocal: true,
                localAudioProcessing: {
                    requestedMode: audioSettingsController.snapshot().requested.mode,
                    state: audioProcessingRuntime.diagnostics(myVideoStream),
                    microphoneGain: noiseSettingsUI.getMicGain(),
                },
                routeStatus: screenSfuRuntime.snapshot(),
                outputGain: remoteAudioGain.getSnapshot(),
                captureAudio: voiceMediaLifecycle.describeScreenAudio(currentScreenStream, navigator.mediaDevices?.getSupportedConstraints?.()),
                shareOptions: currentScreenShareSession?.shareOptions,
                codecDecision: currentScreenShareSession?.codecDecision,
                onSample: (snapshot) => screenSfuRuntime.observeSender(snapshot, {
                    directViewers: [...voiceMediaTargets].filter((id) => !screenSfuRuntime.usesServer(id)).length,
                    budget: window.voiceScreenSfuConfig?.p2pBudget || 24000000,
                }),
                serverHealth: screenSfuRuntime.getSendHealth(),
                piikConnections: usingPiik ? screenSfuRuntime.getDiagnosticConnections?.() : undefined,
                outgoingConnections: [screenSfuRuntime.getSendConnection(), ...voicePeerRegistry.getPeerIds().map((id) => {
                    const call = voicePeerRegistry.getSnapshot(id)?.outgoingCall;
                    return call?.peerConnection || call?._pc;
                })].filter(Boolean),
                previewHidden: tile?.classList.contains('is-local-preview-hidden'),
                isScreenSharing: Boolean(currentScreenStream),
                stream: currentScreenStream,
                tile,
                video: tile?.querySelector('video'),
            };
        }
        const snapshot = voicePeerRegistry.getQualitySource(peerId);
        const serverSource = screenSfuRuntime.getRemoteSource(peerId);
        const tile = snapshot?.tile || document.getElementById(peerId);
        const playbackStream =
            screenShareVolumeController.getPrimaryStream(peerId) ||
            snapshot?.stream;
        return {
            ...snapshot,
            localAudioProcessing: {
                requestedMode: audioSettingsController.snapshot().requested.mode,
                state: audioProcessingRuntime.diagnostics(myVideoStream),
                microphoneGain: noiseSettingsUI.getMicGain(),
            },
            routeStatus: screenSfuRuntime.snapshot(),
            piikConnections: usingPiik ? screenSfuRuntime.getDiagnosticConnections?.(peerId) : undefined,
            outputGain: remoteAudioGain.getSnapshot(),
            ...(serverSource ? { pc: serverSource.pc } : {}),
            serverHealth: serverSource?.serverHealth,
            screenRoute: usingPiik ? 'Piik P2P' : serverSource ? '服务器转发' : 'P2P',
            routeControl: usingPiik ? undefined : {
                get: () => screenSfuRuntime.getReceiveRoute(peerId),
                change: (mode) => screenSfuRuntime.setReceiveRoute(peerId, mode),
                observe: (pc, reports) => { if (!serverSource) screenSfuRuntime.observeP2p(peerId, pc, reports); },
            },
            isScreenSharing: screenSharers.has(peerId),
            stream: playbackStream,
            tile,
            video: tile?.querySelector('video'),
        };
};
voiceMediaQualityRuntime = voiceMediaQualityRuntimeApi.createRuntime({
    debug: (event) => voiceMediaDebug.record(event),
    getQualitySource: getDiagnosticQualitySource,
    view: voiceMediaQualityView,
});
window.exportVoiceMediaDebug = () => voiceMediaDebug.export();
// eslint-disable-next-line no-unused-vars
let noiseProcessorActive = false;
let noiseRawStream = null;
let noiseMode = 'raw';
const audioProcessingRuntime = window.VoiceAudioProcessing.createRuntime({
    getGain: () => noiseSettingsUI.getMicGain(),
    getSpeechGateEnabled: () => noiseSettingsUI.getRnnoiseSpeechGateEnabled(),
    onProcessingStatus: () => notifyMediaDock(),
    supportsRnnoise: isAiExperimentSupported,
    stopStream: (stream) => localMediaTrackStopper.stopStream(stream),
    onSourceEnded: (stream) => {
        const track = stream.getAudioTracks()[0];
        void handleUnexpectedLocalTrackEnded('microphone', track, voiceSessionRuntime.getSnapshot().epoch);
    },
    onProcessorFailure: (pipeline) => recoverProcessingFailure({ ...pipeline, stream: myVideoStream }),
});
const audioPipelines = audioProcessingRuntime.pipelines;
const audioSettingsController = window.VoiceAudioSettingsController.createController({
    initial: { mode: noiseSettingsUI.getNoiseMode(), deviceId: selectedInputDeviceId },
    onRequested: ({ deviceId }) => {
        selectedInputDeviceId = deviceId;
        voiceDeviceRuntime?.setSelected('mic', deviceId);
    },
    onCommitted: ({ mode }) => noiseSettingsUI.setNoiseMode(mode),
    onChange: (snapshot) => {
        callDiagnostics?.record('音频设置切换', {
            请求模式: snapshot.requested.mode,
            实际模式: snapshot.committed.mode,
            设置切换中: snapshot.pending,
            切换结果: snapshot.error,
            输入设备: snapshot.requested.deviceId === 'default' ? '默认' : '自选',
        });
        notifyMediaDock();
    },
    rollback: () => audioProcessingRuntime.diagnostics(myVideoStream)?.sourceLive === false ? { deviceId: 'default' } : {},
    apply: async (request) => {
        if (mediaOperationController.getSnapshot('microphone').promise) {
            mediaOperationController.invalidate('microphone', { state: 'switching' });
        }
        const hasCapture = myVideoStream?.getAudioTracks().some((track) => track.readyState === 'live');
        if ((hasCapture || mediaOperationController.getSnapshot('microphone').desired) && currentPeer && !currentPeer.destroyed) {
            return restartLocalMicrophone(currentPeer, { preserveOldTrack: true, request });
        }
        return true;
    },
});
let activeAudioPipelineStream = null;
let cameraSelectionRevision = 0;
let micPermissionDenied = false;

// eslint-disable-next-line no-undef
viewingRoomId = ROOM_ID;
// eslint-disable-next-line no-undef
selectedVoiceRoomId = ROOM_ID;

const isMobileLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

const getVideoTiles = () => Array.from(mainLayout.querySelectorAll('.video-tile'));
const updateMobileTileView = () => stageLayout?.sync();
const updateMobileRoomState = () => stageLayout?.sync();

const updateCallDuration = () => {
    if (!callStartedAt) {
        return;
    }
    notifyMediaDock();
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
    notifyMediaDock();
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
        hasMic: Boolean(audioTrack),
        micPermissionDenied,
        muted: Boolean(audioTrack && !audioTrack.enabled),
        cameraOn: hasLiveCameraTrack(),
        screenSharing: Boolean(sharingNow),
    };
};

const getLocalPresencePayload = () => {
    const { cameraOn, hasMic, micPermissionDenied, muted } =
        getLocalPresenceState();
    return { cameraOn, hasMic, micPermissionDenied, muted };
};

const getLocalPresenceMember = () => ({
    socketId: socket?.id,
    peerId: localPeerId,
    roomId: joinedVoiceRoomId,
    senderName: getChatName(),
    joinedVoice: Boolean(joinedVoiceRoomId),
    ...getLocalPresenceState(),
    outputMuted,
});

const emitLocalPresenceUpdate = () => {
    if (!joinedVoiceRoomId) {
        return;
    }

    ensureSocket().emit('presence:update', {
        senderName: getChatName(),
        ...getLocalPresencePayload(),
    });

    if (localPeerId) {
        presenceMembersByPeerId.set(localPeerId, getLocalPresenceMember());
    }
    updateAllVideoTileStatus();
};

const getCallStatusLabel = (
    micStatus = getMemberMicStatus(getLocalPresenceMember())
) => {
    const session = voiceSessionRuntime.getSnapshot();
    if (session.desiredVoiceState === 'joined' && session.state !== 'joined') {
        if (session.state === 'failed' && session.failureReason === 'ice-configuration-unavailable')
            return '网络连接暂未准备好，请重试加入语音';
        return voiceStatusViewApi.CONNECTION_LABELS[
            navigator.onLine === false ? 'offline' : session.state
        ];
    }
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

const getMediaDockSnapshot = () => {
    const session = voiceSessionRuntime.getSnapshot();
    const microphoneOperation =
        mediaOperationController.getSnapshot('microphone');
    const cameraOperation = mediaOperationController.getSnapshot('camera');
    const screenOperation = mediaOperationController.getSnapshot('screen');
    const microphoneTrack = myVideoStream?.getAudioTracks?.()[0];
    const mediaErrors = voiceStatusView.getSnapshot();
    const connectionState =
        navigator.onLine === false ? 'offline' : session.state;
    const actualVoiceJoined = Boolean(
        joinedVoiceRoomId &&
            currentPeer &&
            !currentPeer.destroyed &&
            session.state === 'joined'
    );

    return {
        actualVoiceJoined,
        aiNoiseEnabled: audioSettingsController.snapshot().requested.mode === 'rnnoise',
        aiNoiseSupported: isAiExperimentSupported(),
        availableCameras: mediaDevicesCache.camera,
        availableMicrophones: mediaDevicesCache.mic,
        availableOutputs: mediaDevicesCache.output,
        browserScreenShareSupported: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
        callDurationMs: callStartedAt ? Date.now() - callStartedAt : 0,
        callStatusText: getCallStatusLabel(),
        cameraEnabled: hasLiveCameraTrack(),
        cameraError: mediaErrors.camera,
        cameraPending: Boolean(cameraOperation.promise),
        cameraPermissionState:
            cameraOperation.errorType === 'permission-denied'
                ? 'denied'
                : hasLiveCameraTrack()
                  ? 'granted'
                  : 'prompt',
        channelName: getChannelName(joinedVoiceRoomId || viewingRoomId),
        connectionState,
        desiredVoiceJoined: session.desiredVoiceState === 'joined',
        displayName: getChatName(),
        mediaControlsAvailable: actualVoiceJoined,
        mediaErrors,
        microphoneControlsAvailable: session.state !== 'disposed',
        microphoneIntentOnly: session.desiredVoiceState !== 'joined',
        microphoneEnabled: session.desiredVoiceState !== 'joined' ? microphoneOperation.desired : Boolean(
            microphoneTrack?.readyState === 'live' && microphoneTrack.enabled &&
            audioProcessingRuntime.diagnostics(myVideoStream)?.sourceLive !== false
        ),
        microphoneError: mediaErrors.microphone,
        microphoneGain: noiseSettingsUI.getMicGain(),
        rnnoiseSpeechGateEnabled: noiseSettingsUI.getRnnoiseSpeechGateEnabled(),
        microphonePending: Boolean(microphoneOperation.promise),
        microphonePermissionState:
            micPermissionDenied ||
            microphoneOperation.errorType === 'permission-denied'
                ? 'denied'
                : microphoneTrack?.readyState === 'live'
                  ? 'granted'
                  : 'prompt',
        noiseMode,
        noiseSuppressionEnabled: audioSettingsController.snapshot().requested.mode === 'browser',
        requestedNoiseMode: audioSettingsController.snapshot().requested.mode,
        audioSettingsPending: audioSettingsController.snapshot().pending,
        audioSettingsError: audioSettingsController.snapshot().error,
        audioProcessing: audioProcessingRuntime.diagnostics(myVideoStream),
        outputMuted,
        outputSelectionUnsupported: !canSelectAudioOutput(),
        outputVolume,
        screenShareEnabled: Boolean(sharingNow),
        screenShareOptions: currentScreenShareSession?.shareOptions,
        screenShareAudioActive: Boolean(currentScreenStream?.getAudioTracks().some(track => track.readyState === 'live')),
        screenShareError: mediaErrors.screen,
        screenSharePending:
            screenShareRequestPending || Boolean(screenOperation.promise),
        screenShareRoute: screenSfuRuntime?.snapshot(),
        selectedCameraId: selectedCameraDeviceId,
        selectedMicrophoneId: selectedInputDeviceId,
        selectedOutputId: selectedOutputDeviceId,
    };
};

const updateLocalUserCard = () => {
    notifyMediaDock();
    updateAllVideoTileStatus();
};

const getPeerVolume = (peerId) => outputVolumeState.getPeerVolume(peerId);

const setPeerVolume = (peerId, volume) =>
    outputVolumeState.setPeerVolume(peerId, volume);

const remoteAudioGain = window.VoiceRemoteAudioGain.createRuntime({
    onFailure: (error) => {
        voiceStatusView.setMediaError('output', 'unknown', '音量放大不可用，已恢复普通播放');
        console.warn('Could not amplify remote audio.', error);
    },
});
voiceMediaLifecycle.onMediaClear(remoteAudioGain.release);

const canSelectAudioOutput = () =>
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';

const applyOutputDevice = async (mediaElement, isRemote) => {
    if (!isRemote || !mediaElement || !canSelectAudioOutput()) {
        return true;
    }

    const sinkId = selectedOutputDeviceId || 'default';
    const revision = outputSelectionRevision;

    const gainOutput = remoteAudioGain.getOutputTarget(mediaElement);
    const gainToken = remoteAudioGain.getBranchToken(mediaElement);

    let result = await voiceDeviceRuntimeApi.switchOutputDevice({
        deviceId: sinkId,
        mediaElement,
        supported: canSelectAudioOutput(),
    });
    if (revision !== outputSelectionRevision || sinkId !== selectedOutputDeviceId) return result.ok;
    if (gainToken !== remoteAudioGain.getBranchToken(mediaElement)) return applyOutputDevice(mediaElement, isRemote);
    if (result.ok && gainOutput && sinkId !== 'default' && typeof gainOutput.setSinkId !== 'function') {
        remoteAudioGain.fallback(mediaElement, gainToken);
        return true;
    }
    if (result.ok && gainOutput &&
        (typeof gainOutput.setSinkId === 'function' || sinkId !== 'default')) {
        result = await voiceDeviceRuntimeApi.switchOutputDevice({
            deviceId: sinkId,
            mediaElement: gainOutput,
            supported: typeof gainOutput.setSinkId === 'function',
        });
        if (revision !== outputSelectionRevision || sinkId !== selectedOutputDeviceId) return result.ok;
        // A volume/mute change can retire this branch while its sink is pending.
        if (gainToken !== remoteAudioGain.getBranchToken(mediaElement)) return applyOutputDevice(mediaElement, isRemote);
        if (!result.ok) {
            remoteAudioGain.fallback(mediaElement, gainToken);
        }
    }
    if (revision !== outputSelectionRevision || sinkId !== selectedOutputDeviceId) {
        return result.ok;
    }
    if (result.ok) {
        remoteAudioGain.activateOutput(mediaElement);
        notifyMediaDock();
        return true;
    }
    voiceMediaDebug.record({
        errorType: result.errorType,
        event: 'device-output-fallback',
    });
    if (result.fallbackApplied) {
        selectedOutputDeviceId = 'default';
        voiceDeviceRuntime?.setSelected('output', 'default');
    }
    const label = voiceStatusViewApi.ERROR_LABELS.output[result.errorType] ||
        voiceStatusViewApi.ERROR_LABELS.output.unknown;
    voiceStatusView.setMediaError('output', result.errorType,
        `${label}，${result.fallbackApplied ? '已回退默认设备' : '默认设备也不可用，请点击恢复声音'}`);
    notifyMediaDock();
    console.warn(
        'Could not switch output device; falling back to default.',
        result.error
    );
    if (!result.fallbackApplied) {
        console.warn('Could not restore the default output device.');
    } else if (sinkId !== 'default') {
        // Move every player to the fallback, including separate game audio.
        void applyOutputSettingsToRemoteMedia();
    }
    return false;
};

const applyOutputSettings = (mediaElement, isRemote) => {
    if (!mediaElement) {
        return;
    }

    if (isRemote && outputMuted) {
        remoteAudioGain.setVolume(mediaElement, { volume: outputVolumeState.getEffectiveOutputVolume(
            0,
            getPeerVolume(mediaElement.closest('.video-tile')?.dataset.peerId)
        ), muted: true });
    } else {
        const peerId = mediaElement.closest('.video-tile')?.dataset.peerId;
        const peerVolume = isRemote ? getPeerVolume(peerId) : 1;
        remoteAudioGain.setVolume(mediaElement, { volume: outputVolumeState.getEffectiveOutputVolume(
            outputVolume,
            peerVolume
        ), muted: !isRemote });
    }

    return applyOutputDevice(mediaElement, isRemote);
};

const applyScreenShareOutputSettings = (
    mediaElement,
    { muted = false, volume = 1 } = {}
) => {
    if (!mediaElement) {
        return;
    }
    remoteAudioGain.setVolume(mediaElement, { volume: outputVolumeState.getEffectiveOutputVolume(
        outputVolume,
        volume
    ), muted: outputMuted || Boolean(muted) });
    return applyOutputDevice(mediaElement, true);
};

const getPrimaryTileMediaElement = (tile) =>
    tile?.querySelector('video') ||
    Array.from(tile?.querySelectorAll('audio') || []).find(
        (element) => !element.classList.contains('screen-share-audio')
    );

const applyOutputSettingsToRemoteMedia = () => {
    void channelSounds.syncOutput();
    const pending = Array.from(document.querySelectorAll('.video-tile')).map(
        (tile) => {
            const mediaElement = getPrimaryTileMediaElement(tile);
            return applyOutputSettings(mediaElement, tile.id !== 'local-video');
        }
    );
    screenShareVolumeController.reapplyAll();
    return Promise.all(pending);
};

const setScreenShareRequestPending = (pending) => {
    screenShareRequestPending = Boolean(pending);
    notifyMediaDock();
};

const voiceDeviceRuntime = voiceDeviceRuntimeApi.createDeviceRuntime({
    enumerateDevices: () => navigator.mediaDevices?.enumerateDevices?.(),
    onDebug: (event) => voiceMediaDebug.record(event),
    onDevices: ({ devices, selected }) => {
        mediaDevicesCache = {
            camera: devices.camera,
            mic: devices.mic,
            output: devices.output,
        };
        selectedInputDeviceId = selected.mic;
        selectedCameraDeviceId = selected.camera;
        if (!hasLiveCameraTrack() && !mediaOperationController.getSnapshot('camera').promise) {
            committedCameraDeviceId = selected.camera;
        }
        selectedOutputDeviceId = selected.output;
        notifyMediaDock();
    },
    onMissing: ({ type }) => handleMissingMediaDevice(type),
});

const refreshMediaDeviceLists = () => voiceDeviceRuntime.refresh();

const selectInputDevice = (deviceId = 'default') => audioSettingsController.select({ deviceId });

const selectCameraDevice = async (deviceId = 'default') => {
    const revision = ++cameraSelectionRevision;
    const previousDeviceId = committedCameraDeviceId;
    selectedCameraDeviceId = deviceId;
    voiceDeviceRuntime.setSelected('camera', deviceId);
    notifyMediaDock();

    if (
        mediaOperationController.getSnapshot().desired.camera &&
        currentPeer &&
        !currentPeer.destroyed
    ) {
        if (mediaOperationController.getSnapshot('camera').promise) {
            mediaOperationController.invalidate('camera', {
                state: 'switching',
            });
        }
        const switched = await startCamera(currentPeer, {
            preserveOldTrack: true,
        });
        if (!switched && revision === cameraSelectionRevision) {
            selectedCameraDeviceId = previousDeviceId;
            voiceDeviceRuntime.setSelected('camera', previousDeviceId);
            notifyMediaDock();
        }
    } else {
        committedCameraDeviceId = deviceId;
    }
};

const selectOutputDevice = async (deviceId = 'default') => {
    callDiagnostics?.record('输出设备切换请求', { 输出设备: deviceId === 'default' ? '默认' : '自选' });
    outputSelectionRevision += 1;
    voiceStatusView.clearMediaError('output');
    selectedOutputDeviceId = deviceId;
    voiceDeviceRuntime.setSelected('output', deviceId);
    notifyMediaDock();
    await applyOutputSettingsToRemoteMedia();
    notifyMediaDock();
};

const resetLocalVoiceState = () => {
    cameraSelectionRevision += 1;
    selectedCameraDeviceId = committedCameraDeviceId;
    voiceDeviceRuntime.setSelected('camera', selectedCameraDeviceId);
    localTrackEndedController.clear();
    destroyProcessedAudioStream();
    stopCurrentScreenStream();
    localMediaTrackStopper.stopStream(cameraStream);
    localMediaTrackStopper.stopStream(myVideoStream);
    myVideoStream = undefined;
    activeStream = undefined;
    cameraStream = undefined;
    activeVideoTrack = undefined;
    currentScreenStream = undefined;
    sharingNow = false;
    setScreenShareRequestPending(false);
    micPermissionDenied = false;
    setCameraButtonState(false);
    setAudioButtonNoMic();
    stopCallTimer();
    updateLocalUserCard();
};

const pageVoiceTeardown = voiceMediaLifecycle.createPageTeardown({
    beforeStopMedia: () => {
        channelSounds.destroy();
        audioRecoveryRuntime.dispose();
        chatPanelRuntime?.destroy();
        sidebarRuntime?.destroy();
        mediaDockRuntime?.destroy();
        mediaDockAdapter?.destroy();
        remoteVolumeUI.destroy();
        screenShareVolumeController.destroy();
        callDiagnostics?.destroy();
        remoteAudioGain.destroy();
        screenSfuRuntime.leave();
        localScreenSharePreviewController.destroy();
        fullscreenControls.destroy();
        navigator.mediaDevices?.removeEventListener?.(
            'devicechange',
            voiceDeviceRuntime.handleDeviceChange
        );
        voiceMediaDebug.record({
            event: 'teardown',
            reason: 'page-teardown',
        });
        voiceSessionRuntime.leave({ dispose: true, reason: 'page-teardown' });
        iceConfigRuntime.stop();
        peerRetryController.reset('page-teardown');
        mediaOperationController.dispose();
        voiceDeviceRuntime?.dispose();
        unbindScreenTrackEnded();
        currentScreenShareSession = undefined;
        sharingNow = false;
    },
    clearLocalState: resetLocalVoiceState,
    disconnectSocket: (activeSocket) => activeSocket?.disconnect?.(),
    getMediaStreams: () => [
        currentScreenStream,
        cameraStream,
        myVideoStream,
        noiseRawStream,
    ],
    getPeer: () => currentPeer,
    getSocket: () => socket,
    notifyLeave: () => {
        socket?.emit('presence:leaveVoice');
        socket?.emit('voicePeerLeft');
    },
    onWarning: (message, error) => console.warn(message, error || ''),
    stopStream: (stream) => localMediaTrackStopper.stopStream(stream),
    teardownRegistry: (reason) => voicePeerRegistry.teardown(reason),
});

const getChannelName = (roomId) =>
    sidebarRuntime?.getRoomName(roomId) || roomId;

const isKnownRoom = (roomId) => sidebarRuntime?.hasRoom(roomId) === true;

const getChannelUrl = (roomId) => `${window.location.origin}/room/${roomId}`;

const getCopyRoomId = () => joinedVoiceRoomId || viewingRoomId;

const syncRoomCompositionState = () => {
    sidebarRuntime?.setViewingRoom(viewingRoomId);
    sidebarRuntime?.setVoiceRoom(joinedVoiceRoomId, {
        targetRoomId: selectedVoiceRoomId,
    });

    const viewingName = getChannelName(viewingRoomId);
    roomUIState.renderRoomHeader({
        refs: { chatTitle },
        channelName: viewingName,
    });
    const viewedChannel = Array.from(sidebarRoot.querySelectorAll('[data-channel-room]'))
        .find((channel) => channel.dataset.channelRoom === viewingRoomId);
    const description = byId('chatDescription');
    if (description) {
        description.textContent = viewedChannel?.dataset.channelDescription || '';
        description.hidden = !description.textContent;
    }

    updateLocalUserCard();
    updateMobileRoomState();
};

const getVoiceCallMetadata = (stream) => {
    return {
        sharing: sharingNow,
        videoSource: activeVideoTrack
            ? sharingNow
                ? 'screen'
                : 'camera'
            : 'none',
        [voiceCallProtocol.MEDIA_TRACK_ROLES_METADATA]:
            screenShareVolumeControllerApi.buildTrackRoles({
                screenStream: currentScreenStream,
                stream,
            }),
    };
};

const publishLocalMediaToPeer = (
    peer,
    peerId,
    stream,
    { generation = localVoiceMediaGeneration, ...options } = {}
) => {
    if (usingPiik) stream = getPeerMediaStream(peerId, stream);
    if (!voiceMediaTargets.has(peerId)) {
        return undefined;
    }
    // Keep negotiated screen sender slots available for fallback even when
    // signaling goes offline. The connected callback parks them with replaceTrack.

    return voicePeerRegistry.callPeer({
        generation,
        options: {
            ...options,
            metadata: {
                ...getVoiceCallMetadata(stream),
                ...options.metadata,
                screenVoiceSessionGeneration: localVoiceSessionGeneration,
            },
        },
        peer,
        peerId,
        stream,
    });
};

const addKnownRemotePeer = (peerId) => {
    if (!peerId || peerId === localPeerId) {
        return;
    }

    if (!remotePeerOrder.includes(peerId)) {
        remotePeerOrder.push(peerId);
    }
};

const reconcileVoiceTargets = (
    peerIds,
    { epoch = voiceSessionRuntime.getSnapshot().epoch } = {}
) => {
    if (
        !voiceSessionRuntime.isCurrent(epoch) ||
        !currentPeer ||
        currentPeer.destroyed
    ) {
        return false;
    }

    const nextTargets = new Set(
        Array.from(new Set(peerIds || [])).filter(
            (peerId) => peerId && peerId !== localPeerId
        )
    );
    Array.from(voiceMediaTargets).forEach((peerId) => {
        if (nextTargets.has(peerId)) {
            return;
        }
        voiceMediaTargets.delete(peerId);
        const index = remotePeerOrder.indexOf(peerId);
        if (index !== -1) {
            remotePeerOrder.splice(index, 1);
        }
        screenSharers.delete(peerId);
        voicePeerRegistry.cleanupPeer(peerId, 'target-reconcile-left');
    });

    nextTargets.forEach((peerId) => {
        voiceMediaTargets.add(peerId);
        addKnownRemotePeer(peerId);
        ensurePresenceTileForPeer(peerId);
        if (localVoiceMediaGeneration === 0) {
            localVoiceMediaGeneration = 1;
        }
        const registryState = voicePeerRegistry.getSnapshot(peerId);
        if (
            !voicePeerRegistry.isSessionDisconnected() &&
            !registryState?.outgoingCall &&
            !registryState?.outgoingPendingCall
        ) {
            publishLocalMediaToPeer(currentPeer, peerId, getActiveStream());
            voiceMediaDebug.record({
                epoch,
                event: 'outgoing-call-rebuild',
            });
        }
    });
    updateScreenP2pBudget();
    screenSfuRuntime.setSession({ roomId: joinedVoiceRoomId, peerId: localPeerId, voiceSessionGeneration: localVoiceSessionGeneration });
    voiceMediaDebug.record({
        epoch,
        event: 'target-reconciliation',
        targetCount: nextTargets.size,
    });
    return true;
};

const handleSocketVoiceCallTargets = ({
    clientSessionEpoch,
    roomId,
    peerIds = [],
    voiceSessionGeneration,
}) => {
    const session = voiceSessionRuntime.getSnapshot();

    if (
        !Array.isArray(peerIds) ||
        roomId !== joinedVoiceRoomId ||
        clientSessionEpoch !== session.epoch ||
        (session.serverGeneration > 0 &&
            voiceSessionGeneration !== session.serverGeneration)
    ) {
        voiceMediaDebug.record({
            epoch: session.epoch,
            event: 'target-snapshot-stale',
        });
        return;
    }

    adoptVoiceSessionGeneration(voiceSessionGeneration, {
        epoch: clientSessionEpoch,
    });
    reconcileVoiceTargets(peerIds, { epoch: clientSessionEpoch });
};

const handleSocketVoicePeerJoined = ({ roomId } = {}) => {
    if (roomId !== joinedVoiceRoomId || !currentPeer || currentPeer.destroyed) {
        return;
    }

    void requestVoiceSnapshot('peer-joined');
};

const handleSocketRemoveUserVideo = ({ roomId }) => {
    if (roomId !== joinedVoiceRoomId) {
        return;
    }

    void requestVoiceSnapshot('peer-left');
};

function emitScreenShareState(
    sharing,
    voiceSessionGeneration = localVoiceSessionGeneration
) {
    if (
        typeof sharing !== 'boolean' ||
        !joinedVoiceRoomId ||
        !Number.isInteger(voiceSessionGeneration) ||
        voiceSessionGeneration <= 0 ||
        voiceSessionGeneration !== localVoiceSessionGeneration
    ) {
        return false;
    }

    ensureSocket().emit('screen:share', {
        sharing,
        voiceSessionGeneration,
    });
    return true;
}

function adoptVoiceSessionGeneration(
    value,
    { epoch = voiceSessionRuntime.getSnapshot().epoch } = {}
) {
    const generation = Number(value);
    if (
        !voiceSessionRuntime.isCurrent(epoch) ||
        !Number.isInteger(generation) ||
        generation <= 0
    ) {
        return false;
    }

    localVoiceSessionGeneration = generation;
    if (sharingNow && currentScreenShareSession) {
        currentScreenShareSession.voiceSessionGeneration = generation;
        emitScreenShareState(true, generation);
    }
    return true;
}

const bindVoiceSocketHandlers = (activeSocket) => {
    callDiagnostics?.attachSocket(activeSocket);
    activeSocket.off('voice:call-targets', handleSocketVoiceCallTargets);
    activeSocket.off('voice:peer-joined', handleSocketVoicePeerJoined);
    activeSocket.off('removeUserVideo', handleSocketRemoveUserVideo);
    activeSocket.on('voice:call-targets', handleSocketVoiceCallTargets);
    activeSocket.on('voice:peer-joined', handleSocketVoicePeerJoined);
    activeSocket.on('removeUserVideo', handleSocketRemoveUserVideo);
};

const getChatName = () =>
    chatPanelRuntime?.getDisplayName() || chatNameState.getStoredChatName();

const getMemberTileToggle = (member) => member.peerId ? {
    icon: 'fas fa-volume-up',
    label: member.peerId === localPeerId ? '查看我的成员卡片' : '成员音量',
    onClick: (event) => {
        const tile = document.getElementById(member.peerId === localPeerId ? 'local-video' : member.peerId);
        if (tile && member.peerId !== localPeerId) showPeerVolumePopover(event, tile);
        else tile?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    },
} : undefined;

const reconcilePresenceState = ({
    channels = [],
    clientSessionEpoch,
    voiceSessionGeneration,
} = {}) => {
    const session = voiceSessionRuntime.getSnapshot();
    const currentVoiceSnapshot =
        (clientSessionEpoch === undefined &&
            voiceSessionGeneration === undefined) ||
        session.desiredVoiceState !== 'joined' ||
        (clientSessionEpoch === session.epoch &&
            voiceSessionGeneration === session.serverGeneration);
    const previousMembers = new Map(presenceMembersByPeerId);

    if (currentVoiceSnapshot) {
        presenceMembersByPeerId.clear();
        screenSharers.clear();
    }

    channels.forEach((channel) => {
        (channel.members || []).forEach((member) => {
            if (currentVoiceSnapshot && member.peerId) {
                presenceMembersByPeerId.set(member.peerId, member);
                if (
                    channel.slug === joinedVoiceRoomId &&
                    member.peerId !== localPeerId &&
                    member.screenSharing === true
                ) {
                    screenSharers.add(member.peerId);
                }
            }
        });
    });

    if (currentVoiceSnapshot) {
        syncPresenceTilesForJoinedRoom(channels);
        // A late join learns sharing state from presence, not screen:share.
        voicePeerRegistry.getPeerIds().forEach((peerId) => {
            const before = previousMembers.get(peerId);
            const after = presenceMembersByPeerId.get(peerId);
            const source = voicePeerRegistry.getQualitySource(peerId);
            if (after && (source?.stream || remoteScreenSfuSources.has(peerId)) &&
                (before?.cameraOn !== after.cameraOn || before?.screenSharing !== after.screenSharing)) {
                renderRemoteMedia(peerId, source?.stream);
            }
            voiceMediaQualityRuntime?.syncPeer(peerId);
        });
        voiceMediaDebug.record({
            epoch: session.epoch,
            event: 'presence-reconciled',
        });
    } else {
        voiceMediaDebug.record({
            epoch: session.epoch,
            event: 'presence-snapshot-stale',
        });
    }
    updateAllVideoTileStatus();
};

const emitWithAck = (
    activeSocket,
    event,
    args = [],
    { timeoutMs = 5000 } = {}
) =>
    new Promise((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`${event} acknowledgement timed out`));
            }
        }, timeoutMs);
        const acknowledge = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            resolve(result);
        };
        activeSocket.emit(event, ...args, acknowledge);
    });

let activeVoiceRestore;
let iceConnectionPending = false;
const iceConfigRuntime = window.VoiceIceConfig.createRuntime({
    // eslint-disable-next-line no-undef
    enabled: roomBootstrap.turnEnabled === true,
    // eslint-disable-next-line no-undef
    baseServers: iceServers,
    request: () => emitWithAck(ensureSocket(), 'rtc:ice'),
    onUpdate: config => {
        // PeerJS reads this configuration for each new RTCPeerConnection.
        // Existing media connections keep their live TURN allocation/session.
        if (currentPeer && !currentPeer.destroyed) {
            currentPeer.options.config = config;
            if (iceConnectionPending) {
                iceConnectionPending = false;
                voiceStatusView.clearMediaError('network-connection');
                refreshVoiceCallsForLocalMedia(currentPeer);
                notifyMediaDock();
            }
        }
    },
});
const preparePeerConnection = peer => {
    const session = voiceSessionRuntime.getSnapshot();
    const current = () => peer === currentPeer && !peer?.destroyed &&
        voiceSessionRuntime.isCurrent(session.epoch) && voiceSessionRuntime.getSnapshot().desiredVoiceState === 'joined';
    if (!current()) return false;
    const apply = config => {
        if (!current()) return false;
        peer.options.config = config;
        voiceStatusView.clearMediaError('network-connection');
        return true;
    };
    const cached = iceConfigRuntime.getConfiguration();
    if (cached) return apply(cached);
    return iceConfigRuntime.prepare().then(apply).catch(() => {
        if (current()) {
            iceConnectionPending = true;
            voiceStatusView.setMediaError('network-connection', 'unknown', '新连接暂未准备好，正在重试');
            notifyMediaDock();
        }
        return false;
    });
};

async function requestVoiceSnapshot(reason = 'reconcile') {
    const session = voiceSessionRuntime.getSnapshot();
    if (
        session.desiredVoiceState !== 'joined' ||
        !socket?.connected ||
        !voiceSessionRuntime.isCurrent(session.epoch)
    ) {
        return false;
    }
    try {
        const result = await emitWithAck(socket, 'voice:snapshot');
        if (
            !result?.ok ||
            !voiceSessionRuntime.isCurrent(session.epoch) ||
            result.clientSessionEpoch !== session.epoch ||
            result.voiceSessionGeneration !==
                voiceSessionRuntime.getSnapshot().serverGeneration
        ) {
            return false;
        }
        reconcileVoiceTargets(result.peerIds, { epoch: session.epoch });
        voiceMediaDebug.record({
            epoch: session.epoch,
            event: 'voice-snapshot-applied',
            reason,
        });
        return true;
    } catch (error) {
        voiceMediaDebug.record({
            epoch: session.epoch,
            errorType: error?.name || 'Error',
            event: 'voice-snapshot-failed',
            reason,
        });
        return false;
    }
}

const restoreServerVoiceOwner = (reason = 'restore') => {
    const session = voiceSessionRuntime.getSnapshot();
    const peer = currentPeer;
    if (
        session.desiredVoiceState !== 'joined' ||
        !session.roomId ||
        !peer ||
        peer.destroyed ||
        !localPeerId ||
        !socket?.connected
    ) {
        return Promise.resolve(false);
    }
    if (activeVoiceRestore?.epoch === session.epoch) {
        return activeVoiceRestore.promise;
    }

    peerRetryController.cancel('voice-restore-started');
    voiceSessionRuntime.markRestoring(reason);
    const epoch = session.epoch;
    const roomId = session.roomId;
    const restorePromise = emitWithAck(socket, 'voice:join', [
        {
            clientSessionEpoch: epoch,
            peerId: localPeerId,
            roomId,
        },
    ])
        .then(async (result) => {
            if (
                !result?.ok ||
                !voiceSessionRuntime.isCurrent(epoch) ||
                peer !== currentPeer ||
                peer.destroyed
            ) {
                if (
                    !result?.ok &&
                    voiceSessionRuntime.isCurrent(epoch) &&
                    peer === currentPeer &&
                    !peer.destroyed
                ) {
                    voiceSessionRuntime.fail(
                        result?.reason || 'voice-join-rejected'
                    );
                }
                return false;
            }

            await iceConfigRuntime.prepare();
            if (!voiceSessionRuntime.isCurrent(epoch) || peer !== currentPeer || peer.destroyed) return false;
            joinedVoiceRoomId = roomId;
            selectedVoiceRoomId = roomId;
            adoptVoiceSessionGeneration(result.voiceSessionGeneration, {
                epoch,
            });
            if (
                !voiceSessionRuntime.markJoined({
                    epoch,
                    peerId: localPeerId,
                    serverGeneration: result.voiceSessionGeneration,
                })
            ) {
                return false;
            }
            voicePeerRegistry.setSessionDisconnected(false);
            channelSounds.enter(roomId, sidebarRuntime?.getPresenceSnapshot());
            peerRetryController.reset('voice-restored');
            reconcileVoiceTargets(result.peerIds, { epoch });
            socket.emit('presence:joinVoice', {
                senderName: getChatName(),
                ...getLocalPresencePayload(),
            });
            if (sharingNow) {
                emitScreenShareState(true, result.voiceSessionGeneration);
            }
            syncRoomCompositionState();
            updateLocalUserCard();
            voiceMediaDebug.record({
                epoch,
                event: 'voice-join-restored',
                generation: result.voiceSessionGeneration,
                reason,
            });
            await requestVoiceSnapshot(reason);
            return true;
        })
        .catch((error) => {
            if (voiceSessionRuntime.isCurrent(epoch) && socket?.connected) {
                voiceSessionRuntime.fail('voice-join-failed');
            }
            voiceMediaDebug.record({
                epoch,
                errorType: error?.name || 'Error',
                event: 'voice-join-failed',
                reason,
            });
            return false;
        })
        .finally(() => {
            if (activeVoiceRestore?.promise === restorePromise) {
                activeVoiceRestore = undefined;
            }
        });
    activeVoiceRestore = { epoch, promise: restorePromise };
    return restorePromise;
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
        randomizationFactor: 0.2,
        reconnectionAttempts: 5,
        reconnectionDelay: 500,
        reconnectionDelayMax: 8000,
    });
    screenSfuRuntime.attachSocket(socket);
    socket.on('screen:codec-feedback', (payload) => {
        if (payload?.voiceSessionGeneration === localVoiceSessionGeneration && voiceMediaTargets.has(payload.peerId))
            voicePeerRegistry.handleCodecFeedback(payload);
    });
    socket.on('screen:route-pressure', (payload) => screenSfuRuntime.receivePressure(payload));

    socket.on('cursor:move', renderRemoteCursor);
    socket.on('cursor:leave', markRemoteCursorIdle);
    socket.on('cursor:remove', removeRemoteCursor);
    socket.on(
        'screen:share',
        ({ peerId, roomId, sharing, voiceSessionGeneration } = {}) => {
            const session = voiceSessionRuntime.getSnapshot();
            if (
                roomId !== joinedVoiceRoomId ||
                !peerId ||
                peerId === localPeerId ||
                !voiceMediaTargets.has(peerId) ||
                typeof sharing !== 'boolean' ||
                voiceSessionGeneration !== session.serverGeneration
            ) {
                return;
            }

            const member = presenceMembersByPeerId.get(peerId);
            if (member) member.screenSharing = sharing;
            if (sharing) {
                screenSharers.add(peerId);
            } else {
                screenSharers.delete(peerId);
                if (member?.cameraOn === false) {
                    renderRemoteMedia(peerId, voicePeerRegistry.getQualitySource(peerId)?.stream);
                }
            }
            updateAllVideoTileStatus();
            voiceMediaQualityRuntime?.syncPeer(peerId);
            updateMobileTileView();
        }
    );
    socket.on('connect', () => {
        void iceConfigRuntime.reconnect().catch(() => {});
        const transport = socket.io?.engine?.transport?.name || 'unknown';
        voiceMediaDebug.record({ event: 'socket-connect', transport });
        chatPanelRuntime?.setConnectionState('connected');
        chatPanelRuntime?.rejoinCurrentRoom();
        if (voiceSessionRuntime.socketConnected('socket-connect')) {
            if (currentPeer && !currentPeer.destroyed) void restoreServerVoiceOwner('socket-connect');
            else if (pendingPeerCreation?.epoch !== voiceSessionRuntime.getSnapshot().epoch)
                void schedulePeerRecovery('recreate', 'socket-connect-before-peer');
        }
        socket.io?.engine?.once?.('upgrade', (nextTransport) => {
            voiceMediaDebug.record({
                event: 'socket-transport-upgrade',
                transport: nextTransport?.name || 'unknown',
            });
        });
    });
    socket.on('disconnect', (reason) => {
        channelSounds.rebase();
        if (voiceSessionRuntime.socketDisconnected(reason)) {
            rebindLiveLocalTrackEndedHandlers();
        }
        voiceMediaDebug.record({ event: 'socket-disconnect', reason });
        updateLocalUserCard();
    });
    socket.on('connect_error', (error) => {
        voiceSessionRuntime.socketDisconnected('connect-error');
        voiceMediaDebug.record({
            errorType: error?.name || 'Error',
            event: 'socket-connect-error',
        });
    });

    const manager = socket.io;
    manager?.on?.('reconnect_attempt', (attempt) =>
        voiceMediaDebug.record({ attempt, event: 'socket-reconnect-attempt' })
    );
    manager?.on?.('reconnect', (attempt) =>
        voiceMediaDebug.record({ attempt, event: 'socket-reconnect' })
    );
    manager?.on?.('reconnect_error', (error) =>
        voiceMediaDebug.record({
            errorType: error?.name || 'Error',
            event: 'socket-reconnect-error',
        })
    );
    manager?.on?.('reconnect_failed', () => {
        voiceMediaDebug.record({ event: 'socket-reconnect-failed' });
        voiceSessionRuntime.markDegraded('socket-reconnect-failed');
        updateLocalUserCard();
    });

    return socket;
};

const updatePresenceName = () => {
    emitLocalPresenceUpdate();
    updateLocalUserCard();
};

const setViewingRoom = (roomId, { updateHistory = true } = {}) => {
    if (!isKnownRoom(roomId)) {
        return false;
    }
    if (viewingRoomId === roomId) {
        sidebarRuntime?.setViewingRoom(roomId);
        return false;
    }

    viewingRoomId = roomId;
    syncRoomCompositionState();
    clearRemoteCursors();
    chatPanelRuntime?.setRoom(viewingRoomId);

    if (updateHistory) {
        window.history.pushState({ roomId }, '', `/room/${roomId}`);
    }
    return true;
};

const setVoiceTargetRoom = (roomId) => {
    if (!isKnownRoom(roomId)) {
        return false;
    }

    if (joinedVoiceRoomId === roomId) {
        if (voiceSessionRuntime.getSnapshot().state === 'failed') {
            if (voiceSessionRuntime.retry()) {
                rebindLiveLocalTrackEndedHandlers();
                if (!socket?.connected) {
                    socket?.connect?.();
                }
                if (!currentPeer || currentPeer.destroyed) {
                    void schedulePeerRecovery('recreate', 'manual-retry');
                } else if (socket?.connected) {
                    void restoreServerVoiceOwner('manual-retry');
                }
            }
            return true;
        }
        console.info(`Already in voice channel ${getChannelName(roomId)}.`);
        return false;
    }

    if (joinedVoiceRoomId && joinedVoiceRoomId !== roomId) {
        selectedVoiceRoomId = roomId;
        pendingVoiceRoomId = roomId;
        mediaDockAdapter?.hangUp();
        syncRoomCompositionState();
        return true;
    }

    selectedVoiceRoomId = roomId;
    syncRoomCompositionState();
    return joinVoiceChannel(roomId);
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

const requestRawAudioStream = (request = audioSettingsController.snapshot().requested) =>
    audioProcessingRuntime.capture(request);

const createAudioPipeline = async (rawStream, request = audioSettingsController.snapshot().requested) =>
    rawStream ? audioProcessingRuntime.prepare(rawStream, request) : audioProcessingRuntime.stage(request);

const disposeAudioPipeline = (stream, options) => audioProcessingRuntime.dispose(stream, options);

const destroyProcessedAudioStream = () => {
    audioSettingsController.cancel();
    audioProcessingRuntime.cancelPending();
    disposeAudioPipeline(activeAudioPipelineStream);
    activeAudioPipelineStream = null;
    noiseRawStream = null;
    noiseProcessorActive = false;
    noiseMode = 'raw';
};

const adoptAudioPipeline = (stream) => {
    stream = audioProcessingRuntime.adopt(stream);
    const pipeline = audioPipelines.get(stream);
    activeAudioPipelineStream = pipeline ? stream : null;
    noiseRawStream = pipeline?.rawStream || null;
    noiseProcessorActive = Boolean(pipeline);
    noiseMode = pipeline?.mode || 'raw';
    return stream;
};

const updateFullscreenButtonStates = () => {
    fullscreenControls.updateButtonStates();
};

const addFullscreenControls = (tile) => {
    if (!tile.id) {
        return;
    }

    const actions = tile.querySelector('.tile-header-actions') || tile;

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
        return member.screenSharing && hasVideo ? 'screen-share' : 'local';
    }

    if (member.screenSharing && hasVideo) {
        return 'screen-share';
    }

    return hasVideo ? 'remote-video' : 'remote-audio';
};

const createTileAvatarText = (displayName) => videoTileStructureUI.createTileAvatarText(displayName);
const ensureTileStructure = (tile) => {
    const structure = videoTileStructureUI.ensureTileStructure(tile);
    if (!tile.dataset.memberControlsBound) {
        const volume = document.createElement('button');
        volume.type = 'button';
        volume.className = 'member-volume-button';
        volume.textContent = '音量';
        volume.setAttribute('aria-label', '调整此成员的独立音量');
        volume.addEventListener('click', (event) => showPeerVolumePopover(event, tile));
        structure.headerActions.append(volume);
        tile.dataset.memberControlsBound = 'true';
    }
    const volume = tile.querySelector('.member-volume-button');
    if (volume) volume.hidden = tile.id === 'local-video';
    return structure;
};

const showPeerVolumePopover = (event, tile) => {
    const peerId = tile.dataset.peerId;

    if (tile.id === 'local-video' || !peerId) {
        return;
    }

    event.preventDefault();
    event.stopPropagation?.();
    const isScreenShare =
        tile.dataset.tileType === 'screen-share' || screenSharers.has(peerId);

    const snapshot = screenShareVolumeController.getSnapshot(peerId);
    const controls = [{
        currentVolume: Math.round(getPeerVolume(peerId) * 100),
        titleText: '语音音量',
        onVolumeInput: (nextVolume) => {
            setPeerVolume(peerId, nextVolume / 100);
            void applyOutputSettingsToRemoteMedia();
        },
    }];
    if (isScreenShare || snapshot.hasAudio) {
        controls.push({
            currentVolume: Math.round(snapshot.volume * 100),
            disabled: !snapshot.hasAudio,
            emptyText: '无共享音频',
            iconClass: 'fas fa-desktop',
            muted: snapshot.muted,
            muteLabel: '共享静音',
            onMutedChange: (muted) =>
                screenShareVolumeController.setMuted(peerId, muted, {
                    generation: snapshot.generation,
                }),
            onVolumeInput: (nextVolume) =>
                screenShareVolumeController.setVolume(
                    peerId,
                    nextVolume / 100,
                    { generation: snapshot.generation }
                ),
            titleText: '屏幕共享音量',
        });
    }
    return remoteVolumeUI.openPopover({ event, controls });
};

const updateVideoTileStatus = (tile) => {
    if (!tile) {
        return;
    }

    const member = getTileMember(tile);
    const isLocal = tile.id === 'local-video';
    const mediaElement = tile.querySelector('video, audio');
    const localPreview = localScreenSharePreviewController.getSnapshot();
    const statusStream =
        isLocal && localPreview.active
            ? localPreview.stream
            : mediaElement?.srcObject;
    const hasVideo =
        voiceMediaLifecycle.getLiveTracks(statusStream, 'video').length > 0;
    const displayName = member.senderName || (isLocal ? getChatName() : 'Peer');
    ensureTileStructure(tile);
    const tileType = getTileType(tile, hasVideo, member);
    tile.dataset.peerLabel = isLocal ? `${displayName}（我）` : displayName;
    tile.dataset.tileType = tileType;
    if (member.socketId) {
        tile.dataset.socketId = member.socketId;
    } else {
        delete tile.dataset.socketId;
    }

    const isScreenShare = member.screenSharing === true;
    const titleText = isScreenShare
        ? isLocal
            ? '我的屏幕'
            : displayName
        : isLocal
          ? `${displayName}（我）`
          : displayName;
    const statusText = getMemberTileText(member);

    tileStatusUI.renderTileStatus(tile, {
        avatarText: createTileAvatarText(displayName),
        hasVideo,
        isScreenShare,
        showNameLabel: true,
        statuses: getMemberStatusIcons(member),
        statusText,
        titleText,
    });
};

const updateAllVideoTileStatus = () => {
    getVideoTiles().forEach(updateVideoTileStatus);
    stageLayout?.sync();
};

const ensurePresenceTileForPeer = (peerId) => {
    if (!peerId || peerId === localPeerId) return;
    const tile = voicePeerRegistry.ensurePeerTile(peerId);
    if (tile) updateVideoTileStatus(tile);
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
            voicePeerRegistry.cleanupPeer(peerId, 'presence-member-removed');
        }
    });
};

const addVideoStream = (
    video,
    stream,
    videoId,
    {
        generation = 0,
        localPreviewGeneration = 0,
        localPreviewSession,
        trackRoles = [],
    } = {}
) => {
    const tileId = videoId || 'local-video';
    let tile = document.getElementById(tileId);
    const [liveVideoTrack] = voiceMediaLifecycle.getLiveTracks(stream, 'video');
    const hasVideo = Boolean(liveVideoTrack);
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

    const { body } = ensureTileStructure(tile);

    let mediaElement = getPrimaryTileMediaElement(tile);
    if (!mediaElement || mediaElement.tagName !== mediaTag) {
        if (mediaElement) {
            voiceMediaLifecycle.clearMediaElement({
                mediaElement,
                onWarning: (message, error) =>
                    console.warn(message, error || ''),
            });
            mediaElementVideoTracks.delete(mediaElement);
            mediaElementAudioTracks.delete(mediaElement);
        }
        if (videoId) {
            screenShareVolumeController.unbind(videoId);
        }
        body.replaceChildren();
        fullscreenControls.detachTile(tile);
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

    let playbackStream = stream;
    if (videoId && stream) {
        const screenBinding = screenShareVolumeController.bindSource({
            generation,
            ownerKey: videoId,
            sourceStream: stream,
            target: body,
            trackRoles,
        });
        playbackStream = screenBinding.primaryStream;
    } else if (videoId) {
        screenShareVolumeController.unbind(videoId);
    }

    const audioSignature = voiceMediaLifecycle.getLiveTracks(playbackStream, 'audio')
        .map((track) => track.id).join('|');
    const audioChanged = mediaElement.srcObject === playbackStream &&
        mediaElementAudioTracks.has(mediaElement) &&
        mediaElementAudioTracks.get(mediaElement) !== audioSignature;
    const forceRebind = Boolean(
        (hasVideo &&
            mediaElement.srcObject === playbackStream &&
            mediaElementVideoTracks.get(mediaElement) !== liveVideoTrack) ||
        audioChanged
    );
    if (!videoId && localPreviewSession) {
        localScreenSharePreviewController.bindSource({
            generation: localPreviewGeneration,
            mediaElement,
            session: localPreviewSession,
            stream: playbackStream,
            target: body,
            tile,
        });
    } else {
        if (!videoId) {
            localScreenSharePreviewController.stopSession();
        }
        voiceMediaLifecycle.attachAndPlayMedia({
            forceRebind,
            mediaElement,
            onWarning: (message, error) => console.warn(message, error || ''),
            stream: playbackStream,
        });
    }
    mediaElementAudioTracks.set(mediaElement, audioSignature);
    if (hasVideo) {
        mediaElementVideoTracks.set(mediaElement, liveVideoTrack);
    } else {
        mediaElementVideoTracks.delete(mediaElement);
    }
    applyOutputSettings(mediaElement, Boolean(videoId));
    updateVideoTileStatus(tile);
    voiceMediaQualityRuntime?.syncPeer(videoId || 'local-video');
    updateFullscreenButtonStates();
    console.info('[tile] add/update', {
        peerId: tile.dataset.peerId,
        hasVideo,
    });
    updateMobileTileView();
    return tile;
};


const mergeRemoteStream = (
    peerId,
    incomingStream,
    { currentStream, replaceAll = false } = {}
) => {
    const remoteStream = currentStream || new MediaStream();
    const incomingAudioTracks = incomingStream?.getAudioTracks?.() || [];
    const incomingVideoTracks = incomingStream?.getVideoTracks?.() || [];

    if (replaceAll || incomingAudioTracks.length > 0) {
        remoteStream.getAudioTracks().forEach((track) => {
            remoteStream.removeTrack(track);
        });
        incomingAudioTracks.forEach((track) => remoteStream.addTrack(track));
    }

    if (replaceAll || incomingVideoTracks.length > 0) {
        remoteStream.getVideoTracks().forEach((track) => {
            remoteStream.removeTrack(track);
        });
        incomingVideoTracks.forEach((track) => remoteStream.addTrack(track));
    }

    return remoteStream;
};

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

        voicePeerRegistry.answerCall({ call, peer });
    });
};
// ----------------------------------------------------------------------------------

// switching between sharing screen and not sharing
var sharingNow = false;
let currentScreenStream;
let currentScreenShareSession;
let screenCodecAbort;

const getActiveStream = () => {
    activeStream = voiceMediaLifecycle.createMediaSnapshot({
        MediaStreamCtor: MediaStream,
        microphoneStream: myVideoStream,
        screenStream:
            sharingNow && currentScreenStream ? currentScreenStream : undefined,
        videoTrack: activeVideoTrack,
    });
    return activeStream;
};
const getPeerMediaStream = (peerId, stream) => {
    if (!sharingNow || (!usingPiik && !screenSfuRuntime.usesServer(peerId))) return stream;
    const screenTracks = new Set(currentScreenStream?.getTracks() || []);
    return new MediaStream((stream?.getTracks() || []).filter((track) => !screenTracks.has(track)));
};
const updateScreenP2pBudget = () => {
    if (usingPiik) return;
    const track = currentScreenStream?.getVideoTracks?.()[0];
    if (!track) return;
    const directViewers = [...voiceMediaTargets].filter((id) => !screenSfuRuntime?.usesServer(id)).length;
    const total = window.voiceScreenSfuConfig?.p2pBudget || 24000000;
    const serverUplink = screenSfuRuntime?.getUplinkBitrate() || 0;
    const maxBitrate = directViewers <= 2 && !serverUplink ? 27000000 : Math.max(1000000, Math.floor((total - serverUplink) / Math.max(1, directViewers)));
    window.VoiceScreenSendPolicy.register(track, { ...currentScreenShareSession?.shareOptions, maxBitrate });
};

const setLocalVideoStream = (stream) => {
    if (!stream) {
        console.warn('Local stream is not available; skipping preview update.');
        return;
    }

    const previewSession = sharingNow ? currentScreenShareSession : undefined;
    const previewGeneration = previewSession
        ? (previewSession.previewGeneration += 1)
        : 0;
    addVideoStream(myVideo, stream, undefined, {
        localPreviewGeneration: previewGeneration,
        localPreviewSession: previewSession,
    });
};

const refreshVoiceCallsForLocalMedia = (peer) => {
    if (
        !peer ||
        peer !== currentPeer ||
        peer.destroyed ||
        !joinedVoiceRoomId ||
        !localPeerId
    ) {
        return;
    }

    scheduleLocalMediaUpdate(peer);
};

let localMediaUpdateTimer;
let localMediaUpdateSequence = 0;
let localMediaUpdateQueuedAt = 0;

const scheduleLocalMediaUpdate = (peer) => {
    const sequence = (localMediaUpdateSequence += 1);
    localMediaUpdateQueuedAt ||= Date.now();
    window.clearTimeout(localMediaUpdateTimer);
    localMediaUpdateTimer = window.setTimeout(async () => {
        localMediaUpdateTimer = undefined;
        if (
            sequence !== localMediaUpdateSequence ||
            peer !== currentPeer ||
            peer?.destroyed
        ) {
            return;
        }
        const hasPendingCapture = ['microphone', 'camera', 'screen'].some(
            (type) => mediaOperationController.getSnapshot(type).promise
        );
        if (hasPendingCapture && Date.now() - localMediaUpdateQueuedAt < 250) {
            localMediaUpdateTimer = window.setTimeout(
                () => scheduleLocalMediaUpdate(peer),
                40
            );
            return;
        }
        localMediaUpdateQueuedAt = 0;
        localVoiceMediaGeneration += 1;
        const generation = localVoiceMediaGeneration;
        const stream = getActiveStream();
        voiceMediaDebug.record({
            event: 'local-media-snapshot',
            generation,
            sharing: sharingNow,
            tracks: voiceCallProtocol.describeTracks(stream),
        });
        await Promise.all(
            Array.from(voiceMediaTargets, async (peerId) => {
                const replaced = await voicePeerRegistry.replaceOutgoingTracks({
                    generation,
                    peerId,
                    stream: getPeerMediaStream(peerId, stream),
                });
                if (!replaced.ok) {
                    publishLocalMediaToPeer(peer, peerId, stream, {
                        generation,
                    });
                    voiceMediaDebug.record({
                        event: 'local-media-renegotiated',
                        generation,
                        peerId,
                        reason: replaced.reason,
                    });
                }
            })
        );
    }, 40);
};

const sendVideoTrackToPeers = (peer) => refreshVoiceCallsForLocalMedia(peer);

const sendAudioTrackToPeers = (peer) => refreshVoiceCallsForLocalMedia(peer);

const setActiveVideoTrack = (peer, track) => {
    activeVideoTrack = track;
    const stream = getActiveStream();
    setLocalVideoStream(stream);
    sendVideoTrackToPeers(peer);
};

const setCameraButtonState = () => notifyMediaDock();

const unbindLocalTrackEnded = (type, track) => {
    return localTrackEndedController.unbind(type, track);
};

const stopLocalTrack = (type, track) => {
    return localTrackEndedController.stop(type, track);
};

const bindLocalTrackEnded = (type, track) => {
    localTrackEndedController.bind(type, track);
};

const rebindLiveLocalTrackEndedHandlers = () => {
    const micTrack = myVideoStream?.getAudioTracks?.()[0];
    const cameraTrack = cameraStream?.getVideoTracks?.()[0];
    if (micTrack?.readyState === 'live') {
        bindLocalTrackEnded('microphone', micTrack);
    }
    if (cameraTrack?.readyState === 'live') {
        bindLocalTrackEnded('camera', cameraTrack);
    }
};

const setMediaOperationError = (type, result) => {
    if (result?.ok) {
        voiceStatusView.clearMediaError(type);
        notifyMediaDock();
        voiceMediaDebug.record({
            event: 'ui-error-state',
            mediaType: type,
            state: 'cleared',
        });
        return;
    }
    if (result?.errorType === 'user-cancelled') {
        voiceStatusView.clearMediaError(type);
        notifyMediaDock();
        return;
    }
    if (result?.errorType) {
        voiceStatusView.setMediaError(type, result.errorType,
            type === 'screen' && result.error?.name === 'NativeShareConfigurationError'
                ? result.error.message : undefined);
        notifyMediaDock();
        voiceMediaDebug.record({
            errorType: result.errorType,
            event: 'ui-error-state',
            mediaType: type,
            state: 'visible',
        });
    }
};

const startCamera = async (
    peer,
    { preserveOldTrack = false, recovery = false } = {}
) => {
    const previousStream = cameraStream;
    const previousTrack = previousStream?.getVideoTracks?.()[0];
    const cameraDeviceId = selectedCameraDeviceId;
    const cameraConstraints = getCameraConstraints();
    const epoch = voiceSessionRuntime.getSnapshot().epoch;
    const pendingCamera = mediaOperationController.run(
        'camera',
        () =>
            navigator.mediaDevices.getUserMedia({
                video: cameraConstraints,
                audio: false,
            }),
        {
            epoch,
            state: preserveOldTrack ? 'switching' : 'requesting',
            surviveEpochChange: true,
        }
    );
    notifyMediaDock();
    const result = await pendingCamera;
    if (result.cancelled || mediaOperationController.getSnapshot('camera').token !== result.token) {
        return false;
    }
    setMediaOperationError('camera', result);
    if (!result.ok) {
        if (preserveOldTrack && previousTrack?.readyState === 'live') {
            cameraStream = previousStream;
            mediaOperationController.setActive('camera', previousStream);
            setCameraButtonState(true);
        } else {
            setCameraButtonState(false);
        }
        return false;
    }

    const nextStream = result.value;
    const nextTrack = nextStream?.getVideoTracks?.()[0];
    if (!nextTrack) {
        localMediaTrackStopper.stopStream(nextStream);
        voiceStatusView.setMediaError('camera', 'device-not-found');
        notifyMediaDock();
        return false;
    }
    if (previousTrack && previousTrack !== nextTrack) {
        stopLocalTrack('camera', previousTrack);
        localMediaTrackStopper.stopStream(previousStream);
    }
    cameraStream = nextStream;
    selectedCameraDeviceId = cameraDeviceId;
    committedCameraDeviceId = cameraDeviceId;
    mediaOperationController.setActive('camera', nextStream);
    bindLocalTrackEnded('camera', nextTrack);
    voiceDeviceRuntime.setSelected(
        'camera',
        selectedCameraDeviceId
    );
    localTrackEndedController.releaseRecovery('camera', epoch);
    setCameraButtonState(true);
    emitLocalPresenceUpdate();
    updateLocalUserCard();

    if (!sharingNow) {
        setActiveVideoTrack(peer, nextTrack);
    }
    voiceMediaDebug.record({
        epoch,
        event: recovery ? 'camera-recovered' : 'camera-started',
    });
    return true;
};

const toggleCamera = async (peer) => {
    const currentCameraTrack = cameraStream?.getVideoTracks()[0];
    const cameraOperation = mediaOperationController.getSnapshot('camera');

    if ((cameraOperation.promise && cameraOperation.desired) ||
        currentCameraTrack?.readyState === 'live') {
        cameraSelectionRevision += 1;
        mediaOperationController.setDesired('camera', false);
        mediaOperationController.invalidate('camera');
        if (currentCameraTrack) stopLocalTrack('camera', currentCameraTrack);
        cameraStream = undefined;
        selectedCameraDeviceId = committedCameraDeviceId;
        voiceDeviceRuntime.setSelected('camera', selectedCameraDeviceId);
        setCameraButtonState(false);
        emitLocalPresenceUpdate();
        updateLocalUserCard();

        if (!sharingNow) {
            setActiveVideoTrack(peer);
        }
        return;
    }

    mediaOperationController.setDesired('camera', true);
    await startCamera(peer);
};

const unbindScreenTrackEnded = (session = currentScreenShareSession) => {
    session?.track?.removeEventListener?.('ended', session.endedListener);
};

const stopCurrentScreenStream = () => {
    screenCodecAbort?.abort();
    screenCodecAbort = undefined;
    setScreenShareRequestPending(false);
    screenSfuRuntime?.stopPublishing();
    voiceMediaQualityRuntime?.stop('local-video', 'screen-stopped');
    const screenStream = currentScreenStream;
    const screenShareSession = currentScreenShareSession;
    if (screenStream) {
        voiceMediaDebug.record({
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            event: 'track-ended',
            mediaType: 'screen',
            reason: 'intentional-stop',
        });
    }
    unbindScreenTrackEnded();
    localScreenSharePreviewController.stopSession(screenShareSession);
    currentScreenStream = undefined;
    currentScreenShareSession = undefined;

    localMediaTrackStopper.stopStream(screenStream);
};

const restoreCameraAfterScreenShare = (peer) => {
    screenSfuRuntime.stopPublishing();
    const cameraTrack = cameraStream?.getVideoTracks()[0];
    const nextVideoTrack =
        cameraTrack?.readyState === 'live' ? cameraTrack : undefined;

    localScreenSharePreviewController.stopSession(currentScreenShareSession);
    sharingNow = false;
    setActiveVideoTrack(peer, nextVideoTrack);

    unbindScreenTrackEnded();
    currentScreenStream = undefined;
    currentScreenShareSession = undefined;
    updateLocalUserCard();
    if (
        !nextVideoTrack &&
        mediaOperationController.getSnapshot().desired.camera &&
        voiceSessionRuntime.getSnapshot().desiredVoiceState === 'joined'
    ) {
        void startCamera(peer, { recovery: true });
    }
};

const requestDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(
    navigator.mediaDevices
);

const startScreenShare = async (peer, options = {}, preparedStream) => {
    if (screenShareRequestPending || sharingNow) {
        localMediaTrackStopper.stopStream(preparedStream);
        return false;
    }

    options = voiceMediaLifecycle.normalizeScreenShareOptions(options);
    mediaOperationController.setDesired('screen', true);
    setScreenShareRequestPending(true);
    const codecAbort = new AbortController();
    screenCodecAbort = codecAbort;
    const finishRequest = () => {
        if (screenCodecAbort === codecAbort) {
            screenCodecAbort = undefined;
            setScreenShareRequestPending(false);
        }
    };
    let codecDecision;
    let captureStarted = false;
    const capture = await mediaOperationController.run(
        'screen',
        async () => {
            captureStarted = true;
            const result = preparedStream ? { ok: true, stream: preparedStream } : usingPiik && options.provider === 'native'
                ? { ok: true, stream: await screenSfuRuntime.captureNative(voiceMediaLifecycle.normalizeScreenShareOptions(options), codecAbort.signal) }
                : await voiceMediaLifecycle.requestScreenCapture({
                getDisplayMedia: requestDisplayMedia,
                supportedConstraints: navigator.mediaDevices?.getSupportedConstraints?.(),
                options,
            });
            if (result.ok) {
                const track = result.stream.getVideoTracks()[0];
                const cancelled = () => codecAbort.abort();
                track?.addEventListener('ended', cancelled, { once: true });
                try {
                    if (track && !usingPiik) codecDecision = await window.VoiceScreenCodecs.prepare(
                        track, voiceMediaLifecycle.normalizeScreenShareOptions(options), { signal: codecAbort.signal }
                    );
                } catch (error) {
                    localMediaTrackStopper.stopStream(result.stream);
                    throw error;
                } finally {
                    track?.removeEventListener('ended', cancelled);
                }
                if (codecAbort.signal.aborted || track?.readyState === 'ended') {
                    localMediaTrackStopper.stopStream(result.stream);
                    const error = new Error('screen-codec-cancelled');
                    error.name = 'AbortError';
                    throw error;
                }
                return result.stream;
            }

            if (result.error) {
                throw result.error;
            }
            const error = new Error(result.reason || 'screen-capture-failed');
            error.name = 'NotSupportedError';
            throw error;
        },
        {
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            state: 'requesting',
            surviveEpochChange: false,
        }
    );
    if (!capture.ok) {
        // A preflight cancellation never transfers this stream to the operation.
        if (!captureStarted) localMediaTrackStopper.stopStream(preparedStream);
        const ownsRequest = screenCodecAbort === codecAbort;
        finishRequest();
        if (!ownsRequest || codecAbort.signal.aborted) return false;
        if (usingPiik) screenSfuRuntime.stopPublishing();
        mediaOperationController.setDesired('screen', false);
        setMediaOperationError('screen', capture);
        if (usingPiik && options.provider === 'native' && capture.error?.message && !capture.cancelled) {
            voiceStatusView.setMediaError('screen', 'unknown', capture.error.message);
            notifyMediaDock();
        }
        return false;
    }

    if (mediaOperationController.getSnapshot('screen').token !== capture.token ||
        !mediaOperationController.getSnapshot('screen').desired) {
        localMediaTrackStopper.stopStream(capture.value);
        finishRequest();
        return false;
    }

    const shareScreen = capture.value;
    const [track] = shareScreen.getVideoTracks();
    const screenAudioTracks = shareScreen.getAudioTracks();

    if (!track) {
        console.warn('Screen sharing did not provide a video track.');
        mediaOperationController.setDesired('screen', false);
        mediaOperationController.invalidate('screen', { stopValue: true });
        voiceStatusView.setMediaError('screen', 'unknown');
        notifyMediaDock();
        finishRequest();
        return false;
    }

    setMediaOperationError('screen', capture);
    currentScreenStream = shareScreen;
    const screenShareSession = {
        codecDecision,
        shareOptions: voiceMediaLifecycle.normalizeScreenShareOptions(options),
        previewGeneration: 0,
        stream: shareScreen,
        track,
        voiceSessionGeneration: localVoiceSessionGeneration,
    };
    currentScreenShareSession = screenShareSession;
    activeVideoTrack = track;
    sharingNow = true;
    mediaOperationController.setActive('screen', shareScreen);
    setLocalVideoStream(getActiveStream());
    const handleScreenTrackEnded = () => {
        if (
            !voiceMediaLifecycle.isCurrentScreenCapture({
                currentSession: currentScreenShareSession,
                currentStream: currentScreenStream,
                session: screenShareSession,
                sharing: sharingNow,
                stream: shareScreen,
            })
        ) {
            return;
        }

        console.warn('Screen sharing stopped by the browser.');
        mediaOperationController.setDesired('screen', false);
        mediaOperationController.invalidate('screen');
        emitScreenShareState(false, screenShareSession.voiceSessionGeneration);
        stopCurrentScreenStream();
        restoreCameraAfterScreenShare(peer);
        emitLocalPresenceUpdate();
    };
    screenShareSession.endedListener = handleScreenTrackEnded;
    track.addEventListener('ended', handleScreenTrackEnded);

    sendVideoTrackToPeers(peer, track);
    if (screenAudioTracks.length > 0) {
        console.info('[screen] sending screen audio track', {
            count: screenAudioTracks.length,
        });
    } else {
        console.info('[screen] no screen audio track was provided');
    }

    if (usingPiik) {
        try { await screenSfuRuntime.publish(shareScreen, screenShareSession.shareOptions); }
        catch (error) {
            if (currentScreenShareSession !== screenShareSession) { finishRequest(); return false; }
            console.warn('[piik] 共享启动失败', error);
            stopCurrentScreenStream(); restoreCameraAfterScreenShare(peer);
            mediaOperationController.setDesired('screen', false);
            voiceStatusView.setMediaError('screen', 'unknown', error.message); finishRequest(); notifyMediaDock(); return false;
        }
    }
    if (codecAbort.signal.aborted || currentScreenShareSession !== screenShareSession || !sharingNow) { finishRequest(); return false; }
    emitScreenShareState(true, screenShareSession.voiceSessionGeneration);
    updateScreenP2pBudget();
    if (!usingPiik) void screenSfuRuntime.publish(shareScreen, screenShareSession.shareOptions);
    emitLocalPresenceUpdate();
    updateLocalUserCard();
    finishRequest();
    return true;
};

const stopScreenShare = (peer) => {
    if (!screenShareRequestPending && !sharingNow) {
        return false;
    }

    mediaOperationController.setDesired('screen', false);
    mediaOperationController.invalidate('screen');
    const screenShareSession = currentScreenShareSession;
    stopCurrentScreenStream();
    setScreenShareRequestPending(false);
    emitScreenShareState(false, screenShareSession?.voiceSessionGeneration);
    restoreCameraAfterScreenShare(peer);
    emitLocalPresenceUpdate();
    return true;
};

// Source replacement has a single publication owner. Browser permission is
// obtained before retiring the old stream, so cancelling keeps it running.
const updateScreenShare = async (peer, options, change = 'quality') => {
    const session = currentScreenShareSession;
    if (!session || screenShareRequestPending) return false;
    const next = voiceMediaLifecycle.normalizeScreenShareOptions(options);
    const old = session.shareOptions;
    const inPlace = usingPiik && next.provider === old.provider && next.shareAudio === old.shareAudio &&
        (next.provider !== 'native' || (next.nativeAudioMode === old.nativeAudioMode && next.nativeAudioTargetKey === old.nativeAudioTargetKey &&
            !(change === 'source' && !['none', 'source'].includes(next.nativeAudioMode)))) &&
        (next.provider === 'native' || (change === 'quality' && next.codecMode === old.codecMode &&
            !(next.resolutionPreset === 'original' && old.resolutionPreset !== 'original')));
    const controller = new AbortController();
    screenCodecAbort = controller;
    setScreenShareRequestPending(true);
    try {
        if (inPlace) {
            if (next.provider === 'native') await screenSfuRuntime.updateNative(session.stream, next, change === 'source');
            else await screenSfuRuntime.updateWeb(session.stream, next);
            if (controller.signal.aborted || currentScreenShareSession !== session) return false;
            session.shareOptions = next;
            if (next.provider === 'web') window.VoiceScreenSendPolicy?.register(session.track, next);
            voiceStatusView.clearMediaError?.('screen');
            notifyMediaDock();
            return true;
        }
        // A native audio/provider change needs a new negotiated session. The
        // dialog explicitly labels this as restarting, never as a live change.
        let candidate;
        if (next.provider === 'web') {
            const result = await voiceMediaLifecycle.requestScreenCapture({ getDisplayMedia: requestDisplayMedia,
                supportedConstraints: navigator.mediaDevices?.getSupportedConstraints?.(), options: next });
            if (!result.ok) return false;
            candidate = result.stream;
        }
        if (controller.signal.aborted || currentScreenShareSession !== session) {
            localMediaTrackStopper.stopStream(candidate);
            return false;
        }
        screenCodecAbort = undefined;
        setScreenShareRequestPending(false);
        stopScreenShare(peer);
        return await startScreenShare(peer, next, candidate);
    } catch (error) {
        if (!controller.signal.aborted) {
            console.warn('[screen] 修改共享失败', error);
            voiceStatusView.setMediaError('screen', 'unknown', error.message || '修改共享失败，请重试');
        }
        return false;
    } finally {
        if (screenCodecAbort === controller) {
            screenCodecAbort = undefined;
            setScreenShareRequestPending(false);
        }
    }
};

// ----------------------------------------------------------------------------------------

//muting my audio
const setAudioButtonState = () => notifyMediaDock();

const setAudioButtonNoMic = () => notifyMediaDock();

const toggleAudio = (myVideoStream) => {
    const audioTrack = myVideoStream?.getAudioTracks()[0];

    if (!audioTrack) {
        console.warn('No local microphone track is available.');
        return;
    }

    const enabled = audioTrack.enabled;
    if (enabled) {
        mediaOperationController.setDesired('microphone', false);
        audioTrack.enabled = false;
        setAudioButtonState(false);
        micPermissionDenied = false;
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        console.log(`[mic] muted (track.enabled = false)`);
    } else {
        mediaOperationController.setDesired('microphone', true);
        audioTrack.enabled = true;
        setAudioButtonState(true);
        micPermissionDenied = false;
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        console.log(`[mic] unmuted (track.enabled = true)`);
    }
};

const restartLocalMicrophone = async (
    peer,
    { preserveOldTrack = false, recovery = false, request = audioSettingsController.snapshot().requested } = {}
) => {
    const previousAudioTrack = myVideoStream?.getAudioTracks()[0];
    const previousStream = myVideoStream;
    const epoch = voiceSessionRuntime.getSnapshot().epoch;
    const pendingMicrophone = mediaOperationController.run(
        'microphone',
        async () => {
            try {
                return await createAudioPipeline(undefined, request);
            } catch (error) {
                // A failed live switch must keep its old branch and settings.
                if (!error.audioProcessingFailure || error?.name === 'AbortError' ||
                    (preserveOldTrack && previousAudioTrack?.readyState === 'live')) throw error;
                console.warn('[audio] Processing unavailable, falling back to browser audio.', error);
                const fallback = { ...request, mode: 'browser' };
                try {
                    const stream = await createAudioPipeline(undefined, fallback);
                    audioPipelines.get(stream).fallbackReason = error?.message || 'processing-failed';
                    return stream;
                } catch (fallbackError) {
                    if (!fallbackError.audioProcessingFailure || fallbackError?.name === 'AbortError') throw fallbackError;
                    // prepare owns and stops failed captures; capture a fresh live fallback.
                    return requestRawAudioStream(fallback);
                }
            }
        },
        {
            epoch,
            state: preserveOldTrack ? 'switching' : 'requesting',
            surviveEpochChange: true,
        }
    );
    notifyMediaDock();
    const rawResult = await pendingMicrophone;
    if (rawResult.cancelled || mediaOperationController.getSnapshot('microphone').token !== rawResult.token) {
        // Concurrent requests may share the controller's one pending result.
        return rawResult.ok && rawResult.value === myVideoStream;
    }
    setMediaOperationError('microphone', rawResult);
    if (!rawResult.ok) {
        micPermissionDenied = rawResult.errorType === 'permission-denied';
        if (preserveOldTrack && previousAudioTrack?.readyState === 'live') {
            myVideoStream = previousStream;
            mediaOperationController.setActive('microphone', previousStream);
            setAudioButtonState(previousAudioTrack.enabled);
        } else {
            setAudioButtonNoMic();
        }
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        return false;
    }

    let stream;
    try {
        stream = adoptAudioPipeline(rawResult.value);
    } catch (error) {
        disposeAudioPipeline(rawResult.value);
        await audioProcessingRuntime.restoreCurrent();
        if (mediaOperationController.getSnapshot('microphone').token !== rawResult.token) return false;
        mediaOperationController.setActive('microphone', previousStream);
        setMediaOperationError('microphone', { ok: false, error, errorType: 'unknown' });
        notifyMediaDock();
        return false;
    }
    const nextAudioTrack = stream.getAudioTracks()[0];
    if (previousAudioTrack) {
        unbindLocalTrackEnded('microphone', previousAudioTrack);
    }
    if (previousStream !== stream) {
        disposeAudioPipeline(previousStream);
        localMediaTrackStopper.stopStream(previousStream);
    }
    audioSettingsController.adopt(request);
    if (nextAudioTrack) {
        nextAudioTrack.enabled = mediaOperationController.getSnapshot('microphone').desired;
        bindLocalTrackEnded('microphone', nextAudioTrack);
        voiceDeviceRuntime.setSelected(
            'mic',
            selectedInputDeviceId
        );
    }

    myVideoStream = stream;
    mediaOperationController.setActive('microphone', stream);
    localTrackEndedController.releaseRecovery('microphone', epoch);
    micPermissionDenied = false;
    setAudioButtonState(Boolean(nextAudioTrack?.enabled));
    if (previousStream !== stream) {
        setLocalVideoStream(getActiveStream());
        // Capture can finish after the join creates or replaces its Peer.
        sendAudioTrackToPeers(currentPeer, nextAudioTrack);
    }
    emitLocalPresenceUpdate();
    updateLocalUserCard();
    voiceMediaDebug.record({
        epoch,
        event: recovery ? 'microphone-recovered' : 'microphone-started',
    });
    return true;
};

const recoverProcessingFailure = ({ context, stream, rawStream }) => {
        if (stream !== myVideoStream || audioPipelines.get(stream)?.context !== context) return;
        if (audioProcessingRuntime.bypassFailedProcessor(stream)) {
            adoptAudioPipeline(stream);
            notifyMediaDock();
            return;
        }
        if (mediaOperationController.getSnapshot('microphone').promise) return;
        const oldTrack = stream.getAudioTracks()[0];
        const rawTrack = voiceMediaLifecycle.getLiveTracks(rawStream, 'audio')[0];
        if (!rawTrack) return;
        unbindLocalTrackEnded('microphone', oldTrack);
        rawTrack.enabled = mediaOperationController.getSnapshot('microphone').desired;
        myVideoStream = rawStream;
        disposeAudioPipeline(stream, { preserveRaw: true });
        adoptAudioPipeline(rawStream);
        bindLocalTrackEnded('microphone', rawTrack);
        mediaOperationController.setActive('microphone', rawStream);
        setLocalVideoStream(getActiveStream());
        sendAudioTrackToPeers(currentPeer);
        emitLocalPresenceUpdate();
        updateLocalUserCard();
        voiceMediaDebug.record({ event: 'microphone-processing-recovered', mode: 'raw' });
};

const audioRecoveryRuntime = window.VoiceAudioRecovery.createRuntime({
    getMediaElements: () => Array.from(document.querySelectorAll(
        '.video-tile:not(#local-video) video, .video-tile:not(#local-video) audio'
    )),
    getProcessingState: () => {
        const pipeline = audioPipelines.get(activeAudioPipelineStream);
        // Recovery belongs to this branch, even when its context/output is reused.
        return pipeline;
    },
    getPeerStates: () => {
        if (!joinedVoiceRoomId || !currentPeer || currentPeer.destroyed || currentPeer.disconnected || !socket?.connected) return [];
        const hasMedia = [myVideoStream, cameraStream, currentScreenStream]
            .some((stream) => voiceMediaLifecycle.getLiveTracks(stream).length > 0);
        return Array.from(voiceMediaTargets, (peerId) => {
            const call = voicePeerRegistry.getSnapshot(peerId)?.outgoingCall;
            return { peerId, hasMedia, connection: call?.peerConnection || call?._pc };
        });
    },
    onPlaybackBlocked: (blocked) => {
        voiceStatusView.setMediaError('playback', blocked ? 'permission-denied' : undefined,
            '浏览器暂停了声音播放，请点击恢复声音');
        notifyMediaDock();
    },
    onProcessingFailure: (state) => recoverProcessingFailure(state),
    onPeerRecovery: (peerId) => {
        if (!voiceMediaTargets.has(peerId) || !socket?.connected || !currentPeer || currentPeer.destroyed || currentPeer.disconnected) return;
        // Rebuild only this send direction. Keep capture, room membership and
        // the other participant's reverse microphone connection intact.
        localVoiceMediaGeneration += 1;
        publishLocalMediaToPeer(currentPeer, peerId, getActiveStream(), {
            generation: localVoiceMediaGeneration,
        });
        voiceMediaDebug.record({ event: 'audio-peer-recovery', peerId });
    },
    onPeerFailure: (failed) => {
        voiceStatusView.setMediaError('audio-connection', failed ? 'unknown' : undefined,
            '语音连接暂未恢复，请点击恢复声音重试');
        notifyMediaDock();
    },
});

const recoverAudio = () => {
    // Call play()/resume() inside the click, before asynchronous sink changes.
    audioRecoveryRuntime.recover({ userGesture: true });
    outputSelectionRevision += 1;
    voiceStatusView.clearMediaError('output');
    document.querySelectorAll('.video-tile video, .video-tile audio').forEach((element) => {
        delete element.dataset.outputSinkId;
    });
    void applyOutputSettingsToRemoteMedia();
    notifyMediaDock();
};

const initiateAudio = async (peer) => {
    mediaOperationController.setDesired('microphone', true);
    const started = await restartLocalMicrophone(peer);
    if (started) {
        refreshMediaDeviceLists();
        if (!callStartedAt) {
            startCallTimer();
        }
        if (currentPeer && !currentPeer.destroyed) bindPeerCallHandler(currentPeer);
    }
};

const handleMicClick = async (peer) => {
    const operation = mediaOperationController.getSnapshot('microphone');
    if (voiceSessionRuntime.getSnapshot().desiredVoiceState !== 'joined') {
        mediaOperationController.setDesired('microphone', !operation.desired);
        voiceStatusView.clearMediaError('microphone');
        notifyMediaDock();
        return true;
    }
    if (myVideoStream?.getAudioTracks?.()[0]?.readyState === 'live') {
        toggleAudio(myVideoStream);
        return;
    }
    if (operation.promise) {
        mediaOperationController.setDesired('microphone', false);
        mediaOperationController.invalidate('microphone');
        audioSettingsController.cancel();
        audioProcessingRuntime.cancelPending();
        voiceStatusView.clearMediaError('microphone');
        notifyMediaDock();
        return true;
    }

    console.log('[mic] Requesting microphone...');
    await initiateAudio(peer);
};

async function handleUnexpectedLocalTrackEnded(type, track, epoch) {
    const session = voiceSessionRuntime.getSnapshot();
    if (
        !voiceSessionRuntime.isCurrent(epoch) ||
        session.desiredVoiceState !== 'joined' ||
        pageVoiceTeardown.isComplete()
    ) {
        return false;
    }
    const desired = mediaOperationController.getSnapshot().desired;
    if (type !== 'microphone' && type !== 'camera') {
        return false;
    }
    if (
        (type !== 'microphone' && !desired[type]) ||
        !localTrackEndedController.claimRecovery(type, epoch)
    ) {
        return false;
    }

    if (type === 'microphone') {
        if (myVideoStream?.getAudioTracks?.()[0] !== track) {
            localTrackEndedController.releaseRecovery('microphone', epoch);
            return false;
        }
        const recovered = await selectInputDevice('default');
        if (!recovered) {
            // A later successful branch can retain this same output track.
            // Only release genuinely dead capture after all newer work ends.
            if (!mediaOperationController.getSnapshot('microphone').promise &&
                myVideoStream?.getAudioTracks()[0] === track &&
                audioProcessingRuntime.diagnostics(myVideoStream)?.sourceLive === false) {
                destroyProcessedAudioStream();
                localMediaTrackStopper.stopStream(myVideoStream);
                myVideoStream = undefined;
                setLocalVideoStream(getActiveStream());
                refreshVoiceCallsForLocalMedia(currentPeer);
            }
            localTrackEndedController.releaseRecovery('microphone', epoch);
        }
        return recovered;
    }

    if (type === 'camera') {
        if (cameraStream?.getVideoTracks?.()[0] !== track) {
            localTrackEndedController.releaseRecovery('camera', epoch);
            return false;
        }
        setCameraButtonState(false);
        if (sharingNow) {
            localTrackEndedController.releaseRecovery('camera', epoch);
            return false;
        }
        selectedCameraDeviceId = 'default';
        voiceDeviceRuntime.setSelected('camera', 'default');
        const recovered = await startCamera(currentPeer, { recovery: true });
        if (!recovered) {
            if (!mediaOperationController.getSnapshot('camera').promise &&
                cameraStream?.getVideoTracks?.()[0] === track) {
                cameraStream = undefined;
                committedCameraDeviceId = selectedCameraDeviceId;
                setActiveVideoTrack(currentPeer);
            }
            localTrackEndedController.releaseRecovery('camera', epoch);
        }
        return recovered;
    }
    return false;
}

async function handleMissingMediaDevice(type) {
    const session = voiceSessionRuntime.getSnapshot();
    voiceMediaDebug.record({
        epoch: session.epoch,
        event: 'selected-device-fallback',
        mediaType: type,
    });
    if (type === 'output') {
        selectedOutputDeviceId = 'default';
        voiceStatusView.setMediaError('output', 'device-not-found');
        notifyMediaDock();
        await applyOutputSettingsToRemoteMedia();
        return true;
    }
    if (type === 'mic') return selectInputDevice('default');
    if (type === 'camera') {
        cameraSelectionRevision += 1;
        selectedCameraDeviceId = 'default';
        voiceDeviceRuntime.setSelected('camera', 'default');
        if (mediaOperationController.getSnapshot('camera').promise) {
            mediaOperationController.invalidate('camera', { state: 'switching' });
        }
        notifyMediaDock();
        if (
            mediaOperationController.getSnapshot().desired.camera &&
            currentPeer &&
            !currentPeer.destroyed
        ) {
            return startCamera(currentPeer, {
                preserveOldTrack: true,
                recovery: true,
            });
        }
    }
    return false;
}

const peerLifecycleMetadata = new WeakMap();

const waitForPeerOpen = (peer, { reconnect = false, timeoutMs = 4000 } = {}) =>
    new Promise((resolve) => {
        if (!peer || peer.destroyed) {
            resolve(false);
            return;
        }
        if (peer.open && !peer.disconnected) {
            resolve(true);
            return;
        }
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            peer.off?.('open', handleOpen);
            peer.off?.('error', handleFailure);
            peer.off?.('close', handleFailure);
            resolve(result);
        };
        const handleOpen = () => finish(true);
        const handleFailure = () => finish(false);
        const timer = window.setTimeout(() => finish(false), timeoutMs);
        peer.on?.('open', handleOpen);
        peer.on?.('error', handleFailure);
        peer.on?.('close', handleFailure);
        if (reconnect) {
            try {
                peer.reconnect?.();
            } catch {
                finish(false);
            }
        }
    });

const schedulePeerRecovery = (strategy, reason) => {
    const session = voiceSessionRuntime.getSnapshot();
    if (
        session.desiredVoiceState !== 'joined' ||
        session.state === 'disposed' ||
        session.state === 'failed' ||
        navigator.onLine === false
    ) {
        return Promise.resolve(false);
    }
    voiceSessionRuntime.peerDisconnected(reason);
    return peerRetryController.run({
        epoch: session.epoch,
        task: async () => {
            const currentSession = voiceSessionRuntime.getSnapshot();
            if (
                currentSession.desiredVoiceState !== 'joined' ||
                !voiceSessionRuntime.isCurrent(session.epoch)
            ) {
                return false;
            }
            if (
                strategy === 'reconnect' &&
                currentPeer &&
                !currentPeer.destroyed
            ) {
                return waitForPeerOpen(currentPeer, { reconnect: true });
            }
            const retiredPeer = currentPeer;
            currentPeer = undefined;
            retiredPeer?.destroy?.();
            voicePeerRegistry.teardown('peer-recreate');
            localVoiceMediaGeneration = 0;
            const replacement = await createPeerInstance(currentSession.roomId, {
                recreate: true,
            });
            return waitForPeerOpen(replacement);
        },
        onExhausted: ({ epoch }) => {
            const currentSession = voiceSessionRuntime.getSnapshot();
            if (
                voiceSessionRuntime.isCurrent(epoch) &&
                ['reconnecting-peer', 'reconnecting-socket'].includes(
                    currentSession.state
                )
            ) {
                voiceSessionRuntime.fail('peer-recovery-failed');
            }
        },
    });
};

let pendingPeerCreation;
const createPeerInstance = (roomToJoin, options) => {
    const epoch = voiceSessionRuntime.getSnapshot().epoch;
    if (pendingPeerCreation?.epoch === epoch) return pendingPeerCreation.promise;
    const promise = createPreparedPeerInstance(roomToJoin, options).finally(() => {
        if (pendingPeerCreation?.promise === promise) pendingPeerCreation = undefined;
    });
    pendingPeerCreation = { epoch, promise };
    return promise;
};
const createPreparedPeerInstance = async (roomToJoin, { recreate = false } = {}) => {
    const session = voiceSessionRuntime.getSnapshot();
    const iceConfiguration = await iceConfigRuntime.prepare();
    const latest = voiceSessionRuntime.getSnapshot();
    if (!voiceSessionRuntime.isCurrent(session.epoch) || latest.desiredVoiceState !== 'joined' || latest.roomId !== roomToJoin)
        return undefined;
    const isSecurePeerConnection = window.location.protocol === 'https:';
    const peerPort =
        window.location.port || (isSecurePeerConnection ? 443 : 80);

    // eslint-disable-next-line no-undef
    const peer = new Peer(undefined, {
        host: window.location.hostname,
        path: '/peerjs',
        port: peerPort,
        secure: isSecurePeerConnection,
        config: iceConfiguration,
    });
    currentPeer = peer;
    peerLifecycleMetadata.set(peer, { recreate, roomId: roomToJoin });

    peer.on('open', (peerId) => {
        if (peer !== currentPeer || peer.destroyed) {
            return;
        }
        const metadata = peerLifecycleMetadata.get(peer);
        if (metadata?.recreate) {
            voiceSessionRuntime.peerRecreated(peerId);
            rebindLiveLocalTrackEndedHandlers();
        } else if (
            voiceSessionRuntime.getSnapshot().state === 'reconnecting-peer'
        ) {
            voiceSessionRuntime.markRestoring('peer-reconnected');
        }
        voicePeerRegistry.setSessionDisconnected(false);
        localPeerId = peerId;
        myVideo.parentElement?.setAttribute('data-peer-id', localPeerId);
        const activeSocket = ensureSocket();

        selectedVoiceRoomId = roomToJoin;

        bindPeerCallHandler(peer);

        notifyMediaDock();
        syncRoomCompositionState();
        startCallTimer();

        bindVoiceSocketHandlers(activeSocket);
        setLocalVideoStream(getActiveStream());
        updateLocalUserCard();
        voiceMediaDebug.record({
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            event: 'peer-open',
        });
        void restoreServerVoiceOwner(
            metadata?.recreate ? 'peer-recreated' : 'peer-open'
        );
    });

    peer.on('error', (error) => {
        if (peer !== currentPeer) {
            return;
        }
        const classified = voiceSessionRuntimeApi.classifyPeerError(error);
        voiceMediaDebug.record({
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            event: 'peer-error',
            errorType: classified.type,
            recoveryStrategy: classified.strategy,
        });
        console.warn('Peer connection failed.', error);
        if (classified.scope === 'call') {
            return;
        }
        if (!classified.recoverable) {
            voiceSessionRuntime.fail(`peer-${classified.type}`);
            return;
        }
        void schedulePeerRecovery(
            classified.strategy,
            `peer-${classified.type}`
        );
    });

    peer.on('connection', () => {
        console.log('peer connection established');
    });

    peer.on('close', () => {
        if (peer !== currentPeer) {
            return;
        }
        voicePeerRegistry.teardown('peer-close');
        localVoiceMediaGeneration = 0;
        currentPeer = undefined;
        localPeerId = undefined;
        voiceMediaDebug.record({
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            event: 'peer-close',
        });
        if (voiceSessionRuntime.getSnapshot().desiredVoiceState === 'joined') {
            void schedulePeerRecovery('recreate', 'peer-close');
        }
    });

    peer.on('disconnected', () => {
        console.log('Peer disconnected');
        voicePeerRegistry.setSessionDisconnected(true);
        voiceMediaDebug.record({
            epoch: voiceSessionRuntime.getSnapshot().epoch,
            event: 'peer-disconnected',
        });
        void schedulePeerRecovery('reconnect', 'peer-disconnected');
    });
    return peer;
};

const leaveVoiceSession = (reason = 'user-leave') => {
    iceConnectionPending = false;
    iceConfigRuntime.stop();
    channelSounds.leave();
    callDiagnostics?.end(reason);
    screenSfuRuntime.leave();
    const nextRoomId = pendingVoiceRoomId;
    pendingVoiceRoomId = undefined;
    voiceSessionRuntime.leave({ reason });
    voiceMediaDebug.record({ event: 'teardown', reason });
    peerRetryController.reset(reason);
    mediaOperationController.setDesired('camera', false);
    mediaOperationController.setDesired('screen', false);
    ['microphone', 'camera', 'screen'].forEach((type) =>
        mediaOperationController.invalidate(type)
    );
    if (socket?.connected) {
        socket.emit('presence:leaveVoice');
        socket.emit('voicePeerLeft');
    }
    voicePeerRegistry.teardown('local-voice-leave');
    voiceMediaTargets.clear();
    screenSharers.clear();
    const peer = currentPeer;
    currentPeer = undefined;
    peer?.destroy?.();
    localPeerId = undefined;
    joinedVoiceRoomId = undefined;
    localVoiceMediaGeneration = 0;
    localVoiceSessionGeneration = 0;
    resetLocalVoiceState();

    getVideoTiles().forEach((tile) => {
        fullscreenControls.detachTile(tile);
        tile.remove();
    });
    updateMobileTileView();
    updateMobileRoomState();
    notifyMediaDock();
    syncRoomCompositionState();
    if (nextRoomId) {
        joinVoiceChannel(nextRoomId);
    }
    return true;
};

const joinVoiceChannel = (roomId) => {
    if (!isKnownRoom(roomId)) {
        console.warn(`Voice channel ${roomId} is not available.`);
        return false;
    }
    void channelSounds.unlock();
    const currentSession = voiceSessionRuntime.getSnapshot();
    if (
        currentSession.state === 'failed' &&
        currentSession.roomId === roomId &&
        voiceSessionRuntime.retry()
    ) {
        rebindLiveLocalTrackEndedHandlers();
        if (!socket?.connected) {
            ensureSocket().connect?.();
        }
        if (!currentPeer || currentPeer.destroyed) {
            void schedulePeerRecovery('recreate', 'manual-retry');
        } else if (socket?.connected) {
            void restoreServerVoiceOwner('manual-retry');
        }
        return true;
    }
    const sessionEpoch = voiceSessionRuntime.join(roomId);
    if (!sessionEpoch || (currentPeer && !currentPeer.destroyed)) {
        return false;
    }
    callDiagnostics?.start();
    selectedVoiceRoomId = roomId;
    setAudioButtonNoMic();
    setCameraButtonState(false);
    notifyMediaDock();
    syncRoomCompositionState();
    if (mediaOperationController.getSnapshot('microphone').desired) {
        // Joining requests the chosen microphone; outside toggles never capture.
        void initiateAudio(currentPeer);
    }
    void createPeerInstance(roomId).catch(() => {
        if (voiceSessionRuntime.isCurrent(sessionEpoch)) voiceSessionRuntime.fail('ice-configuration-unavailable');
    });
    return true;
};

function removeRemoteTile(peerId, ownedTile) {
    const vidElement =
        ownedTile?.id === peerId ? ownedTile : document.getElementById(peerId);

    if (vidElement) {
        screenShareVolumeController.cleanup(peerId);
        fullscreenControls.detachTile(vidElement);
        const mediaElement = vidElement.querySelector('video, audio');
        if (mediaElement) {
            mediaElement.onloadedmetadata = null;
            mediaElement.srcObject = null;
        }
        vidElement.remove();
        updateMobileTileView();
    }
}

const showVoiceJoinConfirm = (roomId) => {
    voiceJoinOverlayUI.show({
        title: getChannelName(roomId),
        onConfirm: () => {
            setVoiceTargetRoom(roomId);
        },
    });
};

window.addEventListener('popstate', () => {
    const [, roomId] = window.location.pathname.match(/^\/room\/([^/]+)/) || [];

    if (roomId) {
        setViewingRoom(roomId, { updateHistory: false });
    }
});

callDiagnostics = window.VoiceCallDiagnostics.createRuntime({
    sanitize: sanitizeVoiceDiagnostic,
    getReceiverHealth: () => screenSfuRuntime.getReceiverHealth(),
    getState: () => {
        const session = voiceSessionRuntime.getSnapshot();
        const settings = audioSettingsController.snapshot();
        const processing = audioProcessingRuntime.diagnostics(myVideoStream);
        const track = myVideoStream?.getAudioTracks()[0];
        const actual = track?.getSettings?.() || {};
        return {
            会话: { state: session.state, generation: session.serverGeneration },
            本机音频: {
                请求模式: settings.requested.mode,
                实际模式: processing?.mode || null,
                降噪模型: processing?.engine || null,
                模型回退: processing?.engineFallback || null,
                模型预检p95_ms: processing?.probeP95Ms ?? null,
                处理负载: processing?.processingLoad || null,
                设置切换中: settings.pending,
                切换结果: settings.error,
                处理链: processing?.mode === 'deepfilter' ? '浏览器AEC → DeepFilterNet3 → 短前瞻门控 → 输入增益' :
                    processing?.mode === 'rnnoise' ? '浏览器AEC → RNNoise → 可选非语音门控 → 输入增益' :
                    processing?.actual?.noiseSuppression ? '浏览器AEC / NS / AGC → 输入增益' : '浏览器AEC → 输入增益',
                请求AEC: 'all（不支持时普通AEC）',
                请求浏览器降噪: settings.requested.mode === 'browser',
                请求自动增益: settings.requested.mode === 'browser',
                浏览器降噪: processing?.actual?.noiseSuppression ?? null,
                AEC: processing?.actual?.echoCancellation ?? null,
                AEC采集方式: processing?.aecAcquisition || null,
                AEC回退: processing?.aecFallback || null,
                自动增益: processing?.actual?.autoGainControl ?? null,
                非语音门控启用: Boolean(processing?.speechGateEnabled && processing?.speechGateSupported),
                处理器回退: processing?.fallbackReason || null,
                最近切换失败: processing?.lastSwitchFailure || null,
                麦克风存活: processing?.sourceLive ?? false,
                静音: !track?.enabled,
                轨道静音: track?.muted ?? null,
                麦克风增益_百分比: noiseSettingsUI.getMicGain(),
                采集格式: { 采样率: actual.sampleRate || null, 声道数: actual.channelCount || null },
                输入设备: selectedInputDeviceId === 'default' ? '默认' : '自选',
                输出设备: selectedOutputDeviceId === 'default' ? '默认' : '自选',
                输出静音: outputMuted,
                输出增益_百分比: Math.round(outputVolume * 100),
                放大播放: remoteAudioGain.getSnapshot(),
            },
            共享路径变化: screenSfuRuntime.snapshot(),
            共享音频采集: voiceMediaLifecycle.describeScreenAudio(currentScreenStream, navigator.mediaDevices?.getSupportedConstraints?.()),
            输出播放: voicePeerRegistry.getPeerIds().map((peerId, index) => {
                const screen = screenShareVolumeController.getSnapshot(peerId);
                const tile = document.getElementById(peerId);
                const primary = tile?.querySelector('video, audio:not(.screen-share-audio)');
                return { 序号: index + 1, 语音音量_百分比: Math.round(getPeerVolume(peerId) * 100),
                    语音播放: remoteAudioGain.describePlayer(primary),
                    共享播放: remoteAudioGain.describePlayer(screen?.element),
                    有效音量_百分比: outputMuted ? 0 : Math.round(getPeerVolume(peerId) * outputVolume * 100),
                    共享音量_百分比: Math.round((screen?.volume ?? 1) * 100), 共享静音: screen?.muted ?? false };
            }),
        };
    },
    getSources: () => ['local-video', ...screenSharers].map(getDiagnosticQualitySource).filter((source) => source?.isScreenSharing && source.tile),
    getConnections: () => [screenSfuRuntime.getSendConnection(), ...voicePeerRegistry.getPeerIds().flatMap((peerId, index) => {
        const peer = voicePeerRegistry.getSnapshot(peerId);
        return [
            { pc: peer?.incomingCall?.peerConnection || peer?.incomingCall?._pc, ordinal: index + 1, purpose: '接收语音和P2P媒体' },
            { pc: peer?.outgoingCall?.peerConnection || peer?.outgoingCall?._pc, ordinal: index + 1, purpose: '发送语音和P2P媒体' },
            { pc: screenSfuRuntime.getRemoteSource(peerId)?.pc, ordinal: index + 1, purpose: '接收SFU共享' },
        ].filter((entry) => entry.pc);
    })],
    getAudioRole: (pc, report, reports) => {
        if (pc.screenRoute === 'SFU') return '共享音频';
        const source = reports.find((row) => row.id === report.mediaSourceId);
        const trackId = report.trackIdentifier || source?.trackIdentifier;
        if (!trackId) return null;
        if (report.type === 'outbound-rtp') {
            if (myVideoStream?.getAudioTracks().some((track) => track.id === trackId)) return '麦克风';
            if (currentScreenStream?.getAudioTracks().some((track) => track.id === trackId)) return '共享音频';
        } else {
            const peerId = voicePeerRegistry.getPeerIds().find((id) => voicePeerRegistry.getQualitySource(id)?.pc === pc);
            const role = remoteP2pTrackRoles.get(peerId)?.find((row) => row.trackId === trackId)?.role;
            return role === 'screen-share-audio' ? '共享音频' : role ? '麦克风' : null;
        }
        return null;
    },
});
document.querySelector('[data-copy-call-diagnostics]')?.addEventListener('click', (event) => callDiagnostics.copyCombined(event.currentTarget));
window.VoicePlayerMenu.configure({
    beforeOpen: () => remoteVolumeUI.closePopover(),
    showEvents: (tile) => callDiagnostics.showLogs({ shareOrdinal: callDiagnostics.getShareOrdinal(tile), host: tile }),
    onVolume: showPeerVolumePopover,
});
document.addEventListener('voice:share-started', ({ detail }) => callDiagnostics.beginShare(detail.tile, detail.isLocal));
document.addEventListener('voice:share-ended', ({ detail }) => callDiagnostics.endShare(detail.tile));
document.addEventListener('voice:share-sample', ({ detail }) => callDiagnostics.observeShare(detail.tile, detail.snapshot));
mediaDockRoot.querySelector('[data-show-call-logs]')?.addEventListener('click', () => callDiagnostics.showLogs());
mediaDockRoot.querySelector('[data-clear-call-logs]')?.addEventListener('click', (event) => {
    callDiagnostics.clearLogs();
    event.currentTarget.textContent = '已清除历史，当前通话继续记录';
});
remoteVolumeUI.init();

fullscreenControls.bindFullscreenChange();

window.addEventListener('resize', () => {
    // CSS owns size changes; no media, routing or storage operations here.
    stageLayout?.syncViewport();
});

const handleNetworkOffline = () => {
    chatPanelRuntime?.setConnectionState('offline');
    sidebarRuntime?.setConnectionState('offline');
    peerRetryController.setOnline(false);
    if (voiceSessionRuntime.socketDisconnected('network-offline')) {
        rebindLiveLocalTrackEndedHandlers();
    }
    notifyMediaDock();
    voiceMediaDebug.record({ event: 'network-offline' });
};

const handleNetworkOnline = () => {
    chatPanelRuntime?.setConnectionState(
        socket?.connected ? 'connected' : 'connecting'
    );
    sidebarRuntime?.setConnectionState(
        socket?.connected ? 'connected' : 'connecting'
    );
    peerRetryController.setOnline(true);
    voiceMediaDebug.record({ event: 'network-online' });
    notifyMediaDock();
    if (!socket?.connected) {
        socket?.connect?.();
    } else {
        // A brief offline interval may leave Socket.IO connected, so no new
        // connect event will request the history needed to unlock chat.
        chatPanelRuntime?.rejoinCurrentRoom();
    }
    const session = voiceSessionRuntime.getSnapshot();
    if (session.desiredVoiceState !== 'joined') {
        return;
    }
    if (currentPeer?.disconnected && !currentPeer.destroyed) {
        void schedulePeerRecovery('reconnect', 'network-online');
        return;
    }
    if (!currentPeer || currentPeer.destroyed) {
        void schedulePeerRecovery('recreate', 'network-online');
        return;
    }
    if (socket?.connected) {
        voiceSessionRuntime.socketConnected('network-online');
        void restoreServerVoiceOwner('network-online');
    }
};

window.addEventListener('offline', handleNetworkOffline);
window.addEventListener('online', handleNetworkOnline);
document.addEventListener('visibilitychange', () => {
    voiceMediaDebug.record({
        event: 'page-visibility',
        visibilityState: document.visibilityState,
    });
});

window.addEventListener('pagehide', (event) => {
    if (voiceMediaLifecycle.shouldTeardownPage(event)) {
        pageVoiceTeardown.run('page-unload');
    } else {
        voiceMediaDebug.record({ event: 'pagehide-bfcache' });
    }
});

window.addEventListener('pageshow', (event) => {
    if (!event.persisted) {
        return;
    }
    voiceMediaDebug.record({ event: 'pageshow-bfcache' });
    handleNetworkOnline();
});

const sidebarTransport = sidebarSocketTransportApi.createSidebarSocketTransport(
    {
        getSocket: ensureSocket,
    }
);
sidebarRuntime = sidebarRuntimeApi.createSidebarRuntime({
    root: sidebarRoot,
    transport: sidebarTransport,
    stateView: channelSidebarUI,
    participantsView: participantsListUI,
    presenceViewModel,
    initialViewingRoomId: viewingRoomId,
    initialVoiceRoomId: joinedVoiceRoomId,
    initialVoiceTargetRoomId: selectedVoiceRoomId,
    onRequestViewRoom: (roomId) => {
        const changed = setViewingRoom(roomId);
        if (changed && isMobileLayout()) {
            showVoiceJoinConfirm(roomId);
        }
        return changed;
    },
    onRequestVoiceRoom: setVoiceTargetRoom,
    onPresenceSnapshot: (snapshot) => {
        channelSounds.observe(snapshot);
        reconcilePresenceState(snapshot);
        // The sidebar normalizes and stores its roster after this callback.
        queueMicrotask(() => stageLayout?.sync());
    },
    onCopyRoomLink: ({ url }) => copyLinkUI.writeClipboardText(url),
    getRoomUrl: getChannelUrl,
    isLocalMember: (member) =>
        Boolean(member.socketId && socket?.id === member.socketId),
    getMemberTileToggle,
});
sidebarRuntime.init();

const chatTransport = chatSocketTransportApi.createChatSocketTransport({
    getSocket: ensureSocket,
});
chatPanelRuntime = chatPanelRuntimeApi.createChatPanelRuntime({
    root: chatPanelRoot,
    transport: chatTransport,
    messageView: chatMessageUI,
    formView: chatFormUI,
    nameState: chatNameState,
    formatTime: window.VoiceViewUtils.formatTime,
    onDisplayNameChange: updatePresenceName,
    onLiveMessage: (message) => stageLayout?.notifyChatMessage(message),
    onRoomChange: () => stageLayout?.resetChatRoom(),
    onConnectionStateChange: (state) => stageLayout?.setChatConnection(state),
});
chatPanelRuntime.init();
chatPanelRuntime.setRoom(viewingRoomId);

mediaDockAdapter = mediaDockAdapterApi.createMediaDockAdapter({
    actions: {
        copyRoomLink: () =>
            copyLinkUI.writeClipboardText(getChannelUrl(getCopyRoomId())),
        hangUp: () => leaveVoiceSession('media-dock-hangup'),
        joinVoice: () => joinVoiceChannel(selectedVoiceRoomId || viewingRoomId),
        leaveVoice: () => leaveVoiceSession('media-dock-leave'),
        refreshDevices: () => refreshMediaDeviceLists(),
        recoverAudio,
        selectCamera: selectCameraDevice,
        selectMicrophone: selectInputDevice,
        selectOutput: selectOutputDevice,
        setMicrophoneGain: (micGainPercent) => {
            const nextGain = noiseSettingsUI.setMicGain(micGainPercent, {
                syncUI: false,
                onMicGainChange: (value) => {
                    audioProcessingRuntime.setGain(value);
                },
            });
            notifyMediaDock();
            return nextGain;
        },
        setOutputMuted: (muted) => {
            outputMuted = Boolean(muted);
            notifyMediaDock();
            updateAllVideoTileStatus();
            return applyOutputSettingsToRemoteMedia();
        },
        setOutputVolume: (volume) => {
            outputVolume = Math.max(0, Math.min(1, Number(volume) || 0));
            notifyMediaDock();
            return applyOutputSettingsToRemoteMedia();
        },
        startScreenShare: (options) => startScreenShare(currentPeer, options),
        updateScreenShare: (options, change) => updateScreenShare(currentPeer, options, change),
        stopScreenShare: () => stopScreenShare(currentPeer),
        selectNoiseMode: (mode) => audioSettingsController.select({ mode: window.VoiceAudioProcessing.normalizeMode(mode) }),
        setRnnoiseSpeechGate: (enabled) => {
            const previous = noiseSettingsUI.getRnnoiseSpeechGateEnabled();
            noiseSettingsUI.setRnnoiseSpeechGateEnabled(enabled);
            const ok = audioProcessingRuntime.setSpeechGate(enabled);
            if (!ok) noiseSettingsUI.setRnnoiseSpeechGateEnabled(previous);
            notifyMediaDock();
            return ok;
        },
        toggleAiNoiseSuppression: () => audioSettingsController.select({
            mode: audioSettingsController.snapshot().requested.mode === 'rnnoise' ? 'browser' : 'rnnoise',
        }),
        toggleCamera: () => toggleCamera(currentPeer),
        toggleMicrophone: () => handleMicClick(currentPeer),
        toggleNoiseSuppression: () => audioSettingsController.select({
            mode: audioSettingsController.snapshot().requested.mode === 'browser' ? 'off' : 'browser',
        }),
    },
    getSnapshot: getMediaDockSnapshot,
});
mediaDockRuntime = mediaDockRuntimeApi.createMediaDockRuntime({
    root: mediaDockRoot,
    adapter: mediaDockAdapter,
});
mediaDockRuntime.init();
audioRecoveryRuntime.start();
navigator.mediaDevices?.addEventListener?.(
    'devicechange',
    voiceDeviceRuntime.handleDeviceChange
);
void refreshMediaDeviceLists();

stageLayout = window.VoiceStageLayout.createRuntime({
    root: mainLayout,
    stage: videoGrid,
    members: byId('member-cards'),
    sources: byId('share-sources'),
    chat: chatPanelRoot,
    getTiles: getVideoTiles,
    getMember: getTileMember,
    getCameraStream: (tile) => tile.id === 'local-video' ? cameraStream : null,
    getChannelState: () => {
        const roomId = joinedVoiceRoomId || viewingRoomId;
        const channel = sidebarRuntime?.getPresenceSnapshot().channels.find((item) => item.slug === roomId);
        const session = voiceSessionRuntime.getSnapshot();
        return {
            joined: Boolean(joinedVoiceRoomId),
            pending: session.desiredVoiceState === 'joined' && !joinedVoiceRoomId,
            connectionState: session.state,
            channelName: getChannelName(roomId),
            memberCount: channel?.count,
        };
    },
    onJoin: () => joinVoiceChannel(viewingRoomId),
    onVolume: showPeerVolumePopover,
});
stageLayout.init();
stageLayout.setChatConnection(chatPanelRoot.dataset.chatConnectionState || 'connecting');
const shareWatchStatus = window.VoiceShareWatchStatus.createRuntime({
    root: mainLayout,
    getSource: getDiagnosticQualitySource,
});
shareWatchStatus.init();
window.addEventListener('pagehide', (event) => { if (!event.persisted) shareWatchStatus.destroy(); });
const speakingRuntime = window.VoiceSpeakingRuntime.createRuntime({
    getSources: () => getVideoTiles().map((tile) => ({
        id: tile.id,
        stream: tile.id === 'local-video' ? myVideoStream : getPrimaryTileMediaElement(tile)?.srcObject,
        enabled: getTileMember(tile).hasMic && !getTileMember(tile).muted,
    })),
    onSpeaking: (id, speaking) => stageLayout.setSpeaking(id, speaking),
});
speakingRuntime.start();
window.addEventListener('pagehide', (event) => { if (!event.persisted) speakingRuntime.destroy(); });
syncRoomCompositionState();
enablePageCursorSharing();
window.VoiceRoomBoot?.finish('ready');
