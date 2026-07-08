import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const loadCssWithImports = (fileUrl, seen = new Set()) => {
    const key = fileUrl.href;

    if (seen.has(key)) {
        return '';
    }

    seen.add(key);

    const css = readFileSync(fileUrl, 'utf8');
    const importPattern =
        /^\s*@import\s+(?:url\(\s*)?['"](?<path>[^'"]+)['"]\s*\)?\s*;/gm;

    return css.replace(importPattern, (statement, importPath) => {
        if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
            throw new Error(
                `Only local relative CSS imports are supported: ${statement}`
            );
        }

        return loadCssWithImports(new URL(importPath, fileUrl), seen);
    });
};

const readText = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pageLayoutRuntime = readText(
    '../src/views/js/layout/page-layout-runtime.js'
);
const pageLayoutEditorRuntime = readText(
    '../src/views/js/layout/page-layout-editor-runtime.js'
);
const pageLayoutComponentRuntime = readText(
    '../src/views/js/layout/page-layout-component-runtime.js'
);

const MEDIA_ORCHESTRATION_FORBIDDEN_KEYWORDS = [
    'new Peer',
    'Peer(',
    'navigator.mediaDevices',
    'getUserMedia',
    'getDisplayMedia',
    'AudioContext',
    'AudioWorkletNode',
    'socket.emit',
    'joinRoom',
    'presence:joinVoice',
];

