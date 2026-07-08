(function exposePageLayoutRuntime(global) {
    'use strict';

    const PAGE_COMPONENT_LABELS = {
        sidebarPanel: '侧边栏 Sidebar',
        membersPanel: '房间 Room',
        mediaControlsPanel: '语音 Dock',
        chatPanel: '聊天 Chat',
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
                  pageComponentTypes.SIDEBAR_PANEL,
                  pageComponentTypes.CHAT_PANEL,
              ].filter(Boolean);
        let board = options.initialBoard;
        const originalMainSnapshot = mainLayout
            ? mainLayout.cloneNode(true)
            : null;

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

        const createPanelActionButton = ({ action, iconClassName, label }) => {
            const button = documentRef.createElement('button');
            const icon = documentRef.createElement('i');

            button.type = 'button';
            button.className = `panel-action-button panel-action-${action} no-drag`;
            button.dataset.panelAction = action;
            button.title = label;
            button.setAttribute('aria-label', label);
            icon.className = iconClassName;
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
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
            }

            if (pinButton) {
                pinButton.title = pinned ? '取消固定' : '固定置顶';
                pinButton.setAttribute(
                    'aria-label',
                    pinned ? '取消固定' : '固定置顶'
                );
                pinButton.setAttribute('aria-pressed', String(pinned));
            }
        };

        const ensurePanelShellActions = (tile, type) => {
            const panelConfig = options.getPanelConfig?.(type);
            const header = tile?.querySelector('.tile-header');

            if (!panelConfig || !header) {
                return;
            }

            let actions = header.querySelector('.panel-shell-actions');

            if (!actions) {
                actions = documentRef.createElement('div');
                actions.className = 'panel-shell-actions no-drag';
                header.append(actions);
            }

            actions.replaceChildren();

            if (panelConfig.canCollapse !== false) {
                const collapseButton = createPanelActionButton({
                    action: 'collapse',
                    iconClassName: 'fas fa-window-minimize',
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
            const sidebar = getPageTileDiagnostics(
                targetBoard,
                pageComponentTypes.SIDEBAR_PANEL
            );
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
                !sidebar.tile ||
                !sidebar.text.includes('朋友语音房间') ||
                !sidebar.tile.querySelector('.sidebar-brand')
            ) {
                failures.push('sidebarPanel is missing brand content');
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

        const restoreMovedPagePanelNodes = (entries) => {
            entries.forEach(({ node, placeholder }) => {
                if (placeholder.isConnected) {
                    placeholder.replaceWith(node);
                }
            });
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
            const sidebarBrandEl = sidebarEl?.querySelector('.sidebar-brand');
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
                sidebarHasBrand: Boolean(sidebarBrandEl),
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
                ['.sidebar-brand', sidebarBrandEl],
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
            membersEl.before(roomPanelContent);
            roomPanelContent.append(membersEl);

            const entries = [
                {
                    type: pageComponentTypes.SIDEBAR_PANEL,
                    node: sidebarBrandEl,
                },
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
                entry.node.before(placeholder);
                return { ...entry, placeholder };
            });

            const nextBoard = documentRef.createElement('div');
            nextBoard.id = 'page-layout-board';
            nextBoard.className = 'page-layout-board';

            log('Board created, moving full DOM panels');
            const videoGridPlaceholder = documentRef.createComment(
                'page-layout-placeholder:video-grid'
            );
            runtimeVideoGrid.before(videoGridPlaceholder);
            nextBoard.append(runtimeVideoGrid);
            entries.forEach(({ type, node }) => {
                nextBoard.append(createPageTileFromNode(type, node));
            });

            const detachedValidation =
                validateDetachedPageLayoutBoard(nextBoard);
            if (!detachedValidation.ok) {
                error(
                    'detached board validation failed:',
                    detachedValidation.failures
                );
                restoreMovedPagePanelNodes([
                    {
                        node: runtimeVideoGrid,
                        placeholder: videoGridPlaceholder,
                    },
                ]);
                restoreMovedPagePanelNodes(entries);
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

            options.ensureLayoutEditModeToggle();
            options.syncLayoutEditModeUI();

            log(
                'Board initialized with',
                options.getVideoTiles().length,
                'tiles'
            );
            return nextBoard;
        };

        const restoreOriginalStaticLayout = () => {
            if (!mainLayout) return;
            const existingBoard =
                documentRef.getElementById('page-layout-board');
            if (existingBoard) existingBoard.remove();
            mainLayout.classList.add('room-layout');
            if (
                originalMainSnapshot &&
                originalMainSnapshot.children.length > 0
            ) {
                mainLayout.replaceChildren();
                while (originalMainSnapshot.firstChild) {
                    mainLayout.append(originalMainSnapshot.firstChild);
                }
                logger.info('[page-layout] restored original static layout');
            } else {
                mainLayout.replaceChildren();
                mainLayout.innerHTML = `
            <aside class="room-sidebar"><div class="sidebar-brand"><a href="/">朋友语音房间</a></div></aside>
            <main class="room-stage"><section id="canvas"><div id="video-grid"></div></section></main>
            <aside class="chat-panel"><ol id="chatMessages" class="chat-messages" style="height:60vh"></ol>
            <form id="chatForm" class="chat-form"><textarea id="chatInput"></textarea><button>发送</button></form></aside>`;
                logger.info('[page-layout] created safe fallback DOM');
            }
            setBoard(undefined);
            options.setLayoutEditMode(false);
            options.syncLayoutEditModeUI();
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
                    documentRef.getElementById('page-layout-board')?.remove();
                    setBoard(undefined);
                    try {
                        initPageLayoutBoard();
                    } catch (err) {
                        error('reset failed', err);
                        restoreOriginalStaticLayout();
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
                                '.layout-recovery-toolbar, .stage-layout-toolbar'
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
        createRuntime,
    };
})(window);
