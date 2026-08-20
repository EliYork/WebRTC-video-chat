(function exposePageLayoutRuntime(global) {
    'use strict';

    const PAGE_COMPONENT_LABELS = {
        membersPanel: '频道',
        mediaControlsPanel: '媒体控制',
        chatPanel: '聊天',
    };

    const createOriginalDomOwner = ({ root, nodes = [], logger } = {}) => {
        const originalRootChildren = Array.from(root?.childNodes || []);
        const originalPositions = nodes
            .filter((node) => node?.parentNode)
            .map((node) => ({
                node,
                parent: node.parentNode,
                nextSibling: node.nextSibling,
            }));
        const transientNodes = new Set();
        const warn = (...args) =>
            logger?.warn?.('[page-layout] original DOM restore:', ...args);

        const trackTransient = (node) => {
            if (node) {
                transientNodes.add(node);
            }
            return node;
        };

        const restore = () => {
            const errors = [];
            const attempt = (label, callback) => {
                try {
                    callback();
                } catch (error) {
                    errors.push({ label, error });
                    warn(label, error);
                }
            };

            originalPositions
                .slice()
                .reverse()
                .forEach(({ node, parent, nextSibling }) => {
                    attempt(
                        `restore node ${node.id || node.nodeName || ''}`,
                        () => {
                            const reference =
                                nextSibling?.parentNode === parent
                                    ? nextSibling
                                    : null;
                            parent.insertBefore(node, reference);
                        }
                    );
                });

            if (root) {
                const originalChildren = new Set(originalRootChildren);
                Array.from(root.childNodes).forEach((child) => {
                    if (!originalChildren.has(child)) {
                        attempt(
                            `remove runtime root child ${child.id || child.nodeName || ''}`,
                            () => child.remove()
                        );
                    }
                });
                originalRootChildren.forEach((child) => {
                    attempt(
                        `restore root child ${child.id || child.nodeName || ''}`,
                        () => root.append(child)
                    );
                });
            }

            Array.from(transientNodes)
                .reverse()
                .forEach((node) => {
                    attempt(
                        `remove transient ${node.id || node.nodeName || ''}`,
                        () => node.remove()
                    );
                });
            transientNodes.clear();

            return { errors, ok: errors.length === 0 };
        };

        return {
            restore,
            trackTransient,
        };
    };

    const createRuntime = (options = {}) => {
        const documentRef = options.document || global.document;
        const logger = options.logger || global.console;
        const refs = options.refs || {};
        const mainLayout = refs.mainLayout;
        const videoGrid = refs.videoGrid;
        const pageComponentTypes = options.pageComponentTypes || {};
        const panelRegistry =
            typeof options.getPanelRegistry === 'function'
                ? options.getPanelRegistry()
                : [];
        const corePageTypes = panelRegistry.length
            ? panelRegistry.map((panel) => panel.id)
            : [
                  pageComponentTypes.MEMBERS_PANEL,
                  pageComponentTypes.CHAT_PANEL,
              ].filter(Boolean);
        let board = options.initialBoard;
        const originalDomOwner = createOriginalDomOwner({
            root: mainLayout,
            nodes: [
                mainLayout?.querySelector('.sidebar-channel-tree'),
                mainLayout?.querySelector('#buttons'),
                mainLayout?.querySelector('.chat-panel'),
                videoGrid,
            ],
            logger,
        });

        const setBoard = (nextBoard) => {
            board = nextBoard;
            options.onBoardChange?.(nextBoard);
        };

        const log = (...args) => logger.log('[page-layout]', ...args);
        const warn = (...args) => logger.warn('[page-layout]', ...args);
        const error = (...args) => logger.error('[page-layout]', ...args);

        const getBoard = () => board;

        const createPageLayoutTile = (type) => {
            const tile = documentRef.createElement('div');
            tile.id = `page-tile-${type}`;
            tile.className = 'video-tile page-layout-tile panel-shell';
            tile.dataset.pageLayoutType = type;
            tile.dataset.layoutComponentType = type;
            tile.dataset.panelId = type;
            tile.style.overflow = 'hidden';
            const panelConfig = options.getPanelConfig?.(type);
            if (panelConfig) {
                tile.dataset.panelTitle = panelConfig.title;
                tile.dataset.panelCanHide = String(panelConfig.canHide);
                tile.dataset.panelCanCollapse = String(panelConfig.canCollapse);
                tile.dataset.panelCanPin = String(panelConfig.canPin);
                tile.style.minWidth = `${panelConfig.minWidth}px`;
                tile.style.minHeight = `${panelConfig.minHeight}px`;
            }
            return tile;
        };

        const getPageComponentId = (type) => `page-tile-${type}`;

        const getPagePanelLabel = (type) => PAGE_COMPONENT_LABELS[type] || type;

        const createPanelActionButton = ({
            action,
            iconClassName,
            iconName,
            label,
        }) => {
            const button = documentRef.createElement('button');

            button.type = 'button';
            button.className = `window-action-button panel-action-button panel-action-${action} no-drag`;
            button.dataset.panelAction = action;
            button.title = label;
            button.setAttribute('aria-label', label);
            if (!options.morphIconUI?.syncButtonIcon?.(button, iconName)) {
                const icon = documentRef.createElement('i');
                icon.className = iconClassName;
                icon.setAttribute('aria-hidden', 'true');
                button.append(icon);
            }
            return button;
        };

        const stopPanelActionEvent = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        const syncPanelActions = (tile) => {
            const actions = tile?.querySelector('.panel-shell-actions');

            if (!actions) {
                return;
            }

            const collapsed = tile.classList.contains('is-panel-collapsed');
            const pinned = tile.classList.contains('is-panel-pinned');
            const collapseButton = actions.querySelector(
                '[data-panel-action="collapse"]'
            );
            const pinButton = actions.querySelector(
                '[data-panel-action="pin"]'
            );

            if (collapseButton) {
                collapseButton.title = collapsed ? '展开面板' : '收起面板';
                collapseButton.setAttribute(
                    'aria-label',
                    collapsed ? '展开面板' : '收起面板'
                );
                collapseButton.setAttribute('aria-pressed', String(collapsed));
                options.morphIconUI?.syncButtonIcon?.(
                    collapseButton,
                    collapsed ? 'chevron-down' : 'chevron-up'
                );
            }

            if (pinButton) {
                pinButton.title = pinned ? '取消固定' : '固定置顶';
                pinButton.setAttribute(
                    'aria-label',
                    pinned ? '取消固定' : '固定置顶'
                );
                pinButton.setAttribute('aria-pressed', String(pinned));
                options.morphIconUI?.syncButtonIcon?.(
                    pinButton,
                    pinned ? 'pin-off' : 'pin'
                );
            }
        };

        const ensurePanelShellActions = (tile, type) => {
            const panelConfig = options.getPanelConfig?.(type);
            const header = tile?.querySelector('.tile-header');

            if (!panelConfig || !header) {
                return;
            }

            const actionSlot =
                header.querySelector('.tile-header-actions') || header;
            let actions = actionSlot.querySelector('.panel-shell-actions');

            if (!actions) {
                actions = documentRef.createElement('div');
                actions.className = 'panel-shell-actions no-drag';
                actionSlot.append(actions);
            }

            actions.replaceChildren();

            if (panelConfig.canCollapse !== false) {
                const collapseButton = createPanelActionButton({
                    action: 'collapse',
                    iconClassName: 'fas fa-window-minimize',
                    iconName: 'chevron-up',
                    label: '收起面板',
                });
                collapseButton.addEventListener(
                    'pointerdown',
                    stopPanelActionEvent
                );
                collapseButton.addEventListener('click', (event) => {
                    stopPanelActionEvent(event);
                    options.onTogglePanelCollapse?.(tile);
                    syncPanelActions(tile);
                });
                actions.append(collapseButton);
            }

            if (panelConfig.canPin !== false) {
                const pinButton = createPanelActionButton({
                    action: 'pin',
                    iconClassName: 'fas fa-thumbtack',
                    iconName: 'pin',
                    label: '固定置顶',
                });
                pinButton.addEventListener('pointerdown', stopPanelActionEvent);
                pinButton.addEventListener('click', (event) => {
                    stopPanelActionEvent(event);
                    options.onTogglePanelPin?.(tile);
                    syncPanelActions(tile);
                });
                actions.append(pinButton);
            }

            if (panelConfig.canHide !== false) {
                const hideButton = createPanelActionButton({
                    action: 'hide',
                    iconClassName: 'fas fa-eye-slash',
                    iconName: 'eye-off',
                    label: '隐藏窗口',
                });
                hideButton.addEventListener(
                    'pointerdown',
                    stopPanelActionEvent
                );
                hideButton.addEventListener('click', (event) => {
                    stopPanelActionEvent(event);
                    options.onHidePanel?.(tile);
                });
                actions.append(hideButton);
            }

            syncPanelActions(tile);
        };

        const syncLayoutGridMetadata = () => {
            const targetBoard = board || videoGrid;
            if (!targetBoard) {
                return;
            }

            targetBoard.dataset.layoutGridColumns = String(
                options.pageGridColumns
            );
            targetBoard.dataset.layoutGridRows = String(options.pageGridRows);
            targetBoard.style.setProperty(
                '--layout-grid-columns',
                String(options.pageGridColumns)
            );
            targetBoard.style.setProperty(
                '--layout-grid-rows',
                String(options.pageGridRows)
            );
        };

        const validatePageLayout = () => {
            const missing = [];
            const hidden = [];

            corePageTypes.forEach((type) => {
                const tile = documentRef.getElementById(
                    getPageComponentId(type)
                );
                if (!tile) {
                    missing.push(type);
                } else if (tile.classList.contains('is-layout-hidden')) {
                    hidden.push(type);
                }
            });

            if (missing.length > 0) {
                warn('Missing core page tiles:', missing);
            }

            if (hidden.length === corePageTypes.length) {
                warn('All core page tiles are hidden');
            }

            return { missing, hidden };
        };

        const ensureDefaultPageLayout = () => {
            log('Ensuring default page layout exists');

            if (!board) {
                warn('No page layout board, cannot ensure defaults');
                return;
            }

            corePageTypes.forEach((type) => {
                const tile = documentRef.getElementById(
                    getPageComponentId(type)
                );
                const defaultItem = options
                    .getDefaultLayoutItems()
                    .find((item) => item.type === type);
                if (!tile || !defaultItem) {
                    warn('Missing default page panel:', type);
                    return;
                }

                options.applyTileLayout(
                    tile,
                    options.convertGridLayoutToPixels({
                        ...defaultItem.grid,
                        zIndex: options.getNextTileLayoutZIndex(),
                    })
                );
                const visible = defaultItem.visible !== false;
                options.setTileLayoutItemVisibility(
                    tile.dataset.layoutItemId,
                    visible
                );
                tile.classList.toggle('is-layout-hidden', !visible);
            });

            syncLayoutGridMetadata();
            options.saveLayoutToStorage('布局已初始化');
        };

        const createPageTileFromNode = (type, node) => {
            const tile = createPageLayoutTile(type);
            const className = `page-tile-${type.replace(
                /[A-Z]/g,
                (letter) => `-${letter.toLowerCase()}`
            )}`;
            tile.classList.add(className);
            const { header, body, footer } = options.ensureTileStructure(tile);
            const avatar = header.querySelector('.tile-avatar');
            const title = header.querySelector('.tile-title');
            const badges = header.querySelector('.tile-badges');
            const label = getPagePanelLabel(type);

            avatar?.remove();

            if (title) {
                title.textContent = label;
            }

            if (badges) {
                badges.replaceChildren();
            }

            ensurePanelShellActions(tile, type);
            body.append(node);
            footer.textContent = '';
            footer.hidden = true;

            const itemId = `page-${options.sanitizeLayoutIdPart(type)}`;
            tile.dataset.layoutItemId = itemId;
            tile.dataset.layoutId = itemId;
            options.syncTileLayoutItemFromElement(tile, {
                id: itemId,
                type,
                visible: true,
                positioned: true,
            });

            return tile;
        };

        const getPageTileDiagnostics = (targetBoard, type) => {
            const tile = targetBoard.querySelector(
                `#${getPageComponentId(type)}`
            );
            return {
                tile,
                text: tile?.textContent.trim() || '',
                childCount:
                    tile?.querySelector('.tile-body')?.children.length || 0,
            };
        };

        const validateDetachedPageLayoutBoard = (targetBoard) => {
            const tileCount =
                targetBoard.querySelectorAll('.page-layout-tile').length;
            const members = getPageTileDiagnostics(
                targetBoard,
                pageComponentTypes.MEMBERS_PANEL
            );
            const mediaControls = getPageTileDiagnostics(
                targetBoard,
                pageComponentTypes.MEDIA_CONTROLS_PANEL
            );
            const chat = getPageTileDiagnostics(
                targetBoard,
                pageComponentTypes.CHAT_PANEL
            );
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

            if (tileCount < corePageTypes.length) {
                failures.push(`expected ${corePageTypes.length} page tiles`);
            }

            if (
                !members.tile ||
                !/大厅|游戏开黑/.test(members.text) ||
                !members.tile.querySelector(
                    '[data-channel-room], .tree-channel'
                )
            ) {
                failures.push('membersPanel is missing room content');
            }

            if (
                !mediaControls.tile ||
                !mediaControls.tile.querySelector('#buttons') ||
                !mediaControls.tile.querySelector('#localUserName')
            ) {
                failures.push('mediaControlsPanel is missing media controls');
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

        const bootstrapRecoveryToolbar = ({ visible = false } = {}) =>
            options.layoutRecoveryUI.ensureRecoveryToolbar({
                onReset: () => {
                    options.clearSavedLayout();
                    options.reload();
                },
                onRestore: () => {
                    restoreOriginalStaticLayout();
                },
                visible,
            });

        const initPageLayoutBoard = () => {
            if (board) {
                return board;
            }

            if (!mainLayout) {
                warn('No #main element found');
                return undefined;
            }

            const sidebarEl = mainLayout.querySelector('.room-sidebar');
            const chatPanelEl = mainLayout.querySelector('.chat-panel');
            const membersEl = sidebarEl?.querySelector('.sidebar-channel-tree');
            const roomInfoEl = sidebarEl?.querySelector('.local-user-card');
            const mediaControlsEl = roomInfoEl?.querySelector('#buttons');
            const chatMessagesEl = chatPanelEl?.querySelector(
                '#chatMessages, .chat-messages'
            );
            const chatFormEl = chatPanelEl?.querySelector(
                '#chatForm, .chat-form'
            );
            const runtimeVideoGrid = mainLayout.querySelector('#video-grid');
            const chatFormHasControls = Boolean(
                chatFormEl?.querySelector('textarea, input') &&
                    chatFormEl.querySelector('button')
            );

            if (chatPanelEl && !chatMessagesEl) {
                warn(
                    'Chat messages container was not found; keeping remaining chat panel content after input extraction.'
                );
            }

            log('source nodes', {
                sidebar: Boolean(sidebarEl),
                sidebarChildren: sidebarEl?.children.length || 0,
                sidebarHasTree: Boolean(membersEl),
                sidebarHasUserCard: Boolean(roomInfoEl),
                mediaControls: Boolean(mediaControlsEl),
                stageHasVideoGrid: Boolean(runtimeVideoGrid),
                chatPanel: Boolean(chatPanelEl),
                chatPanelHasMessages: Boolean(chatMessagesEl),
                chatPanelHasForm: Boolean(chatFormEl),
                chatFormHasControls,
            });

            const missingSelectors = [
                ['.sidebar-channel-tree', membersEl],
                ['.local-user-card', roomInfoEl],
                ['#buttons', mediaControlsEl],
                ['#video-grid', runtimeVideoGrid],
                ['.chat-panel', chatPanelEl],
                ['#chatForm or .chat-form', chatFormEl],
                [
                    'chat input controls',
                    chatFormHasControls ? chatFormEl : null,
                ],
            ]
                .filter(([, node]) => !node)
                .map(([selector]) => selector);

            if (missingSelectors.length > 0) {
                error('missing source nodes:', missingSelectors);
                bootstrapRecoveryToolbar({ visible: true });
                return undefined;
            }

            const roomPanelContent = documentRef.createElement('section');
            roomPanelContent.className = 'room-panel-content';
            roomPanelContent.setAttribute('aria-label', '房间 Room');
            originalDomOwner.trackTransient(roomPanelContent);
            membersEl.before(roomPanelContent);
            roomPanelContent.append(membersEl);

            const entries = [
                {
                    type: pageComponentTypes.MEMBERS_PANEL,
                    node: roomPanelContent,
                },
                {
                    type: pageComponentTypes.MEDIA_CONTROLS_PANEL,
                    node: mediaControlsEl,
                },
                {
                    type: pageComponentTypes.CHAT_PANEL,
                    node: chatPanelEl,
                },
            ].map((entry) => {
                const placeholder = documentRef.createComment(
                    `page-layout-placeholder:${entry.type}`
                );
                originalDomOwner.trackTransient(placeholder);
                entry.node.before(placeholder);
                return { ...entry, placeholder };
            });

            const nextBoard = documentRef.createElement('div');
            nextBoard.id = 'page-layout-board';
            nextBoard.className = 'page-layout-board';
            originalDomOwner.trackTransient(nextBoard);

            log('Board created, moving full DOM panels');
            const videoGridPlaceholder = documentRef.createComment(
                'page-layout-placeholder:video-grid'
            );
            originalDomOwner.trackTransient(videoGridPlaceholder);
            runtimeVideoGrid.before(videoGridPlaceholder);
            nextBoard.append(runtimeVideoGrid);
            entries.forEach(({ type, node }) => {
                const tile = createPageTileFromNode(type, node);
                originalDomOwner.trackTransient(tile);
                nextBoard.append(tile);
            });

            const detachedValidation =
                validateDetachedPageLayoutBoard(nextBoard);
            if (!detachedValidation.ok) {
                error(
                    'detached board validation failed:',
                    detachedValidation.failures
                );
                restoreOriginalStaticLayout();
                bootstrapRecoveryToolbar({ visible: true });
                return undefined;
            }

            mainLayout.classList.remove('room-layout');
            mainLayout.replaceChildren(nextBoard);
            setBoard(nextBoard);

            syncLayoutGridMetadata();

            const savedItems = options.loadLayoutFromStorage();
            log('Loaded layout from storage:', savedItems.length, 'items');
            const savedHasCore =
                savedItems.length > 0 &&
                corePageTypes.every((type) =>
                    savedItems.some((item) => item.type === type)
                );

            if (savedItems.length === 0 || !savedHasCore) {
                log('No valid saved layout, using defaults');
                ensureDefaultPageLayout();
            } else {
                const { missing } = validatePageLayout();
                if (
                    missing.length > 0 ||
                    missing.length === corePageTypes.length
                ) {
                    warn(
                        'Saved layout missing core components, using defaults'
                    );
                    ensureDefaultPageLayout();
                } else {
                    options.initializeLayoutFromStorage();
                }
            }

            options.ensureWindowManagerToolbar();
            options.syncWindowManagerUI();

            log(
                'Board initialized with',
                options.getVideoTiles().length,
                'tiles'
            );
            return nextBoard;
        };

        const restoreOriginalStaticLayout = () => {
            if (!mainLayout) {
                return { errors: [], ok: false };
            }

            const errors = [];
            const activeElement = documentRef.activeElement;
            const attempt = (label, callback) => {
                try {
                    callback?.();
                } catch (error) {
                    errors.push({ label, error });
                    warn(`recovery step failed: ${label}`, error);
                }
            };

            attempt('cancel layout interactions', () =>
                options.cancelLayoutInteractions?.()
            );
            const restored = originalDomOwner.restore();
            errors.push(...restored.errors);
            attempt('clear layout board state', () => setBoard(undefined));
            attempt('restore main layout classes', () => {
                mainLayout.classList.add('room-layout');
                mainLayout.classList.remove('is-window-interacting');
            });
            attempt('restore focus', () => {
                if (
                    activeElement?.isConnected !== false &&
                    typeof activeElement?.focus === 'function'
                ) {
                    activeElement.focus({ preventScroll: true });
                }
            });
            attempt('sync window manager UI', () =>
                options.syncWindowManagerUI()
            );

            if (errors.length > 0) {
                warn('original DOM recovery completed with errors', errors);
            } else {
                log('restored original business DOM nodes');
            }

            return { errors, ok: errors.length === 0 };
        };

        const detectBrokenBoard = () => {
            const existingBoard =
                documentRef.getElementById('page-layout-board');
            if (!existingBoard) return false;
            const tileCount =
                existingBoard.querySelectorAll('.page-layout-tile').length;
            if (tileCount === 0) {
                warn('detected empty board with 0 tiles, recovering');
                return true;
            }
            const validation = validateDetachedPageLayoutBoard(existingBoard);
            if (!validation.ok) {
                warn(
                    'detected broken page board, recovering',
                    validation.failures
                );
                return true;
            }
            return false;
        };

        const bootstrap = () => {
            if (detectBrokenBoard()) {
                restoreOriginalStaticLayout();
                bootstrapRecoveryToolbar({ visible: true });
                return;
            }

            try {
                initPageLayoutBoard();
            } catch (err) {
                error('init failed', err);
                restoreOriginalStaticLayout();
                bootstrapRecoveryToolbar({ visible: true });
            }
        };

        const installDebugRuntime = () => {
            global.__voiceLayoutDebug = {
                bootTime: new Date().toISOString(),
                resetLayout() {
                    options.clearSavedLayout();
                    const restored = restoreOriginalStaticLayout();
                    if (!restored.ok) {
                        warn('reset stopped after incomplete DOM recovery');
                        bootstrapRecoveryToolbar({ visible: true });
                        return;
                    }
                    try {
                        initPageLayoutBoard();
                    } catch (err) {
                        error('reset failed', err);
                        restoreOriginalStaticLayout();
                        bootstrapRecoveryToolbar({ visible: true });
                    }
                },
                showRecoveryToolbar() {
                    bootstrapRecoveryToolbar({ visible: true });
                },
                hideRecoveryToolbar() {
                    bootstrapRecoveryToolbar({ visible: false });
                },
                dumpDom() {
                    const result = {
                        main: Boolean(documentRef.getElementById('main')),
                        board: Boolean(
                            documentRef.getElementById('page-layout-board')
                        ),
                        pageTiles: documentRef.querySelectorAll(
                            '#page-layout-board > .page-layout-tile'
                        ).length,
                        toolbar: Boolean(
                            documentRef.querySelector(
                                '.layout-recovery-toolbar, .desktop-window-toolbar'
                            )
                        ),
                        panelRegistry: corePageTypes,
                        remotePeerCount: documentRef.querySelectorAll(
                            '.video-tile[data-layout-item-type="remotePeer"]'
                        ).length,
                        localPeer: {
                            exists: Boolean(
                                documentRef.getElementById('local-video')
                            ),
                            hidden: Boolean(
                                documentRef
                                    .getElementById('local-video')
                                    ?.classList.contains('is-layout-hidden')
                            ),
                        },
                        hasFooterLabels: Array.from(
                            documentRef.querySelectorAll(
                                '.page-layout-tile > .tile-footer:not([hidden])'
                            )
                        ).some(
                            (footer) => footer.textContent.trim().length > 0
                        ),
                    };
                    corePageTypes.forEach((type) => {
                        const tile = documentRef.getElementById(
                            `page-tile-${type}`
                        );
                        result[type] = tile
                            ? {
                                  exists: true,
                                  id: tile.id,
                                  hidden: tile.classList.contains(
                                      'is-layout-hidden'
                                  ),
                                  childCount: tile.children.length,
                                  bodyChildren:
                                      tile.querySelector('.tile-body')?.children
                                          .length || 0,
                                  textPreview: tile.textContent
                                      .trim()
                                      .slice(0, 80),
                                  hasInput: Boolean(
                                      tile.querySelector('textarea, input')
                                  ),
                                  hasChannelLinks: Boolean(
                                      tile.querySelector(
                                          '.tree-channel, [data-channel-room]'
                                      )
                                  ),
                              }
                            : { exists: false };
                    });
                    result.totalTiles =
                        documentRef.querySelectorAll('.video-tile').length;
                    options.layoutRecoveryUI.printDebugTable(result);
                    return result;
                },
                dumpLayout() {
                    const items = options.serializeLayoutItems();
                    options.layoutRecoveryUI.printDebugTable(
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
                },
                validateLayout() {
                    return validatePageLayout();
                },
            };
        };

        installDebugRuntime();

        return {
            bootstrap,
            bootstrapRecoveryToolbar,
            createPageLayoutTile,
            createPageTileFromNode,
            detectBrokenBoard,
            ensureDefaultPageLayout,
            getBoard,
            getPageComponentId,
            getPagePanelLabel,
            initPageLayoutBoard,
            restoreOriginalStaticLayout,
            syncLayoutGridMetadata,
            syncPanelActions,
            validateDetachedPageLayoutBoard,
            validatePageLayout,
        };
    };

    global.PageLayoutRuntime = {
        createOriginalDomOwner,
        createRuntime,
    };
})(window);
