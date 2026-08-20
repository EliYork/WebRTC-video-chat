(function exposePageLayoutConfig(global) {
    'use strict';

    const PAGE_COMPONENT_TYPES = {
        MEMBERS_PANEL: 'membersPanel',
        MEDIA_CONTROLS_PANEL: 'mediaControlsPanel',
        CHAT_PANEL: 'chatPanel',
    };
    const PANEL_COLLAPSED_HEIGHT = 42;

    const PANEL_REGISTRY = [
        {
            id: PAGE_COMPONENT_TYPES.MEMBERS_PANEL,
            title: '频道',
            defaultLayout: { x: 1, y: 1, w: 7, h: 10 },
            minWidth: 260,
            minHeight: 220,
            canDrag: true,
            canResize: true,
            canHide: true,
            canCollapse: true,
            canPin: true,
        },
        {
            id: PAGE_COMPONENT_TYPES.MEDIA_CONTROLS_PANEL,
            title: '媒体控制',
            defaultLayout: { x: 1, y: 12, w: 7, h: 5 },
            minWidth: 220,
            minHeight: 140,
            canDrag: true,
            canResize: true,
            canHide: true,
            canCollapse: true,
            canPin: true,
        },
        {
            id: PAGE_COMPONENT_TYPES.CHAT_PANEL,
            title: '聊天',
            defaultLayout: { x: 24, y: 2, w: 7, h: 14 },
            minWidth: 280,
            minHeight: 240,
            canDrag: true,
            canResize: true,
            canHide: true,
            canCollapse: true,
            canPin: true,
        },
    ];

    const getPanelRegistry = () =>
        PANEL_REGISTRY.map((panel) => ({
            ...panel,
            defaultLayout: { ...panel.defaultLayout },
        }));

    const getPanelConfig = (id) =>
        getPanelRegistry().find((panel) => panel.id === id) || null;

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
            showRoomName: true,
            showCopyLink: true,
            showMemberCount: true,
        },
        [LAYOUT_ITEM_TYPES.CHAT]: {
            compactMode: false,
            showHeader: true,
        },
        [LAYOUT_ITEM_TYPES.LOCAL_PEER]: {
            userPlaced: false,
            showSelfPreview: true,
            showControls: true,
        },
        [LAYOUT_ITEM_TYPES.REMOTE_PEER]: {
            userPlaced: false,
            keepHiddenWhenRejoin: true,
            showPeerName: true,
        },
        [LAYOUT_ITEM_TYPES.SCREEN_SHARE]: {
            userPlaced: false,
            autoShowScreenShare: true,
            showScreenHeader: true,
        },
    };

    const PANEL_COMPONENT_CONFIG_DEFAULTS = Object.fromEntries(
        PANEL_REGISTRY.map((panel) => [
            panel.id,
            {
                collapsed: false,
                pinned: false,
                expandedHeight: 0,
            },
        ])
    );

    const LAYOUT_PREFERENCE_DEFAULTS = {
        autoShowLocalPeer: true,
        autoShowRemotePeers: true,
        autoShowScreenShare: true,
        keepHiddenRemotePeers: true,
    };

    const getDefaultComponentConfig = (type) => {
        const defaults =
            COMPONENT_CONFIG_DEFAULTS[type] ||
            PANEL_COMPONENT_CONFIG_DEFAULTS[type];
        return defaults ? { ...defaults } : {};
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

    const getDefaultLayoutPreferences = () => ({
        ...LAYOUT_PREFERENCE_DEFAULTS,
    });

    const normalizeLayoutPreferences = (prefs = {}) => {
        const defaults = getDefaultLayoutPreferences();
        const result = {};
        for (const key of Object.keys(defaults)) {
            result[key] =
                typeof prefs[key] === 'boolean' ? prefs[key] : defaults[key];
        }
        return result;
    };

    const getLayoutPreferenceValue = (prefs, key) => {
        const source = prefs || getDefaultLayoutPreferences();
        return source[key] !== undefined
            ? source[key]
            : LAYOUT_PREFERENCE_DEFAULTS[key];
    };

    global.PageLayoutConfig = {
        PAGE_COMPONENT_TYPES,
        PANEL_REGISTRY,
        PANEL_COLLAPSED_HEIGHT,
        LAYOUT_ITEM_TYPES,
        LEGACY_LAYOUT_ITEM_TYPES,
        REMOTE_PEER_LAYOUT_ID_PREFIX,
        AUTO_LAYOUT_GRID_SIZES,
        COMPONENT_CONFIG_DEFAULTS,
        PANEL_COMPONENT_CONFIG_DEFAULTS,
        LAYOUT_PREFERENCE_DEFAULTS,
        getPanelRegistry,
        getPanelConfig,
        getDefaultComponentConfig,
        normalizeComponentConfig,
        getDefaultLayoutPreferences,
        normalizeLayoutPreferences,
        getLayoutPreferenceValue,
    };
})(window);
