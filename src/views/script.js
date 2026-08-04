/* eslint-disable no-console */
console.info('[page-layout] script boot v2 ' + new Date().toISOString());
let socket;

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
const mobileBackToChannelsBtn = byId('mobileBackToChannels');
const mobilePrevTileBtn = byId('mobilePrevTile');
const mobileNextTileBtn = byId('mobileNextTile');
const mobileTileCount = byId('mobileTileCount');
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
const layoutStoreRuntime = window.PageLayoutStoreRuntime;
const roomUIState = window.VoiceRoomUIState;
const mobileRoomState = window.VoiceMobileRoomState;
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
const {
    PAGE_COMPONENT_TYPES,
    LAYOUT_ITEM_TYPES,
    LEGACY_LAYOUT_ITEM_TYPES,
    AUTO_LAYOUT_GRID_SIZES,
    PANEL_COLLAPSED_HEIGHT,
    getDefaultComponentConfig,
    normalizeComponentConfig,
    getDefaultLayoutPreferences,
    normalizeLayoutPreferences,
    getLayoutPreferenceValue,
    getPanelRegistry,
    getPanelConfig,
} = layoutConfig;
const layoutIds = window.PageLayoutIds;
const {
    getDefaultLayoutItems,
    getLayoutComponentId,
    renderLayoutComponentTile: renderLayoutComponentTileContent,
} = layoutComponents;
const getAudioConstraints = () => {
    const constraints = noiseSettingsUI.getAudioConstraints();

    if (selectedInputDeviceId && selectedInputDeviceId !== 'default') {
        return {
            ...constraints,
            deviceId: { exact: selectedInputDeviceId },
        };
    }

    return constraints;
};

const getCameraConstraints = () =>
    selectedCameraDeviceId && selectedCameraDeviceId !== 'default'
        ? { deviceId: { exact: selectedCameraDeviceId } }
        : true;

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
const PAGE_STORAGE_VERSION = 2;
const LEGACY_PAGE_STORAGE_VERSIONS = [1];
const PAGE_LAYOUT_STORAGE_KEY_PREFIX = 'voicePageLayout:v4';
const MEDIA_DOCK_LAYOUT_ITEM_ID = 'page-mediaControlsPanel';
const MEDIA_DOCK_DEFAULT_GRID = Object.freeze({ x: 0, y: 12, w: 4, h: 6 });
const PINNED_TILE_Z_INDEX_BASE = 10000;
const PAGE_SINGLETON_TYPES = new Set(
    getPanelRegistry().map((panel) => panel.id)
);
const REAL_DOM_PAGE_TYPES = PAGE_SINGLETON_TYPES;
const PAGE_TILE_MIN_WIDTH = 160;
const PAGE_TILE_MIN_HEIGHT = 80;
let pageLayoutBoard;
let pageLayoutRuntime;
let pageLayoutStoreRuntime;
let chatPanelRuntime;
let sidebarRuntime;
let mediaDockAdapter;
let mediaDockRuntime;

const notifyMediaDock = () => mediaDockAdapter?.notify();

const updateLayoutItemConfig = (id, patch) => {
    const item = getTileLayoutItem(id);
    if (!item) {
        return;
    }
    item.config = normalizeComponentConfig(item.type, {
        ...item.config,
        ...patch,
    });
    setTileLayoutItem(item);
    saveLayoutToStorage('配置已更新');
};

const getLayoutPreference = (key) =>
    pageLayoutStoreRuntime?.getLayoutPreference(key);
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
let pendingVoiceRoomId;
let callStartedAt;
let callDurationTimer;
let outputMuted = false;
let outputVolume = 1;
let selectedInputDeviceId = 'default';
let selectedCameraDeviceId = 'default';
let selectedOutputDeviceId = 'default';
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
let localVoiceMediaGeneration = 0;
let localVoiceSessionGeneration = 0;
let screenShareRequestPending = false;
const localMediaTrackStopper = voiceMediaLifecycle.createTrackStopper();
const voiceMediaDebug = voiceCallProtocol.createMediaDebugLog();
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
        stopStream: (stream) => localMediaTrackStopper.stopStream(stream),
    });
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
    attachRemoteStream: ({ generation, metadata, peerId, stream }) =>
        addVideoStream(document.createElement('video'), stream, peerId, {
            generation,
            trackRoles:
                metadata?.[voiceCallProtocol.MEDIA_TRACK_ROLES_METADATA] || [],
        }),
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
            addVideoStream(document.createElement('video'), null, peerId);
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
        screenShareVolumeController.cleanup(peerId);
        voiceMediaQualityRuntime?.stop(peerId, 'peer-cleanup', {
            remove: true,
        });
    },
    onRemoteMediaState: ({ peerId }) =>
        voiceMediaQualityRuntime?.syncPeer(peerId),
    onWarning: (message, error) => console.warn(message, error || ''),
    removeRemoteTile: ({ peerId, tile }) => removeRemoteTile(peerId, tile),
});
voiceMediaQualityRuntime = voiceMediaQualityRuntimeApi.createRuntime({
    debug: (event) => voiceMediaDebug.record(event),
    getQualitySource: (peerId) => {
        const snapshot = voicePeerRegistry.getQualitySource(peerId);
        const tile = snapshot?.tile || document.getElementById(peerId);
        const playbackStream =
            screenShareVolumeController.getPrimaryStream(peerId) ||
            snapshot?.stream;
        return {
            ...snapshot,
            isScreenSharing: screenSharers.has(peerId),
            stream: playbackStream,
            video: tile?.querySelector('video'),
        };
    },
    view: voiceMediaQualityView,
});
window.exportVoiceMediaDebug = () => voiceMediaDebug.export();
let tileLayoutZIndex = TILE_BASE_Z_INDEX;
let layoutEditMode = false;
let layoutLocked = false;
let pageLayoutEditorRuntime;
let pageLayoutComponentRuntime;
const layoutResizeBoundBoards = new WeakSet();
const activeLayoutInteractionCancels = new Set();
let noiseAudioContext = null;
let noiseProcessorNode = null;
// eslint-disable-next-line no-unused-vars
let noiseProcessorActive = false;
let noiseRawStream = null;
let noiseMode = 'raw';
let noiseGainNode = null;
let micPermissionDenied = false;

// eslint-disable-next-line no-undef
viewingRoomId = ROOM_ID;
// eslint-disable-next-line no-undef
selectedVoiceRoomId = ROOM_ID;

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

