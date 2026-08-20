(function exposeVoiceTileStatusUI(global) {
    'use strict';

    const { setText, toggleClass } = global.VoiceViewUtils;

    const clearChildren = (element) => {
        element?.replaceChildren();
    };

    const createStatusBadge = (
        { key = '', label = '', icon = '' } = {},
        { compact = false, header = false } = {}
    ) => {
        const badge = global.document.createElement('span');
        const badgeIcon = global.document.createElement('i');

        badge.className = header
            ? `tile-header-status tile-header-status-${key}`
            : compact
              ? `tile-badge tile-badge-${key}`
              : `tile-status-badge tile-status-${key}`;
        badge.title = label;
        badgeIcon.className = icon;
        badge.append(badgeIcon);

        if (!compact || header) {
            badge.append(global.document.createTextNode(label));
        }

        return badge;
    };

    const updateTileStatusClasses = (
        tile,
        { hasVideo = false, isScreenShare = false } = {}
    ) => {
        toggleClass(tile, 'has-video', hasVideo);
        toggleClass(tile, 'is-audio-only', !hasVideo);
        toggleClass(tile, 'is-screen-share', isScreenShare);
    };

    const renderTileHeader = (
        tile,
        { avatarText = '', titleText = '', showNameLabel = true } = {}
    ) => {
        const avatar = tile?.querySelector('.tile-avatar');
        const title = tile?.querySelector('.tile-title');
        const display = showNameLabel ? '' : 'none';

        setText(avatar, avatarText);
        setText(title, titleText);

        if (avatar) {
            avatar.style.display = display;
        }

        if (title) {
            title.style.display = display;
        }
    };

    const renderTileBadges = (
        tile,
        statuses = [],
        { headerOnly = false } = {}
    ) => {
        const overlay = tile?.querySelector('.tile-overlay');
        const badges = tile?.querySelector('.tile-badges');

        clearChildren(overlay);
        clearChildren(badges);

        statuses.forEach((status) => {
            if (!headerOnly) {
                overlay?.append(createStatusBadge(status));
            }
            badges?.append(
                createStatusBadge(status, {
                    compact: !headerOnly,
                    header: headerOnly,
                })
            );
        });
    };

    const renderTilePlaceholder = (
        tile,
        {
            avatarText = '',
            hasVideo = false,
            statusText = '',
            titleText = '',
        } = {}
    ) => {
        const placeholder = tile?.querySelector('.voice-placeholder');

        if (!placeholder || hasVideo) {
            return;
        }

        setText(
            placeholder.querySelector('.voice-placeholder-avatar'),
            avatarText
        );
        setText(
            placeholder.querySelector('.voice-placeholder-title'),
            titleText
        );
        setText(
            placeholder.querySelector('.voice-placeholder-status'),
            statusText
        );
    };

    const renderTileFooter = (tile, text = '', { hidden = false } = {}) => {
        const footer = tile?.querySelector('.tile-footer');
        setText(footer, hidden ? '' : text);
        toggleClass(footer, 'is-hidden', hidden);
    };

    const renderTileStatus = (tile, state = {}) => {
        if (!tile) {
            return;
        }

        updateTileStatusClasses(tile, state);
        renderTileHeader(tile, state);
        renderTileBadges(tile, state.statuses || [], {
            headerOnly: state.isScreenShare === true,
        });
        renderTilePlaceholder(tile, state);
        renderTileFooter(tile, state.statusText, {
            hidden: state.isScreenShare === true,
        });
    };

    global.VoiceTileStatusUI = {
        renderTileBadges,
        renderTileFooter,
        renderTileHeader,
        renderTilePlaceholder,
        renderTileStatus,
        updateTileStatusClasses,
    };
})(window);