const MODULE_SCRIPTS = [
    {
        path: '/js/shared/view-utils.js',
        sourcePath: '../src/views/js/shared/view-utils.js',
        namespace: 'VoiceViewUtils',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
    },
    {
        path: '/js/chat/chat-name-state.js',
        sourcePath: '../src/views/js/chat/chat-name-state.js',
        namespace: 'VoiceChatNameState',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'document',
            'querySelector',
            'socket',
            'io(',
            'Peer',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'saveLayoutToStorage',
            'joinChatRoom',
            'sendChatMessage',
            'appendChatMessage',
            'renderChatHistory',
            'updatePresenceName',
            'emitLocalPresenceUpdate',
            'updateLocalUserCard',
        ],
        requiredExports: [
            [
                /CHAT_NAME_STORAGE_KEY/,
                'chat name state must expose the storage key',
            ],
            [
                /normalizeChatName/,
                'chat name state must expose name normalization',
            ],
            [
                /getStoredChatName/,
                'chat name state must expose stored name lookup',
            ],
            [
                /getChatName/,
                'chat name state must expose effective name lookup',
            ],
            [/saveChatName/, 'chat name state must expose name persistence'],
            [
                /webrtc-video-chat-name/,
                'chat name state must preserve the storage key',
            ],
            [
                /\.trim\(\)\s*\.slice\(0, CHAT_NAME_MAX_LENGTH\)/,
                'chat name state must preserve trim and max length normalization',
            ],
            [
                /const CHAT_NAME_MAX_LENGTH = 32/,
                'chat name state must preserve the 32 character limit',
            ],
            [
                /normalizeChatName\(inputValue\) \|\| getStoredChatName\(\)/,
                'chat name state must fall back to stored or guest name for empty input',
            ],
            [
                /normalizeChatName\(inputValue\) \|\| createGuestName\(\)/,
                'chat name state must fall back to guest name before saving empty input',
            ],
            [
                /safeStorageGet\(CHAT_NAME_STORAGE_KEY\)/,
                'chat name state must read the existing storage key',
            ],
            [
                /safeStorageSet\(CHAT_NAME_STORAGE_KEY, name\)/,
                'chat name state must save the normalized name to the existing storage key',
            ],
        ],
    },
    {
        path: '/js/media/noise-settings-ui.js',
        sourcePath: '../src/views/js/media/noise-settings-ui.js',
        namespace: 'VoiceNoiseSettingsUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
    },
    {
        path: '/js/shared/control-popovers-ui.js',
        sourcePath: '../src/views/js/shared/control-popovers-ui.js',
        namespace: 'VoiceControlPopoversUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'getUserMedia',
            'Peer',
            'socket.emit',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
        ],
        requiredExports: [
            [
                /createController/,
                'control popovers UI must expose a controller factory',
            ],
            [
                /aria-expanded/,
                'control popovers UI must own expanded state sync',
            ],
            [
                /closeAllPopovers\(\{ exceptWrap: wrap \}\)/,
                'control popovers UI must close sibling popovers before opening one',
            ],
            [
                /event\.key === 'Escape'/,
                'control popovers UI must close popovers on Escape',
            ],
        ],
    },
    {
        path: '/js/media/peer-volume-ui.js',
        sourcePath: '../src/views/js/media/peer-volume-ui.js',
        namespace: 'VoiceRemoteVolumeUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'getUserMedia',
            'Peer',
            'socket.emit',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
        ],
    },
    {
        path: '/js/shared/copy-link-ui.js',
        sourcePath: '../src/views/js/shared/copy-link-ui.js',
        namespace: 'VoiceCopyLinkUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
        ],
        requiredExports: [
            [/bindCopyButton/, 'copy link UI must expose copy button binding'],
            [
                /writeClipboardText/,
                'copy link UI must expose clipboard writing helper',
            ],
            [
                /navigator\.clipboard\.writeText\(String\(text\)\)/,
                'copy link UI must preserve clipboard text coercion',
            ],
            [
                /timersByButton = new WeakMap\(\)/,
                'copy link UI must keep restore timers scoped per button',
            ],
            [
                /setAttribute\('aria-label', label\)/,
                'copy link UI must preserve accessible button labels',
            ],
            [
                /classList\.toggle\([\s\S]*?'is-copied'/,
                'copy link UI must preserve copied state class sync',
            ],
        ],
    },
    {
        path: '/js/media/output-volume-state.js',
        sourcePath: '../src/views/js/media/output-volume-state.js',
        namespace: 'VoiceOutputVolumeState',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'document',
            'querySelector',
            'mediaElement',
            'new Peer',
            'Peer(',
            'RTCPeerConnection',
            'socket',
            'socket.emit',
            'socket.on',
            'io(',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'MediaStream',
            'mediaElement.volume',
            'mediaElement.muted',
            'applyOutputSettings',
            'applyOutputSettingsToRemoteMedia',
            'saveLayoutToStorage',
            'addEventListener',
        ],
        requiredExports: [
            [
                /PEER_VOLUME_STORAGE_KEY/,
                'output volume state must expose the peer volume storage key',
            ],
            [
                /getPeerVolumes/,
                'output volume state must expose volume map read',
            ],
            [/getPeerVolume/, 'output volume state must expose per-peer read'],
            [/setPeerVolume/, 'output volume state must expose per-peer write'],
            [
                /getEffectiveOutputVolume/,
                'output volume state must expose output volume calculation',
            ],
            [
                /getEffectiveVolume/,
                'output volume state must expose effective volume calculation',
            ],
            [
                /voice-room-peer-volumes-v1/,
                'output volume state must preserve peer volume storage key',
            ],
            [
                /Math\.min\(\s*1,\s*Math\.max\(0,\s*numericVolume\)\s*\)/,
                'output volume state must preserve 0-1 volume clamping',
            ],
            [
                /clampVolume\(outputVolume,\s*1\)\s*\*\s*clampVolume\(peerVolume,\s*1\)/,
                'output volume state must preserve outputVolume * peerVolume effective volume',
            ],
        ],
    },
    {
        path: '/js/media/output-volume-ui.js',
        sourcePath: '../src/views/js/media/output-volume-ui.js',
        namespace: 'VoiceOutputVolumeUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'applyOutputSettingsToRemoteMedia',
        ],
    },
    {
        path: '/js/media/media-controls-ui.js',
        sourcePath: '../src/views/js/media/media-controls-ui.js',
        namespace: 'VoiceMediaControlsUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'enumerateDevices',
            'applyOutputSettingsToRemoteMedia',
            'addTrack',
            'removeTrack',
        ],
        requiredExports: [
            [
                /renderCallControls/,
                'media controls UI must expose control visibility rendering',
            ],
            [
                /renderMicButtonState/,
                'media controls UI must expose mic button rendering',
            ],
            [
                /renderCameraButtonState/,
                'media controls UI must expose camera button rendering',
            ],
            [
                /renderLeaveButtonState/,
                'media controls UI must expose leave button rendering',
            ],
            [
                /bindMediaDevicePopovers/,
                'media controls UI must expose dock device popover behavior',
            ],
            [
                /pointerenter[\s\S]*?pointerleave[\s\S]*?mouseenter[\s\S]*?mouseleave/,
                'media controls UI must keep device popovers responsive to pointer and mouse hover events',
            ],
            [
                /renderDeviceList/,
                'media controls UI must expose media device list rendering',
            ],
        ],
    },
    {
        path: '/js/media/fullscreen-controls.js',
        sourcePath: '../src/views/js/media/fullscreen-controls.js',
        namespace: 'VoiceFullscreenControls',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'saveLayoutToStorage',
            'normalizeLoadedLayoutItems',
            'detectTileResizeDirection',
            'startTileResize',
        ],
        requiredExports: [
            [
                /getFullscreenElement/,
                'fullscreen controls must expose fullscreen element lookup',
            ],
            [
                /updateButtonStates/,
                'fullscreen controls must expose button state sync',
            ],
            [
                /attachTileButton/,
                'fullscreen controls must expose tile button attachment',
            ],
            [
                /bindFullscreenChange/,
                'fullscreen controls must expose fullscreen change binding',
            ],
            [
                /requestFullscreen/,
                'fullscreen controls must preserve requestFullscreen support',
            ],
            [
                /exitFullscreen/,
                'fullscreen controls must preserve exitFullscreen support',
            ],
            [
                /fullscreenchange/,
                'fullscreen controls must listen for fullscreenchange',
            ],
            [
                /fullscreenElement/,
                'fullscreen controls must preserve fullscreenElement lookup',
            ],
            [
                /button\.className = 'fullscreen-btn'/,
                'fullscreen controls must preserve fullscreen button class',
            ],
            [
                /const video = tile\?\.querySelector\('video'\)/,
                'fullscreen controls must keep video lookup scoped to the tile',
            ],
            [
                /tile\.ondblclick = toggle/,
                'fullscreen controls must keep tile double-click as a thin toggle wrapper',
            ],
        ],
    },
    {
        path: '/js/media/voice-join-overlay-ui.js',
        sourcePath: '../src/views/js/media/voice-join-overlay-ui.js',
        namespace: 'VoiceJoinOverlayUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
        ],
        requiredExports: [
            [/show/, 'voice join overlay UI must expose show'],
            [/hide/, 'voice join overlay UI must expose hide'],
            [
                /voiceJoinOverlay/,
                'voice join overlay UI must preserve overlay identity',
            ],
            [
                /voice-join-overlay hidden/,
                'voice join overlay UI must preserve hidden initial state',
            ],
            [
                /voiceJoinConfirm/,
                'voice join overlay UI must preserve confirm control',
            ],
            [
                /voiceJoinCancel/,
                'voice join overlay UI must preserve cancel control',
            ],
            [
                /currentOptions\.onConfirm/,
                'voice join overlay UI must invoke confirm callback',
            ],
            [
                /currentOptions\.onCancel/,
                'voice join overlay UI must invoke cancel callback',
            ],
            [
                /setHidden\(getOverlay\(\), false\)/,
                'voice join overlay UI must show the overlay through hidden state',
            ],
            [
                /setHidden\(overlay\)/,
                'voice join overlay UI must hide the overlay through hidden state',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-snap-utils.js',
        sourcePath: '../src/views/js/layout/page-layout-snap-utils.js',
        namespace: 'PageLayoutSnapUtils',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'function toggleLayoutEditMode',
            'function setLayoutEditMode',
            'function syncLayoutEditModeUI',
            'function finalizeLayoutEditing',
            'function finishTileLayoutInteraction',
            'function finalizeLayoutItemDrag',
            'saveLayout',
            'loadLayout',
            'persist',
            'localStorage',
            'addEventListener("pointer',
            "addEventListener('pointer",
        ],
    },
    {
        path: '/js/layout/page-layout-resize-utils.js',
        sourcePath: '../src/views/js/layout/page-layout-resize-utils.js',
        namespace: 'PageLayoutResizeUtils',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'saveLayoutToStorage',
            'document',
            'window.',
            'addEventListener',
            'setPointerCapture',
            'releasePointerCapture',
            'getBoundingClientRect',
            'showSnapPreview',
            'hideSnapPreview',
        ],
        requiredExports: [
            [
                /detectTileResizeDirection/,
                'layout resize utils must expose resize hit testing',
            ],
            [
                /resolveTileResizeLayout/,
                'layout resize utils must expose resize layout calculation',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-edit-ui.js',
        sourcePath: '../src/views/js/layout/page-layout-edit-ui.js',
        namespace: 'PageLayoutEditUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'function toggleLayoutEditMode',
            'function setLayoutEditMode',
            'function syncLayoutEditModeUI',
            'function finalizeLayoutEditing',
            'function finishTileLayoutInteraction',
            'function finalizeLayoutItemDrag',
            'function snapTileLayoutToGridForTile',
            'function snapAllLayoutItemsToGrid',
            'function snapTileLayoutToGrid',
            'saveLayout',
            'persist',
            'localStorage',
        ],
    },
    {
        path: '/js/layout/page-layout-component-actions-ui.js',
        sourcePath:
            '../src/views/js/layout/page-layout-component-actions-ui.js',
        namespace: 'PageLayoutComponentActionsUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'new Peer',
            'Peer(',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'sessionStorage',
            'saveLayoutToStorage',
            'clearSavedLayout',
            'updateLayoutItemConfig',
            'hideLayoutComponent(',
            'toggleTileFreeMove(',
            'startTileResize',
            'detectTileResizeDirection',
            'setPointerCapture',
            'releasePointerCapture',
        ],
        requiredExports: [
            [/findToolbar/, 'component action UI must expose toolbar lookup'],
            [
                /positionToolbar/,
                'component action UI must expose toolbar positioning',
            ],
            [
                /setActiveTile/,
                'component action UI must expose selected tile rendering',
            ],
            [
                /syncToolbarState/,
                'component action UI must expose toolbar state sync',
            ],
            [
                /ensureToolbar/,
                'component action UI must expose toolbar creation',
            ],
            [
                /layout-toolbar-button layout-toolbar-hide/,
                'component action UI must preserve hide button classes',
            ],
            [
                /setAttribute\('aria-label', '隐藏组件'\)/,
                'component action UI must preserve hide aria label',
            ],
            [
                /setAttribute\('aria-label', '自由移动'\)/,
                'component action UI must preserve free move aria label',
            ],
            [
                /textContent = '移'/,
                'component action UI must preserve free move button text',
            ],
            [
                /textContent = '\?'/,
                'component action UI must preserve help button text',
            ],
            [
                /is-layout-selected/,
                'component action UI must preserve selected class sync',
            ],
            [
                /is-visible/,
                'component action UI must preserve toolbar visibility',
            ],
            [
                /is-free-move-enabled/,
                'component action UI must preserve free move class sync',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-storage.js',
        sourcePath: '../src/views/js/layout/page-layout-storage.js',
        namespace: 'PageLayoutStorage',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'function toggleLayoutEditMode',
            'function setLayoutEditMode',
            'function syncLayoutEditModeUI',
            'function finalizeLayoutEditing',
            'function finishTileLayoutInteraction',
            'function finalizeLayoutItemDrag',
            'addEventListener("pointer',
            "addEventListener('pointer",
            'getUserMedia',
            'RTCPeerConnection',
            'socket.on',
        ],
        requiredExports: [
            [
                /knownTypes\.has\(type\)/,
                'normalizeLoadedLayoutItems must filter unknown or retired panel types',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-store-runtime.js',
        sourcePath: '../src/views/js/layout/page-layout-store-runtime.js',
        namespace: 'PageLayoutStoreRuntime',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'new Peer',
            'Peer(',
            'socket.emit',
            'socket.on',
            'querySelectorAll',
        ],
        requiredExports: [
            [
                /\.\.\.options\.getSingletonTypes\(\)/,
                'known page panel types must come from the current panel registry',
            ],
            [
                /loadLayoutFromStorage/,
                'store runtime must expose layout storage loading',
            ],
            [
                /saveLayoutToStorage/,
                'store runtime must expose layout storage saving',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-config.js',
        sourcePath: '../src/views/js/layout/page-layout-config.js',
        namespace: 'PageLayoutConfig',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'document',
            'querySelector',
            'localStorage',
            'sessionStorage',
            'new Peer',
            'Peer(',
            'socket',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
        ],
        requiredExports: [
            [
                /PAGE_COMPONENT_TYPES/,
                'layout config must expose page component types',
            ],
            [
                /LAYOUT_ITEM_TYPES/,
                'layout config must expose layout item types',
            ],
            [
                /LEGACY_LAYOUT_ITEM_TYPES/,
                'layout config must expose legacy item type aliases',
            ],
            [
                /REMOTE_PEER_LAYOUT_ID_PREFIX/,
                'layout config must expose remote peer layout id prefix',
            ],
            [
                /AUTO_LAYOUT_GRID_SIZES/,
                'layout config must expose auto placement grid sizes',
            ],
            [
                /COMPONENT_CONFIG_DEFAULTS/,
                'layout config must expose component config defaults',
            ],
            [
                /LAYOUT_PREFERENCE_DEFAULTS/,
                'layout config must expose layout preference defaults',
            ],
            [/PANEL_REGISTRY/, 'layout config must expose the panel registry'],
            [
                /PANEL_COLLAPSED_HEIGHT/,
                'layout config must expose the shared collapsed panel height',
            ],
            [
                /PANEL_COMPONENT_CONFIG_DEFAULTS/,
                'layout config must expose panel state config defaults',
            ],
            [
                /getPanelRegistry/,
                'layout config must expose panel registry lookup',
            ],
            [
                /getDefaultComponentConfig/,
                'layout config must expose default config cloning',
            ],
            [
                /normalizeComponentConfig/,
                'layout config must expose component config normalization',
            ],
            [
                /getDefaultLayoutPreferences/,
                'layout config must expose layout preference defaults cloning',
            ],
            [
                /normalizeLayoutPreferences/,
                'layout config must expose layout preference normalization',
            ],
            [
                /getLayoutPreferenceValue/,
                'layout config must expose preference value lookup',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-ids.js',
        sourcePath: '../src/views/js/layout/page-layout-ids.js',
        namespace: 'PageLayoutIds',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'document',
            'window.localStorage',
            'localStorage',
            'sessionStorage',
            'saveLayoutToStorage',
            'new Peer',
            'Peer(',
            'socket',
            'socket.emit',
            'socket.on',
            'io(',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'layoutItemsById',
            'savedLayoutItemsById',
            'getRemoteMemberForPeerId',
            'presenceMembersByPeerId',
            'joinedVoiceRoomId',
            'localPeerId',
            'getTileLayoutId',
            'getTileLayoutItemId',
            'getLayoutItemTypeForTile',
            'addLayoutComponent',
            'hideLayoutComponent',
            'resetDefaultLayout',
            'initializeLayoutFromStorage',
            'applyPageLayoutItemToPanel',
            'renderLayoutComponentTile',
            'startTileResize',
            'detectTileResizeDirection',
        ],
        requiredExports: [
            [
                /sanitizeLayoutIdPart/,
                'layout ids must expose id-part sanitizing',
            ],
            [/getRemoteLayoutKey/, 'layout ids must expose remote key helper'],
            [
                /getRemoteLayoutItemId/,
                'layout ids must expose remote item id helper',
            ],
            [
                /getLegacyRemoteLayoutPeerId/,
                'layout ids must expose legacy remote id parsing',
            ],
            [
                /normalizeRemotePeerLayoutId/,
                'layout ids must expose remote id normalization',
            ],
            [
                /getRemoteLayoutAliasIds/,
                'layout ids must expose remote alias expansion',
            ],
            [
                /replace\(\s*\/\[\^a-zA-Z0-9_-\]\//,
                'layout ids must preserve sanitize replacement rules',
            ],
            [
                /REMOTE_PEER_LAYOUT_ID_PREFIX/,
                'layout ids must preserve remotePeer prefix semantics',
            ],
            [
                /'remote-peer:'[\s\S]*'peer:'[\s\S]*'peer-'/,
                'layout ids must preserve legacy remote alias prefixes',
            ],
            [
                /REMOTE_PEER_LAYOUT_ID_PREFIX[\s\S]*peer-\$\{sanitizedPeerId\}/,
                'layout ids must preserve remotePeer peer alias matching',
            ],
            [
                /preferredId[\s\S]*aliases\.add\(preferredId\)/,
                'layout ids must keep preferred saved remote id first',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-placement-utils.js',
        sourcePath: '../src/views/js/layout/page-layout-placement-utils.js',
        namespace: 'PageLayoutPlacementUtils',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'document',
            'window.localStorage',
            'localStorage',
            'sessionStorage',
            'saveLayoutToStorage',
            'new Peer',
            'Peer(',
            'socket',
            'socket.emit',
            'socket.on',
            'io(',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'layoutItemsById',
            'getOccupiedLayoutRects',
            'getDefaultLayoutItems',
            'getPreferredTileLayoutItem',
            'getInitialTileLayoutForSync',
            'applySavedTileLayout',
            'addLayoutComponent',
            'hideLayoutComponent',
            'resetDefaultLayout',
            'initializeLayoutFromStorage',
            'applyPageLayoutItemToPanel',
            'renderLayoutComponentTile',
            'startTileResize',
            'detectTileResizeDirection',
        ],
        requiredExports: [
            [
                /isAutoPlacedLayoutType/,
                'placement utils must expose auto type checks',
            ],
            [
                /getAutoLayoutGridSize/,
                'placement utils must expose auto grid sizes',
            ],
            [
                /isAbnormallyLargeAutoGrid/,
                'placement utils must expose abnormal grid checks',
            ],
            [
                /normalizeAutoLayoutGrid/,
                'placement utils must expose auto grid normalization',
            ],
            [
                /getFallbackTileLayoutForType/,
                'placement utils must expose fallback layout selection',
            ],
            [
                /isRectWithinGrid/,
                'placement utils must expose grid bounds checking',
            ],
            [/rectOverlapArea/, 'placement utils must expose overlap scoring'],
            [/scoreLayoutSlot/, 'placement utils must expose slot scoring'],
            [
                /findAvailableLayoutSlot/,
                'placement utils must expose slot search',
            ],
            [
                /Number\(grid\?\.w\)\s*>=\s*options\.columns\s*-\s*1[\s\S]*Number\(grid\?\.h\)\s*>=\s*options\.rows\s*-\s*1/,
                'placement utils must preserve abnormal auto grid thresholds',
            ],
            [
                /overlapArea\s*\*\s*1000\s*\+\s*distanceFromCenter\s*\*\s*10\s*\+\s*edgePenalty/,
                'placement utils must preserve slot score weights',
            ],
            [
                /for \(let y = 0; y <= options\.rows - size\.h; y \+= 1\)[\s\S]*for \(let x = 0; x <= options\.columns - size\.w; x \+= 1\)/,
                'placement utils must preserve y-then-x slot search order',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-components.js',
        sourcePath: '../src/views/js/layout/page-layout-components.js',
        namespace: 'PageLayoutComponents',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'new Peer',
            'Peer(',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'AudioContext',
            'socket',
            'io(',
            'localStorage',
            'sessionStorage',
            'saveLayoutToStorage',
            'layoutItemsById',
            'savedLayoutItemsById',
            'addLayoutComponent',
            'hideLayoutComponent',
            'resetDefaultLayout',
            'initializeLayoutFromStorage',
            'applyPageLayoutItemToPanel',
            'applyStoredLayoutToExistingTile',
            'startTileResize',
            'detectTileResizeDirection',
            'setPointerCapture',
            'releasePointerCapture',
            'CHAT_INPUT',
            'chatForm',
            'chatInput',
        ],
        requiredExports: [
            [
                /getDefaultLayoutItems/,
                'layout components must expose default layout items',
            ],
            [
                /getLayoutComponentId/,
                'layout components must expose component id mapping',
            ],
            [
                /getLayoutComponentDisplayState/,
                'layout components must expose component display state',
            ],
            [
                /renderLayoutComponentTile/,
                'layout components must expose component tile rendering',
            ],
            [
                /getPanelRegistry\(\)\.map/,
                'default page panels must be generated from the panel registry',
            ],
            [
                /grid:\s*\{\s*\.\.\.panel\.defaultLayout\s*\}/,
                'default page panel grids must come from registered defaults',
            ],
            [
                /LOCAL_PEER[\s\S]*?grid:\s*\{\s*x:\s*13,\s*y:\s*7,\s*w:\s*5,\s*h:\s*4\s*\}/,
                'default localPeer layout must stay unchanged',
            ],
            [/房间信息/, 'room component title must stay unchanged'],
            [
                /聊天组件已添加/,
                'chat component fallback text must stay unchanged',
            ],
            [/我的语音/, 'local peer component title must stay unchanged'],
        ],
    },
    {
        path: '/js/layout/page-layout-toolbar-ui.js',
        sourcePath: '../src/views/js/layout/page-layout-toolbar-ui.js',
        namespace: 'PageLayoutToolbarUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'saveLayoutToStorage',
            'clearSavedLayout',
            'addLayoutComponent',
            'renderLayoutComponentMenu',
            'closeLayoutComponentConfig',
            'finalizeLayoutEditing',
            'resetDefaultLayout',
        ],
        requiredExports: [
            [/ensureToolbar/, 'layout toolbar UI must expose toolbar creation'],
            [
                /renderToolbarState/,
                'layout toolbar UI must expose edit-mode rendering',
            ],
            [
                /showSaveStatus/,
                'layout toolbar UI must expose save-status rendering',
            ],
            [
                /renderResetConfirmState/,
                'layout toolbar UI must expose reset confirmation rendering',
            ],
            [
                /layoutLockToggle/,
                'layout toolbar UI must expose the optional layout lock toggle',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-component-menu-ui.js',
        sourcePath: '../src/views/js/layout/page-layout-component-menu-ui.js',
        namespace: 'PageLayoutComponentMenuUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'CORE_PAGE_TYPES',
            'PAGE_COMPONENT_LABELS',
            'getExistingLayoutComponentTile',
            'getTileLayoutItem',
            'addLayoutComponent',
            'stagePanel',
            'CHAT_INPUT',
            'chatForm',
            'chatInput',
            'saveLayoutToStorage',
            'clearSavedLayout',
            'closeLayoutComponentConfig',
        ],
        requiredExports: [
            [
                /renderMenu/,
                'layout component menu UI must expose menu rendering',
            ],
            [
                /closeMenu/,
                'layout component menu UI must expose close rendering',
            ],
            [
                /toggleMenu/,
                'layout component menu UI must expose toggle rendering',
            ],
        ],
    },
    {
        path: '/js/layout/page-layout-recovery-ui.js',
        sourcePath: '../src/views/js/layout/page-layout-recovery-ui.js',
        namespace: 'PageLayoutRecoveryUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'clearSavedLayout',
            'window.location.reload',
            'initPageLayoutBoard',
            'validatePageLayout',
            'restoreOriginalStaticLayout',
        ],
        requiredExports: [
            [
                /ensureRecoveryToolbar/,
                'layout recovery UI must expose toolbar creation',
            ],
            [
                /setRecoveryToolbarVisible/,
                'layout recovery UI must expose toolbar visibility sync',
            ],
            [
                /printDebugTable/,
                'layout recovery UI must expose debug table printing',
            ],
        ],
    },
    {
        path: '/js/room/room-ui-state.js',
        sourcePath: '../src/views/js/room/room-ui-state.js',
        namespace: 'VoiceRoomUIState',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
        ],
        requiredExports: [
            [/renderCallTimer/, 'room UI state must render call timer UI'],
            [
                /renderLocalUserCard/,
                'room UI state must render local user card UI',
            ],
            [
                /renderMobileTileNav/,
                'room UI state must render mobile tile nav UI',
            ],
            [/renderRoomHeader/, 'room UI state must render room header UI'],
        ],
    },
    {
        path: '/js/room/mobile-room-state.js',
        sourcePath: '../src/views/js/room/mobile-room-state.js',
        namespace: 'VoiceMobileRoomState',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'new Peer',
            'Peer(',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
        ],
        requiredExports: [
            [
                /createMobileRoomState/,
                'mobile room state must expose controller factory',
            ],
            [
                /if \(aSharing && !bSharing\) return -1;/,
                'mobile room state must sort screen-share tiles first',
            ],
            [
                /remotePeerOrder\.indexOf\(a\.id\)\s*-\s*remotePeerOrder\.indexOf\(b\.id\)/,
                'mobile room state must preserve remote peer ordering',
            ],
            [
                /remoteTiles\.push\(localTile\)/,
                'mobile room state must keep local tile last',
            ],
            [
                /toggleRoomClass\?\.\(refs\.mainLayout, 'mobile-in-room', isInRoom\)/,
                'mobile room state must own mobile room class sync',
            ],
            [/goPrevious/, 'mobile room state must expose previous navigation'],
            [/goNext/, 'mobile room state must expose next navigation'],
        ],
    },
    {
        path: '/js/room/presence-view-model.js',
        sourcePath: '../src/views/js/room/presence-view-model.js',
        namespace: 'VoicePresenceViewModel',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'document',
            'querySelector',
            'localStorage',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
        ],
        requiredExports: [
            [
                /getMemberMicStatus/,
                'presence view model must expose mic status mapping',
            ],
            [
                /getMemberTileText/,
                'presence view model must expose tile status text mapping',
            ],
            [
                /getMemberStatusIcons/,
                'presence view model must expose status icon mapping',
            ],
            [
                /buildParticipantViewModel/,
                'presence view model must expose participant view model mapping',
            ],
        ],
    },
    {
        path: '/js/room/participants-list-ui.js',
        sourcePath: '../src/views/js/room/participants-list-ui.js',
        namespace: 'VoiceParticipantsListUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
        ],
        requiredExports: [
            [
                /renderParticipantsList/,
                'participants list UI must expose list rendering',
            ],
            [
                /renderParticipantItem/,
                'participants list UI must expose item rendering',
            ],
            [
                /renderEmptyParticipants/,
                'participants list UI must expose empty state',
            ],
            [
                /updateParticipantItemClasses/,
                'participants list UI must expose participant class sync',
            ],
        ],
    },
    {
        path: '/js/room/tile-status-ui.js',
        sourcePath: '../src/views/js/room/tile-status-ui.js',
        namespace: 'VoiceTileStatusUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
            'attachStream',
            'addTrack',
            'removeTrack',
        ],
        requiredExports: [
            [/renderTileStatus/, 'tile status UI must expose status rendering'],
            [
                /updateTileStatusClasses/,
                'tile status UI must expose class syncing',
            ],
            [/renderTileBadges/, 'tile status UI must expose badge rendering'],
            [
                /renderTilePlaceholder/,
                'tile status UI must expose placeholder rendering',
            ],
        ],
    },
    {
        path: '/js/room/video-tile-structure-ui.js',
        sourcePath: '../src/views/js/room/video-tile-structure-ui.js',
        namespace: 'VoiceVideoTileStructureUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'localStorage',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileDrag',
            'startTileResize',
            'detectTileResizeDirection',
            'bindTileLayoutControls',
            'bindLayoutResizeBoardControls',
            'addEventListener',
            'pointerdown',
            'pointermove',
            'pointerup',
        ],
        requiredExports: [
            [
                /createTileAvatarText/,
                'video tile structure UI must expose avatar text creation',
            ],
            [
                /ensureTileStructure/,
                'video tile structure UI must expose tile structure creation',
            ],
            [
                /data-drag-handle/,
                'video tile structure UI must preserve tile header drag handle',
            ],
            [
                /tile-resize-handle/,
                'video tile structure UI must preserve resize handle classes',
            ],
            [
                /dataset\.resizeDirection/,
                'video tile structure UI must preserve resize direction data',
            ],
        ],
    },
    {
        path: '/js/chat/chat-message-ui.js',
        sourcePath: '../src/views/js/chat/chat-message-ui.js',
        namespace: 'VoiceChatMessageUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
            'chat:send',
            'chat:join',
            'chatForm',
            'chatInput',
        ],
        requiredExports: [
            [
                /renderChatMessageItem/,
                'chat message UI must expose item rendering',
            ],
            [
                /appendChatMessage/,
                'chat message UI must expose append rendering',
            ],
            [
                /renderChatHistory/,
                'chat message UI must expose history rendering',
            ],
            [
                /scrollToBottom/,
                'chat message UI may own scroll-to-bottom UI sync',
            ],
        ],
    },
    {
        path: '/js/chat/chat-form-ui.js',
        sourcePath: '../src/views/js/chat/chat-form-ui.js',
        namespace: 'VoiceChatFormUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'socket.emit',
            'socket.on',
            'chat:send',
            'chat:message',
            'chat:history',
            'Peer',
            'getUserMedia',
            'requestAudioStream',
            'joinVoiceChannel',
            'setViewingRoom',
            'saveLayoutToStorage',
        ],
        requiredExports: [
            [
                /getMessageContent/,
                'chat form UI must expose content normalization',
            ],
            [
                /renderSubmitState/,
                'chat form UI must expose submit state rendering',
            ],
            [
                /renderInputState/,
                'chat form UI must expose input state rendering',
            ],
            [/resetForm/, 'chat form UI must expose form reset helper'],
            [/focusInput/, 'chat form UI must expose focus helper'],
        ],
    },
    {
        path: '/js/room/channel-sidebar-ui.js',
        sourcePath: '../src/views/js/room/channel-sidebar-ui.js',
        namespace: 'VoiceChannelSidebarUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
            'voiceJoinOverlay',
        ],
        requiredExports: [
            [
                /renderChannelItemState/,
                'channel sidebar UI must expose item state rendering',
            ],
            [
                /renderChannelListState/,
                'channel sidebar UI must expose list state rendering',
            ],
            [
                /aria-current/,
                'channel sidebar UI may own current-channel aria sync',
            ],
        ],
    },
    {
        path: '/js/room/cursor-share-ui.js',
        sourcePath: '../src/views/js/room/cursor-share-ui.js',
        namespace: 'VoiceCursorShareUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'Peer',
            'socket.emit',
            'socket.on',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
            'saveLayoutToStorage',
            'loadLayoutFromStorage',
            'startTileResize',
            'detectTileResizeDirection',
            'connectToNewUser',
            'getOrderedTiles',
            'syncPresenceTiles',
            'applyOutputSettingsToRemoteMedia',
            'cursor:move',
            'cursor:leave',
            'cursor:remove',
            'addEventListener',
        ],
        requiredExports: [
            [
                /getCursorOverlay/,
                'cursor share UI must expose overlay creation',
            ],
            [
                /renderRemoteCursor/,
                'cursor share UI must expose cursor rendering',
            ],
            [/setCursorIdle/, 'cursor share UI must expose idle class syncing'],
            [
                /removeRemoteCursor/,
                'cursor share UI must expose cursor removal',
            ],
        ],
    },
];

