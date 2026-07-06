/* eslint-disable no-console */
console.info('[page-layout] script boot v2 ' + new Date().toISOString());
let socket;

const {
    byId,
    createGuestName,
    formatDuration,
    formatTime,
    queryAll,
    readJsonStorage,
    safeStorageGet,
    safeStorageSet,
    setHidden,
    setText,
    writeJsonStorage,
} = window.VoiceViewUtils;

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
const localUserName = byId('localUserName');
const localVoiceChannelName = byId('localVoiceChannelName');
const callStatusText = byId('callStatusText');
const callDuration = byId('callDuration');
const screenStatusText = byId('screenStatusText');
const toggleOutputBtn = byId('toggleOutput');
const outputVolumeInput = byId('outputVolume');
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
const remoteStreams = {};
const getAudioConstraints = () => noiseSettingsUI.getAudioConstraints();

const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name';
const PEER_VOLUME_STORAGE_KEY = 'voice-room-peer-volumes-v1';
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
const PAGE_COMPONENT_TYPES = {
    SIDEBAR_PANEL: 'sidebarPanel',
    CHAT_PANEL: 'chatPanel',
};
const PAGE_SINGLETON_TYPES = new Set([
    PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
    PAGE_COMPONENT_TYPES.CHAT_PANEL,
]);
const REAL_DOM_PAGE_TYPES = PAGE_SINGLETON_TYPES;
const PAGE_TILE_MIN_WIDTH = 160;
const PAGE_TILE_MIN_HEIGHT = 80;
const PAGE_COMPONENT_LABELS = {
    [PAGE_COMPONENT_TYPES.SIDEBAR_PANEL]: '左侧频道栏',
    [PAGE_COMPONENT_TYPES.CHAT_PANEL]: '聊天消息',
};
let pageLayoutBoard;
const LAYOUT_ITEM_TYPES = {
    LOCAL: 'local',
    LOCAL_PEER: 'localPeer',
    REMOTE_PEER: 'remotePeer',
    SCREEN_SHARE: 'screen-share',
    PLACEHOLDER: 'placeholder',
    ROOM: 'room',
    CHAT: 'chat',
};
const LEGACY_LAYOUT_ITEM_TYPES = {
    remotePeer: LAYOUT_ITEM_TYPES.REMOTE_PEER,
    'remote-peer': LAYOUT_ITEM_TYPES.REMOTE_PEER,
    screenShare: LAYOUT_ITEM_TYPES.SCREEN_SHARE,
};
const REMOTE_PEER_LAYOUT_ID_PREFIX = 'remotePeer:';
const AUTO_LAYOUT_GRID_SIZES = {
    [LAYOUT_ITEM_TYPES.LOCAL_PEER]: { w: 5, h: 4 },
    [LAYOUT_ITEM_TYPES.REMOTE_PEER]: { w: 5, h: 4 },
    [LAYOUT_ITEM_TYPES.SCREEN_SHARE]: { w: 14, h: 9 },
};
const COMPONENT_CONFIG_DEFAULTS = {
    [LAYOUT_ITEM_TYPES.ROOM]: {
        freeMove: true,
        showRoomName: true,
        showCopyLink: true,
        showMemberCount: true,
    },
    [LAYOUT_ITEM_TYPES.CHAT]: {
        freeMove: true,
        compactMode: false,
        showHeader: true,
    },
    [LAYOUT_ITEM_TYPES.LOCAL_PEER]: {
        freeMove: true,
        userPlaced: false,
        showSelfPreview: true,
        showControls: true,
    },
    [LAYOUT_ITEM_TYPES.REMOTE_PEER]: {
        freeMove: true,
        userPlaced: false,
        keepHiddenWhenRejoin: true,
        showPeerName: true,
    },
    [LAYOUT_ITEM_TYPES.SCREEN_SHARE]: {
        freeMove: true,
        userPlaced: false,
        autoShowScreenShare: true,
        showScreenHeader: true,
    },
};
const LAYOUT_PREFERENCE_DEFAULTS = {
    autoShowLocalPeer: true,
    autoShowRemotePeers: true,
    autoShowScreenShare: true,
    keepHiddenRemotePeers: true,
};
let layoutPreferences = { ...LAYOUT_PREFERENCE_DEFAULTS };

const getDefaultComponentConfig = (type) => {
    const defaults = COMPONENT_CONFIG_DEFAULTS[type];
    return defaults ? { ...defaults } : { freeMove: true };
};

const normalizeComponentConfig = (type, config = {}) => {
    const defaults = getDefaultComponentConfig(type);
    const result = {};
    for (const key of Object.keys(defaults)) {
        if (key in config && typeof config[key] === typeof defaults[key]) {
            result[key] = config[key];
        } else {
            result[key] = defaults[key];
        }
    }
    return result;
};

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

const getDefaultLayoutPreferences = () => ({ ...LAYOUT_PREFERENCE_DEFAULTS });

const normalizeLayoutPreferences = (prefs = {}) => {
    const defaults = getDefaultLayoutPreferences();
    const result = {};
    for (const key of Object.keys(defaults)) {
        result[key] =
            typeof prefs[key] === 'boolean' ? prefs[key] : defaults[key];
    }
    return result;
};

const readLayoutPreferencesFromStorage = () => {
    try {
        const raw = localStorage.getItem(getLayoutStorageKey());
        if (!raw) {
            return getDefaultLayoutPreferences();
        }
        const payload = JSON.parse(raw);
        return normalizeLayoutPreferences(payload.preferences);
    } catch {
        return getDefaultLayoutPreferences();
    }
};

const getLayoutPreference = (key) => {
    const prefs = layoutPreferences || getDefaultLayoutPreferences();
    return prefs[key] !== undefined
        ? prefs[key]
        : LAYOUT_PREFERENCE_DEFAULTS[key];
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
let activeMobileTileIndex = 0;
const remotePeerOrder = [];
const screenSharers = new Set();
const peersWithCallHandler = new WeakSet();
const presenceMembersByPeerId = new Map();
const layoutItemsById = new Map();
let tileLayoutZIndex = TILE_BASE_Z_INDEX;
let layoutEditMode = false;
let layoutEditModeToggle;
let layoutAddComponentToggle;
let layoutResetDefaultButton;
let layoutComponentMenu;
let layoutSaveStatus;
let layoutResetConfirmTimer;
let layoutSaveStatusTimer;
let layoutStorageHydrating = false;
let activeLayoutToolbarTile;
let snapPreviewOverlay;
let activeResizeCursorTile;
let activeResizeCursorBoard;
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
    setHidden(callControls, false);
    setHidden(destroyPeerBtn, false);
};

const hideCallControls = () => {
    setHidden(callControls);
    setHidden(destroyPeerBtn);
};

const isMobileLayout = () => window.innerWidth <= MOBILE_BREAKPOINT;

const getVideoTiles = () =>
    Array.from((pageLayoutBoard || videoGrid).querySelectorAll('.video-tile'));

const syncLayoutGridMetadata = () => {
    const board = pageLayoutBoard || videoGrid;
    if (!board) {
        return;
    }

    board.dataset.layoutGridColumns = String(PAGE_GRID_COLUMNS);
    board.dataset.layoutGridRows = String(PAGE_GRID_ROWS);
    board.style.setProperty('--layout-grid-columns', String(PAGE_GRID_COLUMNS));
    board.style.setProperty('--layout-grid-rows', String(PAGE_GRID_ROWS));
};

const createPageLayoutTile = (type) => {
    const tile = document.createElement('div');
    tile.id = `page-tile-${type}`;
    tile.className = 'video-tile page-layout-tile';
    tile.dataset.pageLayoutType = type;
    tile.dataset.layoutComponentType = type;
    tile.style.overflow = 'hidden';
    return tile;
};

const getPageComponentId = (type) => `page-tile-${type}`;

const PL_LOG = (...args) => console.log('[page-layout]', ...args);
const PL_WARN = (...args) => console.warn('[page-layout]', ...args);

const CORE_PAGE_TYPES = [
    PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
    PAGE_COMPONENT_TYPES.CHAT_PANEL,
];

const validatePageLayout = () => {
    const missing = [];
    const hidden = [];

    CORE_PAGE_TYPES.forEach((type) => {
        const tile = document.getElementById(getPageComponentId(type));
        if (!tile) {
            missing.push(type);
        } else if (tile.classList.contains('is-layout-hidden')) {
            hidden.push(type);
        }
    });

    if (missing.length > 0) {
        PL_WARN('Missing core page tiles:', missing);
    }

    if (hidden.length === CORE_PAGE_TYPES.length) {
        PL_WARN('All core page tiles are hidden');
    }

    return { missing, hidden };
};

const ensureDefaultPageLayout = () => {
    PL_LOG('Ensuring default page layout exists');

    if (!pageLayoutBoard) {
        PL_WARN('No page layout board, cannot ensure defaults');
        return;
    }

    CORE_PAGE_TYPES.forEach((type) => {
        const tile = document.getElementById(getPageComponentId(type));
        const defaultItem = getDefaultLayoutItems().find(
            (item) => item.type === type
        );
        if (!tile || !defaultItem) {
            PL_WARN('Missing default page panel:', type);
            return;
        }

        applyTileLayout(
            tile,
            convertGridLayoutToPixels({
                ...defaultItem.grid,
                zIndex: getNextTileLayoutZIndex(),
            })
        );
        setTileLayoutItemVisibility(tile.dataset.layoutItemId, true);
        tile.classList.remove('is-layout-hidden');
    });

    syncLayoutGridMetadata();
    saveLayoutToStorage('布局已初始化');
};

const getPagePanelLabel = (type) => PAGE_COMPONENT_LABELS[type] || type;

