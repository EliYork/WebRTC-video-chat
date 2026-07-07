(function exposePageLayoutEditorRuntime(global) {
    'use strict';

    const createEditorRuntime = (options = {}) => {
        const documentRef = options.document || global.document;
        const refs = options.refs || {};
        const toolbarUI = options.layoutToolbarUI;
        const componentMenuUI = options.layoutComponentMenuUI;
        const componentActionsUI = options.layoutComponentActionsUI;
        let editMode = Boolean(options.initialEditMode);
        let toolbarRefs = {};
        let resetConfirmTimer;
        let activeToolbarTile;

        const setEditModeState = (enabled) => {
            editMode = Boolean(enabled);
            options.onEditModeChange?.(editMode);
        };

        const ensureToolbar = () => {
            if (!refs.mainLayout || toolbarRefs.editModeToggle) {
                return toolbarRefs;
            }

            toolbarRefs = toolbarUI.ensureToolbar({
                mainLayout: refs.mainLayout,
            });
            return toolbarRefs;
        };

        const closeComponentMenu = () => {
            componentMenuUI.closeMenu({
                menu: toolbarRefs.componentMenu,
                toggleButton: toolbarRefs.addComponentToggle,
            });
        };

        const closeComponentConfig = () => {
            const panel = documentRef.querySelector('.layout-config-panel');
            if (panel) {
                panel.remove();
            }
        };

        const findComponentToolbar = (tile) =>
            componentActionsUI.findToolbar(tile);

        const positionComponentToolbar = (tile) => {
            componentActionsUI.positionToolbar({
                tile,
                board: options.getPageLayoutBoard() || tile?.parentElement,
            });
        };

        const setActiveToolbarTile = (tile) => {
            activeToolbarTile = tile;
            componentActionsUI.setActiveTile({
                tile,
                enabled: editMode,
                onPosition: positionComponentToolbar,
            });
        };

        const positionActiveToolbarTile = () => {
            if (activeToolbarTile) {
                positionComponentToolbar(activeToolbarTile);
            }
        };

        const syncComponentToolbarState = (tile) => {
            componentActionsUI.syncToolbarState({
                tile,
                freeMoveEnabled: options.isTileFreeMoveEnabled(tile),
            });
        };

        const ensureComponentToolbar = (tile) => {
            return componentActionsUI.ensureToolbar({
                board: options.getPageLayoutBoard(),
                tile,
                freeMoveEnabled: options.isTileFreeMoveEnabled(tile),
                onHide: options.onHideComponent,
                onToggleFreeMove: options.onToggleFreeMove,
                onActivate: setActiveToolbarTile,
            });
        };

        const ensureComponentActions = () => {
            options.getVideoTiles().forEach((tile) => {
                const { actions } = options.ensureTileStructure(tile);
                actions
                    .querySelectorAll(
                        '.layout-component-remove, .layout-component-settings'
                    )
                    .forEach((button) => button.remove());
                ensureComponentToolbar(tile);
            });
        };

        const buildComponentMenuItems = () =>
            options.getCorePageTypes().map((type) => {
                const tile = options.getExistingLayoutComponentTile(type);
                const item = tile?.dataset.layoutItemId
                    ? options.getTileLayoutItem(tile.dataset.layoutItemId)
                    : null;
                const exists = Boolean(tile);
                const visible =
                    exists && !tile.classList.contains('is-layout-hidden');

                return {
                    disabled: Boolean(
                        exists && visible && item?.visible !== false
                    ),
                    label: options.getPagePanelLabel(type),
                    statusText: visible
                        ? '已显示'
                        : exists
                          ? '重新显示'
                          : '添加',
                    type,
                };
            });

        const renderComponentMenu = () => {
            if (!toolbarRefs.componentMenu) {
                return;
            }

            componentMenuUI.renderMenu({
                items: buildComponentMenuItems(),
                menu: toolbarRefs.componentMenu,
                onSelect: (type) => {
                    options.onAddComponent(type);
                    closeComponentMenu();
                },
            });
        };

        const toggleComponentMenu = () => {
            if (!toolbarRefs.componentMenu) {
                return;
            }

            renderComponentMenu();
            componentMenuUI.toggleMenu({
                menu: toolbarRefs.componentMenu,
                toggleButton: toolbarRefs.addComponentToggle,
            });
        };

        const syncEditModeUI = () => {
            toolbarUI.renderToolbarState({
                addComponentToggle: toolbarRefs.addComponentToggle,
                editMode,
                editModeToggle: toolbarRefs.editModeToggle,
                layoutLocked: options.isLayoutLocked?.() || false,
                lockLayoutToggle: toolbarRefs.lockLayoutToggle,
                mainLayout: refs.mainLayout,
                pageLayoutBoard: options.getPageLayoutBoard(),
                resetDefaultButton: toolbarRefs.resetDefaultButton,
                saveStatus: toolbarRefs.saveStatus,
                toolbar: toolbarRefs.toolbar,
            });

            options.getVideoTiles().forEach((tile) => {
                tile.classList.toggle('is-layout-editing', editMode);
            });

            if (editMode) {
                options.onEnterEditMode?.();
                renderComponentMenu();
                ensureComponentActions();
                if (activeToolbarTile) {
                    setActiveToolbarTile(activeToolbarTile);
                }
            } else {
                setActiveToolbarTile(undefined);
                closeComponentMenu();
                closeComponentConfig();
            }
        };

        const setEditMode = (enabled) => {
            setEditModeState(enabled);
            options.syncLayoutGridMetadata();
            syncEditModeUI();

            if (!editMode) {
                options.onExitEditMode?.();
            }
        };

        const toggleEditMode = () => {
            if (editMode) {
                options.onFinalizeLayoutEditing();
                return;
            }

            setEditMode(true);
        };

        const showSaveStatus = (message) => {
            toolbarUI.showSaveStatus({
                message,
                saveStatus: toolbarRefs.saveStatus,
            });
        };

        const handleResetDefaultClick = () => {
            const resetDefaultButton = toolbarRefs.resetDefaultButton;
            const confirmed =
                resetDefaultButton?.dataset.confirmReset === 'true';

            if (!confirmed) {
                toolbarUI.renderResetConfirmState({
                    confirming: true,
                    resetDefaultButton,
                });
                clearTimeout(resetConfirmTimer);
                resetConfirmTimer = setTimeout(() => {
                    toolbarUI.renderResetConfirmState({
                        confirming: false,
                        resetDefaultButton,
                    });
                }, 2400);

                return;
            }

            clearTimeout(resetConfirmTimer);
            toolbarUI.renderResetConfirmState({
                confirming: false,
                resetDefaultButton,
            });
            options.onApplyDefaultLayout();
        };

        const bindToolbarEvents = ({
            onEditToggle = toggleEditMode,
            onComponentMenuToggle = toggleComponentMenu,
            onLockToggle = options.onToggleLayoutLock,
            onResetDefault = handleResetDefaultClick,
        } = {}) => {
            const nextRefs = ensureToolbar();
            nextRefs.editModeToggle?.addEventListener('click', onEditToggle);
            nextRefs.addComponentToggle?.addEventListener(
                'click',
                onComponentMenuToggle
            );
            nextRefs.lockLayoutToggle?.addEventListener('click', () =>
                onLockToggle?.()
            );
            nextRefs.resetDefaultButton?.addEventListener(
                'click',
                onResetDefault
            );
            return nextRefs;
        };

        const getToolbarRefs = () => toolbarRefs;
        const isEditMode = () => editMode;

        return {
            bindToolbarEvents,
            closeComponentConfig,
            closeComponentMenu,
            ensureComponentActions,
            ensureToolbar,
            findComponentToolbar,
            getToolbarRefs,
            handleResetDefaultClick,
            isEditMode,
            positionActiveToolbarTile,
            positionComponentToolbar,
            renderComponentMenu,
            setActiveToolbarTile,
            setEditMode,
            showSaveStatus,
            syncComponentToolbarState,
            syncEditModeUI,
            toggleComponentMenu,
            toggleEditMode,
        };
    };

    global.PageLayoutEditorRuntime = {
        createEditorRuntime,
        createRuntime: createEditorRuntime,
    };
})(window);