const CORE_PAGE_TYPES = getPanelRegistry().map((panel) => panel.id);

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

const syncLayoutEditModeUI = () => pageLayoutEditorRuntime?.syncEditModeUI();

const setLayoutEditMode = (enabled) =>
    pageLayoutEditorRuntime?.setEditMode(enabled);

const setLayoutLocked = (locked) => {
    layoutLocked = Boolean(locked);
    mainLayout?.classList.toggle('is-layout-locked', layoutLocked);
    pageLayoutBoard?.classList.toggle('is-layout-locked', layoutLocked);
    resetLayoutResizeCursor();
    syncLayoutEditModeUI();
};

const toggleLayoutLocked = () => {
    setLayoutLocked(!layoutLocked);
};

const updateMobileTileView = () => mobileRoomController.updateTileView();

const setMobileRoomView = (isInRoom) =>
    mobileRoomController.setRoomView(isInRoom);

const updateMobileRoomState = () => {
    mobileRoomController.updateRoomState(Boolean(joinedVoiceRoomId));
};

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
        aiNoiseEnabled: noiseSettingsUI.getAiExperimentEnabled(),
        aiNoiseSupported: isAiExperimentSupported(),
        availableCameras: mediaDevicesCache.camera,
        availableMicrophones: mediaDevicesCache.mic,
        availableOutputs: mediaDevicesCache.output,
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
        microphoneEnabled: Boolean(
            microphoneTrack?.readyState === 'live' && microphoneTrack.enabled
        ),
        microphoneError: mediaErrors.microphone,
        microphoneGain: noiseSettingsUI.getMicGain(),
        microphonePending: Boolean(microphoneOperation.promise),
        microphonePermissionState:
            micPermissionDenied ||
            microphoneOperation.errorType === 'permission-denied'
                ? 'denied'
                : microphoneTrack?.readyState === 'live'
                  ? 'granted'
                  : 'prompt',
        noiseMode,
        noiseSuppressionEnabled: noiseSettingsUI.getNoiseSuppressionEnabled(),
        outputMuted,
        outputSelectionUnsupported: !canSelectAudioOutput(),
        outputVolume,
        screenShareEnabled: Boolean(sharingNow),
        screenShareError: mediaErrors.screen,
        screenSharePending:
            screenShareRequestPending || Boolean(screenOperation.promise),
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

const canSelectAudioOutput = () =>
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';

const applyOutputDevice = async (mediaElement, isRemote) => {
    if (!isRemote || !mediaElement || !canSelectAudioOutput()) {
        return true;
    }

    const sinkId = selectedOutputDeviceId || 'default';

    if (mediaElement.dataset.outputSinkId === sinkId) {
        return true;
    }

    const result = await voiceDeviceRuntimeApi.switchOutputDevice({
        deviceId: sinkId,
        mediaElement,
        supported: canSelectAudioOutput(),
    });
    if (result.ok) {
        voiceStatusView.clearMediaError('output');
        notifyMediaDock();
        return true;
    }
    voiceMediaDebug.record({
        errorType: result.errorType,
        event: 'device-output-fallback',
    });
    selectedOutputDeviceId = 'default';
    voiceDeviceRuntime?.setSelected('output', 'default');
    voiceStatusView.setMediaError('output', result.errorType);
    notifyMediaDock();
    console.warn(
        'Could not switch output device; falling back to default.',
        result.error
    );
    if (!result.fallbackApplied) {
        console.warn('Could not restore the default output device.');
    }
    return false;
};

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

    return applyOutputDevice(mediaElement, isRemote);
};

const applyScreenShareOutputSettings = (
    mediaElement,
    { muted = false, volume = 1 } = {}
) => {
    if (!mediaElement) {
        return;
    }
    mediaElement.volume = outputVolumeState.getEffectiveOutputVolume(
        outputVolume,
        volume
    );
    mediaElement.muted = outputMuted || Boolean(muted);
    return applyOutputDevice(mediaElement, true);
};

const getPrimaryTileMediaElement = (tile) =>
    tile?.querySelector('video') ||
    Array.from(tile?.querySelectorAll('audio') || []).find(
        (element) => !element.classList.contains('screen-share-audio')
    );

const applyOutputSettingsToRemoteMedia = () => {
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
        selectedOutputDeviceId = selected.output;
        notifyMediaDock();
    },
    onMissing: ({ type }) => handleMissingMediaDevice(type),
});

const refreshMediaDeviceLists = () => voiceDeviceRuntime.refresh();

const selectInputDevice = async (deviceId = 'default') => {
    const previousDeviceId = selectedInputDeviceId;
    selectedInputDeviceId = deviceId;
    voiceDeviceRuntime.setSelected('mic', deviceId);
    notifyMediaDock();

    if (
        mediaOperationController.getSnapshot().desired.microphone &&
        currentPeer &&
        !currentPeer.destroyed
    ) {
        if (mediaOperationController.getSnapshot('microphone').promise) {
            mediaOperationController.invalidate('microphone', {
                state: 'switching',
            });
        }
        const switched = await restartLocalMicrophone(currentPeer, {
            preserveOldTrack: true,
        });
        if (!switched) {
            selectedInputDeviceId = previousDeviceId;
            voiceDeviceRuntime.setSelected('mic', previousDeviceId);
            notifyMediaDock();
        }
    }
};

const selectCameraDevice = async (deviceId = 'default') => {
    const previousDeviceId = selectedCameraDeviceId;
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
        if (!switched) {
            selectedCameraDeviceId = previousDeviceId;
            voiceDeviceRuntime.setSelected('camera', previousDeviceId);
            notifyMediaDock();
        }
    }
};

const selectOutputDevice = async (deviceId = 'default') => {
    selectedOutputDeviceId = deviceId;
    voiceDeviceRuntime.setSelected('output', deviceId);
    notifyMediaDock();
    await applyOutputSettingsToRemoteMedia();
    notifyMediaDock();
};

