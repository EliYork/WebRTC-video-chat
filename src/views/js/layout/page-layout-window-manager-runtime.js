(function exposePageLayoutWindowManagerRuntime(global) {
    'use strict';

    const createWindowManagerRuntime = (options = {}) => {
        const refs = options.refs || {};
        const toolbarUI = options.layoutToolbarUI;
        const componentMenuUI = options.layoutComponentMenuUI;
        const morphIconUI = options.morphIconUI;
        let toolbarRefs = {};
        let globalEventsBound = false;
        let resetConfirmTimer;

        const ensureToolbar = () => {
            if (!refs.mainLayout) {
                return toolbarRefs;
            }
            if (toolbarRefs.settingsToggle?.isConnected) {
                return toolbarRefs;
            }

            toolbarRefs = toolbarUI.ensureToolbar({
                mainLayout: refs.mainLayout,
            });
            return toolbarRefs;
        };

        const syncSettingsIcon = (open, { animate = true } = {}) => {
            morphIconUI?.syncButtonIcon?.(
                toolbarRefs.settingsToggle,
                open ? 'close' : 'settings',
                { animate }
            );
        };

        const closeSettingsMenu = ({ restoreFocus = false } = {}) => {
            componentMenuUI.closeMenu({
                menu: toolbarRefs.settingsMenu,
                toggleButton: toolbarRefs.settingsToggle,
            });
            syncSettingsIcon(false);
            if (restoreFocus) {
                toolbarRefs.settingsToggle?.focus?.();
            }
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
                    disabled: false,
                    label: options.getPagePanelLabel(type),
                    statusText:
                        visible && item?.visible !== false ? '隐藏' : '显示',
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
                    const tile = options.getExistingLayoutComponentTile(type);
                    const visible =
                        Boolean(tile) &&
                        !tile.classList.contains('is-layout-hidden');
                    if (visible) {
                        options.onHideWindow?.(tile);
                    } else {
                        options.onShowWindow(type);
                    }
                    closeSettingsMenu();
                },
            });
        };

        const toggleSettingsMenu = () => {
            if (!toolbarRefs.settingsMenu) {
                return;
            }

            renderWindowMenu();
            const open = componentMenuUI.toggleMenu({
                menu: toolbarRefs.settingsMenu,
                toggleButton: toolbarRefs.settingsToggle,
            });
            syncSettingsIcon(open);
        };

        const syncWindowManagerUI = () => {
            toolbarUI.renderToolbarState({
                resetDefaultButton: toolbarRefs.resetDefaultButton,
                saveStatus: toolbarRefs.saveStatus,
                settingsToggle: toolbarRefs.settingsToggle,
                toolbar: toolbarRefs.toolbar,
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
            closeSettingsMenu();
        };

        const bindToolbarEvents = () => {
            const nextRefs = ensureToolbar();
            if (nextRefs.toolbar?.dataset.settingsBound !== 'true') {
                syncSettingsIcon(false, { animate: false });
                nextRefs.settingsToggle?.addEventListener(
                    'click',
                    toggleSettingsMenu
                );
                nextRefs.resetDefaultButton?.addEventListener(
                    'click',
                    handleResetDefaultClick
                );
                nextRefs.toolbar.dataset.settingsBound = 'true';
            }

            if (!globalEventsBound) {
                global.document.addEventListener('pointerdown', (event) => {
                    if (
                        !toolbarRefs.settingsMenu?.hidden &&
                        !toolbarRefs.toolbar?.contains?.(event.target)
                    ) {
                        closeSettingsMenu();
                    }
                });
                global.document.addEventListener('keydown', (event) => {
                    if (
                        event.key === 'Escape' &&
                        !toolbarRefs.settingsMenu?.hidden
                    ) {
                        closeSettingsMenu({ restoreFocus: true });
                    }
                });
                globalEventsBound = true;
            }
            return nextRefs;
        };

        return {
            bindToolbarEvents,
            closeSettingsMenu,
            ensureToolbar,
            handleResetDefaultClick,
            renderWindowMenu,
            showSaveStatus,
            syncWindowManagerUI,
            toggleSettingsMenu,
        };
    };

    global.PageLayoutWindowManagerRuntime = {
        createRuntime: createWindowManagerRuntime,
        createWindowManagerRuntime,
    };
})(window);