const createPageTileFromNode = (type, node) => {
    const tile = createPageLayoutTile(type);
    const className = `page-tile-${type.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
    )}`;
    tile.classList.add(className);
    const { header, body, footer } = ensureTileStructure(tile);
    const avatar = header.querySelector('.tile-avatar');
    const title = header.querySelector('.tile-title');
    const badges = header.querySelector('.tile-badges');
    const label = getPagePanelLabel(type);

    if (avatar) {
        avatar.textContent = createTileAvatarText(label);
    }

    if (title) {
        title.textContent = label;
    }

    if (badges) {
        badges.replaceChildren();
    }

    body.append(node);
    footer.textContent = '';
    footer.hidden = true;

    const itemId = `page-${sanitizeLayoutIdPart(type)}`;
    tile.dataset.layoutItemId = itemId;
    tile.dataset.layoutId = itemId;
    syncTileLayoutItemFromElement(tile, {
        id: itemId,
        type,
        visible: true,
        positioned: true,
    });

    return tile;
};

const getPageTileDiagnostics = (board, type) => {
    const tile = board.querySelector(`#${getPageComponentId(type)}`);
    return {
        tile,
        text: tile?.textContent.trim() || '',
        childCount: tile?.querySelector('.tile-body')?.children.length || 0,
    };
};

const validateDetachedPageLayoutBoard = (board) => {
    const tileCount = board.querySelectorAll('.page-layout-tile').length;
    const sidebar = getPageTileDiagnostics(
        board,
        PAGE_COMPONENT_TYPES.SIDEBAR_PANEL
    );
    const chat = getPageTileDiagnostics(board, PAGE_COMPONENT_TYPES.CHAT_PANEL);
    const chatInputHasTextControl = Boolean(
        chat.tile?.querySelector('textarea, input')
    );
    const chatInputHasSendButton = Boolean(
        chat.tile &&
            Array.from(chat.tile.querySelectorAll('button')).some(
                (button) =>
                    button.type === 'submit' ||
                    button.textContent.includes('发送')
            )
    );
    const chatHasMessageArea = Boolean(
        chat.tile?.querySelector('#chatMessages, .chat-messages') ||
            chat.tile?.querySelector('.chat-panel')?.children.length
    );
    const failures = [];

    if (tileCount < CORE_PAGE_TYPES.length) {
        failures.push(`expected ${CORE_PAGE_TYPES.length} page tiles`);
    }

    if (
        !sidebar.tile ||
        !sidebar.text.includes('朋友语音房间') ||
        !/大厅|游戏开黑/.test(sidebar.text) ||
        !sidebar.tile.querySelector('[data-channel-room], .tree-channel')
    ) {
        failures.push('sidebarPanel is missing channel content');
    }

    if (!board.querySelector('#video-grid')) {
        failures.push('runtime video grid is missing');
    }

    if (
        !chat.tile ||
        !chatHasMessageArea ||
        !chatInputHasTextControl ||
        !chatInputHasSendButton
    ) {
        failures.push('chatPanel is missing chat content');
    }

    return {
        ok: failures.length === 0,
        failures,
    };
};

const restoreMovedPagePanelNodes = (entries) => {
    entries.forEach(({ node, placeholder }) => {
        if (placeholder.isConnected) {
            placeholder.replaceWith(node);
        }
    });
};

const initPageLayoutBoard = () => {
    if (pageLayoutBoard) {
        return pageLayoutBoard;
    }

    if (!mainLayout) {
        PL_WARN('No #main element found');
        return undefined;
    }

    const sidebarEl = mainLayout.querySelector('.room-sidebar');
    const stageEl = mainLayout.querySelector('.room-stage');
    const chatPanelEl = mainLayout.querySelector('.chat-panel');
    const chatMessagesEl = chatPanelEl?.querySelector(
        '#chatMessages, .chat-messages'
    );
    const chatFormEl = chatPanelEl?.querySelector('#chatForm, .chat-form');
    const runtimeVideoGrid = mainLayout.querySelector('#video-grid');
    const chatFormHasControls = Boolean(
        chatFormEl?.querySelector('textarea, input') &&
            chatFormEl.querySelector('button')
    );

    if (chatPanelEl && !chatMessagesEl) {
        PL_WARN(
            'Chat messages container was not found; keeping remaining chat panel content after input extraction.'
        );
    }

    PL_LOG('source nodes', {
        sidebar: Boolean(sidebarEl),
        sidebarChildren: sidebarEl?.children.length || 0,
        sidebarHasBrand: Boolean(sidebarEl?.querySelector('.sidebar-brand')),
        sidebarHasTree: Boolean(
            sidebarEl?.querySelector('.sidebar-channel-tree')
        ),
        sidebarHasUserCard: Boolean(
            sidebarEl?.querySelector('.local-user-card')
        ),
        stage: Boolean(stageEl),
        stageHasCanvas: Boolean(stageEl?.querySelector('#canvas')),
        stageHasVideoGrid: Boolean(runtimeVideoGrid),
        chatPanel: Boolean(chatPanelEl),
        chatPanelHasMessages: Boolean(chatMessagesEl),
        chatPanelHasForm: Boolean(chatFormEl),
        chatFormHasControls,
    });

    const missingSelectors = [
        ['.room-sidebar', sidebarEl],
        ['#video-grid', runtimeVideoGrid],
        ['.chat-panel', chatPanelEl],
        ['#chatForm or .chat-form', chatFormEl],
        ['chat input controls', chatFormHasControls ? chatFormEl : null],
    ]
        .filter(([, node]) => !node)
        .map(([selector]) => selector);

    if (missingSelectors.length > 0) {
        console.error('[page-layout] missing source nodes:', missingSelectors);
        _bootstrapRecoveryToolbar({ visible: true });
        return undefined;
    }

    const entries = [
        {
            type: PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
            node: sidebarEl,
        },
        {
            type: PAGE_COMPONENT_TYPES.CHAT_PANEL,
            node: chatPanelEl,
        },
    ].map((entry) => {
        const placeholder = document.createComment(
            `page-layout-placeholder:${entry.type}`
        );
        entry.node.before(placeholder);
        return { ...entry, placeholder };
    });

    const board = document.createElement('div');
    board.id = 'page-layout-board';
    board.className = 'page-layout-board';

    PL_LOG('Board created, moving full DOM panels');
    board.append(runtimeVideoGrid);
    entries.forEach(({ type, node }) => {
        board.append(createPageTileFromNode(type, node));
    });

    const detachedValidation = validateDetachedPageLayoutBoard(board);
    if (!detachedValidation.ok) {
        console.error(
            '[page-layout] detached board validation failed:',
            detachedValidation.failures
        );
        restoreMovedPagePanelNodes(entries);
        _bootstrapRecoveryToolbar({ visible: true });
        return undefined;
    }

    mainLayout.classList.remove('room-layout');
    mainLayout.replaceChildren(board);
    pageLayoutBoard = board;

    syncLayoutGridMetadata();

    const savedItems = loadLayoutFromStorage();
    PL_LOG('Loaded layout from storage:', savedItems.length, 'items');
    const savedHasCore =
        savedItems.length > 0 &&
        CORE_PAGE_TYPES.every((type) =>
            savedItems.some((item) => item.type === type)
        );

    if (savedItems.length === 0 || !savedHasCore) {
        PL_LOG('No valid saved layout, using defaults');
        ensureDefaultPageLayout();
    } else {
        const { missing } = validatePageLayout();
        if (missing.length > 0 || missing.length === CORE_PAGE_TYPES.length) {
            PL_WARN('Saved layout missing core components, using defaults');
            ensureDefaultPageLayout();
        } else {
            initializeLayoutFromStorage();
        }
    }

    ensureLayoutEditModeToggle();
    syncLayoutEditModeUI();

    PL_LOG('Board initialized with', getVideoTiles().length, 'tiles');
    return board;
};

const _originalMainSnapshot = mainLayout ? mainLayout.cloneNode(true) : null;

const _bootstrapRecoveryToolbar = ({ visible = false } = {}) => {
    const existing = document.querySelector('.layout-recovery-toolbar');
    if (existing) {
        existing.hidden = !visible;
        return existing;
    }
    const bar = document.createElement('div');
    bar.className = 'layout-recovery-toolbar';
    bar.hidden = true;
    bar.innerHTML =
        '<button id="layoutRecoveryReset" type="button">重置布局</button>' +
        '<button id="layoutRecoveryRestore" type="button">恢复原始页面</button>';
    bar.hidden = !visible;
    document.body.append(bar);
    bar.querySelector('#layoutRecoveryReset').addEventListener('click', () => {
        localStorage.removeItem(getLayoutStorageKey());
        window.location.reload();
    });
    bar.querySelector('#layoutRecoveryRestore').addEventListener(
        'click',
        () => {
            restoreOriginalStaticLayout();
        }
    );
    return bar;
};

const restoreOriginalStaticLayout = () => {
    if (!mainLayout) return;
    const board = document.getElementById('page-layout-board');
    if (board) board.remove();
    mainLayout.classList.add('room-layout');
    if (_originalMainSnapshot && _originalMainSnapshot.children.length > 0) {
        mainLayout.replaceChildren();
        while (_originalMainSnapshot.firstChild) {
            mainLayout.append(_originalMainSnapshot.firstChild);
        }
        console.info('[page-layout] restored original static layout');
    } else {
        mainLayout.replaceChildren();
        mainLayout.innerHTML = `
            <aside class="room-sidebar"><div class="sidebar-brand"><a href="/">朋友语音房间</a></div></aside>
            <main class="room-stage"><section id="canvas"><div id="video-grid"></div></section></main>
            <aside class="chat-panel"><ol id="chatMessages" class="chat-messages" style="height:60vh"></ol>
            <form id="chatForm" class="chat-form"><textarea id="chatInput"></textarea><button>发送</button></form></aside>`;
        console.info('[page-layout] created safe fallback DOM');
    }
    pageLayoutBoard = undefined;
    layoutEditMode = false;
    syncLayoutEditModeUI();
};

