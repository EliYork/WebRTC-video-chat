import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
        path: '/js/view-utils.js',
        sourcePath: '../src/views/js/view-utils.js',
        namespace: 'VoiceViewUtils',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: false,
    },
    {
        path: '/js/noise-settings-ui.js',
        sourcePath: '../src/views/js/noise-settings-ui.js',
        namespace: 'VoiceNoiseSettingsUI',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
    },
    {
        path: '/js/control-popovers-ui.js',
        sourcePath: '../src/views/js/control-popovers-ui.js',
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
    },
    {
        path: '/js/peer-volume-ui.js',
        sourcePath: '../src/views/js/peer-volume-ui.js',
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
        path: '/js/copy-link-ui.js',
        sourcePath: '../src/views/js/copy-link-ui.js',
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
    },
    {
        path: '/js/output-volume-state.js',
        sourcePath: '../src/views/js/output-volume-state.js',
        namespace: 'VoiceOutputVolumeState',
        mustLoadBeforeMain: true,
        dependsOnViewUtils: true,
        forbiddenKeywords: [
            'new Peer',
            'Peer(',
            'RTCPeerConnection',
            'socket.emit',
            'socket.on',
            'navigator.mediaDevices',
            'getUserMedia',
            'getDisplayMedia',
            'MediaStream',
            'mediaElement.volume',
            'mediaElement.muted',
            'applyOutputSettings',
            'applyOutputSettingsToRemoteMedia',
            'addEventListener',
        ],
        requiredExports: [
            [
                /getPeerVolumes/,
                'output volume state must expose volume map read',
            ],
            [/getPeerVolume/, 'output volume state must expose per-peer read'],
            [/setPeerVolume/, 'output volume state must expose per-peer write'],
            [
                /getEffectiveVolume/,
                'output volume state must expose effective volume calculation',
            ],
            [
                /voice-room-peer-volumes-v1/,
                'output volume state must preserve peer volume storage key',
            ],
        ],
    },
    {
        path: '/js/output-volume-ui.js',
        sourcePath: '../src/views/js/output-volume-ui.js',
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
        path: '/js/media-controls-ui.js',
        sourcePath: '../src/views/js/media-controls-ui.js',
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
        ],
    },
    {
        path: '/js/fullscreen-controls.js',
        sourcePath: '../src/views/js/fullscreen-controls.js',
        namespace: 'VoiceFullscreenControls',
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
            'saveLayoutToStorage',
            'normalizeLoadedLayoutItems',
            'detectTileResizeDirection',
            'startTileResize',
        ],
    },
    {
        path: '/js/voice-join-overlay-ui.js',
        sourcePath: '../src/views/js/voice-join-overlay-ui.js',
        namespace: 'VoiceJoinOverlayUI',
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
            'setViewingRoom',
            'setVoiceTargetRoom',
        ],
    },
    {
        path: '/js/page-layout-snap-utils.js',
        sourcePath: '../src/views/js/page-layout-snap-utils.js',
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
        path: '/js/page-layout-resize-utils.js',
        sourcePath: '../src/views/js/page-layout-resize-utils.js',
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
        path: '/js/page-layout-edit-ui.js',
        sourcePath: '../src/views/js/page-layout-edit-ui.js',
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
        path: '/js/page-layout-component-actions-ui.js',
        sourcePath: '../src/views/js/page-layout-component-actions-ui.js',
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
        path: '/js/page-layout-storage.js',
        sourcePath: '../src/views/js/page-layout-storage.js',
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
                /item\.type === 'stagePanel'[\s\S]*?return null;/,
                'normalizeLoadedLayoutItems must ignore saved stagePanel entries',
            ],
        ],
    },
    {
        path: '/js/page-layout-config.js',
        sourcePath: '../src/views/js/page-layout-config.js',
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
        path: '/js/page-layout-ids.js',
        sourcePath: '../src/views/js/page-layout-ids.js',
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
        path: '/js/page-layout-components.js',
        sourcePath: '../src/views/js/page-layout-components.js',
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
                /SIDEBAR_PANEL[\s\S]*?grid:\s*\{\s*x:\s*0,\s*y:\s*0,\s*w:\s*5,\s*h:\s*18\s*\}/,
                'default sidebarPanel layout must stay unchanged',
            ],
            [
                /CHAT_PANEL[\s\S]*?grid:\s*\{\s*x:\s*26,\s*y:\s*0,\s*w:\s*6,\s*h:\s*18\s*\}/,
                'default chatPanel layout must stay unchanged',
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
        path: '/js/page-layout-toolbar-ui.js',
        sourcePath: '../src/views/js/page-layout-toolbar-ui.js',
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
        ],
    },
    {
        path: '/js/page-layout-component-menu-ui.js',
        sourcePath: '../src/views/js/page-layout-component-menu-ui.js',
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
        path: '/js/page-layout-recovery-ui.js',
        sourcePath: '../src/views/js/page-layout-recovery-ui.js',
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
        path: '/js/room-ui-state.js',
        sourcePath: '../src/views/js/room-ui-state.js',
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
        path: '/js/mobile-room-state.js',
        sourcePath: '../src/views/js/mobile-room-state.js',
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
        path: '/js/presence-view-model.js',
        sourcePath: '../src/views/js/presence-view-model.js',
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
        path: '/js/participants-list-ui.js',
        sourcePath: '../src/views/js/participants-list-ui.js',
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
        path: '/js/tile-status-ui.js',
        sourcePath: '../src/views/js/tile-status-ui.js',
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
        path: '/js/video-tile-structure-ui.js',
        sourcePath: '../src/views/js/video-tile-structure-ui.js',
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
        path: '/js/chat-message-ui.js',
        sourcePath: '../src/views/js/chat-message-ui.js',
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
        path: '/js/chat-form-ui.js',
        sourcePath: '../src/views/js/chat-form-ui.js',
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
        path: '/js/channel-sidebar-ui.js',
        sourcePath: '../src/views/js/channel-sidebar-ui.js',
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
        path: '/js/cursor-share-ui.js',
        sourcePath: '../src/views/js/cursor-share-ui.js',
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
const pageLayoutStorage = getModuleSource('/js/page-layout-storage.js');
const pageLayoutConfig = getModuleSource('/js/page-layout-config.js');
const pageLayoutIds = getModuleSource('/js/page-layout-ids.js');
const pageLayoutComponents = getModuleSource('/js/page-layout-components.js');
const pageLayoutToolbarUi = getModuleSource('/js/page-layout-toolbar-ui.js');
const pageLayoutRecoveryUi = getModuleSource('/js/page-layout-recovery-ui.js');
const videoTileStructureUi = getModuleSource('/js/video-tile-structure-ui.js');
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
    assertScriptBeforeMain('/js/view-utils.js');

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
                path !== '/js/view-utils.js' &&
                (dependsOnViewUtils || source.includes('VoiceViewUtils'))
            ) {
                assertScriptBefore('/js/view-utils.js', path);
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

assert.match(
    roomIndex,
    /<aside\b[^>]*id="chat-panel"[^>]*class="chat-panel"[\s\S]*?<form\b[^>]*id="chatForm"[\s\S]*?<textarea\b[^>]*id="chatInput"/,
    '.chat-panel must remain intact and contain #chatForm / #chatInput'
);

assertSourceContains(script, 'page layout base contract', [
    [
        /PAGE_LAYOUT_STORAGE_KEY_PREFIX\s*=\s*'voicePageLayout:v2'/,
        'page layout must use the v2 storage key',
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
        /CHAT_PANEL:\s*'chatPanel'/,
        'chatPanel must be a first-class page component',
    ],
]);
const pageComponentTypesMatch = pageLayoutConfig.match(
    /const PAGE_COMPONENT_TYPES = \{(?<body>[\s\S]*?)\};/
);
assert.ok(pageComponentTypesMatch, 'PAGE_COMPONENT_TYPES must be inspectable');
assertSourceDoesNotContain(
    pageComponentTypesMatch.groups.body,
    'PAGE_COMPONENT_TYPES',
    [[/CHAT_INPUT/, 'PAGE_COMPONENT_TYPES must not restore CHAT_INPUT']]
);
assertSourceDoesNotContain(script, 'page layout base contract', [
    [/STAGE_PANEL:\s*'stagePanel'/, 'stagePanel must not be a page component'],
]);
assertSourceDoesNotContain(pageLayoutConfig, 'page layout config contract', [
    [/STAGE_PANEL:\s*'stagePanel'/, 'stagePanel must not be a page component'],
]);
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

const defaultsMatch = pageLayoutComponents.match(
    /const getDefaultLayoutItems = \(\) => \[(?<body>[\s\S]*?)\];/
);
assert.ok(
    defaultsMatch,
    'PageLayoutComponents.getDefaultLayoutItems should return a literal default layout'
);
const defaultBody = defaultsMatch.groups.body;

assertSourceContains(defaultBody, 'default page layout', [
    [/SIDEBAR_PANEL/, 'default layout includes sidebarPanel'],
    [/CHAT_PANEL/, 'default layout includes chatPanel'],
    [/LOCAL_PEER/, 'default layout includes localPeer'],
]);
assertSourceDoesNotContain(defaultBody, 'default page layout', [
    [
        /STAGE_PANEL|CHANNEL_SIDEBAR|SELF_STATUS|ROOM_INFO|CHAT_INPUT/,
        'default page layout must not include old split components',
    ],
]);

assertSourceContains(script, 'script.js', [
    {
        pattern: /const createPageTileFromNode = /,
        message: 'page layout must move existing DOM roots into tiles',
    },
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
    {
        pattern: /const validateDetachedPageLayoutBoard = /,
        message:
            'page layout must validate detached board content before replacing #main',
    },
]);
assertSourceContains(pageLayoutStorage, 'page-layout-storage.js', [
    [
        /item\.type === 'stagePanel'[\s\S]*?return null;/,
        'normalizeLoadedLayoutItems must ignore saved stagePanel entries',
    ],
]);
assert.ok(
    script.indexOf('window.__voiceLayoutDebug = {') <
        script.indexOf('_runPageLayoutInit();'),
    'window.__voiceLayoutDebug must be defined before page layout init runs'
);
assertSourceContains(script, 'page layout behavior contract', [
    [
        /pageTiles:\s*document\.querySelectorAll/,
        'dumpDom must report pageTiles',
    ],
    [/unexpectedStagePanel/, 'dumpDom must flag an unexpected stagePanel'],
    [
        /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?return;/,
        'renderLayoutComponentTile must return before replacing real DOM panel bodies',
    ],
    [
        /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?savedItem[\s\S]*?savedItem\?\.config[\s\S]*?config,/,
        'real DOM page panels must restore saved config such as freeMove while rendering',
    ],
    [/showRecoveryToolbar\(\)/, 'debug API must expose showRecoveryToolbar()'],
    [/footer\.hidden = true/, 'real DOM page panels must hide footer labels'],
    [
        /title\.textContent = label/,
        'page-level panels must keep a visible title in the tile header',
    ],
    [
        /avatar\.textContent = createTileAvatarText\(label\)/,
        'page-level panel headers must keep a leading avatar/icon marker',
    ],
    [
        /layout-component-toolbar/,
        'layout controls must use an external floating component toolbar',
    ],
    [
        /positionLayoutComponentToolbar/,
        'component toolbar position must be recalculated from tile bounds',
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
    script,
    /const syncLayoutEditModeUI = \(\) => \{/,
    /\nconst setLayoutEditMode = /,
    'layout edit mode UI sync helper'
);
const setLayoutEditModeBody = getSourceBetween(
    script,
    /const setLayoutEditMode = \(enabled\) => \{/,
    /\nconst toggleLayoutEditMode = /,
    'layout edit mode setter'
);
const toggleLayoutEditModeBody = getSourceBetween(
    script,
    /const toggleLayoutEditMode = \(\) => \{/,
    /\nconst updateMobileTileView = /,
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
    /layoutToolbarUI\.renderToolbarState\(\{[\s\S]*?editMode:\s*layoutEditMode[\s\S]*?mainLayout[\s\S]*?pageLayoutBoard/,
    'layout edit UI sync must delegate toolbar state rendering from layoutEditMode'
);
assert.match(
    setLayoutEditModeBody,
    /layoutEditMode\s*=\s*Boolean\(enabled\)[\s\S]*?syncLayoutGridMetadata\(\)[\s\S]*?syncLayoutEditModeUI\(\)/,
    'entering or leaving layout edit mode must update state, grid metadata, and UI together'
);
assert.match(
    setLayoutEditModeBody,
    /if \(!layoutEditMode\) \{[\s\S]*?hideSnapPreview\(\)[\s\S]*?resetLayoutResizeCursor\(\)/,
    'leaving layout edit mode must clear snap preview and resize cursor state'
);
assert.match(
    toggleLayoutEditModeBody,
    /if \(layoutEditMode\) \{[\s\S]*?finalizeLayoutEditing\(\)[\s\S]*?return;/,
    'clicking Done must use finalizeLayoutEditing instead of directly leaving edit mode'
);
assert.match(
    toggleLayoutEditModeBody,
    /setLayoutEditMode\(true\)/,
    'clicking Edit Layout must enter layout edit mode through setLayoutEditMode(true)'
);
assert.match(
    finalizeLayoutEditingBody,
    /layoutSnapUtils\.snapAllLayoutItemsToGrid\([\s\S]*?hideSnapPreview\(\)[\s\S]*?saveLayoutToStorage\([\s\S]*?setLayoutEditMode\(false\)/,
    'finalizing layout edit mode must snap all items, hide preview, save, and then leave edit mode'
);
assert.match(
    script,
    /const saveLayoutToStorage = \(message = '已保存'\) => \{[\s\S]*?layoutStorage\.saveLayoutToStorage\(/,
    'saveLayoutToStorage wrapper must delegate persistence to PageLayoutStorage'
);
assert.match(
    script,
    /const loadLayoutFromStorage = \(\) =>[\s\S]*?layoutStorage\.loadLayoutFromStorage\(/,
    'loadLayoutFromStorage wrapper must delegate loading to PageLayoutStorage'
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
    /const canDragLayoutItem = [\s\S]*?layoutEditMode[\s\S]*?\|\|[\s\S]*?freeMove\s*===\s*true/,
    'freeMove=true must allow normal-mode dragging'
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
['input', 'textarea', 'button', 'select', 'a', '[contenteditable]'].forEach(
    (selector) => {
        assert.ok(
            ignoreDragTargetBody.includes(`'${selector}'`),
            `drag ignore list must include ${selector}`
        );
    }
);
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
    script,
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
    script,
    /const rectOverlapArea = /,
    'auto placement must score overlap area'
);
assert.match(
    script,
    /const isRectWithinGrid = /,
    'auto placement must reject out-of-grid candidates'
);
assert.match(
    script,
    /const scoreLayoutSlot = /,
    'auto placement must score candidate slots'
);
assert.match(
    script,
    /const findAvailableLayoutSlot = /,
    'auto placement must have a shared findAvailableLayoutSlot helper'
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
    script,
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
    /min-height:\s*(?:3[0-9]|4[0-4])px/,
    'normal-mode page tile headers should stay compact'
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
