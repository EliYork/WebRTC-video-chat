(function exposePageLayoutComponents(global) {
    'use strict';

    const layoutConfig = global.PageLayoutConfig;
    const { LAYOUT_ITEM_TYPES } = layoutConfig;

    const getLayoutComponentId = (type) =>
        type === LAYOUT_ITEM_TYPES.LOCAL_PEER
            ? 'local-video'
            : `page-tile-${type}`;

    const getDefaultLayoutItems = () => [
        ...layoutConfig.getPanelRegistry().map((panel) => ({
            id: `page-${panel.id}`,
            type: panel.id,
            grid: { ...panel.defaultLayout },
            visible: panel.defaultVisible !== false,
            config: {
                collapsed: false,
                pinned: false,
            },
        })),
        {
            id: 'local-peer-default',
            type: LAYOUT_ITEM_TYPES.LOCAL_PEER,
            grid: { x: 13, y: 7, w: 5, h: 4 },
            visible: true,
        },
    ];

    const getLayoutComponentDisplayState = (
        type,
        config = {},
        context = {}
    ) => {
        if (type === LAYOUT_ITEM_TYPES.ROOM) {
            const body = [];
            if (config.showRoomName !== false) {
                body.push(`频道：${context.channelName}`);
            }
            if (config.showMemberCount !== false) {
                body.push(`在线成员：${context.memberCount || 0}`);
            }
            body.push(
                context.joinedVoiceRoomId
                    ? '语音状态：已加入'
                    : '语音状态：未加入'
            );

            return {
                title: '房间信息',
                body: body.length ? body : ['房间信息组件'],
                footer: '房间组件',
                showCopyLink: config.showCopyLink !== false,
            };
        }

        if (type === LAYOUT_ITEM_TYPES.CHAT) {
            const messages = Array.isArray(context.chatMessages)
                ? context.chatMessages
                : [];

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
            body: [
                '本地语音组件',
                context.joinedVoiceRoomId ? '已加入语音' : '未加入语音',
            ],
            footer: '我的语音组件',
            showSelfPreview: config.showSelfPreview !== false,
            showControls: config.showControls !== false,
        };
    };

    const renderLayoutComponentTile = (
        tile,
        {
            bindCopyButton,
            config = {},
            createTileAvatarText,
            displayContext = {},
            ensureTileStructure,
            getCopyLink,
            getTileLayoutId,
            type = tile?.dataset.layoutComponentType,
        } = {}
    ) => {
        if (!tile || !ensureTileStructure || !createTileAvatarText) {
            return null;
        }

        const { header, body, footer } = ensureTileStructure(tile);
        const avatar = header.querySelector('.tile-avatar');
        const title = header.querySelector('.tile-title');
        const badges = header.querySelector('.tile-badges');
        const state = getLayoutComponentDisplayState(
            type,
            config,
            displayContext
        );

        tile.dataset.tileType = type;
        tile.dataset.peerLabel = state.title;
        tile.classList.add('layout-component-tile');
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
        const content = global.document.createElement('div');
        content.className = 'layout-component-content';
        state.body.forEach((line) => {
            const itemEl = global.document.createElement('p');
            itemEl.textContent = line;
            content.append(itemEl);
        });
        body.append(content);

        if (
            type === LAYOUT_ITEM_TYPES.ROOM &&
            state.showCopyLink &&
            bindCopyButton &&
            getCopyLink
        ) {
            const linkBtn = global.document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'layout-component-link-btn';
            linkBtn.textContent = '复制频道链接';
            const linkIcon = global.document.createElement('i');
            linkIcon.className = 'fas fa-link';
            linkBtn.prepend(linkIcon);
            bindCopyButton({
                button: linkBtn,
                getLink: getCopyLink,
            });
            content.append(linkBtn);
        }

        if (type === LAYOUT_ITEM_TYPES.CHAT && state.showHeader !== false) {
            header.style.display = '';
        } else if (
            type === LAYOUT_ITEM_TYPES.CHAT &&
            state.showHeader === false
        ) {
            header.style.display = 'none';
        } else if (type !== LAYOUT_ITEM_TYPES.CHAT) {
            header.style.display = '';
        }

        if (type === LAYOUT_ITEM_TYPES.LOCAL_PEER) {
            const bodyEl = tile.querySelector('.tile-body');
            const localVideo = bodyEl?.querySelector('video');
            const localPlaceholder =
                bodyEl?.querySelector('.voice-placeholder');
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

        const nextLayoutId =
            typeof getTileLayoutId === 'function'
                ? getTileLayoutId(tile)
                : tile.dataset.layoutId;
        tile.dataset.layoutId = nextLayoutId;

        return {
            id: nextLayoutId,
            type,
            visible: true,
            positioned: tile.classList.contains('is-positioned'),
            config,
        };
    };

    global.PageLayoutComponents = {
        getDefaultLayoutItems,
        getLayoutComponentId,
        getLayoutComponentDisplayState,
        renderLayoutComponentTile,
    };
})(window);