window.__voiceLayoutDebug = {
    bootTime: new Date().toISOString(),
    resetLayout() {
        localStorage.removeItem(getLayoutStorageKey());
        document.getElementById('page-layout-board')?.remove();
        if (typeof initPageLayoutBoard === 'function') {
            pageLayoutBoard = undefined;
            try {
                initPageLayoutBoard();
            } catch (err) {
                console.error('[page-layout] reset failed', err);
                restoreOriginalStaticLayout();
            }
        } else {
            window.location.reload();
        }
    },
    showRecoveryToolbar() {
        _bootstrapRecoveryToolbar({ visible: true });
    },
    hideRecoveryToolbar() {
        _bootstrapRecoveryToolbar({ visible: false });
    },
    dumpDom() {
        const result = {
            main: Boolean(document.getElementById('main')),
            board: Boolean(document.getElementById('page-layout-board')),
            pageTiles: document.querySelectorAll(
                '#page-layout-board > .page-layout-tile'
            ).length,
            toolbar: Boolean(
                document.querySelector(
                    '.layout-recovery-toolbar, .stage-layout-toolbar'
                )
            ),
            unexpectedStagePanel: Boolean(
                document.getElementById('page-tile-stagePanel')
            ),
            remotePeerCount: document.querySelectorAll(
                '.video-tile[data-layout-item-type="remotePeer"]'
            ).length,
            localPeer: {
                exists: Boolean(document.getElementById('local-video')),
                hidden: Boolean(
                    document
                        .getElementById('local-video')
                        ?.classList.contains('is-layout-hidden')
                ),
            },
            hasFooterLabels: Array.from(
                document.querySelectorAll(
                    '.page-layout-tile > .tile-footer:not([hidden])'
                )
            ).some((footer) => footer.textContent.trim().length > 0),
        };
        const types = CORE_PAGE_TYPES;
        types.forEach((t) => {
            const tile = document.getElementById(`page-tile-${t}`);
            result[t] = tile
                ? {
                      exists: true,
                      id: tile.id,
                      hidden: tile.classList.contains('is-layout-hidden'),
                      childCount: tile.children.length,
                      bodyChildren:
                          tile.querySelector('.tile-body')?.children.length ||
                          0,
                      textPreview: tile.textContent.trim().slice(0, 80),
                      hasInput: Boolean(tile.querySelector('textarea, input')),
                      hasChannelLinks: Boolean(
                          tile.querySelector(
                              '.tree-channel, [data-channel-room]'
                          )
                      ),
                  }
                : { exists: false };
        });
        result.totalTiles = document.querySelectorAll('.video-tile').length;
        console.table(result);
        return result;
    },
    dumpLayout() {
        if (typeof serializeLayoutItems === 'function') {
            const items = serializeLayoutItems();
            console.table(
                items.map((item) => ({
                    id: item.id,
                    type: item.type,
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    visible: item.visible,
                }))
            );
            return items;
        }
        console.warn('[page-layout] serializeLayoutItems not available yet');
        return [];
    },
    validateLayout() {
        if (typeof validatePageLayout === 'function') {
            return validatePageLayout();
        }
        return { missing: [], hidden: [] };
    },
};

const _detectBrokenBoard = () => {
    const board = document.getElementById('page-layout-board');
    if (!board) return false;
    const tileCount = board.querySelectorAll('.page-layout-tile').length;
    if (tileCount === 0) {
        console.warn(
            '[page-layout] detected empty board with 0 tiles, recovering'
        );
        return true;
    }
    const validation = validateDetachedPageLayoutBoard(board);
    if (!validation.ok) {
        console.warn(
            '[page-layout] detected broken page board, recovering',
            validation.failures
        );
        return true;
    }
    return false;
};

const _runPageLayoutInit = () => {
    if (_detectBrokenBoard()) {
        restoreOriginalStaticLayout();
        _bootstrapRecoveryToolbar({ visible: true });
        return;
    }

    try {
        initPageLayoutBoard();
    } catch (err) {
        console.error('[page-layout] init failed', err);
        restoreOriginalStaticLayout();
        _bootstrapRecoveryToolbar({ visible: true });
    }
};

const ensureLayoutEditModeToggle = () => {
    if (!mainLayout || layoutEditModeToggle) {
        return layoutEditModeToggle;
    }

    const toolbar = document.createElement('div');
    const button = document.createElement('button');
    const icon = document.createElement('i');
    const label = document.createElement('span');
    const addButton = document.createElement('button');
    const addIcon = document.createElement('i');
    const addLabel = document.createElement('span');
    const resetButton = document.createElement('button');
    const resetIcon = document.createElement('i');
    const resetLabel = document.createElement('span');
    const menu = document.createElement('div');
    const status = document.createElement('span');
    const primaryAction = document.createElement('div');
    const secondaryActions = document.createElement('div');

    toolbar.className =
        'stage-layout-toolbar page-layout-toolbar page-layout-topbar';
    toolbar.setAttribute('aria-label', '布局工具');
    primaryAction.className = 'layout-edit-primary-action';
    secondaryActions.className = 'layout-edit-secondary-actions';
    button.id = 'layoutEditModeToggle';
    button.className = 'layout-edit-toggle layout-edit-primary-button';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    icon.className = 'fas fa-border-all';
    icon.setAttribute('aria-hidden', 'true');
    label.textContent = '编辑布局';
    button.append(icon, label);

    addButton.id = 'layoutAddComponentToggle';
    addButton.className = 'layout-tool-button';
    addButton.type = 'button';
    addButton.setAttribute('aria-expanded', 'false');
    addIcon.className = 'fas fa-plus';
    addIcon.setAttribute('aria-hidden', 'true');
    addLabel.textContent = '添加组件';
    addButton.append(addIcon, addLabel);

    resetButton.id = 'layoutResetDefault';
    resetButton.className = 'layout-tool-button';
    resetButton.type = 'button';
    resetIcon.className = 'fas fa-undo';
    resetIcon.setAttribute('aria-hidden', 'true');
    resetLabel.textContent = '恢复默认布局';
    resetButton.append(resetIcon, resetLabel);

    menu.className = 'layout-component-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '添加布局组件');

    status.className = 'layout-save-status';
    status.textContent = '已保存';

    primaryAction.append(button);
    secondaryActions.append(addButton, resetButton, status, menu);
    toolbar.append(primaryAction, secondaryActions);
    mainLayout.prepend(toolbar);

    layoutEditModeToggle = button;
    layoutAddComponentToggle = addButton;
    layoutResetDefaultButton = resetButton;
    layoutComponentMenu = menu;
    layoutSaveStatus = status;
    return layoutEditModeToggle;
};

const syncLayoutEditModeUI = () => {
    mainLayout?.classList.toggle('is-layout-editing', layoutEditMode);
    pageLayoutBoard?.classList.toggle('is-layout-editing', layoutEditMode);

    if (layoutEditModeToggle) {
        layoutEditModeToggle.setAttribute(
            'aria-pressed',
            String(layoutEditMode)
        );
        layoutEditModeToggle.querySelector('span').textContent = layoutEditMode
            ? '完成编辑'
            : '编辑布局';
    }

    [layoutAddComponentToggle, layoutResetDefaultButton].forEach((button) => {
        if (button) {
            button.hidden = !layoutEditMode;
        }
    });

    if (layoutSaveStatus) {
        layoutSaveStatus.hidden = !layoutEditMode;
    }

    getVideoTiles().forEach((tile) => {
        tile.classList.toggle('is-layout-editing', layoutEditMode);
    });

    if (layoutEditMode) {
        closePeerVolumePopover();
        renderLayoutComponentMenu();
        ensureLayoutComponentActions();
        if (activeLayoutToolbarTile) {
            setActiveLayoutToolbarTile(activeLayoutToolbarTile);
        }
    } else {
        setActiveLayoutToolbarTile(undefined);
        closeLayoutComponentMenu();
        closeLayoutComponentConfig();
    }
};

const setLayoutEditMode = (enabled) => {
    layoutEditMode = Boolean(enabled);
    syncLayoutGridMetadata();
    syncLayoutEditModeUI();

    if (!layoutEditMode) {
        hideSnapPreview();
        resetLayoutResizeCursor();
    }
};

const toggleLayoutEditMode = () => {
    if (layoutEditMode) {
        finalizeLayoutEditing();
        return;
    }

    setLayoutEditMode(true);
};

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

const updateCallDuration = () => {
    if (!callStartedAt || !callDuration) {
        return;
    }

    setText(callDuration, formatDuration(Date.now() - callStartedAt));
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

    setText(callDuration, '00:00');
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
    setText(localUserName, getChatName());

    setText(
        localVoiceChannelName,
        getChannelName(joinedVoiceRoomId || viewingRoomId)
    );

    setText(
        callStatusText,
        isConnectingToPeer ? '正在连接语音' : getCallStatusLabel()
    );

    if (screenStatusText) {
        setText(screenStatusText);
        setHidden(screenStatusText);
    }

    syncNoiseSettingsUI();
    updateAllVideoTileStatus();
};

const getPeerVolumes = () => readJsonStorage(PEER_VOLUME_STORAGE_KEY, {}) || {};

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
    writeJsonStorage(PEER_VOLUME_STORAGE_KEY, volumes);
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