const moduleSources = new Map(
    MODULE_SCRIPTS.map(({ path, sourcePath }) => [path, readText(sourcePath)])
);
const getModuleSource = (path) => moduleSources.get(path);

const script = readText('../src/views/script.js');
const roomIndex = readText('../src/views/room/index.ejs');
const pageLayoutStorage = getModuleSource('/js/layout/page-layout-storage.js');
const pageLayoutStoreRuntime = getModuleSource(
    '/js/layout/page-layout-store-runtime.js'
);
const pageLayoutConfig = getModuleSource('/js/layout/page-layout-config.js');
const pageLayoutIds = getModuleSource('/js/layout/page-layout-ids.js');
const pageLayoutPlacementUtils = getModuleSource(
    '/js/layout/page-layout-placement-utils.js'
);
const pageLayoutComponents = getModuleSource(
    '/js/layout/page-layout-components.js'
);
const pageLayoutToolbarUi = getModuleSource(
    '/js/layout/page-layout-toolbar-ui.js'
);
const pageLayoutRecoveryUi = getModuleSource(
    '/js/layout/page-layout-recovery-ui.js'
);
const videoTileStructureUi = getModuleSource(
    '/js/room/video-tile-structure-ui.js'
);
const style = loadCssWithImports(
    new URL('../src/views/style.css', import.meta.url)
);

