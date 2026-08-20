(function exposePageLayoutWindowManagerRuntime(global) {
    'use strict';

    const createWindowManagerRuntime = (options = {}) => {
        const refs = options.refs || {};
        const toolbarUI = options.layoutToolbarUI;
        const componentMenuUI = options.layoutComponentMenuUI;
        let toolbarRefs = {};
        let resetConfirmTimer;

        const ensureToolbar = () => {
            if (!refs.mainLayout || toolbarRefs.windowMenuToggle) {
                return toolbarRefs;
            }

            toolbarRefs = toolbarUI.ensureToolbar({
                mainLayout: refs.mainLayout,
            });
            return toolbarRefs;
        };

        const closeWindowMenu = () => {
            componentMenuUI.closeMenu({
                menu: toolbarRefs.componentMenu,
                toggleButton: toolbarRefs.windowMenuToggle,
            });
        };

        const buildWindowMenuItems = () =>
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
                          ? '恢复'
                          : '添加',
                    type,
                };
            });

        const renderWindowMenu = () => {
            if (!toolbarRefs.componentMenu) {
                return;
            }

            componentMenuUI.renderMenu({
                items: buildWindowMenuItems(),
                menu: toolbarRefs.componentMenu,
                onSelect: (type) => {
                    options.onShowWindow(type);
                    closeWindowMenu();
                },
            });
        };

        const toggleWindowMenu = () => {
            if (!toolbarRefs.componentMenu) {
                return;
            }

            renderWindowMenu();
            componentMenuUI.toggleMenu({
                menu: toolbarRefs.componentMenu,
                toggleButton: toolbarRefs.windowMenuToggle,
            });
        };

        const syncWindowManagerUI = () => {
            toolbarUI.renderToolbarState({
                resetDefaultButton: toolbarRefs.resetDefaultButton,
                saveStatus: toolbarRefs.saveStatus,
                toolbar: toolbarRefs.toolbar,
                windowMenuToggle: toolbarRefs.windowMenuToggle,
            });
            renderWindowMenu();
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

        const bindToolbarEvents = () => {
            const nextRefs = ensureToolbar();
            nextRefs.windowMenuToggle?.addEventListener(
                'click',
                toggleWindowMenu
            );
            nextRefs.resetDefaultButton?.addEventListener(
                'click',
                handleResetDefaultClick
            );
            return nextRefs;
        };

        return {
            bindToolbarEvents,
            closeWindowMenu,
            ensureToolbar,
            handleResetDefaultClick,
            renderWindowMenu,
            showSaveStatus,
            syncWindowManagerUI,
            toggleWindowMenu,
        };
    };

    global.PageLayoutWindowManagerRuntime = {
        createRuntime: createWindowManagerRuntime,
        createWindowManagerRuntime,
    };
})(window);