const getStoredChatName = () => {
    const storedName = safeStorageGet(CHAT_NAME_STORAGE_KEY);

    if (storedName) {
        return storedName;
    }

    const guestName = createGuestName();
    safeStorageSet(CHAT_NAME_STORAGE_KEY, guestName);
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
    safeStorageSet(CHAT_NAME_STORAGE_KEY, name);
};

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
    meta.textContent = `${senderName} · ${formatTime(message.createdAt)}`;
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
            const memberPeerId = member.peerId;

            item.className = 'channel-member';
            name.className = 'channel-member-name';
            name.textContent = `${member.senderName || 'Guest'}${isMe ? '（我）' : ''}`;
            statuses.className = 'channel-member-statuses';
            getMemberStatusIcons(member).forEach((status) => {
                statuses.append(createMemberStatusIcon(status));
            });

            item.append(name, statuses);

            if (memberPeerId && memberPeerId !== localPeerId) {
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'member-toggle-tile';
                toggleBtn.title = '显示/隐藏组件';
                toggleBtn.setAttribute('aria-label', '显示/隐藏组件');
                const toggleIcon = document.createElement('i');
                const tileForPeer = document.getElementById(memberPeerId);
                const layoutItemId =
                    tileForPeer?.dataset.layoutItemId ||
                    getRemoteLayoutItemId(memberPeerId, member);
                const layoutItem = getTileLayoutItem(layoutItemId);
                const isVisible =
                    layoutItem?.visible !== false &&
                    (!tileForPeer ||
                        !tileForPeer.classList.contains('is-layout-hidden'));
                toggleIcon.className = isVisible
                    ? 'fas fa-eye'
                    : 'fas fa-eye-slash';
                toggleBtn.append(toggleIcon);
                toggleBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleMemberTileVisibility(memberPeerId);
                });
                statuses.append(toggleBtn);
            } else if (memberPeerId && memberPeerId === localPeerId) {
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'member-toggle-tile';
                toggleBtn.title = '显示/隐藏我的语音组件';
                toggleBtn.setAttribute('aria-label', '显示/隐藏我的语音组件');
                const toggleIcon = document.createElement('i');
                const localTile = document.getElementById('local-video');
                const layoutItem = localTile?.dataset.layoutItemId
                    ? getTileLayoutItem(localTile.dataset.layoutItemId)
                    : null;
                const isVisible =
                    layoutItem?.visible !== false &&
                    (!localTile ||
                        !localTile.classList.contains('is-layout-hidden'));
                toggleIcon.className = isVisible
                    ? 'fas fa-eye'
                    : 'fas fa-eye-slash';
                toggleBtn.append(toggleIcon);
                toggleBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleLocalPeerTileVisibility();
                });
                statuses.append(toggleBtn);
            }

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

const getRemoteMemberForPeerId = (peerId) =>
    peerId ? presenceMembersByPeerId.get(peerId) || null : null;

const getRemoteLayoutKey = (
    peerId,
    member = getRemoteMemberForPeerId(peerId)
) => {
    const roomKey = member?.roomId || joinedVoiceRoomId || 'room';
    const displayName = member?.displayName || member?.senderName;
    const candidates = [
        ['member', member?.memberId],
        ['user', member?.userId],
        ['client', member?.clientId],
        ['socket', member?.socketId],
        ['name', displayName ? `${roomKey}:${displayName}` : null],
        ['peer', peerId || member?.peerId],
    ];
    const candidate = candidates.find(([, value]) => {
        if (value === undefined || value === null) {
            return false;
        }

        return String(value).trim() !== '';
    });

    return sanitizeLayoutIdPart(
        candidate ? `${candidate[0]}-${candidate[1]}` : 'unknown'
    );
};

const getRemoteLayoutItemId = (
    peerId,
    member = getRemoteMemberForPeerId(peerId)
) => `${REMOTE_PEER_LAYOUT_ID_PREFIX}${getRemoteLayoutKey(peerId, member)}`;

const getLegacyRemoteLayoutPeerId = (id) => {
    const value = String(id || '');

    if (value.startsWith(REMOTE_PEER_LAYOUT_ID_PREFIX)) {
        return value.slice(REMOTE_PEER_LAYOUT_ID_PREFIX.length);
    }

    if (value.startsWith('remote-peer:')) {
        return value.slice('remote-peer:'.length);
    }

    if (value.startsWith('peer:')) {
        return value.slice('peer:'.length);
    }

    if (value.startsWith('peer-')) {
        return value.slice('peer-'.length);
    }

    return null;
};

const normalizeRemotePeerLayoutId = (id, peerId, member) => {
    const resolvedPeerId =
        peerId || member?.peerId || getLegacyRemoteLayoutPeerId(id);

    if (
        !resolvedPeerId &&
        String(id || '').startsWith(REMOTE_PEER_LAYOUT_ID_PREFIX)
    ) {
        return `${REMOTE_PEER_LAYOUT_ID_PREFIX}${sanitizeLayoutIdPart(
            String(id).slice(REMOTE_PEER_LAYOUT_ID_PREFIX.length)
        )}`;
    }

    return resolvedPeerId ? getRemoteLayoutItemId(resolvedPeerId, member) : id;
};

const getRemoteLayoutAliasIds = (peerId, member, preferredId) => {
    const aliases = new Set();
    const resolvedPeerId = peerId || member?.peerId;
    const sanitizedPeerId = resolvedPeerId
        ? sanitizeLayoutIdPart(resolvedPeerId)
        : null;

    if (preferredId) {
        aliases.add(preferredId);
    }

    if (resolvedPeerId || member) {
        aliases.add(getRemoteLayoutItemId(resolvedPeerId, member));
    }

    if (sanitizedPeerId) {
        aliases.add(`${REMOTE_PEER_LAYOUT_ID_PREFIX}peer-${sanitizedPeerId}`);
        aliases.add(`${REMOTE_PEER_LAYOUT_ID_PREFIX}${sanitizedPeerId}`);
        aliases.add(`remote-peer:${sanitizedPeerId}`);
        aliases.add(`remote-peer:peer-${sanitizedPeerId}`);
        aliases.add(`peer:${sanitizedPeerId}`);
        aliases.add(`peer-${sanitizedPeerId}`);
    }

    return Array.from(aliases).filter(Boolean);
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

const getTileBounds = () => {
    const board = pageLayoutBoard || videoGrid;
    const boardRect = board.getBoundingClientRect();
    const fallbackWidth = boardRect.width || board.parentElement?.offsetWidth;
    const fallbackHeight =
        boardRect.height || board.parentElement?.offsetHeight;

    return {
        width: Math.max(
            PAGE_TILE_MIN_WIDTH,
            fallbackWidth || PAGE_TILE_MIN_WIDTH
        ),
        height: Math.max(
            PAGE_TILE_MIN_HEIGHT,
            fallbackHeight || PAGE_TILE_MIN_HEIGHT
        ),
    };
};

const clampGridNumber = (value, min, max) =>
    Math.min(Math.max(min, value), max);

const getLayoutGridMetrics = () => {
    const bounds = getTileBounds();
    const cellWidth = bounds.width / PAGE_GRID_COLUMNS;
    const cellHeight = bounds.height / PAGE_GRID_ROWS;

    return {
        bounds,
        cellWidth,
        cellHeight,
        minGridW: Math.max(
            LAYOUT_MIN_GRID_W,
            Math.ceil(PAGE_TILE_MIN_WIDTH / cellWidth)
        ),
        minGridH: Math.max(
            LAYOUT_MIN_GRID_H,
            Math.ceil(PAGE_TILE_MIN_HEIGHT / cellHeight)
        ),
    };
};

const clampGridLayout = ({ x, y, w, h }) => {
    const { minGridW, minGridH } = getLayoutGridMetrics();
    const nextW = clampGridNumber(
        Math.round(Number(w) || minGridW),
        minGridW,
        PAGE_GRID_COLUMNS
    );
    const nextH = clampGridNumber(
        Math.round(Number(h) || minGridH),
        minGridH,
        PAGE_GRID_ROWS
    );
    const nextX = clampGridNumber(
        Math.round(Number(x) || 0),
        0,
        PAGE_GRID_COLUMNS - nextW
    );
    const nextY = clampGridNumber(
        Math.round(Number(y) || 0),
        0,
        PAGE_GRID_ROWS - nextH
    );

    return { x: nextX, y: nextY, w: nextW, h: nextH };
};

const convertTileLayoutToGrid = ({ x, y, width, height }) => {
    const { cellWidth, cellHeight } = getLayoutGridMetrics();

    return clampGridLayout({
        x: Math.round(x / cellWidth),
        y: Math.round(y / cellHeight),
        w: Math.round(width / cellWidth),
        h: Math.round(height / cellHeight),
    });
};

const convertGridLayoutToPixels = ({ x, y, w, h, zIndex }) => {
    const grid = clampGridLayout({ x, y, w, h });
    const { cellWidth, cellHeight } = getLayoutGridMetrics();

    return clampTileLayout({
        x: grid.x * cellWidth,
        y: grid.y * cellHeight,
        width: grid.w * cellWidth,
        height: grid.h * cellHeight,
        zIndex,
    });
};

const snapTileLayoutToGrid = (layout) =>
    convertGridLayoutToPixels({
        ...convertTileLayoutToGrid(layout),
        zIndex: layout.zIndex,
    });

const isAutoPlacedLayoutType = (type) => Boolean(AUTO_LAYOUT_GRID_SIZES[type]);

const normalizeLayoutItemType = (type) =>
    LEGACY_LAYOUT_ITEM_TYPES[type] || type;

const getAutoLayoutGridSize = (type) =>
    clampGridLayout({
        x: 0,
        y: 0,
        ...(AUTO_LAYOUT_GRID_SIZES[type] || {
            w: LAYOUT_MIN_GRID_W,
            h: LAYOUT_MIN_GRID_H,
        }),
    });

const isAbnormallyLargeAutoGrid = (type, grid) =>
    isAutoPlacedLayoutType(type) &&
    (Number(grid?.w) >= PAGE_GRID_COLUMNS - 1 ||
        Number(grid?.h) >= PAGE_GRID_ROWS - 1);

const normalizeAutoLayoutGrid = (type, grid = {}) => {
    if (!isAutoPlacedLayoutType(type)) {
        return clampGridLayout(grid);
    }

    const defaultSize = getAutoLayoutGridSize(type);
    const width = Number(grid.w);
    const height = Number(grid.h);
    const hasUsableSize =
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0 &&
        !isAbnormallyLargeAutoGrid(type, { w: width, h: height });

    return clampGridLayout({
        x: grid.x,
        y: grid.y,
        w: hasUsableSize ? width : defaultSize.w,
        h: hasUsableSize ? height : defaultSize.h,
    });
};

const getFallbackTileLayoutForType = (type, layout = {}) => {
    if (layout?.grid && isAutoPlacedLayoutType(type)) {
        return {
            grid: normalizeAutoLayoutGrid(type, layout.grid),
            zIndex: layout.zIndex,
        };
    }

    if (
        isAutoPlacedLayoutType(type) &&
        Number.isFinite(Number(layout?.width)) &&
        Number.isFinite(Number(layout?.height))
    ) {
        const grid = convertTileLayoutToGrid(layout);
        if (isAbnormallyLargeAutoGrid(type, grid)) {
            return {
                grid: {
                    ...grid,
                    w: getAutoLayoutGridSize(type).w,
                    h: getAutoLayoutGridSize(type).h,
                },
                zIndex: layout.zIndex,
            };
        }
    }

    if (
        layout?.grid ||
        Number.isFinite(Number(layout?.width)) ||
        Number.isFinite(Number(layout?.height))
    ) {
        return layout;
    }

    if (!isAutoPlacedLayoutType(type)) {
        return layout;
    }

    return {
        grid: getAutoLayoutGridSize(type),
        zIndex: layout?.zIndex,
    };
};

const isRectWithinGrid = (rect) =>
    rect &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w > 0 &&
    rect.h > 0 &&
    rect.x + rect.w <= PAGE_GRID_COLUMNS &&
    rect.y + rect.h <= PAGE_GRID_ROWS;

const rectOverlapArea = (a, b) => {
    if (!a || !b) {
        return 0;
    }

    const overlapW = Math.max(
        0,
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    );
    const overlapH = Math.max(
        0,
        Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    );

    return overlapW * overlapH;
};

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

const scoreLayoutSlot = (rect, occupiedRects, options = {}) => {
    const centerX = options.centerX ?? PAGE_GRID_COLUMNS / 2;
    const centerY = options.centerY ?? PAGE_GRID_ROWS / 2;
    const rectCenterX = rect.x + rect.w / 2;
    const rectCenterY = rect.y + rect.h / 2;
    const overlapArea = occupiedRects.reduce(
        (total, occupied) => total + rectOverlapArea(rect, occupied),
        0
    );
    const distanceFromCenter =
        Math.abs(rectCenterX - centerX) + Math.abs(rectCenterY - centerY);
    const edgePenalty =
        (rect.x === 0 ? 2 : 0) +
        (rect.y === 0 ? 1 : 0) +
        (rect.x + rect.w === PAGE_GRID_COLUMNS ? 2 : 0) +
        (rect.y + rect.h === PAGE_GRID_ROWS ? 1 : 0);

    return overlapArea * 1000 + distanceFromCenter * 10 + edgePenalty;
};

const findAvailableLayoutSlot = (type, preferredSize, options = {}) => {
    const size = clampGridLayout({
        x: 0,
        y: 0,
        ...(preferredSize || getAutoLayoutGridSize(type)),
    });
    const occupiedRects = getOccupiedLayoutRects(options.excludeId);
    let bestSlot = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let y = 0; y <= PAGE_GRID_ROWS - size.h; y += 1) {
        for (let x = 0; x <= PAGE_GRID_COLUMNS - size.w; x += 1) {
            const candidate = { x, y, w: size.w, h: size.h };

            if (!isRectWithinGrid(candidate)) {
                continue;
            }

            const score = scoreLayoutSlot(candidate, occupiedRects, options);

            if (score < bestScore) {
                bestScore = score;
                bestSlot = candidate;
            }
        }
    }

    return bestSlot || clampGridLayout({ x: 0, y: 0, w: size.w, h: size.h });
};