const roomScriptSrcs = Array.from(
    roomIndex.matchAll(/<script\b[^>]*\bsrc=["'](?<src>[^"']+)["'][^>]*>/g),
    (match) => match.groups.src
);
const indexOfRoomScript = (src) => roomScriptSrcs.indexOf(src);
const assertScriptBefore = (scriptA, scriptB) => {
    const scriptAIndex = indexOfRoomScript(scriptA);
    const scriptBIndex = indexOfRoomScript(scriptB);

    assert.ok(scriptAIndex >= 0, `room index must load ${scriptA}`);
    assert.ok(scriptBIndex >= 0, `room index must load ${scriptB}`);
    assert.ok(
        scriptAIndex < scriptBIndex,
        `${scriptA} must load before ${scriptB}`
    );
};

const assertScriptBeforeMain = (scriptPath) => {
    assertScriptBefore(scriptPath, '/script.js');
};

const assertNoForbiddenKeywords = (source, filename, keywords) => {
    keywords.forEach((forbiddenKeyword) => {
        assert.ok(
            !source.includes(forbiddenKeyword),
            `${filename} must not contain ${forbiddenKeyword}`
        );
    });
};

const getSnippetPattern = (snippet) =>
    Array.isArray(snippet) ? snippet[0] : snippet.pattern;

const getSnippetMessage = (snippet) =>
    Array.isArray(snippet) ? snippet[1] : snippet.message;

const assertSourceContains = (source, label, requiredSnippets) => {
    requiredSnippets.forEach((snippet) => {
        const pattern = getSnippetPattern(snippet);
        const message = getSnippetMessage(snippet);

        assert.match(
            source,
            pattern,
            message || `${label} must contain ${pattern}`
        );
    });
};

const assertSourceDoesNotContain = (source, label, forbiddenSnippets) => {
    forbiddenSnippets.forEach((snippet) => {
        const pattern = getSnippetPattern(snippet);
        const message = getSnippetMessage(snippet);

        assert.doesNotMatch(
            source,
            pattern,
            message || `${label} must not contain ${pattern}`
        );
    });
};

const getSourceBetween = (source, startPattern, endPattern, label) => {
    const startMatch = source.match(startPattern);

    assert.ok(startMatch, `${label} start must be inspectable`);

    const startIndex = startMatch.index;
    const rest = source.slice(startIndex + startMatch[0].length);
    const endMatch = rest.match(endPattern);

    assert.ok(endMatch, `${label} end must be inspectable`);

    return source.slice(
        startIndex,
        startIndex + startMatch[0].length + endMatch.index
    );
};

const assertModuleScriptContracts = (moduleScripts) => {
    assertScriptBeforeMain('/js/shared/view-utils.js');

    moduleScripts.forEach(
        ({
            path,
            namespace,
            mustLoadBeforeMain = true,
            dependsOnViewUtils = false,
            forbiddenKeywords = [],
            requiredExports = [],
        }) => {
            const source = getModuleSource(path);
            const filename = path.replace('/js/', '');

            assert.ok(source, `${filename} source must be loaded`);

            if (mustLoadBeforeMain) {
                assertScriptBeforeMain(path);
            }

            if (
                path !== '/js/shared/view-utils.js' &&
                (dependsOnViewUtils || source.includes('VoiceViewUtils'))
            ) {
                assertScriptBefore('/js/shared/view-utils.js', path);
            }

            if (namespace) {
                assertSourceContains(source, filename, [
                    [
                        new RegExp(`global\\.${namespace}\\s*=\\s*\\{`),
                        `${filename} must expose ${namespace}`,
                    ],
                ]);
            }

            assertNoForbiddenKeywords(
                source,
                filename,
                MEDIA_ORCHESTRATION_FORBIDDEN_KEYWORDS
            );
            assertNoForbiddenKeywords(source, filename, forbiddenKeywords);
            assertSourceContains(source, filename, requiredExports);
        }
    );
};

assertModuleScriptContracts(MODULE_SCRIPTS);

