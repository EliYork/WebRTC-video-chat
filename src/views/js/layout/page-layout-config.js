(function exposePageLayoutConfig(global) {
    'use strict';

    const PAGE_COMPONENT_TYPES = {
        SIDEBAR_PANEL: 'sidebarPanel',
        CHAT_PANEL: 'chatPanel',
    };

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
        LAYOUT_ITEM_TYPES,
        LEGACY_LAYOUT_ITEM_TYPES,
        REMOTE_PEER_LAYOUT_ID_PREFIX,
        AUTO_LAYOUT_GRID_SIZES,
        COMPONENT_CONFIG_DEFAULTS,
        LAYOUT_PREFERENCE_DEFAULTS,
        getDefaultComponentConfig,
        normalizeComponentConfig,
        getDefaultLayoutPreferences,
        normalizeLayoutPreferences,
        getLayoutPreferenceValue,
    };
})(window);