const findTileForLayoutItem = (item) =>
    item?.elementId
        ? document.getElementById(item.elementId)
        : getVideoTiles().find(
              (tile) =>
                  tile.dataset.layoutItemId === item?.id ||
                  tile.dataset.layoutId === item?.id
          );

const snapLayoutItemToGrid = (item) => {
    if (!item?.id) {
        return null;
    }

    const tile = findTileForLayoutItem(item);
    const layoutSource =
        tile && !tile.classList.contains('is-layout-hidden')
            ? getCurrentTileLayout(tile)
            : item.layout || convertGridLayoutToPixels(item.grid || {});
    const snappedLayout = snapTileLayoutToGrid(layoutSource);
    const snappedGrid = convertTileLayoutToGrid(snappedLayout);
    const nextItem = {
        ...item,
        layout: snappedLayout,
        grid: snappedGrid,
        positioned: true,
    };

    layoutItemsById.set(nextItem.id, nextItem);

    if (tile) {
        applyTileLayoutItemToElement(tile, nextItem, {
            applyPosition: true,
        });
    }

    return nextItem;
};

const snapAllLayoutItemsToGrid = () => {
    layoutItemsById.forEach((item) => {
        snapLayoutItemToGrid(item);
    });
};

const ensureSnapPreviewOverlay = () => {
    if (!pageLayoutBoard) {
        return null;
    }

    if (!snapPreviewOverlay) {
        snapPreviewOverlay = document.createElement('div');
        snapPreviewOverlay.className = 'layout-snap-preview';
        snapPreviewOverlay.setAttribute('aria-hidden', 'true');
        pageLayoutBoard.append(snapPreviewOverlay);
    }

    return snapPreviewOverlay;
};

const showSnapPreview = (tile, layout) => {
    if (!tile || !layout) {
        return;
    }

    const overlay = ensureSnapPreviewOverlay();
    if (!overlay) {
        return;
    }

    const snappedLayout = snapTileLayoutToGrid(layout);
    overlay.style.left = `${snappedLayout.x}px`;
    overlay.style.top = `${snappedLayout.y}px`;
    overlay.style.width = `${snappedLayout.width}px`;
    overlay.style.height = `${snappedLayout.height}px`;
    overlay.dataset.targetTileId = tile.id;
    overlay.classList.add('is-visible');
};

const hideSnapPreview = () => {
    if (snapPreviewOverlay) {
        snapPreviewOverlay.classList.remove('is-visible');
        delete snapPreviewOverlay.dataset.targetTileId;
    }
};

const finalizeLayoutEditing = () => {
    snapAllLayoutItemsToGrid();
    hideSnapPreview();
    saveLayoutToStorage('布局已吸附');
    setLayoutEditMode(false);
};