assertSourceContains(script, 'chat name state delegation', [
    [
        /const chatNameState = window\.VoiceChatNameState/,
        'script.js must load the chat name state module',
    ],
    [
        /const getStoredChatName = \(\) => chatNameState\.getStoredChatName\(\);/,
        'script.js must keep getStoredChatName as a thin state-module wrapper',
    ],
    [
        /const getChatName = \(\) => chatNameState\.getChatName\(chatNameInput\?\.value\);/,
        'script.js must keep chatNameInput DOM reads outside the state module',
    ],
    [
        /const saveChatName = \(\) => \{[\s\S]*?if \(!chatNameInput\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?const name = chatNameState\.saveChatName\(chatNameInput\.value\);[\s\S]*?chatNameInput\.value = name;[\s\S]*?\};/,
        'script.js must keep saveChatName as a DOM-input wrapper around chat name state',
    ],
    [
        /chatNameInput\.addEventListener\('change', \(\) => \{[\s\S]*?saveChatName\(\);[\s\S]*?updatePresenceName\(\);[\s\S]*?\}\);/,
        'chat name input change must still save before updating presence',
    ],
]);
assertSourceDoesNotContain(script, 'chat name state delegation', [
    [
        /const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name'/,
        'script.js must not retain the chat name storage key after extraction',
    ],
]);

assert.match(
    roomIndex,
    /<aside\b[^>]*id="chat-panel"[^>]*class="chat-panel"[\s\S]*?<form\b[^>]*id="chatForm"[\s\S]*?<textarea\b[^>]*id="chatInput"/,
    '.chat-panel must remain intact and contain #chatForm / #chatInput'
);
assert.match(
    roomIndex,
    /<div\b[^>]*id="buttons"[^>]*class="[^"]*\bmedia-dock\b[^"]*"[\s\S]*?<div\b[^>]*class="local-user-header media-dock-user"[\s\S]*?id="localUserName"[\s\S]*?<div\b[^>]*class="media-dock-info"[\s\S]*?id="localVoiceChannelName"[\s\S]*?<div\b[^>]*class="media-dock-activity-row"[\s\S]*?id="noiseToggle"[\s\S]*?id="aiNoiseToggle"[\s\S]*?id="destroyPeer"[\s\S]*?<div\b[^>]*class="media-dock-actions"[\s\S]*?id="copyRoomLink"[\s\S]*?id="toggleAudio"[\s\S]*?id="toggleOutput"/,
    'media dock must own local identity, voice details, noise, AI, hangup, copy link, mic, and output controls in one DOM source'
);
assert.doesNotMatch(
    roomIndex,
    /<section\b[^>]*class="local-user-card"[\s\S]*?<div\b[^>]*class="local-user-header(?! media-dock-user)"/,
    'local room card must not keep a second standalone identity strip outside the media dock'
);

assertSourceContains(script, 'page layout base contract', [
    [
        /PAGE_STORAGE_VERSION\s*=\s*2/,
        'page layout schema version must bump for the media dock layout migration',
    ],
    [
        /PAGE_LAYOUT_STORAGE_KEY_PREFIX\s*=\s*'voicePageLayout:v4'/,
        'page layout must use the v4 storage key',
    ],
    [
        /const migrateLoadedLayoutItem = \(/,
        'script must define a saved layout item migration hook',
    ],
    [
        /const layoutConfig = window\.PageLayoutConfig/,
        'script must consume page layout config through PageLayoutConfig',
    ],
    [
        /const layoutIds = window\.PageLayoutIds/,
        'script must consume page layout ids through PageLayoutIds',
    ],
    [
        /const layoutPlacementUtils = window\.PageLayoutPlacementUtils/,
        'script must consume placement helpers through PageLayoutPlacementUtils',
    ],
    [
        /const layoutComponents = window\.PageLayoutComponents/,
        'script must consume page layout components through PageLayoutComponents',
    ],
]);
assertSourceContains(pageLayoutConfig, 'page layout config contract', [
    [
        /SIDEBAR_PANEL:\s*'sidebarPanel'/,
        'sidebarPanel must be a first-class page component',
    ],
    [
        /MEMBERS_PANEL:\s*'membersPanel'/,
        'membersPanel must be a first-class page component',
    ],
    [
        /MEDIA_CONTROLS_PANEL:\s*'mediaControlsPanel'/,
        'mediaControlsPanel must be a first-class page component',
    ],
    [
        /CHAT_PANEL:\s*'chatPanel'/,
        'chatPanel must be a first-class page component',
    ],
    [
        /PANEL_REGISTRY[\s\S]*?minWidth[\s\S]*?minHeight[\s\S]*?canDrag[\s\S]*?canResize/,
        'panel registry must define shared shell layout capabilities',
    ],
    [
        /MEMBERS_PANEL[\s\S]*?title:\s*'房间 Room'/,
        'membersPanel must be presented as the room panel',
    ],
    [
        /SIDEBAR_PANEL[\s\S]*?defaultVisible:\s*false[\s\S]*?MEDIA_CONTROLS_PANEL[\s\S]*?title:\s*'语音 Dock'[\s\S]*?defaultLayout:\s*\{\s*x:\s*0,\s*y:\s*12,\s*w:\s*4,\s*h:\s*6\s*\}[\s\S]*?canDrag:\s*true[\s\S]*?canResize:\s*true/,
        'sidebarPanel must stay hidden while mediaControlsPanel defaults to a draggable left-bottom 4x6 dock layout',
    ],
    [
        /PANEL_REGISTRY[\s\S]*?canHide[\s\S]*?canCollapse[\s\S]*?canPin/,
        'panel registry must define shared action capabilities',
    ],
    [
        /PANEL_COLLAPSED_HEIGHT\s*=\s*42/,
        'panel collapse must keep a shared fallback collapsed height',
    ],
    [
        /PANEL_COMPONENT_CONFIG_DEFAULTS[\s\S]*?collapsed:\s*false[\s\S]*?pinned:\s*false[\s\S]*?expandedHeight:\s*0/,
        'panel config defaults must persist collapsed, pinned, and expanded height state',
    ],
]);
const pageComponentTypesMatch = pageLayoutConfig.match(
    /const PAGE_COMPONENT_TYPES = \{(?<body>[\s\S]*?)\};/
);
assert.ok(pageComponentTypesMatch, 'PAGE_COMPONENT_TYPES must be inspectable');
assertSourceDoesNotContain(
    pageComponentTypesMatch.groups.body,
    'PAGE_COMPONENT_TYPES',
    [
        [/CHAT_INPUT/, 'PAGE_COMPONENT_TYPES must not restore CHAT_INPUT'],
        [
            /STAGE_PANEL|stagePanel/,
            'PAGE_COMPONENT_TYPES must not restore stagePanel',
        ],
        [
            /ROOM_INFO_PANEL|roomInfoPanel/,
            'PAGE_COMPONENT_TYPES must not restore standalone roomInfoPanel',
        ],
    ]
);
assertSourceDoesNotContain(pageLayoutConfig, 'page layout config contract', [
    [/stagePanel/, 'PANEL_REGISTRY must not include stagePanel'],
    [/舞台 Stage/, 'PANEL_REGISTRY must not expose the Stage panel label'],
    [
        /roomInfoPanel/,
        'PANEL_REGISTRY must not expose standalone roomInfoPanel',
    ],
]);
const mediaControlsPanelConfigBody = getSourceBetween(
    pageLayoutConfig,
    /id:\s*PAGE_COMPONENT_TYPES\.MEDIA_CONTROLS_PANEL,/,
    /\n\s*\},\n\s*\{\n\s*id:\s*PAGE_COMPONENT_TYPES\.CHAT_PANEL,/,
    'mediaControlsPanel registry entry'
);
assert.doesNotMatch(
    mediaControlsPanelConfigBody,
    /defaultVisible:\s*false/,
    'mediaControlsPanel must be visible in the default layout'
);
assert.match(
    mediaControlsPanelConfigBody,
    /minWidth:\s*220[\s\S]*?minHeight:\s*140/,
    'mediaControlsPanel minimum size must allow the 4x6 dock default'
);
assertSourceContains(pageLayoutIds, 'page-layout-ids.js', [
    [
        /REMOTE_PEER_LAYOUT_ID_PREFIX/,
        'page layout ids must consume the configured remote peer prefix',
    ],
    [
        /'remote-peer:'[\s\S]*'peer:'[\s\S]*'peer-'/,
        'page layout ids must preserve legacy remote alias parsing',
    ],
]);
assertSourceContains(
    pageLayoutPlacementUtils,
    'page-layout-placement-utils.js',
    [
        [
            /const isAutoPlacedLayoutType = \(type, options = \{\}\) =>[\s\S]*Boolean\(getAutoLayoutGridSizes\(options\)\[type\]\)/,
            'placement utils must keep auto placement driven by configured type sizes',
        ],
        [
            /const getFallbackTileLayoutForType = \(type, layout = \{\}, options = \{\}\) => \{[\s\S]*layout\?\.grid[\s\S]*normalizeAutoLayoutGrid[\s\S]*Number\.isFinite\(Number\(layout\?\.width\)\)[\s\S]*getAutoLayoutGridSize/,
            'placement utils must preserve fallback layout behavior',
        ],
        [
            /const findAvailableLayoutSlot = [\s\S]*const occupiedRects = options\.occupiedRects \|\| \[\]/,
            'placement utils must receive occupied rects from script.js',
        ],
    ]
);

const defaultsMatch = pageLayoutComponents.match(
    /const getDefaultLayoutItems = \(\) => \[(?<body>[\s\S]*?)\];/
);
assert.ok(
    defaultsMatch,
    'PageLayoutComponents.getDefaultLayoutItems should return a literal default layout'
);
const defaultBody = defaultsMatch.groups.body;

assertSourceContains(defaultBody, 'default page layout', [
    [/getPanelRegistry\(\)\.map/, 'default layout uses panel registry'],
    [/defaultLayout/, 'default layout comes from registered panel defaults'],
    [
        /visible:\s*panel\.defaultVisible !== false/,
        'default panel visibility must come from the panel registry',
    ],
    [/LOCAL_PEER/, 'default layout includes localPeer'],
]);
assertSourceDoesNotContain(defaultBody, 'default page layout', [
    [
        /STAGE_PANEL|stagePanel|ROOM_INFO_PANEL|roomInfoPanel|CHANNEL_SIDEBAR|SELF_STATUS|CHAT_INPUT/,
        'default page layout must not include retired split component ids',
    ],
]);

assertSourceContains(pageLayoutRuntime, 'page-layout-runtime.js', [
    {
        pattern: /const createPageTileFromNode = /,
        message: 'page layout must move existing DOM roots into tiles',
    },
    {
        pattern: /const validateDetachedPageLayoutBoard = /,
        message:
            'page layout must validate detached board content before replacing #main',
    },
    {
        pattern:
            /tile\.dataset\.layoutItemId = itemId;[\s\S]*?tile\.dataset\.layoutId = itemId;[\s\S]*?options\.syncTileLayoutItemFromElement\(tile,/,
        message:
            'page panels must keep layout item data needed for drag/save persistence',
    },
]);
assert.match(
    pageLayoutRuntime,
    /const visible = defaultItem\.visible !== false;[\s\S]*?setTileLayoutItemVisibility\([\s\S]*?visible[\s\S]*?classList\.toggle\('is-layout-hidden', !visible\)/,
    'default page layout initialization must keep hidden-by-default panels hidden'
);

assertSourceContains(script, 'script.js', [
    {
        pattern: /const requestAudioStream = async/,
        message: 'requestAudioStream must stay in script.js',
    },
    {
        pattern: /const createAudioPipeline = async/,
        message: 'createAudioPipeline must stay in script.js',
    },
    {
        pattern: /const joinVoiceChannel = /,
        message: 'joinVoiceChannel must stay in script.js',
    },
    {
        pattern: /const setViewingRoom = /,
        message: 'setViewingRoom must stay in script.js',
    },
    {
        pattern: /const setVoiceTargetRoom = /,
        message: 'setVoiceTargetRoom must stay in script.js',
    },
    {
        pattern: /function setupCallStreamHandler/,
        message: 'setupCallStreamHandler must stay in script.js',
    },
    {
        pattern: /const bindPeerCallHandler = /,
        message: 'bindPeerCallHandler must stay in script.js',
    },
    {
        pattern: /const initiateAudio = async/,
        message: 'initiateAudio must stay in script.js',
    },
    {
        pattern: /const toggleCamera = async/,
        message: 'toggleCamera must stay in script.js',
    },
    {
        pattern: /async function toggleScreenShare/,
        message: 'toggleScreenShare must stay in script.js',
    },
    {
        pattern: /const applyOutputSettings = /,
        message: 'applyOutputSettings must stay in script.js',
    },
    {
        pattern: /const applyOutputSettingsToRemoteMedia = /,
        message: 'applyOutputSettingsToRemoteMedia must stay in script.js',
    },
]);
assertSourceContains(pageLayoutStorage, 'page-layout-storage.js', [
    [
        /knownTypes\.has\(type\)/,
        'normalizeLoadedLayoutItems must filter unknown or retired panel types',
    ],
    [
        /supportedVersions[\s\S]*?payloadVersion/,
        'normalizeLoadedLayoutItems must allow explicitly supported legacy schema versions',
    ],
    [
        /migrateLoadedLayoutItem/,
        'normalizeLoadedLayoutItems must support per-item migration',
    ],
]);
assertSourceContains(pageLayoutStoreRuntime, 'page-layout-store-runtime.js', [
    [
        /\.\.\.options\.getSingletonTypes\(\)/,
        'known page panel types must come from the current panel registry',
    ],
    [
        /supportedVersions:\s*options\.supportedStorageVersions[\s\S]*?migrateLoadedLayoutItem:\s*options\.migrateLoadedLayoutItem/,
        'store runtime must pass storage migration hooks to layout storage',
    ],
]);

const storageState = new Map();
const storageWindow = {
    localStorage: {
        getItem: (key) => storageState.get(key) || null,
        removeItem: (key) => storageState.delete(key),
        setItem: (key, value) => storageState.set(key, String(value)),
    },
};
runInNewContext(pageLayoutStorage, { window: storageWindow });
const storageApi = storageWindow.PageLayoutStorage;
const v2StorageKey = storageApi.getLayoutStorageKey({
    prefix: 'voicePageLayout:v2',
    roomId: 'contract-room',
});
const v3StorageKey = storageApi.getLayoutStorageKey({
    prefix: 'voicePageLayout:v3',
    roomId: 'contract-room',
});
const v4StorageKey = storageApi.getLayoutStorageKey({
    prefix: 'voicePageLayout:v4',
    roomId: 'contract-room',
});
storageState.set(
    v2StorageKey,
    JSON.stringify({
        version: 1,
        items: [
            {
                id: 'page-stagePanel',
                type: 'stagePanel',
                visible: true,
                x: 0,
                y: 0,
                w: 12,
                h: 8,
            },
        ],
    })
);
storageState.set(
    v3StorageKey,
    JSON.stringify({
        version: 1,
        items: [
            {
                id: 'page-stagePanel',
                type: 'stagePanel',
                visible: true,
                x: 0,
                y: 0,
                w: 12,
                h: 8,
            },
            {
                id: 'page-mediaControlsPanel',
                type: 'mediaControlsPanel',
                visible: false,
                x: 0,
                y: 14,
                w: 6,
                h: 4,
            },
        ],
    })
);
assert.equal(
    storageApi.loadLayoutFromStorage({
        storageKey: v4StorageKey,
        normalize: (payload) => payload.items,
    }).length,
    0,
    'v4 layout loading must ignore old v2/v3 payloads that contain retired or hidden panel state'
);
const normalizedLegacyPanelItems = storageApi.normalizeLoadedLayoutItems(
    {
        version: 1,
        items: [
            {
                id: 'page-stagePanel',
                type: 'stagePanel',
                visible: true,
                x: 0,
                y: 0,
                w: 12,
                h: 8,
            },
            {
                id: 'page-roomInfoPanel',
                type: 'roomInfoPanel',
                visible: true,
                x: 0,
                y: 8,
                w: 6,
                h: 3,
            },
            {
                id: 'page-membersPanel',
                type: 'membersPanel',
                visible: true,
                x: 0,
                y: 0,
                w: 6,
                h: 14,
            },
        ],
    },
    {
        version: 1,
        columns: 32,
        rows: 18,
        getKnownLayoutItemTypes: () =>
            new Set(['membersPanel', 'mediaControlsPanel', 'chatPanel']),
        normalizeLayoutItemType: (type) => type,
        getLegacyRemoteLayoutPeerId: () => null,
        normalizeRemotePeerLayoutId: (id) => id,
        remotePeerType: 'remotePeer',
        singletonTypes: new Set([
            'membersPanel',
            'mediaControlsPanel',
            'chatPanel',
        ]),
        normalizeAutoLayoutGrid: (type, grid) => grid,
        normalizeZIndex: (z) => Number(z) || 0,
        normalizeComponentConfig: () => ({}),
    }
);
assert.deepEqual(
    Array.from(normalizedLegacyPanelItems, (item) => item.type),
    ['membersPanel'],
    'saved stagePanel and standalone roomInfoPanel entries must be filtered before rendering'
);
const migratedLegacyMediaDockItems = storageApi.normalizeLoadedLayoutItems(
    {
        version: 1,
        items: [
            {
                id: 'page-mediaControlsPanel',
                type: 'mediaControlsPanel',
                visible: false,
                x: 10,
                y: 15,
                w: 12,
                h: 3,
            },
            {
                id: 'page-chatPanel',
                type: 'chatPanel',
                visible: true,
                x: 26,
                y: 0,
                w: 6,
                h: 18,
            },
        ],
    },
    {
        version: 2,
        supportedVersions: [1],
        columns: 32,
        rows: 18,
        getKnownLayoutItemTypes: () =>
            new Set(['membersPanel', 'mediaControlsPanel', 'chatPanel']),
        normalizeLayoutItemType: (type) => type,
        getLegacyRemoteLayoutPeerId: () => null,
        normalizeRemotePeerLayoutId: (id) => id,
        remotePeerType: 'remotePeer',
        singletonTypes: new Set([
            'membersPanel',
            'mediaControlsPanel',
            'chatPanel',
        ]),
        normalizeAutoLayoutGrid: (type, grid) => grid,
        normalizeZIndex: (z) => Number(z) || 0,
        normalizeComponentConfig: () => ({}),
        migrateLoadedLayoutItem: ({ item, itemId, payloadVersion, type }) => {
            if (
                payloadVersion < 2 &&
                itemId === 'page-mediaControlsPanel' &&
                type === 'mediaControlsPanel' &&
                (Number(item.w) >= 8 || Number(item.h) <= 3)
            ) {
                return {
                    ...item,
                    x: 0,
                    y: 12,
                    w: 4,
                    h: 6,
                    visible: true,
                };
            }

            return item;
        },
    }
);
const migratedMediaDockItem = migratedLegacyMediaDockItems.find(
    (item) => item.id === 'page-mediaControlsPanel'
);
assert.ok(
    migratedMediaDockItem,
    'legacy mediaControlsPanel item must survive migration'
);
assert.equal(
    migratedMediaDockItem.type,
    'mediaControlsPanel',
    'legacy mediaControlsPanel item must keep its current type'
);
assert.deepEqual(
    { ...migratedMediaDockItem.grid },
    { x: 0, y: 12, w: 4, h: 6 },
    'legacy wide mediaControlsPanel grid must migrate to the left-bottom 4x6 dock default'
);
assert.equal(
    migratedMediaDockItem.visible,
    true,
    'legacy hidden mediaControlsPanel must become visible after dock migration'
);
assert.match(
    pageLayoutRuntime,
    /installDebugRuntime\(\);\s*return\s*\{\s*bootstrap,/,
    'window.__voiceLayoutDebug must be installed before runtime bootstrap is returned'
);
assertSourceContains(
    pageLayoutRuntime,
    'page layout runtime behavior contract',
    [
        [
            /pageTiles:\s*documentRef\.querySelectorAll/,
            'dumpDom must report pageTiles',
        ],
        [
            /showRecoveryToolbar\(\)/,
            'debug API must expose showRecoveryToolbar()',
        ],
        [
            /footer\.hidden = true/,
            'real DOM page panels must hide footer labels',
        ],
        [
            /title\.textContent = label/,
            'page-level panels must keep a visible title in the tile header',
        ],
        [
            /avatar\?\.remove\(\)/,
            'page-level panel headers must remove the leading avatar/icon marker',
        ],
        [
            /const ensurePanelShellActions = \(tile, type\) => \{[\s\S]*?panelConfig\.canCollapse[\s\S]*?panelConfig\.canPin/,
            'panel shell actions must place collapse before pin while using registry capabilities',
        ],
        [
            /action:\s*'collapse'[\s\S]*?onTogglePanelCollapse[\s\S]*?action:\s*'pin'[\s\S]*?onTogglePanelPin/,
            'panel shell actions must place the collapse button to the left of the top-right pin button',
        ],
        [
            /pointerdown[\s\S]*?stopPanelActionEvent[\s\S]*?click[\s\S]*?stopPanelActionEvent/,
            'panel action buttons must block pointerdown and click from starting panel drag',
        ],
        [
            /roomPanelContent\.append\(membersEl\)/,
            'membersPanel must keep channel/member content while local identity lives in the media dock',
        ],
        [
            /node:\s*mediaControlsEl/,
            'mediaControlsPanel must move the real #buttons node instead of cloning controls',
        ],
        [
            /nextBoard\.append\(runtimeVideoGrid\)/,
            '#video-grid must be moved as the direct workspace video layer',
        ],
    ]
);
assertSourceDoesNotContain(
    pageLayoutRuntime,
    'page layout runtime behavior contract',
    [
        [/stagePanel/, 'runtime must not create or debug a stagePanel'],
        [/舞台 Stage/, 'runtime must not expose the Stage panel label'],
        [
            /ROOM_INFO_PANEL|roomInfoPanel/,
            'runtime must not create a standalone roomInfoPanel',
        ],
        [
            /action:\s*'hide'/,
            'panel shell titlebar must not render hide action',
        ],
    ]
);
assertSourceContains(script, 'page layout behavior contract', [
    [
        /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?return;/,
        'renderLayoutComponentTile must return before replacing real DOM panel bodies',
    ],
    [
        /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?savedItem[\s\S]*?savedItem\?\.config[\s\S]*?config,/,
        'real DOM page panels must restore saved config such as freeMove while rendering',
    ],
    [
        /layout-component-toolbar/,
        'layout controls must use an external floating component toolbar',
    ],
    [
        /positionLayoutComponentToolbar/,
        'component toolbar position must be recalculated from tile bounds',
    ],
    [
        /const getPanelCollapsedHeight = \(\) => \{[\s\S]*?PAGE_GRID_ROWS[\s\S]*?\};[\s\S]*?const togglePanelCollapse = \(tile\) => \{[\s\S]*?expandedHeight[\s\S]*?getPanelCollapsedHeight\(\)[\s\S]*?savePanelItemState/,
        'collapse must use the one-grid titlebar height while preserving expanded height and saving panel state through the shared path',
    ],
    [
        /const togglePanelPin = \(tile\) => \{[\s\S]*?const currentLayout = item\.layout \|\| getCurrentTileLayout\(tile\)[\s\S]*?getNextTileLayoutZIndexForBand\(nextPinned\)[\s\S]*?savePanelItemState/,
        'pin must save state without remeasuring panel coordinates',
    ],
    [
        /const setLayoutLocked = \(locked\) => \{[\s\S]*?layoutLocked = Boolean\(locked\)[\s\S]*?syncLayoutEditModeUI\(\)/,
        'layout lock must be optional session state wired through the layout UI',
    ],
    [/freeMove:\s*false/, 'layout item config must persist a freeMove flag'],
    [/isTileFreeMoveEnabled/, 'freeMove must affect normal-mode tile movement'],
]);
assertSourceContains(pageLayoutRecoveryUi, 'page-layout-recovery-ui.js', [
    [/bar\.hidden = true/, 'recovery toolbar must be hidden by default'],
]);
assertSourceContains(videoTileStructureUi, 'video-tile-structure-ui.js', [
    [/header\.className = 'tile-header'/, 'tile headers must keep class name'],
    [/body'.*?'tile-body'/, 'tile bodies must keep class name'],
    [/overlay'.*?'tile-overlay'/, 'tile overlays must keep class name'],
    [/footer'.*?'tile-footer'/, 'tile footers must keep class name'],
    [/actions'.*?'tile-actions'/, 'tile actions must keep class name'],
]);
assertSourceDoesNotContain(script, 'page layout behavior contract', [
    [
        /actions\.prepend\(removeButton\)/,
        'hide button must not be inserted inside the tile actions area',
    ],
]);
const togglePanelPinBody = getSourceBetween(
    script,
    /const togglePanelPin = \(tile\) => \{/,
    /\nconst isTileFreeMoveEnabled = /,
    'panel pin toggle helper'
);
assert.doesNotMatch(
    togglePanelPinBody,
    /applyTileLayout\(/,
    'pin/unpin must not apply left/top/width/height while toggling z-index'
);

assert.match(
    script,
    /finalizeLayoutEditing/,
    'clicking Done must finalize editing instead of only toggling edit mode'
);
assert.match(
    script,
    /snapAllLayoutItemsToGrid/,
    'finalize editing must snap all layout items to the grid'
);
const syncLayoutEditModeUiBody = getSourceBetween(
    pageLayoutEditorRuntime,
    /const syncEditModeUI = \(\) => \{/,
    /\n\s*const setEditMode = /,
    'layout edit mode UI sync helper'
);
const setLayoutEditModeBody = getSourceBetween(
    pageLayoutEditorRuntime,
    /const setEditMode = \(enabled\) => \{/,
    /\n\s*const toggleEditMode = /,
    'layout edit mode setter'
);
const toggleLayoutEditModeBody = getSourceBetween(
    pageLayoutEditorRuntime,
    /const toggleEditMode = \(\) => \{/,
    /\n\s*const showSaveStatus = /,
    'layout edit mode toggle'
);
const finalizeLayoutEditingBody = getSourceBetween(
    script,
    /const finalizeLayoutEditing = \(\) => \{/,
    /\nconst getLayoutStorageKey = /,
    'layout edit finalize helper'
);
assert.match(
    syncLayoutEditModeUiBody,
    /toolbarUI\.renderToolbarState\(\{[\s\S]*?editMode[\s\S]*?mainLayout[\s\S]*?pageLayoutBoard/,
    'layout edit UI sync must delegate toolbar state rendering from layoutEditMode'
);
assert.match(
    setLayoutEditModeBody,
    /setEditModeState\(enabled\)[\s\S]*?options\.syncLayoutGridMetadata\(\)[\s\S]*?syncEditModeUI\(\)/,
    'entering or leaving layout edit mode must update state, grid metadata, and UI together'
);
assert.match(
    script,
    /onExitEditMode:\s*\(\) => \{[\s\S]*?hideSnapPreview\(\)[\s\S]*?resetLayoutResizeCursor\(\)/,
    'leaving layout edit mode must clear snap preview and resize cursor state'
);
assert.match(
    toggleLayoutEditModeBody,
    /if \(editMode\) \{[\s\S]*?options\.onFinalizeLayoutEditing\(\)[\s\S]*?return;/,
    'clicking Done must use finalizeLayoutEditing instead of directly leaving edit mode'
);
assert.match(
    toggleLayoutEditModeBody,
    /setEditMode\(true\)/,
    'clicking Edit Layout must enter layout edit mode through setLayoutEditMode(true)'
);
assert.match(
    finalizeLayoutEditingBody,
    /setLayoutEditMode\(false\)[\s\S]*?hideSnapPreview\(\)[\s\S]*?resetLayoutResizeCursor\(\)[\s\S]*?layoutSnapUtils\.snapAllLayoutItemsToGrid\([\s\S]*?saveLayoutToStorage\(/,
    'finalizing layout edit mode must leave edit mode before snap/save cleanup so the UI responds immediately'
);
assert.match(
    script,
    /const saveLayoutToStorage = \(message = '已保存'\) => \{[\s\S]*?pageLayoutStoreRuntime\?\.saveLayoutToStorage\(message\)/,
    'saveLayoutToStorage wrapper must delegate persistence to PageLayoutStoreRuntime'
);
assert.match(
    script,
    /const loadLayoutFromStorage = \(\) =>[\s\S]*?pageLayoutStoreRuntime\?\.loadLayoutFromStorage\(\)/,
    'loadLayoutFromStorage wrapper must delegate loading to PageLayoutStoreRuntime'
);
assert.match(
    script,
    /showSnapPreview/,
    'dragging and resizing must expose a snap preview state'
);
const showSnapPreviewBody = script.slice(
    script.indexOf('const showSnapPreview = '),
    script.indexOf('const hideSnapPreview = ')
);
assert.ok(showSnapPreviewBody, 'showSnapPreview body should be inspectable');
assert.doesNotMatch(
    showSnapPreviewBody,
    /layoutEditMode/,
    'snap preview must also be available for normal-mode freeMove dragging'
);
assert.match(
    showSnapPreviewBody,
    /layoutSnapUtils\.snapTileLayoutToGrid\([\s\S]*?layoutEditUI\.showSnapPreview/,
    'snap preview must pass a snapped layout to the edit UI helper'
);
assert.match(
    script,
    /hideSnapPreview/,
    'snap preview must be hidden after interactions and when leaving edit mode'
);
assert.match(
    script,
    /const canDragLayoutItem = /,
    'layout dragging eligibility must be centralized'
);
assert.match(
    script,
    /const canDragLayoutItem = [\s\S]*?!layoutLocked[\s\S]*?layoutEditMode[\s\S]*?\|\|[\s\S]*?freeMove\s*===\s*true/,
    'panels must be draggable by default unless locked, while freeMove=true still allows normal-mode tile dragging'
);
assert.match(
    script,
    /const canResizeLayoutItem = [\s\S]*?!layoutLocked[\s\S]*?layoutEditMode[\s\S]*?canResize/,
    'layout lock must disable panel resize while edit mode still gates resizing'
);
assert.match(
    script,
    /const shouldIgnoreLayoutDragTarget = /,
    'interactive controls must be excluded from layout drag starts'
);
const ignoreDragTargetBody = script.slice(
    script.indexOf('const shouldIgnoreLayoutDragTarget = '),
    script.indexOf('const findLayoutComponentToolbar = ')
);
[
    'input',
    'textarea',
    'button',
    'select',
    'a',
    '[contenteditable]',
    '.panel-action-button',
].forEach((selector) => {
    assert.ok(
        ignoreDragTargetBody.includes(`'${selector}'`),
        `drag ignore list must include ${selector}`
    );
});
assert.match(
    script,
    /const finalizeLayoutItemDrag = [\s\S]*?snapTileLayoutToGrid[\s\S]*?saveLayoutToStorage[\s\S]*?hideSnapPreview/,
    'drag finish must snap, save, and hide the preview through one path'
);
const singleTileSnapBody = getSourceBetween(
    script,
    /const snapTileLayoutToGridForTile = \(tile\) => \{/,
    /\nconst markTileLayoutUserPlaced = /,
    'single-tile snap helper'
);
const finalizeLayoutItemDragBody = getSourceBetween(
    script,
    /const finalizeLayoutItemDrag = \(tile\) => \{/,
    /\nconst finishTileLayoutInteraction = /,
    'drag finish helper'
);
const finishTileLayoutInteractionBody = getSourceBetween(
    script,
    /const finishTileLayoutInteraction = \(tile\) => \{/,
    /\nconst clampPositionedTileLayouts = /,
    'layout interaction finish helper'
);
assert.match(
    singleTileSnapBody,
    /layoutSnapUtils\.snapTileLayoutToGridForTile\(/,
    'single-tile snap helper must delegate to PageLayoutSnapUtils'
);
assert.match(
    finalizeLayoutItemDragBody,
    /snapTileLayoutToGridForTile\(tile\)/,
    'drag finish must snap the single tile before saving after normal or editing drag'
);
assert.match(
    finishTileLayoutInteractionBody,
    /finalizeLayoutItemDrag\(tile\)/,
    'normal and editing drag/resize finish must enter the shared single-tile snap path'
);
assert.match(
    script,
    /const applySavedTileLayout = [\s\S]*?upsertTileLayoutItem[\s\S]*?config:\s*layoutItem\.config/,
    'saved layout config such as freeMove must be restored when a tile is loaded'
);
assert.match(
    pageLayoutComponentRuntime,
    /const applyPageLayoutItemToPanel = [\s\S]*?upsertTileLayoutItem[\s\S]*?config:\s*item\.config/,
    'page-level saved layout config must be restored during storage initialization'
);
assert.match(
    script,
    /const detectTileResizeDirection = [\s\S]*?layoutResizeUtils\.detectTileResizeDirection/,
    'resize must use delegated tile-edge hit testing, not only tiny handle targets'
);
assert.match(
    script,
    /const resolveTileResizeLayout = [\s\S]*?layoutResizeUtils\.resolveTileResizeLayout[\s\S]*?clampTileLayout/,
    'resize layout calculation must delegate pure math while preserving script clamp semantics'
);
assert.match(
    script,
    /const finishTileLayoutInteraction = [\s\S]*?finalizeLayoutItemDrag/,
    'drag and resize finish must use the shared finalize path'
);
assert.match(
    pageLayoutConfig,
    /const AUTO_LAYOUT_GRID_SIZES = [\s\S]*?\[LAYOUT_ITEM_TYPES\.LOCAL_PEER\]:\s*\{\s*w:\s*5,\s*h:\s*4\s*\}[\s\S]*?\[LAYOUT_ITEM_TYPES\.REMOTE_PEER\]:\s*\{\s*w:\s*5,\s*h:\s*4\s*\}[\s\S]*?\[LAYOUT_ITEM_TYPES\.SCREEN_SHARE\]:\s*\{\s*w:\s*14,\s*h:\s*9\s*\}/,
    'auto-placed voice and screen-share tiles must use the requested default grid sizes'
);
assert.match(
    script,
    /const getOccupiedLayoutRects = /,
    'auto placement must collect occupied layout rects'
);
assert.match(
    pageLayoutPlacementUtils,
    /const rectOverlapArea = /,
    'auto placement must score overlap area in placement utils'
);
assert.match(
    script,
    /const isRectWithinGrid = [\s\S]*?layoutPlacementUtils\.isRectWithinGrid/,
    'auto placement must delegate out-of-grid rejection'
);
assert.match(
    pageLayoutPlacementUtils,
    /const scoreLayoutSlot = /,
    'auto placement must score candidate slots in placement utils'
);
assert.match(
    script,
    /const findAvailableLayoutSlot = [\s\S]*?layoutPlacementUtils\.findAvailableLayoutSlot[\s\S]*?occupiedRects:\s*getOccupiedLayoutRects\(options\.excludeId\)/,
    'auto placement must delegate slot search while script supplies occupied rects'
);
assert.match(
    script,
    /const applySavedTileLayout = [\s\S]*?savedItem[\s\S]*?findAvailableLayoutSlot[\s\S]*?upsertTileLayoutItem/,
    'tiles without saved layout should use auto slot placement before being synced'
);
assertSourceDoesNotContain(script, 'auto placement', [
    [
        /x:\s*13\s*\+\s*\(remoteIndex\s*%\s*3\)\s*\*\s*2/,
        'remote peer placement must not use the old fixed x=13 stagger',
    ],
    [
        /y:\s*7\s*\+\s*\(remoteIndex\s*%\s*3\)\s*\*\s*2/,
        'remote peer placement must not use the old fixed y=7 stagger',
    ],
    [
        /x:\s*8,\s*y:\s*2,\s*w:\s*16,\s*h:\s*10/,
        'screen-share placement must not use the old fixed 16x10 slot',
    ],
]);
assert.match(
    script,
    /const markTileLayoutUserPlaced = [\s\S]*?userPlaced:\s*true/,
    'manual drag/resize must mark auto-placed media tiles as userPlaced'
);
assert.match(
    script,
    /const finalizeLayoutItemDrag = [\s\S]*?markTileLayoutUserPlaced[\s\S]*?saveLayoutToStorage/,
    'drag finish must persist the userPlaced flag before saving'
);
assert.match(
    pageLayoutComponentRuntime,
    /const applyStoredLayoutToExistingTile = [\s\S]*?if \(!tile\) \{[\s\S]*?return;/,
    'saved remote/screen-share layout must not create fake online tiles'
);

const toolbarMatch = style.match(
    /\.stage-layout-toolbar\s*\{(?<body>[\s\S]*?)\}/
);
const secondaryActionsMatch = style.match(
    /\.layout-edit-secondary-actions\s*\{(?<body>[\s\S]*?)\}/
);
const toolButtonMatch = style.match(
    /\.layout-edit-toggle,\s*\.layout-tool-button\s*\{(?<body>[\s\S]*?)\}/
);
const componentToolbarMatch = style.match(
    /\.layout-component-toolbar\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(toolbarMatch, 'page-level layout toolbar style must exist');
assert.ok(secondaryActionsMatch, 'secondary topbar actions style must exist');
assert.ok(toolButtonMatch, 'layout action button style must exist');
assert.ok(componentToolbarMatch, 'component floating toolbar style must exist');
assert.match(
    pageLayoutToolbarUi,
    /page-layout-topbar/,
    'topbar must use a stable page-layout-topbar container'
);
assert.match(
    pageLayoutToolbarUi,
    /layout-edit-primary-button/,
    'edit/done toggle must have a fixed primary button class'
);
assert.match(
    pageLayoutToolbarUi,
    /layout-edit-secondary-actions/,
    'secondary layout actions must not affect primary button coordinates'
);
assert.match(
    pageLayoutToolbarUi,
    /layoutLockToggle[\s\S]*?aria-pressed[\s\S]*?锁定布局/,
    'toolbar must expose an optional layout lock toggle without making it the default mode'
);
assert.match(
    pageLayoutToolbarUi,
    /labelText:\s*'编辑'/,
    'normal layout toolbar state must expose only the concise Edit entry'
);
assert.match(
    pageLayoutToolbarUi,
    /addComponentToggle\.hidden = true[\s\S]*?lockLayoutToggle\.hidden = true[\s\S]*?resetDefaultButton\.hidden = true[\s\S]*?saveStatus\.hidden = true/,
    'toolbar must create secondary edit controls hidden in normal mode'
);
assert.match(
    pageLayoutToolbarUi,
    /setButtonLabel\(editModeToggle,\s*editMode \? '完成' : '编辑'\)/,
    'edit toggle must switch between Edit and Done without keeping Edit Layout visible'
);
assert.match(
    pageLayoutToolbarUi,
    /toolbar\.dataset\.editing = String\(editMode\)[\s\S]*?toolbar\.classList\.toggle\('is-layout-editing', editMode\)/,
    'toolbar render must synchronize data-editing and editing class state'
);
assert.match(
    pageLayoutToolbarUi,
    /addComponentToggle\.hidden = !editMode[\s\S]*?lockLayoutToggle\.hidden = !editMode[\s\S]*?resetDefaultButton\.hidden = !editMode/,
    'components, lock, and reset controls must only appear while editing'
);
assert.match(
    pageLayoutEditorRuntime,
    /toolbar:\s*toolbarRefs\.toolbar/,
    'editor runtime must pass the toolbar node into state rendering'
);
assert.match(
    pageLayoutEditorRuntime,
    /toggleComponentMenu[\s\S]*?if \(!toolbarRefs\.componentMenu\)[\s\S]*?renderComponentMenu/,
    'components menu must remain available as the unified restore entry for hidden panels'
);
assert.match(
    toolbarMatch.groups.body,
    /position:\s*fixed/,
    'page-level layout toolbar must be fixed to the viewport'
);
const topToolbarZ = Number(
    toolbarMatch.groups.body.match(/z-index:\s*(\d+)/)?.[1]
);
const componentToolbarZ = Number(
    componentToolbarMatch.groups.body.match(/z-index:\s*(\d+)/)?.[1]
);
assert.ok(
    Number.isFinite(topToolbarZ) &&
        Number.isFinite(componentToolbarZ) &&
        topToolbarZ > componentToolbarZ,
    'page-level layout toolbar z-index must be higher than component toolbar'
);
assert.match(
    style,
    /\.layout-edit-primary-button[\s\S]*?width:\s*(?:11|12|13|14)\dpx/,
    'edit/done button must use a stable fixed width'
);
assert.match(
    style,
    /\.layout-edit-secondary-actions/,
    'secondary actions must be styled separately from the fixed primary button'
);
assert.match(
    style,
    /\.layout-snap-preview/,
    'style must define a visible snap preview overlay'
);
assert.match(
    style,
    /\.panel-shell-actions[\s\S]*?\.panel-action-button/,
    'style must define unified panel action buttons'
);
assert.match(
    style,
    /\.panel-shell-actions[\s\S]*?position:\s*absolute[\s\S]*?top:\s*6px[\s\S]*?right:\s*10px/,
    'panel shell actions must sit in the titlebar top-right corner'
);
assert.match(
    style,
    /\.panel-shell-actions[\s\S]*?opacity:\s*0[\s\S]*?pointer-events:\s*none/,
    'panel shell actions must stay hidden until hover/focus/editing'
);
assert.match(
    style,
    /\.page-layout-tile:hover \.panel-shell-actions[\s\S]*?\.page-layout-board\.is-layout-editing \.panel-shell-actions[\s\S]*?opacity:\s*1[\s\S]*?pointer-events:\s*auto/,
    'panel shell actions must show on hover, focus, selection, or layout editing'
);
assert.match(
    style,
    /\.page-layout-tile \.tile-avatar[\s\S]*?display:\s*none/,
    'page panel headers must hide the leading avatar marker'
);
assert.match(
    style,
    /\.page-layout-tile\.is-panel-collapsed[\s\S]*?\.tile-body[\s\S]*?display:\s*none/,
    'collapsed panels must hide content while preserving the shell header'
);
assert.match(
    style,
    /#buttons\.media-dock[\s\S]*?position:\s*relative[\s\S]*?width:\s*100%[\s\S]*?height:\s*auto[\s\S]*?min-height:\s*58px/,
    'media dock must stay compact inside mediaControlsPanel instead of using viewport-fixed positioning or filling the full panel height'
);
const mediaDockStyleMatch = style.match(
    /#buttons\.media-dock\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(mediaDockStyleMatch, 'media dock base style must exist');
assert.doesNotMatch(
    mediaDockStyleMatch.groups.body,
    /position:\s*fixed|left:\s*max\(16px, env\(safe-area-inset-left\)\)|bottom:\s*max\(16px, env\(safe-area-inset-bottom\)\)/,
    'normal mode media dock must not escape the page layout system with fixed left-bottom positioning'
);
assert.match(
    style,
    /\.page-layout-board:not\(\.is-layout-editing\)[\s\S]*?\.page-tile-media-controls-panel[\s\S]*?background:\s*transparent[\s\S]*?\.tile-header[\s\S]*?display:\s*none/,
    'old mediaControlsPanel shell must be hidden outside layout editing'
);
assert.match(
    style,
    /\.page-layout-board:not\(\.is-layout-editing\) \.page-tile-media-controls-panel[\s\S]*?display:\s*block/,
    'normal mode must not display-none the mediaControlsPanel that contains the dock'
);
const normalMediaPanelStyleMatch = style.match(
    /\.page-layout-board:not\(\.is-layout-editing\) \.page-tile-media-controls-panel\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(
    normalMediaPanelStyleMatch,
    'normal mode mediaControlsPanel style must exist'
);
assert.doesNotMatch(
    normalMediaPanelStyleMatch.groups.body,
    /position:\s*static/,
    'normal mode mediaControlsPanel must keep layout runtime positioning'
);
assert.match(
    style,
    /#buttons\.media-dock\.hidden[\s\S]*?display:\s*grid !important/,
    'normal mode hidden state must not hide the real media dock body'
);
assert.doesNotMatch(
    style,
    /page-tile-stage-panel|\.page-layout-tile \.room-stage/,
    'stage must stay as the direct workspace video layer, not a panel shell'
);
const boardMatch = style.match(/\.page-layout-board\s*\{(?<body>[\s\S]*?)\}/);
const boardEditingMatch = style.match(
    /\.page-layout-board\.is-layout-editing\s*\{(?<body>[\s\S]*?)\}/
);
const editingTileMatch = style.match(
    /\.page-layout-board\.is-layout-editing\s+\.video-tile\s*\{(?<body>[\s\S]*?)\}/
);
const mainMatch = style.match(/#main\s*\{(?<body>[\s\S]*?)\}/);
const getBackgroundSize = (body) =>
    body.match(/background-size:\s*(?<value>[\s\S]*?);/)?.groups.value.trim();
const getBackgroundPosition = (body) =>
    body
        .match(/background-position:\s*(?<value>[\s\S]*?);/)
        ?.groups.value.trim();
const pageTileHeaderMatch = style.match(
    /\.page-layout-tile \.tile-header\s*\{(?<body>[\s\S]*?)\}/
);
const pageTileFooterMatch = style.match(
    /\.page-layout-tile \.tile-footer\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(mainMatch, '#main base style must exist');
assert.ok(boardMatch, 'page layout board base style must exist');
assert.ok(boardEditingMatch, 'page layout board editing style must exist');
assert.ok(editingTileMatch, 'editing tile style must exist');
assert.ok(pageTileHeaderMatch, 'page tile header base style must exist');
assert.ok(pageTileFooterMatch, 'page tile footer base style must exist');
assert.doesNotMatch(
    mainMatch.groups.body,
    /radial-gradient/,
    '#main must not use a dot-board radial background'
);
assert.doesNotMatch(
    mainMatch.groups.body,
    /background-image:[\s\S]*linear-gradient\([^;]*1px/,
    '#main must not carry a separate grid definition'
);
assert.doesNotMatch(
    boardMatch.groups.body,
    /radial-gradient/,
    'normal-mode board must not use a dot-board radial background'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /radial-gradient/,
    'editing-mode board must not use a dot-board radial background'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-line-opacity:\s*0\.0[0-9]+/,
    'normal-mode board should define the soft grid opacity variable'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-line-color:\s*rgba\(\s*216,\s*111,\s*154,\s*var\(--layout-grid-line-opacity\)\s*\)/,
    'board grid line color should be derived from the shared opacity variable'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-size-x:\s*calc\(100%\s*\/\s*var\(--layout-grid-columns,\s*32\)\)/,
    'board grid width should reuse the page layout grid columns'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-size-y:\s*calc\(100%\s*\/\s*var\(--layout-grid-rows,\s*18\)\)/,
    'board grid height should reuse the page layout grid rows'
);
assert.match(
    boardMatch.groups.body,
    /--layout-tile-header-height:\s*calc\(\s*100vh\s*\/\s*var\(--layout-grid-rows,\s*18\)\s*\)/,
    'page tile titlebars should use one page-layout grid row'
);
assert.match(
    boardMatch.groups.body,
    /linear-gradient\(var\(--layout-grid-line-color\) 1px, transparent 1px\)/,
    'normal-mode board should use the shared linear grid background'
);
assert.match(
    boardMatch.groups.body,
    /border:\s*1px\s+solid\s+transparent/,
    'normal-mode board should reserve border space to prevent edit-mode shifting'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /border:\s*1px/,
    'editing board must not add a new border width that shifts the layout'
);
assert.match(
    boardEditingMatch.groups.body,
    /border-color:/,
    'editing board should enhance the pre-reserved border by color only'
);
assert.match(
    boardEditingMatch.groups.body,
    /--layout-grid-line-opacity:\s*0\.1[0-9]+/,
    'editing mode should enhance the same grid by changing opacity only'
);
assert.match(
    editingTileMatch.groups.body,
    /box-shadow:[\s\S]*?\binset\s+0\s+0\s+0\s+2px/,
    'editing tile highlight must use inset box-shadow so visual bounds do not exceed saved layout bounds'
);
assert.doesNotMatch(
    editingTileMatch.groups.body,
    /box-shadow:[\s\S]*?(?<!inset\s)0\s+0\s+0\s+2px/,
    'editing tile highlight must not use an outer 0 0 0 2px box-shadow that exceeds the true layout boundary'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-image:/,
    'editing mode must not define a separate background image'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-size:/,
    'editing mode must not define a separate background size'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-position:/,
    'editing mode must not define a separate background position'
);
assert.match(
    getBackgroundSize(boardMatch.groups.body) || '',
    /var\(--layout-grid-size-x\)\s+var\(--layout-grid-size-y\)/,
    'page board grid should use shared grid-size variables'
);
assert.match(
    getBackgroundPosition(boardMatch.groups.body) || '',
    /0\s+0/,
    'page board grid should use a stable origin'
);
assert.match(
    secondaryActionsMatch.groups.body,
    /width:\s*max-content/,
    'secondary topbar actions should size to their content instead of squeezing buttons'
);
assert.match(
    secondaryActionsMatch.groups.body,
    /flex-wrap:\s*nowrap/,
    'secondary topbar actions must remain horizontal'
);
assert.match(
    toolButtonMatch.groups.body,
    /white-space:\s*nowrap/,
    'layout action buttons must not wrap Chinese labels vertically'
);
assert.match(
    toolButtonMatch.groups.body,
    /flex:\s*0\s+0\s+auto/,
    'layout action buttons must not shrink into vertical labels'
);
assert.doesNotMatch(
    pageTileHeaderMatch.groups.body,
    /display:\s*none/,
    'normal-mode page tiles must keep title headers visible'
);
assert.match(
    pageTileHeaderMatch.groups.body,
    /height:\s*var\(--layout-tile-header-height\)[\s\S]*?min-height:\s*var\(--layout-tile-header-height\)/,
    'normal-mode page tile headers should stay exactly one layout grid row tall'
);
assert.match(
    pageTileFooterMatch.groups.body,
    /display:\s*none/,
    'bottom footer labels must remain hidden'
);
assert.match(
    style,
    /--resize-hit-corner:\s*(?:1[6-9]|2[0-4])px/,
    'corner resize hit area should be 16-24px'
);