const resetLocalVoiceState = () => {
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
        chatPanelRuntime?.destroy();
        sidebarRuntime?.destroy();
        mediaDockRuntime?.destroy();
        mediaDockAdapter?.destroy();
        remoteVolumeUI.destroy();
        screenShareVolumeController.destroy();
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
    if (!voiceMediaTargets.has(peerId)) {
        return undefined;
    }

    return voicePeerRegistry.callPeer({
        generation,
        options: {
            ...options,
            metadata: {
                ...getVoiceCallMetadata(stream),
                ...options.metadata,
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
    activeSocket.off('voice:call-targets', handleSocketVoiceCallTargets);
    activeSocket.off('voice:peer-joined', handleSocketVoicePeerJoined);
    activeSocket.off('removeUserVideo', handleSocketRemoveUserVideo);
    activeSocket.on('voice:call-targets', handleSocketVoiceCallTargets);
    activeSocket.on('voice:peer-joined', handleSocketVoicePeerJoined);
    activeSocket.on('removeUserVideo', handleSocketRemoveUserVideo);
};

const getChatName = () =>
    chatPanelRuntime?.getDisplayName() || chatNameState.getStoredChatName();

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

const reconcilePresenceState = ({
    channels = [],
    clientSessionEpoch,
    voiceSessionGeneration,
} = {}) => {
    const session = voiceSessionRuntime.getSnapshot();
    const currentVoiceSnapshot =
        session.desiredVoiceState !== 'joined' ||
        (clientSessionEpoch === session.epoch &&
            voiceSessionGeneration === session.serverGeneration);

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
                if (voiceSessionRuntime.isCurrent(epoch)) {
                    voiceSessionRuntime.fail(
                        result?.reason || 'voice-join-rejected'
                    );
                }
                return false;
            }

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

    socket.on('cursor:move', renderRemoteCursor);
    socket.on('cursor:leave', markRemoteCursorIdle);
    socket.on('cursor:remove', removeRemoteCursor);
    socket.on('screen:share', ({ peerId, roomId, sharing } = {}) => {
        if (
            roomId !== joinedVoiceRoomId ||
            !peerId ||
            typeof sharing !== 'boolean'
        ) {
            return;
        }

        if (sharing) {
            screenSharers.add(peerId);
        } else {
            screenSharers.delete(peerId);
        }
        if (sharing && getLayoutPreference('autoShowScreenShare')) {
            const tile = document.getElementById(peerId);
            if (tile && tile.classList.contains('is-layout-hidden')) {
                setTileLayoutItemVisibility(tile.dataset.layoutItemId, true);
                tile.classList.remove('is-layout-hidden');
                bringTileLayoutToFront(tile);
            }
        }
        updateAllVideoTileStatus();
        voiceMediaQualityRuntime?.syncPeer(peerId);
        updateMobileTileView();
    });
    socket.on('connect', () => {
        const transport = socket.io?.engine?.transport?.name || 'unknown';
        voiceMediaDebug.record({ event: 'socket-connect', transport });
        chatPanelRuntime?.setConnectionState('connected');
        chatPanelRuntime?.rejoinCurrentRoom();
        if (voiceSessionRuntime.socketConnected('socket-connect')) {
            void restoreServerVoiceOwner('socket-connect');
        }
        socket.io?.engine?.once?.('upgrade', (nextTransport) => {
            voiceMediaDebug.record({
                event: 'socket-transport-upgrade',
                transport: nextTransport?.name || 'unknown',
            });
        });
    });
    socket.on('disconnect', (reason) => {
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
        voiceSessionRuntime.fail('socket-reconnect-failed');
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

const requestRawAudioStream = async ({ allowBasicFallback = true } = {}) => {
    let rawStream;

    try {
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
        });
    } catch (error) {
        if (!allowBasicFallback) {
            throw error;
        }
        console.warn(
            'Could not start microphone with enhanced constraints; retrying with basic audio.',
            error
        );
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
    }

    return rawStream;
};

const requestAudioStream = async ({ rawOnly = false, ...options } = {}) => {
    const rawStream = await requestRawAudioStream(options);
    if (rawOnly) {
        return rawStream;
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
        localMediaTrackStopper.stopStream(noiseRawStream);
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

const isPanelTilePinned = (tile) => {
    if (!tile?.dataset?.pageLayoutType) {
        return false;
    }

    return (
        tile.classList.contains('is-panel-pinned') ||
        getTileLayoutItem(tile.dataset.layoutItemId)?.config?.pinned === true
    );
};

const normalizeTileLayoutZIndex = (value, { pinned = false } = {}) => {
    const zIndex = Number(value);
    const baseZIndex = pinned ? PINNED_TILE_Z_INDEX_BASE : TILE_BASE_Z_INDEX;

    return Number.isFinite(zIndex) && zIndex >= baseZIndex
        ? Math.round(zIndex)
        : baseZIndex;
};

const getTileLayoutZIndex = (tile) =>
    normalizeTileLayoutZIndex(
        tile.style.zIndex || window.getComputedStyle(tile).zIndex,
        { pinned: isPanelTilePinned(tile) }
    );

const applyTileLayoutZIndex = (tile, zIndex) => {
    tile.style.zIndex = String(
        normalizeTileLayoutZIndex(zIndex, {
            pinned: isPanelTilePinned(tile),
        })
    );
};

const getNextTileLayoutZIndexForBand = (pinned = false) => {
    const baseZIndex = pinned ? PINNED_TILE_Z_INDEX_BASE : TILE_BASE_Z_INDEX;
    const highestTileZIndex = getVideoTiles().reduce((highest, candidate) => {
        const candidateZIndex = getTileLayoutZIndex(candidate);

        if (pinned) {
            return isPanelTilePinned(candidate)
                ? Math.max(highest, candidateZIndex)
                : highest;
        }

        return candidateZIndex < PINNED_TILE_Z_INDEX_BASE
            ? Math.max(highest, candidateZIndex)
            : highest;
    }, baseZIndex);

    tileLayoutZIndex = Math.max(tileLayoutZIndex, highestTileZIndex) + 1;

    return tileLayoutZIndex;
};

const getNextTileLayoutZIndex = (tile) =>
    getNextTileLayoutZIndexForBand(isPanelTilePinned(tile));

const getLayoutBoardForTile = (tile) => {
    if (tile && !tile.dataset.pageLayoutType && videoGrid?.contains(tile)) {
        return videoGrid;
    }

    return pageLayoutBoard || videoGrid;
};

const getPanelCollapsedHeight = () => {
    const boardHeight =
        getLayoutBoardForTile()?.getBoundingClientRect?.().height ||
        window.innerHeight ||
        PANEL_COLLAPSED_HEIGHT;

    return Math.max(32, Math.round(boardHeight / PAGE_GRID_ROWS));
};

const getTileMinimumSize = (tile) => {
    const panelConfig = getPanelConfig(tile?.dataset?.pageLayoutType);
    const collapsed =
        tile?.classList?.contains('is-panel-collapsed') ||
        tile?.dataset?.panelCollapsing === 'true';

    return {
        width: panelConfig?.minWidth || PAGE_TILE_MIN_WIDTH,
        height: collapsed
            ? getPanelCollapsedHeight()
            : panelConfig?.minHeight || PAGE_TILE_MIN_HEIGHT,
    };
};

const bringTileLayoutToFront = (tile) => {
    if (!tile || fullscreenControls.isTileLayoutWriteBlocked(tile)) {
        return;
    }

    applyTileLayoutZIndex(tile, getNextTileLayoutZIndex(tile));
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

const getLayoutSnapContext = (tile) => {
    const minimumSize = getTileMinimumSize(tile);

    return {
        board: getLayoutBoardForTile(tile),
        columns: PAGE_GRID_COLUMNS,
        rows: PAGE_GRID_ROWS,
        minGridW: LAYOUT_MIN_GRID_W,
        minGridH: LAYOUT_MIN_GRID_H,
        minTileWidth: minimumSize.width,
        minTileHeight: minimumSize.height,
        normalizeZIndex: normalizeTileLayoutZIndex,
        findTileForLayoutItem,
        getCurrentTileLayout,
        applyTileLayout,
        applyTileLayoutItemToElement,
        setLayoutItem: setTileLayoutItem,
        getContextForTile: getLayoutSnapContext,
    };
};

const getTileBounds = (tile) =>
    layoutSnapUtils.getTileBounds(getLayoutSnapContext(tile));

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

const isLegacyMediaDockGrid = (item = {}) => {
    const width = Number(item.w);
    const height = Number(item.h);

    return (
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        (width >= 8 || height <= 3)
    );
};

const migrateLoadedLayoutItem = ({
    item,
    itemId,
    payloadVersion,
    type,
} = {}) => {
    if (
        Number(payloadVersion) >= PAGE_STORAGE_VERSION ||
        type !== PAGE_COMPONENT_TYPES.MEDIA_CONTROLS_PANEL ||
        itemId !== MEDIA_DOCK_LAYOUT_ITEM_ID ||
        !isLegacyMediaDockGrid(item)
    ) {
        return item;
    }

    return {
        ...item,
        ...MEDIA_DOCK_DEFAULT_GRID,
        visible: true,
    };
};

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

    forEachTileLayoutItem((item) => {
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
        getLayoutSnapContext(tile)
    );

    layoutEditUI.showSnapPreview({
        board: getLayoutBoardForTile(tile),
        tile,
        layout: snappedLayout,
    });
};

const hideSnapPreview = () => layoutEditUI.hideSnapPreview();

const finalizeLayoutEditing = () => {
    setLayoutEditMode(false);
    hideSnapPreview();
    resetLayoutResizeCursor();

    try {
        layoutSnapUtils.snapAllLayoutItemsToGrid(
            getTileLayoutItemsRegistry(),
            getLayoutSnapContext()
        );
        saveLayoutToStorage('布局已吸附');
    } catch (error) {
        console.warn('[page-layout] finalize layout failed after exit', error);
    }
};

const getLayoutStorageKey = () =>
    layoutStorage.getLayoutStorageKey({
        prefix: PAGE_LAYOUT_STORAGE_KEY_PREFIX,
        roomId: viewingRoomId || selectedVoiceRoomId || 'default',
    });

const serializeLayoutItems = () => pageLayoutStoreRuntime?.serialize() || [];

const loadLayoutFromStorage = () =>
    pageLayoutStoreRuntime?.loadLayoutFromStorage() || [];

const getSavedLayoutItemPreference = (itemId) =>
    pageLayoutStoreRuntime?.getSavedItem(itemId);

const getSavedRemoteLayoutItemPreference = (peerId, member, preferredId) =>
    pageLayoutStoreRuntime?.getSavedRemoteItem(peerId, member, preferredId);

const showLayoutSaveStatus = (message) =>
    pageLayoutEditorRuntime?.showSaveStatus(message);

const saveLayoutToStorage = (message = '已保存') => {
    pageLayoutStoreRuntime?.saveLayoutToStorage(message);
};

const clearSavedLayout = () => {
    pageLayoutStoreRuntime?.clearSavedLayout();
};

const clampTileLayout = (layout) =>
    layoutSnapUtils.clampTileLayout(layout, getLayoutSnapContext());

const clampTileLayoutForTile = (tile, layout) =>
    layoutSnapUtils.clampTileLayout(layout, getLayoutSnapContext(tile));

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

    return (
        voiceMediaLifecycle.getLiveTracks(mediaElement?.srcObject).length > 0
    );
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

const getTileLayoutItem = (itemId) => pageLayoutStoreRuntime?.getItem(itemId);

const setTileLayoutItem = (item) => pageLayoutStoreRuntime?.setItem(item);

const forEachTileLayoutItem = (callback) => {
    pageLayoutStoreRuntime?.forEachItem(callback);
};

const getTileLayoutItemsRegistry = () => pageLayoutStoreRuntime?.getRegistry();

const upsertTileLayoutItem = (tile, updates = {}) =>
    pageLayoutStoreRuntime?.upsertTileLayoutItem(tile, updates);

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
    tile.classList.toggle(
        'is-panel-collapsed',
        item.config?.collapsed === true
    );
    tile.classList.toggle('is-panel-pinned', item.config?.pinned === true);
    tile.dataset.panelCollapsed = String(item.config?.collapsed === true);
    tile.dataset.panelPinned = String(item.config?.pinned === true);

    if (applyPosition) {
        applyTileLayout(
            tile,
            item.config?.collapsed === true
                ? { ...item.layout, height: getPanelCollapsedHeight() }
                : item.layout,
            { syncItem: false }
        );
    } else {
        applyTileLayoutZIndex(tile, item.layout.zIndex);
    }

    pageLayoutRuntime?.syncPanelActions(tile);
};

const syncTileLayoutItemFromElement = (tile, updates = {}) =>
    pageLayoutStoreRuntime?.syncTileLayoutItemFromElement(tile, updates);

const persistTileLayoutItem = (tile) =>
    pageLayoutStoreRuntime?.persistTileLayoutItem(tile);

const setTileLayoutItemVisibility = (
    itemId,
    visible,
    { syncElement = true } = {}
) => {
    pageLayoutStoreRuntime?.setItemVisibility(itemId, visible, {
        syncElement,
    });
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
    pageLayoutStoreRuntime?.retirePreviousTileLayoutItem(tile, nextItemId);
};

const applyTileLayout = (tile, layout, { syncItem = true } = {}) => {
    const next = clampTileLayoutForTile(tile, layout);

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
    const board = getLayoutBoardForTile(tile);
    const tileRect = tile.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();

    return clampTileLayoutForTile(tile, {
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
        getLayoutSnapContext(tile)
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
    setTileLayoutItem(item);
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
        if (
            tile.classList.contains('is-positioned') &&
            !fullscreenControls.isTileLayoutWriteBlocked(tile)
        ) {
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
        const memberCount =
            sidebarRuntime?.getRoomMemberCount(
                viewingRoomId || joinedVoiceRoomId
            ) || 0;

        return {
            channelName,
            joinedVoiceRoomId,
            memberCount,
        };
    }

    if (type === LAYOUT_ITEM_TYPES.CHAT) {
        return {
            chatMessages: chatPanelRuntime?.getMessagePreviews(3) || [],
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

const hideLayoutComponent = (tile) => {
    const panelConfig = getPanelConfig(tile?.dataset?.pageLayoutType);

    if (panelConfig?.canHide === false) {
        return;
    }

    pageLayoutComponentRuntime?.hideLayoutComponent(tile);
};

const applyDefaultLayout = () =>
    pageLayoutComponentRuntime?.applyDefaultLayout();

const initializeLayoutFromStorage = () =>
    pageLayoutComponentRuntime?.initializeLayoutFromStorage();

const renderLayoutComponentMenu = () =>
    pageLayoutEditorRuntime?.renderComponentMenu();

const getLayoutItemForTile = (tile) =>
    getTileLayoutItem(tile?.dataset.layoutItemId || tile?.dataset.layoutId);

const isRegisteredPanelItem = (item) => PAGE_SINGLETON_TYPES.has(item?.type);

const getPanelConfigForTile = (tile) =>
    getPanelConfig(tile?.dataset?.pageLayoutType);

const savePanelItemState = (tile, { config, layout, message } = {}) => {
    const item = getLayoutItemForTile(tile);

    if (!tile || !item || !isRegisteredPanelItem(item)) {
        return null;
    }

    const nextLayout = layout || getCurrentTileLayout(tile);
    const nextConfig = normalizeComponentConfig(item.type, {
        ...item.config,
        ...config,
    });
    const nextItem = upsertTileLayoutItem(tile, {
        layout: nextLayout,
        visible: item.visible !== false,
        positioned: true,
        config: nextConfig,
    });

    applyTileLayoutItemToElement(tile, nextItem, {
        applyPosition: false,
    });
    saveLayoutToStorage(message || '布局已更新');
    positionLayoutComponentToolbar(tile);
    return nextItem;
};

const togglePanelCollapse = (tile) => {
    const panelConfig = getPanelConfigForTile(tile);
    const item = getLayoutItemForTile(tile);

    if (!panelConfig || panelConfig.canCollapse === false || !item) {
        return;
    }

    const currentLayout = getCurrentTileLayout(tile);
    const collapsed = item.config?.collapsed === true;
    const expandedHeight = Math.max(
        panelConfig.minHeight || PAGE_TILE_MIN_HEIGHT,
        Number(item.config?.expandedHeight) || currentLayout.height
    );
    const nextLayout = collapsed
        ? { ...currentLayout, height: expandedHeight }
        : { ...currentLayout, height: getPanelCollapsedHeight() };

    tile.dataset.panelCollapsing = String(!collapsed);
    applyTileLayout(tile, nextLayout, { syncItem: false });
    savePanelItemState(tile, {
        layout: nextLayout,
        config: {
            collapsed: !collapsed,
            expandedHeight: collapsed ? expandedHeight : currentLayout.height,
        },
        message: collapsed ? '面板已展开' : '面板已收起',
    });
    delete tile.dataset.panelCollapsing;
};

const togglePanelPin = (tile) => {
    const panelConfig = getPanelConfigForTile(tile);
    const item = getLayoutItemForTile(tile);

    if (!panelConfig || panelConfig.canPin === false || !item) {
        return;
    }

    const pinned = item.config?.pinned === true;
    const nextPinned = !pinned;
    const nextConfig = { pinned: nextPinned };
    const currentLayout = item.layout || getCurrentTileLayout(tile);
    const nextLayout = {
        ...currentLayout,
        zIndex: getNextTileLayoutZIndexForBand(nextPinned),
    };

    savePanelItemState(tile, {
        layout: nextLayout,
        config: nextConfig,
        message: pinned ? '已取消固定' : '已固定置顶',
    });
};

const isTileFreeMoveEnabled = (tile) =>
    getLayoutItemForTile(tile)?.config?.freeMove === true;

const canDragLayoutItem = (item) => {
    if (isRegisteredPanelItem(item)) {
        return !layoutLocked && getPanelConfig(item.type)?.canDrag !== false;
    }

    return layoutEditMode || item?.config?.freeMove === true;
};

const canResizeLayoutItem = (item) => {
    if (isRegisteredPanelItem(item)) {
        return (
            !layoutLocked &&
            layoutEditMode &&
            getPanelConfig(item.type)?.canResize !== false
        );
    }

    return layoutEditMode || item?.config?.freeMove === true;
};

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
                '.panel-shell-actions',
                '.panel-action-button',
                '.fullscreen-btn',
            ].join(', ')
        )
    );

const isLayoutDragHandleTarget = (event, tile) => {
    const handle = event.target?.closest?.('[data-drag-handle="true"]');

    if (!handle || !tile?.contains?.(handle)) {
        return false;
    }

    return handle.closest?.('.video-tile') === tile;
};

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
        .filter(
            (tile) =>
                !layoutEditMode ||
                tile.parentElement === pageLayoutBoard ||
                tile.dataset.pageLayoutType
        )
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
        !isLayoutDragHandleTarget(event, tile) ||
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

    const finishInteraction = (persist = true) => {
        if (finished) {
            return;
        }

        finished = true;
        if (tile.hasPointerCapture?.(event.pointerId)) {
            tile.releasePointerCapture(event.pointerId);
        }
        tile.classList.remove('is-dragging');
        if (persist) {
            finishTileLayoutInteraction(tile);
        } else {
            hideSnapPreview();
            resetLayoutResizeCursor();
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        activeLayoutInteractionCancels.delete(cancelInteraction);
    };
    const onEnd = () => finishInteraction(true);
    const cancelInteraction = () => finishInteraction(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    activeLayoutInteractionCancels.add(cancelInteraction);
};

const resolveTileResizeLayout = (
    tile,
    startLayout,
    direction,
    deltaX,
    deltaY
) => {
    const minimumSize = getTileMinimumSize(tile);
    const nextLayout = layoutResizeUtils.resolveTileResizeLayout({
        bounds: getTileBounds(tile),
        deltaX,
        deltaY,
        direction,
        minHeight: minimumSize.height,
        minWidth: minimumSize.width,
        startLayout,
    });

    return clampTileLayoutForTile(tile, nextLayout);
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
            tile,
            startLayout,
            direction,
            moveEvent.clientX - startX,
            moveEvent.clientY - startY
        );
        applyTileLayout(tile, nextLayout);
        showSnapPreview(tile, nextLayout);
        positionLayoutComponentToolbar(tile);
    };

    const finishInteraction = (persist = true) => {
        if (finished) {
            return;
        }

        finished = true;
        if (tile.hasPointerCapture?.(event.pointerId)) {
            tile.releasePointerCapture(event.pointerId);
        }
        tile.classList.remove('is-resizing');
        resetLayoutResizeCursor();
        if (persist) {
            finishTileLayoutInteraction(tile);
        } else {
            hideSnapPreview();
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        activeLayoutInteractionCancels.delete(cancelInteraction);
    };
    const onEnd = () => finishInteraction(true);
    const cancelInteraction = () => finishInteraction(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    activeLayoutInteractionCancels.add(cancelInteraction);
};

const cancelActiveLayoutInteractions = () => {
    Array.from(activeLayoutInteractionCancels).forEach((cancel) => cancel());
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
                const shouldIgnoreTarget = shouldIgnoreLayoutDragTarget(
                    event.target
                );
                const resizeDirection = shouldIgnoreTarget
                    ? null
                    : detectTileResizeDirection(event, tile);

                if (resizeDirection) {
                    setActiveLayoutToolbarTile(tile);
                    startTileResize(event, tile, resizeDirection);
                    return;
                }

                bringTileLayoutToFront(tile);
                setActiveLayoutToolbarTile(tile);

                if (
                    !shouldIgnoreTarget &&
                    isLayoutDragHandleTarget(event, tile) &&
                    canDragLayoutItem(getLayoutItemForTile(tile))
                ) {
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
                isLayoutDragHandleTarget(event, tile) &&
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

pageLayoutStoreRuntime = layoutStoreRuntime.createRuntime({
    document,
    logger: console,
    layoutStorage,
    version: PAGE_STORAGE_VERSION,
    columns: PAGE_GRID_COLUMNS,
    rows: PAGE_GRID_ROWS,
    layoutItemTypes: LAYOUT_ITEM_TYPES,
    pageComponentTypes: PAGE_COMPONENT_TYPES,
    supportedStorageVersions: LEGACY_PAGE_STORAGE_VERSIONS,
    getSingletonTypes: () => PAGE_SINGLETON_TYPES,
    getLayoutStorageKey,
    getDefaultLayoutPreferences,
    normalizeLayoutPreferences,
    getLayoutPreferenceValue,
    clampGridLayout,
    normalizeZIndex: normalizeTileLayoutZIndex,
    normalizeComponentConfig,
    normalizeLayoutItemType,
    getLegacyRemoteLayoutPeerId,
    normalizeRemotePeerLayoutId,
    normalizeAutoLayoutGrid,
    getRemoteLayoutAliasIds,
    getFallbackTileLayoutForType,
    migrateLoadedLayoutItem,
    normalizeTileLayout,
    convertTileLayoutToGrid,
    getTileLayoutItemId,
    getCurrentTileLayout,
    applyTileLayoutItemToElement,
    isRemoteLayoutAliasForTile,
    showLayoutSaveStatus,
});

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
    getSavedLayoutItems: () => pageLayoutStoreRuntime?.getSavedItems() || [],
    isLayoutStorageHydrating: () =>
        pageLayoutStoreRuntime?.isHydrating() || false,
    setLayoutStorageHydrating: (hydrating) =>
        pageLayoutStoreRuntime?.setHydrating(hydrating),
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
    onToggleLayoutLock: toggleLayoutLocked,
    isLayoutLocked: () => layoutLocked,
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
    getPanelRegistry,
    getPanelConfig,
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
    onHidePanel: hideLayoutComponent,
    onTogglePanelCollapse: togglePanelCollapse,
    onTogglePanelPin: togglePanelPin,
    loadLayoutFromStorage,
    clearSavedLayout,
    initializeLayoutFromStorage,
    ensureLayoutEditModeToggle,
    syncLayoutEditModeUI,
    getVideoTiles,
    serializeLayoutItems,
    setLayoutEditMode,
    setLayoutLocked,
    cancelLayoutInteractions: cancelActiveLayoutInteractions,
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
    const isScreenShare =
        tile.dataset.tileType === 'screen-share' || screenSharers.has(peerId);

    if (isScreenShare) {
        const snapshot = screenShareVolumeController.getSnapshot(peerId);
        remoteVolumeUI.openPopover({
            currentVolume: Math.round(snapshot.volume * 100),
            disabled: !snapshot.hasAudio,
            emptyText: '无共享音频',
            event,
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
        return;
    }

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
        isLayoutEditing: layoutEditMode,
        isScreenShare,
        showNameLabel: isScreenShare || showPeerName,
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

        voicePeerRegistry.ensurePeerTile(peerId);

        if (!shouldAutoShow) {
            const tile = document.getElementById(peerId);
            if (tile) {
                tile.classList.add('is-layout-hidden');
                setTileLayoutItemVisibility(tile.dataset.layoutItemId, false);
            }
        }
    } else {
        voicePeerRegistry.ensurePeerTile(peerId);
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

    const forceRebind = Boolean(
        hasVideo &&
            mediaElement.srcObject === playbackStream &&
            mediaElementVideoTracks.get(mediaElement) !== liveVideoTrack
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
    if (hasVideo) {
        mediaElementVideoTracks.set(mediaElement, liveVideoTrack);
    } else {
        mediaElementVideoTracks.delete(mediaElement);
    }
    applyOutputSettings(mediaElement, Boolean(videoId));
    updateVideoTileStatus(tile);
    if (videoId) {
        voiceMediaQualityRuntime?.syncPeer(videoId);
    }
    updateFullscreenButtonStates();
    console.info('[tile] add/update', {
        peerId: tile.dataset.peerId,
        layoutId: tile.dataset.layoutId,
        hasVideo,
    });
    resetAutoTileLayoutHeights();
    updateMobileTileView();
    return tile;
};

initializeLayoutFromStorage();

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

        voicePeerRegistry.answerCall({ call });
    });
};
// ----------------------------------------------------------------------------------

// switching between sharing screen and not sharing
var sharingNow = false;
let currentScreenStream;
let currentScreenShareSession;

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

    localVoiceMediaGeneration += 1;
    const stream = getActiveStream();
    voiceMediaDebug.record({
        event: 'local-media-snapshot',
        generation: localVoiceMediaGeneration,
        sharing: sharingNow,
        tracks: voiceCallProtocol.describeTracks(stream),
    });

    voiceMediaTargets.forEach((peerId) =>
        publishLocalMediaToPeer(peer, peerId, stream, {
            generation: localVoiceMediaGeneration,
        })
    );
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
        voiceStatusView.setMediaError(type, result.errorType);
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
    const epoch = voiceSessionRuntime.getSnapshot().epoch;
    const pendingCamera = mediaOperationController.run(
        'camera',
        () =>
            navigator.mediaDevices.getUserMedia({
                video: getCameraConstraints(),
                audio: false,
            }),
        {
            epoch,
            state: preserveOldTrack ? 'switching' : 'requesting',
        }
    );
    notifyMediaDock();
    const result = await pendingCamera;
    setMediaOperationError('camera', result);
    if (
        result.ok &&
        mediaOperationController.getSnapshot('camera').token !== result.token
    ) {
        return true;
    }
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
    mediaOperationController.setActive('camera', nextStream);
    bindLocalTrackEnded('camera', nextTrack);
    voiceDeviceRuntime.setSelected(
        'camera',
        nextTrack.getSettings?.().deviceId || selectedCameraDeviceId
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

    if (cameraOperation.promise && cameraOperation.desired) {
        mediaOperationController.setDesired('camera', false);
        mediaOperationController.invalidate('camera');
        setCameraButtonState(false);
        return;
    }

    if (currentCameraTrack?.readyState === 'live') {
        mediaOperationController.setDesired('camera', false);
        mediaOperationController.invalidate('camera');
        stopLocalTrack('camera', currentCameraTrack);
        cameraStream = undefined;
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

const startScreenShare = async (peer, options = {}) => {
    if (screenShareRequestPending || sharingNow) {
        return false;
    }

    mediaOperationController.setDesired('screen', true);
    setScreenShareRequestPending(true);
    const capture = await mediaOperationController.run(
        'screen',
        async () => {
            const result = await voiceMediaLifecycle.requestScreenCapture({
                getDisplayMedia: requestDisplayMedia,
                options,
            });
            if (result.ok) {
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
        }
    );
    setScreenShareRequestPending(false);
    if (!capture.ok) {
        mediaOperationController.setDesired('screen', false);
        setMediaOperationError('screen', capture);
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
        return false;
    }

    setMediaOperationError('screen', capture);
    currentScreenStream = shareScreen;
    const screenShareSession = {
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

    emitScreenShareState(true, screenShareSession.voiceSessionGeneration);
    emitLocalPresenceUpdate();
    updateLocalUserCard();
    return true;
};

const stopScreenShare = (peer) => {
    if (screenShareRequestPending || !sharingNow) {
        return false;
    }

    mediaOperationController.setDesired('screen', false);
    mediaOperationController.invalidate('screen');
    const screenShareSession = currentScreenShareSession;
    stopCurrentScreenStream();
    emitScreenShareState(false, screenShareSession?.voiceSessionGeneration);
    restoreCameraAfterScreenShare(peer);
    emitLocalPresenceUpdate();
    return true;
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
    { preserveOldTrack = false, recovery = false } = {}
) => {
    const previousAudioTrack = myVideoStream?.getAudioTracks()[0];
    const wasMuted = Boolean(previousAudioTrack && !previousAudioTrack.enabled);
    const previousStream = myVideoStream;
    const epoch = voiceSessionRuntime.getSnapshot().epoch;
    const pendingMicrophone = mediaOperationController.run(
        'microphone',
        () =>
            requestAudioStream({
                allowBasicFallback:
                    !preserveOldTrack && selectedInputDeviceId === 'default',
                rawOnly: true,
            }),
        {
            epoch,
            state: preserveOldTrack ? 'switching' : 'requesting',
        }
    );
    notifyMediaDock();
    const rawResult = await pendingMicrophone;
    setMediaOperationError('microphone', rawResult);
    if (
        rawResult.ok &&
        mediaOperationController.getSnapshot('microphone').token !==
            rawResult.token
    ) {
        return true;
    }
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

    if (previousAudioTrack) {
        unbindLocalTrackEnded('microphone', previousAudioTrack);
    }
    destroyProcessedAudioStream();
    localMediaTrackStopper.stopStream(previousStream);
    let stream = rawResult.value;
    try {
        stream = await createAudioPipeline(rawResult.value);
    } catch (error) {
        console.warn('[audio] Pipeline init failed, using raw.', error);
    }
    if (
        !voiceSessionRuntime.isCurrent(epoch) ||
        mediaOperationController.getSnapshot('microphone').token !==
            rawResult.token
    ) {
        localMediaTrackStopper.stopStream(stream);
        localMediaTrackStopper.stopStream(rawResult.value);
        return false;
    }
    const nextAudioTrack = stream.getAudioTracks()[0];
    if (nextAudioTrack) {
        nextAudioTrack.enabled = recovery ? true : !wasMuted;
        bindLocalTrackEnded('microphone', nextAudioTrack);
        voiceDeviceRuntime.setSelected(
            'mic',
            nextAudioTrack.getSettings?.().deviceId || selectedInputDeviceId
        );
    }

    myVideoStream = stream;
    mediaOperationController.setActive('microphone', stream);
    localTrackEndedController.releaseRecovery('microphone', epoch);
    micPermissionDenied = false;
    setAudioButtonState(Boolean(nextAudioTrack?.enabled));
    setLocalVideoStream(getActiveStream());
    sendAudioTrackToPeers(peer, nextAudioTrack);
    emitLocalPresenceUpdate();
    updateLocalUserCard();
    voiceMediaDebug.record({
        epoch,
        event: recovery ? 'microphone-recovered' : 'microphone-started',
    });
    return true;
};

const resetAutoTileLayoutHeights = () => {
    getVideoTiles().forEach((tile) => {
        if (!tile.classList.contains('is-positioned')) {
            tile.style.height = '';
        }
    });
};

const initiateAudio = async (peer) => {
    mediaOperationController.setDesired('microphone', true);
    const started = await restartLocalMicrophone(peer);
    if (started) {
        refreshMediaDeviceLists();
        if (!callStartedAt) {
            startCallTimer();
        }
        bindPeerCallHandler(peer);
    }
};

const handleMicClick = async (peer) => {
    if (myVideoStream) {
        toggleAudio(myVideoStream);
        return;
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
        !desired[type] ||
        !localTrackEndedController.claimRecovery(type, epoch)
    ) {
        return false;
    }

    if (type === 'microphone') {
        if (myVideoStream?.getAudioTracks?.()[0] !== track) {
            localTrackEndedController.releaseRecovery('microphone', epoch);
            return false;
        }
        selectedInputDeviceId = 'default';
        voiceDeviceRuntime.setSelected('mic', 'default');
        setAudioButtonNoMic();
        const recovered = await restartLocalMicrophone(currentPeer, {
            recovery: true,
        });
        if (!recovered) {
            myVideoStream = undefined;
            setLocalVideoStream(getActiveStream());
            refreshVoiceCallsForLocalMedia(currentPeer);
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
            cameraStream = undefined;
            setActiveVideoTrack(currentPeer);
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
    if (type === 'mic') {
        selectedInputDeviceId = 'default';
        notifyMediaDock();
        if (
            mediaOperationController.getSnapshot().desired.microphone &&
            currentPeer &&
            !currentPeer.destroyed
        ) {
            return restartLocalMicrophone(currentPeer, {
                preserveOldTrack: true,
                recovery: true,
            });
        }
        return false;
    }
    if (type === 'camera') {
        selectedCameraDeviceId = 'default';
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
            const replacement = createPeerInstance(currentSession.roomId, {
                recreate: true,
            });
            return waitForPeerOpen(replacement);
        },
        onExhausted: () => voiceSessionRuntime.fail('peer-recovery-failed'),
    });
};

const createPeerInstance = (roomToJoin, { recreate = false } = {}) => {
    const isSecurePeerConnection = window.location.protocol === 'https:';
    const peerPort =
        window.location.port || (isSecurePeerConnection ? 443 : 80);

    // eslint-disable-next-line no-undef
    const peer = new Peer(undefined, {
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
    const nextRoomId = pendingVoiceRoomId;
    pendingVoiceRoomId = undefined;
    voiceSessionRuntime.leave({ reason });
    voiceMediaDebug.record({ event: 'teardown', reason });
    peerRetryController.reset(reason);
    mediaOperationController.setDesired('microphone', false);
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

    forEachTileLayoutItem((item) => {
        if (!PAGE_SINGLETON_TYPES.has(item.type)) {
            setTileLayoutItemVisibility(item.id, false);
        }
    });
    videoGrid.replaceChildren();
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
    selectedVoiceRoomId = roomId;
    setAudioButtonNoMic();
    setCameraButtonState(false);
    notifyMediaDock();
    syncRoomCompositionState();
    createPeerInstance(roomId);
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
        setTileLayoutItemVisibility(vidElement.dataset.layoutItemId, false);
        vidElement.remove();
        resetAutoTileLayoutHeights();
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

remoteVolumeUI.init();

fullscreenControls.bindFullscreenChange();

mobileBackToChannelsBtn?.addEventListener('click', () => {
    if (currentPeer && !currentPeer.destroyed) {
        mediaDockAdapter?.hangUp();
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
    onPresenceSnapshot: reconcilePresenceState,
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
        selectCamera: selectCameraDevice,
        selectMicrophone: selectInputDevice,
        selectOutput: selectOutputDevice,
        setMicrophoneGain: (micGainPercent) => {
            const nextGain = noiseSettingsUI.setMicGain(micGainPercent, {
                syncUI: false,
                onMicGainChange: (value) => {
                    if (noiseGainNode) {
                        noiseGainNode.gain.value = Math.max(0.001, value / 100);
                    }
                },
            });
            notifyMediaDock();
            return nextGain;
        },
        setOutputMuted: (muted) => {
            outputMuted = Boolean(muted);
            notifyMediaDock();
            return applyOutputSettingsToRemoteMedia();
        },
        setOutputVolume: (volume) => {
            outputVolume = Math.max(0, Math.min(1, Number(volume) || 0));
            notifyMediaDock();
            return applyOutputSettingsToRemoteMedia();
        },
        startScreenShare: (options) => startScreenShare(currentPeer, options),
        stopScreenShare: () => stopScreenShare(currentPeer),
        toggleAiNoiseSuppression: () => {
            noiseSettingsUI.setAiExperimentEnabled(
                !noiseSettingsUI.getAiExperimentEnabled()
            );
            notifyMediaDock();
            return true;
        },
        toggleCamera: () => toggleCamera(currentPeer),
        toggleMicrophone: () => handleMicClick(currentPeer),
        toggleNoiseSuppression: () => {
            noiseSettingsUI.setNoiseSuppressionEnabled(
                !noiseSettingsUI.getNoiseSuppressionEnabled()
            );
            notifyMediaDock();
            return true;
        },
    },
    getSnapshot: getMediaDockSnapshot,
});
mediaDockRuntime = mediaDockRuntimeApi.createMediaDockRuntime({
    root: mediaDockRoot,
    adapter: mediaDockAdapter,
});
mediaDockRuntime.init();
navigator.mediaDevices?.addEventListener?.(
    'devicechange',
    voiceDeviceRuntime.handleDeviceChange
);
void refreshMediaDeviceLists();

syncRoomCompositionState();
enablePageCursorSharing();