const getLayoutStorageKey = () =>
    `${PAGE_LAYOUT_STORAGE_KEY_PREFIX}:${String(
        viewingRoomId || selectedVoiceRoomId || 'default'
    ).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const getKnownLayoutItemTypes = () =>
    new Set([
        ...Object.values(LAYOUT_ITEM_TYPES),
        ...Object.values(PAGE_COMPONENT_TYPES),
    ]);

const serializeLayoutItems = () => {
    const seen = new Set();
    const items = [];

    layoutItemsById.forEach((item) => {
        if (!item?.id || seen.has(item.id)) {
            return;
        }

        const grid = clampGridLayout(item.grid || item.layout || {});
        seen.add(item.id);
        items.push({
            id: item.id,
            type: item.type,
            x: grid.x,
            y: grid.y,
            w: grid.w,
            h: grid.h,
            z: normalizeTileLayoutZIndex(item.layout?.zIndex),
            visible: item.visible !== false,
            config: {
                ...normalizeComponentConfig(item.type, item.config),
                peerId: item.peerId || null,
            },
        });
    });

    return items;
};

const normalizeLoadedLayoutItems = (payload) => {
    if (!payload || payload.version !== PAGE_STORAGE_VERSION) {
        return [];
    }

    if (
        payload.grid &&
        (Number(payload.grid.columns) !== PAGE_GRID_COLUMNS ||
            Number(payload.grid.rows) !== PAGE_GRID_ROWS)
    ) {
        // Grid changes are still normalized below; incompatible payloads should
        // never be applied raw.
    }

    const knownTypes = getKnownLayoutItemTypes();
    const seen = new Set();
    const seenSingletonTypes = new Set();

    const normalizedItems = (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => {
            if (item && item.type === 'stagePanel') {
                return null;
            }

            if (!item?.id) {
                return null;
            }

            const type = normalizeLayoutItemType(item?.type);
            const peerId =
                typeof item?.config?.peerId === 'string'
                    ? item.config.peerId
                    : getLegacyRemoteLayoutPeerId(item.id);
            const itemId =
                type === LAYOUT_ITEM_TYPES.REMOTE_PEER
                    ? normalizeRemotePeerLayoutId(item.id, peerId, {
                          peerId,
                      })
                    : String(item.id);

            if (
                !knownTypes.has(type) ||
                seen.has(itemId) ||
                (PAGE_SINGLETON_TYPES.has(type) && seenSingletonTypes.has(type))
            ) {
                return null;
            }

            seen.add(itemId);
            if (PAGE_SINGLETON_TYPES.has(type)) {
                seenSingletonTypes.add(type);
            }
            const grid = normalizeAutoLayoutGrid(type, {
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
            });

            return {
                id: itemId,
                type,
                grid,
                z: normalizeTileLayoutZIndex(item.z),
                visible: item.visible !== false,
                config: {
                    ...normalizeComponentConfig(type, item.config),
                    peerId: peerId || null,
                },
            };
        })
        .filter(Boolean);

    return normalizedItems;
};

const loadLayoutFromStorage = () => {
    try {
        const raw = localStorage.getItem(getLayoutStorageKey());

        if (!raw) {
            return [];
        }

        return normalizeLoadedLayoutItems(JSON.parse(raw));
    } catch (error) {
        console.warn(
            '[layout] saved layout is invalid; using defaults.',
            error
        );
        return [];
    }
};

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

const showLayoutSaveStatus = (message) => {
    if (!layoutSaveStatus) {
        return;
    }

    layoutSaveStatus.textContent = message;
    clearTimeout(layoutSaveStatusTimer);
    layoutSaveStatusTimer = setTimeout(() => {
        layoutSaveStatus.textContent = '已保存';
    }, 1800);
};

const buildLayoutStoragePayload = () => ({
    version: PAGE_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    grid: {
        columns: PAGE_GRID_COLUMNS,
        rows: PAGE_GRID_ROWS,
    },
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
    localStorage.setItem(getLayoutStorageKey(), JSON.stringify(payload));
    refreshSavedLayoutItems();
    showLayoutSaveStatus(message);
};

const clearSavedLayout = () => {
    localStorage.removeItem(getLayoutStorageKey());
    refreshSavedLayoutItems();
};

refreshSavedLayoutItems();

const clampTileLayout = ({ x, y, width, height, zIndex }) => {
    const bounds = getTileBounds();
    const minW = PAGE_TILE_MIN_WIDTH;
    const minH = PAGE_TILE_MIN_HEIGHT;
    const nextWidth = Math.min(Math.max(width, minW), bounds.width);
    const nextHeight = Math.min(Math.max(height, minH), bounds.height);

    return {
        x: Math.min(Math.max(0, x), Math.max(0, bounds.width - nextWidth)),
        y: Math.min(Math.max(0, y), Math.max(0, bounds.height - nextHeight)),
        width: nextWidth,
        height: nextHeight,
        zIndex: normalizeTileLayoutZIndex(zIndex),
    };
};

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

    const snappedLayout = snapTileLayoutToGrid(getCurrentTileLayout(tile));
    applyTileLayout(tile, snappedLayout);
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

const getLayoutComponentId = (type) =>
    type === LAYOUT_ITEM_TYPES.LOCAL_PEER ? 'local-video' : `page-tile-${type}`;

const getDefaultLayoutItems = () => [
    {
        id: `page-${PAGE_COMPONENT_TYPES.SIDEBAR_PANEL}`,
        type: PAGE_COMPONENT_TYPES.SIDEBAR_PANEL,
        grid: { x: 0, y: 0, w: 5, h: 18 },
        visible: true,
    },
    {
        id: `page-${PAGE_COMPONENT_TYPES.CHAT_PANEL}`,
        type: PAGE_COMPONENT_TYPES.CHAT_PANEL,
        grid: { x: 26, y: 0, w: 6, h: 18 },
        visible: true,
    },
    {
        id: 'local-peer-default',
        type: LAYOUT_ITEM_TYPES.LOCAL_PEER,
        grid: { x: 13, y: 7, w: 5, h: 4 },
        visible: true,
    },
];

const getLayoutComponentDisplayState = (type, config = {}) => {
    if (type === LAYOUT_ITEM_TYPES.ROOM) {
        const channelName = getChannelName(viewingRoomId || joinedVoiceRoomId);
        const currentMemberList = document.querySelector(
            `[data-members-for="${viewingRoomId || joinedVoiceRoomId}"]`
        );
        const memberCount =
            currentMemberList?.querySelectorAll('.channel-member').length || 0;
        const body = [];
        if (config.showRoomName !== false) {
            body.push(`频道：${channelName}`);
        }
        if (config.showMemberCount !== false) {
            body.push(`在线成员：${memberCount}`);
        }
        body.push(joinedVoiceRoomId ? '语音状态：已加入' : '语音状态：未加入');

        return {
            title: '房间信息',
            body: body.length ? body : ['房间信息组件'],
            footer: '房间组件',
            showCopyLink: config.showCopyLink !== false,
        };
    }

    if (type === LAYOUT_ITEM_TYPES.CHAT) {
        const messages = Array.from(
            chatMessages?.querySelectorAll('.chat-message') || []
        )
            .slice(-3)
            .map((message) => message.textContent.trim())
            .filter(Boolean);

        return {
            title: '聊天',
            body: messages.length
                ? messages
                : ['聊天组件已添加', '普通聊天输入仍在右侧面板中'],
            footer: '聊天组件',
            compactMode: config.compactMode === true,
        };
    }

    return {
        title: '我的语音',
        body: ['本地语音组件', joinedVoiceRoomId ? '已加入语音' : '未加入语音'],
        footer: '我的语音组件',
        showSelfPreview: config.showSelfPreview !== false,
        showControls: config.showControls !== false,
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
    const { header, body, footer } = ensureTileStructure(tile);
    const avatar = header.querySelector('.tile-avatar');
    const title = header.querySelector('.tile-title');
    const badges = header.querySelector('.tile-badges');
    const state = getLayoutComponentDisplayState(type, config);

    tile.dataset.tileType = type;
    tile.dataset.peerLabel = state.title;
    tile.classList.add('layout-component-tile');
    tile.classList.toggle('is-layout-editing', layoutEditMode);
    tile.classList.toggle(
        'chat-compact-mode',
        type === LAYOUT_ITEM_TYPES.CHAT && state.compactMode
    );

    if (avatar) {
        avatar.textContent = createTileAvatarText(state.title);
    }

    if (title) {
        title.textContent = state.title;
    }

    if (badges) {
        badges.replaceChildren();
    }

    body.replaceChildren();
    const content = document.createElement('div');
    content.className = 'layout-component-content';
    state.body.forEach((line) => {
        const itemEl = document.createElement('p');
        itemEl.textContent = line;
        content.append(itemEl);
    });
    body.append(content);

    if (type === LAYOUT_ITEM_TYPES.ROOM && state.showCopyLink) {
        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'layout-component-link-btn';
        linkBtn.textContent = '复制频道链接';
        const linkIcon = document.createElement('i');
        linkIcon.className = 'fas fa-link';
        linkBtn.prepend(linkIcon);
        linkBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(
                    getChannelUrl(getCopyRoomId())
                );
                linkBtn.textContent = '已复制';
                const checkIcon = document.createElement('i');
                checkIcon.className = 'fas fa-check';
                linkBtn.prepend(checkIcon);
                setTimeout(() => {
                    linkBtn.textContent = '复制频道链接';
                    const restoreIcon = document.createElement('i');
                    restoreIcon.className = 'fas fa-link';
                    linkBtn.prepend(restoreIcon);
                }, 1500);
            } catch {
                // noop
            }
        });
        content.append(linkBtn);
    }

    if (type === LAYOUT_ITEM_TYPES.CHAT && state.showHeader !== false) {
        header.style.display = '';
    } else if (type === LAYOUT_ITEM_TYPES.CHAT && state.showHeader === false) {
        header.style.display = 'none';
    } else if (type !== LAYOUT_ITEM_TYPES.CHAT) {
        header.style.display = '';
    }

    if (type === LAYOUT_ITEM_TYPES.LOCAL_PEER) {
        const bodyEl = tile.querySelector('.tile-body');
        const localVideo = bodyEl?.querySelector('video');
        const localPlaceholder = bodyEl?.querySelector('.voice-placeholder');
        if (!state.showSelfPreview) {
            if (localVideo) {
                localVideo.style.display = 'none';
            }
            if (localPlaceholder) {
                localPlaceholder.style.display = 'none';
            }
        } else {
            if (localVideo) {
                localVideo.style.display = '';
            }
            if (localPlaceholder) {
                localPlaceholder.style.display = '';
            }
        }
        const localActions = tile.querySelector('.tile-overlay');
        if (localActions) {
            localActions.style.display = state.showControls ? '' : 'none';
        }
    }

    footer.textContent = '';
    footer.hidden = true;

    const nextLayoutId = getTileLayoutId(tile);
    tile.dataset.layoutId = nextLayoutId;
    syncTileLayoutItemFromElement(tile, {
        id: nextLayoutId,
        type,
        visible: true,
        positioned: tile.classList.contains('is-positioned'),
        config,
    });

    if (layoutEditMode) {
        ensureLayoutComponentActions();
    }
};

const getExistingLayoutComponentTile = (type) => {
    if (type === LAYOUT_ITEM_TYPES.LOCAL_PEER) {
        return document.getElementById('local-video');
    }

    return document.getElementById(getLayoutComponentId(type));
};

const addLayoutComponent = (type) => {
    const allowedTypes = PAGE_SINGLETON_TYPES;

    if (!allowedTypes.has(type)) {
        return null;
    }

    const tile = getExistingLayoutComponentTile(type);

    if (!tile) {
        PL_WARN('Cannot recreate missing real DOM page panel:', type);
        return null;
    }

    const layoutId = getTileLayoutId(tile);
    const savedItem = getSavedLayoutItemPreference(layoutId);
    const defaultItem = getDefaultLayoutItems().find(
        (item) => item.type === type
    );
    const layoutItem = savedItem || defaultItem;

    if (
        layoutItem &&
        (savedItem || !tile.classList.contains('is-positioned'))
    ) {
        applyTileLayout(
            tile,
            convertGridLayoutToPixels({
                ...layoutItem.grid,
                zIndex: layoutItem.z || getNextTileLayoutZIndex(),
            })
        );
    }

    const visible =
        layoutStorageHydrating && savedItem
            ? savedItem.visible
            : layoutStorageHydrating
              ? true
              : true;
    tile.classList.toggle('is-layout-hidden', !visible);
    setTileLayoutItemVisibility(tile.dataset.layoutItemId, visible);
    bringTileLayoutToFront(tile);
    saveLayoutToStorage(visible ? '布局已更新' : '布局已更新');
    renderLayoutComponentMenu();
    updateMobileTileView();

    return tile;
};

const hideLayoutComponent = (tile) => {
    if (!tile) {
        return;
    }

    setTileLayoutItemVisibility(tile.dataset.layoutItemId, false);
    tile.classList.add('is-layout-hidden');
    findLayoutComponentToolbar(tile)?.classList.remove('is-visible');
    closePeerVolumePopover();
    saveLayoutToStorage('布局已更新');
    renderLayoutComponentMenu();
    updateMobileTileView();
};

const resetDefaultLayout = () => {
    const confirmed = layoutResetDefaultButton?.dataset.confirmReset === 'true';

    if (!confirmed) {
        if (layoutResetDefaultButton) {
            layoutResetDefaultButton.dataset.confirmReset = 'true';
            layoutResetDefaultButton.querySelector('span').textContent =
                '再次点击确认';
            clearTimeout(layoutResetConfirmTimer);
            layoutResetConfirmTimer = setTimeout(() => {
                delete layoutResetDefaultButton.dataset.confirmReset;
                layoutResetDefaultButton.querySelector('span').textContent =
                    '恢复默认布局';
            }, 2400);
        }

        return;
    }

    clearTimeout(layoutResetConfirmTimer);
    delete layoutResetDefaultButton.dataset.confirmReset;
    layoutResetDefaultButton.querySelector('span').textContent = '恢复默认布局';
    clearSavedLayout();

    const defaultItems = getDefaultLayoutItems();
    const pageTypes = CORE_PAGE_TYPES;

    pageTypes.forEach((type) => {
        addLayoutComponent(type);
    });

    defaultItems.forEach((item) => {
        const tile =
            item.type === LAYOUT_ITEM_TYPES.LOCAL_PEER
                ? document.getElementById('local-video')
                : document.getElementById(getLayoutComponentId(item.type)) ||
                  getVideoTiles().find(
                      (candidate) => getTileLayoutId(candidate) === item.id
                  );

        if (!tile) {
            return;
        }

        tile.classList.remove('is-layout-hidden');
        applyTileLayout(
            tile,
            convertGridLayoutToPixels({
                ...item.grid,
                zIndex: getNextTileLayoutZIndex(),
            })
        );
        setTileLayoutItemVisibility(tile.dataset.layoutItemId, item.visible);
    });

    saveLayoutToStorage('已恢复默认');
    renderLayoutComponentMenu();
    updateMobileTileView();
};

const getInitialLayoutItems = () => {
    const savedItems = Array.from(savedLayoutItemsById.values());

    return savedItems.length ? savedItems : getDefaultLayoutItems();
};

const applyStoredLayoutToExistingTile = (item) => {
    const tile = getVideoTiles().find(
        (candidate) => getTileLayoutId(candidate) === item.id
    );

    if (!tile) {
        return;
    }

    applyTileLayout(
        tile,
        convertGridLayoutToPixels({
            ...item.grid,
            zIndex: item.z || getNextTileLayoutZIndex(),
        })
    );
    const syncedItem = upsertTileLayoutItem(tile, {
        visible: item.visible,
        positioned: true,
        config: item.config,
    });
    applyTileLayoutItemToElement(tile, syncedItem, {
        applyPosition: false,
    });
    setTileLayoutItemVisibility(tile.dataset.layoutItemId, item.visible);
    tile.classList.toggle('is-layout-hidden', !item.visible);
};

const applyPageLayoutItemToPanel = (item) => {
    const tile = getExistingLayoutComponentTile(item.type);

    if (!tile) {
        return;
    }

    const nextLayout = convertGridLayoutToPixels({
        ...item.grid,
        zIndex: item.z || getNextTileLayoutZIndex(),
    });

    applyTileLayout(tile, nextLayout);
    const syncedItem = upsertTileLayoutItem(tile, {
        layout: nextLayout,
        visible: item.visible,
        positioned: true,
        config: item.config,
    });
    applyTileLayoutItemToElement(tile, syncedItem, {
        applyPosition: false,
    });
    setTileLayoutItemVisibility(tile.dataset.layoutItemId, item.visible);
    tile.classList.toggle('is-layout-hidden', !item.visible);
};

const initializeLayoutFromStorage = () => {
    const initialItems = getInitialLayoutItems();

    layoutStorageHydrating = true;
    try {
        initialItems.forEach((item) => {
            if (PAGE_SINGLETON_TYPES.has(item.type)) {
                const existing = getExistingLayoutComponentTile(item.type);
                if (!existing) {
                    addLayoutComponent(item.type);
                } else {
                    applyPageLayoutItemToPanel(item);
                }
                return;
            }

            applyStoredLayoutToExistingTile(item);
        });
    } finally {
        layoutStorageHydrating = false;
    }

    renderLayoutComponentMenu();
    updateMobileTileView();
};

function closeLayoutComponentMenu() {
    if (layoutComponentMenu) {
        layoutComponentMenu.hidden = true;
    }

    if (layoutAddComponentToggle) {
        layoutAddComponentToggle.setAttribute('aria-expanded', 'false');
    }
}

function closeLayoutComponentConfig() {
    const panel = document.querySelector('.layout-config-panel');
    if (panel) {
        panel.remove();
    }
}

function renderLayoutComponentMenu() {
    if (!layoutComponentMenu) {
        return;
    }

    layoutComponentMenu.replaceChildren();

    const componentTypes = CORE_PAGE_TYPES;

    componentTypes.forEach((type) => {
        const tile = getExistingLayoutComponentTile(type);
        const item = tile?.dataset.layoutItemId
            ? getTileLayoutItem(tile.dataset.layoutItemId)
            : null;
        const exists = Boolean(tile);
        const visible = exists && !tile.classList.contains('is-layout-hidden');
        const button = document.createElement('button');
        const status = document.createElement('span');

        button.type = 'button';
        button.className = 'layout-component-menu-item';
        button.dataset.layoutComponentType = type;
        button.setAttribute('role', 'menuitem');
        button.disabled = Boolean(exists && visible && item?.visible !== false);
        button.textContent = PAGE_COMPONENT_LABELS[type] || type;
        status.className = 'layout-component-menu-status';
        status.textContent = visible ? '已显示' : exists ? '重新显示' : '添加';
        button.append(status);
        button.addEventListener('click', () => {
            addLayoutComponent(type);
            closeLayoutComponentMenu();
        });
        layoutComponentMenu.append(button);
    });
}

const toggleLayoutComponentMenu = () => {
    if (!layoutComponentMenu || !layoutEditMode) {
        return;
    }

    renderLayoutComponentMenu();
    layoutComponentMenu.hidden = !layoutComponentMenu.hidden;
    layoutAddComponentToggle?.setAttribute(
        'aria-expanded',
        String(!layoutComponentMenu.hidden)
    );
};

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
    Array.from(document.querySelectorAll('.layout-component-toolbar')).find(
        (toolbar) => toolbar.dataset.targetTileId === tile.id
    );

const positionLayoutComponentToolbar = (tile) => {
    const toolbar = findLayoutComponentToolbar(tile);
    const board = pageLayoutBoard || tile?.parentElement;

    if (!tile || !toolbar || !board) {
        return;
    }

    const boardRect = board.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 34;
    const toolbarHeight = toolbar.offsetHeight || 96;
    const gap = 8;
    const centerX = tileRect.left - boardRect.left + tileRect.width / 2;
    const showRight = centerX < boardRect.width / 2;
    const rawLeft = showRight
        ? tileRect.right - boardRect.left + gap
        : tileRect.left - boardRect.left - toolbarWidth - gap;
    const left = clampGridNumber(
        Math.round(rawLeft),
        4,
        Math.max(4, Math.round(boardRect.width - toolbarWidth - 4))
    );
    const top = clampGridNumber(
        Math.round(tileRect.top - boardRect.top),
        4,
        Math.max(4, Math.round(boardRect.height - toolbarHeight - 4))
    );

    toolbar.classList.toggle('is-left-side', !showRight);
    toolbar.classList.toggle('is-right-side', showRight);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
};

const setActiveLayoutToolbarTile = (tile) => {
    activeLayoutToolbarTile = tile;
    document
        .querySelectorAll('.video-tile.is-layout-selected')
        .forEach((activeTile) =>
            activeTile.classList.remove('is-layout-selected')
        );
    document
        .querySelectorAll('.layout-component-toolbar')
        .forEach((toolbar) => toolbar.classList.remove('is-visible'));

    if (!layoutEditMode || !tile) {
        return;
    }

    tile.classList.add('is-layout-selected');
    const toolbar = findLayoutComponentToolbar(tile);
    if (toolbar) {
        toolbar.classList.add('is-visible');
        positionLayoutComponentToolbar(tile);
    }
};

const syncLayoutComponentToolbarState = (tile) => {
    const toolbar = findLayoutComponentToolbar(tile);
    const freeMoveButton = toolbar?.querySelector('.layout-toolbar-free-move');
    const enabled = isTileFreeMoveEnabled(tile);

    tile.classList.toggle('is-free-move-enabled', enabled);

    if (freeMoveButton) {
        freeMoveButton.setAttribute('aria-pressed', String(enabled));
        freeMoveButton.title = enabled ? '关闭自由移动' : '开启自由移动';
    }
};

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

const ensureLayoutComponentToolbar = (tile) => {
    if (!pageLayoutBoard || !tile.id) {
        return null;
    }

    let toolbar = findLayoutComponentToolbar(tile);

    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'layout-component-toolbar';
        toolbar.dataset.targetTileId = tile.id;

        const hideButton = document.createElement('button');
        hideButton.type = 'button';
        hideButton.className = 'layout-toolbar-button layout-toolbar-hide';
        hideButton.title = '隐藏组件';
        hideButton.setAttribute('aria-label', '隐藏组件');
        hideButton.textContent = '\u00D7';
        hideButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            hideLayoutComponent(tile);
            toolbar.classList.remove('is-visible');
        });

        const freeMoveButton = document.createElement('button');
        freeMoveButton.type = 'button';
        freeMoveButton.className =
            'layout-toolbar-button layout-toolbar-free-move';
        freeMoveButton.setAttribute('aria-label', '自由移动');
        freeMoveButton.textContent = '移';
        freeMoveButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTileFreeMove(tile);
        });

        const helpWrap = document.createElement('span');
        helpWrap.className = 'layout-toolbar-help-wrap';
        const helpButton = document.createElement('button');
        helpButton.type = 'button';
        helpButton.className = 'layout-toolbar-button layout-toolbar-help';
        helpButton.setAttribute('aria-label', '自由移动说明');
        helpButton.textContent = '?';
        const tooltip = document.createElement('span');
        tooltip.className = 'layout-toolbar-tooltip';
        tooltip.textContent =
            '开启自由移动后，退出编辑模式也可以拖动这个组件。';
        helpWrap.append(helpButton, tooltip);

        toolbar.append(hideButton, freeMoveButton, helpWrap);
        toolbar.addEventListener('mouseenter', () =>
            setActiveLayoutToolbarTile(tile)
        );
        pageLayoutBoard.append(toolbar);
    }

    syncLayoutComponentToolbarState(tile);
    positionLayoutComponentToolbar(tile);
    return toolbar;
};

const ensureLayoutComponentActions = () => {
    getVideoTiles().forEach((tile) => {
        const { actions } = ensureTileStructure(tile);
        actions
            .querySelectorAll(
                '.layout-component-remove, .layout-component-settings'
            )
            .forEach((button) => button.remove());
        ensureLayoutComponentToolbar(tile);
    });
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

    TILE_RESIZE_DIRECTIONS.forEach((direction) => {
        let resizeHandle = tile.querySelector(
            `.tile-resize-handle[data-resize-direction="${direction}"]`
        );

        if (!resizeHandle) {
            resizeHandle = document.createElement('div');
            resizeHandle.className = `tile-resize-handle tile-resize-handle--${direction}`;
            resizeHandle.dataset.resizeDirection = direction;
            resizeHandle.setAttribute('aria-hidden', 'true');
            tile.append(resizeHandle);
        }
    });

    bindTileLayoutControls(tile, header);
    bindLayoutResizeBoardControls();

    return { header, body, overlay, actions, footer };
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

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const withinHorizontalBand =
        x >= -TILE_RESIZE_EDGE_OUTSET_PX &&
        x <= rect.width + TILE_RESIZE_EDGE_OUTSET_PX;
    const withinVerticalBand =
        y >= -TILE_RESIZE_EDGE_OUTSET_PX &&
        y <= rect.height + TILE_RESIZE_EDGE_OUTSET_PX;

    if (!withinHorizontalBand || !withinVerticalBand) {
        return null;
    }

    const nearLeftCorner =
        x >= -TILE_RESIZE_EDGE_OUTSET_PX && x <= TILE_RESIZE_CORNER_SIZE_PX;
    const nearRightCorner =
        x >= rect.width - TILE_RESIZE_CORNER_SIZE_PX &&
        x <= rect.width + TILE_RESIZE_EDGE_OUTSET_PX;
    const nearTopCorner =
        y >= -TILE_RESIZE_EDGE_OUTSET_PX && y <= TILE_RESIZE_CORNER_SIZE_PX;
    const nearBottomCorner =
        y >= rect.height - TILE_RESIZE_CORNER_SIZE_PX &&
        y <= rect.height + TILE_RESIZE_EDGE_OUTSET_PX;
    const nearLeftEdge =
        x >= -TILE_RESIZE_EDGE_OUTSET_PX && x <= TILE_RESIZE_EDGE_INSET_PX;
    const nearRightEdge =
        x >= rect.width - TILE_RESIZE_EDGE_INSET_PX &&
        x <= rect.width + TILE_RESIZE_EDGE_OUTSET_PX;
    const nearTopEdge =
        y >= -TILE_RESIZE_EDGE_OUTSET_PX && y <= TILE_RESIZE_EDGE_INSET_PX;
    const nearBottomEdge =
        y >= rect.height - TILE_RESIZE_EDGE_INSET_PX &&
        y <= rect.height + TILE_RESIZE_EDGE_OUTSET_PX;

    if (nearTopCorner && nearLeftCorner) {
        return 'nw';
    }

    if (nearTopCorner && nearRightCorner) {
        return 'ne';
    }

    if (nearBottomCorner && nearLeftCorner) {
        return 'sw';
    }

    if (nearBottomCorner && nearRightCorner) {
        return 'se';
    }

    if (nearTopEdge) {
        return 'n';
    }

    if (nearRightEdge) {
        return 'e';
    }

    if (nearBottomEdge) {
        return 's';
    }

    if (nearLeftEdge) {
        return 'w';
    }

    return null;
};

const getTileResizeCursor = (direction) => TILE_RESIZE_CURSORS[direction] || '';

const resetTileResizeCursor = (tile) => {
    if (tile) {
        tile.style.cursor = '';
    }
};

const resetBoardResizeCursor = (board = pageLayoutBoard || videoGrid) => {
    if (board) {
        board.style.cursor = '';
    }
};

const clearResizeHoverState = (target) => {
    target?.classList?.remove(...LAYOUT_RESIZE_HOVER_CLASSES);
    target?.style?.removeProperty('--layout-resize-cursor');
};

const resetLayoutResizeCursor = (board = pageLayoutBoard || videoGrid) => {
    resetBoardResizeCursor(board);
    resetBoardResizeCursor(activeResizeCursorBoard);
    document.body.style.cursor = '';
    document.body.style.removeProperty('--layout-resize-cursor');
    clearResizeHoverState(document.body);
    clearResizeHoverState(board);
    clearResizeHoverState(activeResizeCursorBoard);
    resetTileResizeCursor(activeResizeCursorTile);
    activeResizeCursorTile = undefined;
    activeResizeCursorBoard = undefined;
};

const applyResizeHoverState = (target, direction, cursor) => {
    if (!target) {
        return;
    }

    target.classList.remove(...LAYOUT_RESIZE_HOVER_CLASSES);
    target.classList.add('is-layout-resize-hover', `resize-hover-${direction}`);
    target.style.setProperty('--layout-resize-cursor', cursor);
};

const setLayoutResizeCursor = (hit, board = pageLayoutBoard || videoGrid) => {
    const cursor = getTileResizeCursor(hit?.direction);

    if (!cursor || !hit?.tile) {
        resetLayoutResizeCursor(board);
        return;
    }

    if (activeResizeCursorTile && activeResizeCursorTile !== hit.tile) {
        resetTileResizeCursor(activeResizeCursorTile);
    }

    activeResizeCursorTile = hit.tile;
    activeResizeCursorBoard = board;
    hit.tile.style.cursor = cursor;
    document.body.style.cursor = cursor;
    document.body.style.setProperty('--layout-resize-cursor', cursor);
    applyResizeHoverState(document.body, hit.direction, cursor);

    if (board) {
        board.style.cursor = cursor;
        applyResizeHoverState(board, hit.direction, cursor);
    }
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
    const bounds = getTileBounds();
    const minW = PAGE_TILE_MIN_WIDTH;
    const minH = PAGE_TILE_MIN_HEIGHT;
    const next = { ...startLayout };

    if (direction.includes('e')) {
        next.width = Math.min(
            Math.max(minW, startLayout.width + deltaX),
            bounds.width - startLayout.x
        );
    }

    if (direction.includes('s')) {
        next.height = Math.min(
            Math.max(minH, startLayout.height + deltaY),
            bounds.height - startLayout.y
        );
    }

    if (direction.includes('w')) {
        const right = startLayout.x + startLayout.width;
        next.x = Math.min(Math.max(0, startLayout.x + deltaX), right - minW);
        next.width = right - next.x;
    }

    if (direction.includes('n')) {
        const bottom = startLayout.y + startLayout.height;
        next.y = Math.min(Math.max(0, startLayout.y + deltaY), bottom - minH);
        next.height = bottom - next.y;
    }

    return clampTileLayout(next);
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

_bootstrapRecoveryToolbar();

try {
    _runPageLayoutInit();
    ensureLayoutEditModeToggle()?.addEventListener(
        'click',
        toggleLayoutEditMode
    );
    layoutAddComponentToggle?.addEventListener(
        'click',
        toggleLayoutComponentMenu
    );
    layoutResetDefaultButton?.addEventListener('click', resetDefaultLayout);
    syncLayoutEditModeUI();
} catch (err) {
    console.error('[page-layout] critical init failure', err);
    restoreOriginalStaticLayout();
    _bootstrapRecoveryToolbar({ visible: true });
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
    const { header, overlay, footer } = ensureTileStructure(tile);
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
    tile.classList.toggle('has-video', hasVideo);
    tile.classList.toggle('is-audio-only', !hasVideo);
    tile.classList.toggle('is-screen-share', tileType === 'screen-share');
    tile.classList.toggle('is-layout-editing', layoutEditMode);
    if (layoutEditMode) {
        ensureLayoutComponentActions();
    }

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

    const remoteConfigItem = getTileLayoutItem(tile.dataset.layoutItemId);
    if (
        remoteConfigItem &&
        remoteConfigItem.type === LAYOUT_ITEM_TYPES.REMOTE_PEER
    ) {
        const remoteConfig = normalizeComponentConfig(
            LAYOUT_ITEM_TYPES.REMOTE_PEER,
            remoteConfigItem.config
        );
        if (avatar) {
            avatar.style.display = remoteConfig.showPeerName ? '' : 'none';
        }
        if (title) {
            title.style.display = remoteConfig.showPeerName ? '' : 'none';
        }
    } else {
        if (avatar && !tile.dataset.layoutComponentType) {
            avatar.style.display = '';
        }
        if (title && !tile.dataset.layoutComponentType) {
            title.style.display = '';
        }
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

document.addEventListener('fullscreenchange', updateFullscreenButtonStates);
document.addEventListener(
    'webkitfullscreenchange',
    updateFullscreenButtonStates
);

mobileBackToChannelsBtn?.addEventListener('click', () => {
    if (currentPeer && !currentPeer.destroyed) {
        byId('destroyPeer')?.click();
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
    syncLayoutGridMetadata();
    updateMobileRoomState();
    updateMobileTileView();
    clampPositionedTileLayouts();
    if (activeLayoutToolbarTile) {
        positionLayoutComponentToolbar(activeLayoutToolbarTile);
    }
});

updateChannelIndicators();
updateOutputButtonState();
updateScreenShareButtonState();
syncNoiseSettingsUI();
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
