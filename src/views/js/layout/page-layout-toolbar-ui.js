(function exposePageLayoutToolbarUI(global) {
    'use strict';

    let saveStatusTimer;

    const setButtonLabel = (button, text) => {
        const label = button?.querySelector('.layout-settings-action-label');
        if (label) {
            label.textContent = text;
        }
    };

    const createSettingsToggle = () => {
        const button = global.document.createElement('button');
        const icon = global.document.createElement('i');

        button.id = 'layoutSettingsToggle';
        button.className = 'layout-settings-toggle';
        button.type = 'button';
        button.title = '设置';
        button.setAttribute('aria-label', '设置');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'layoutSettingsMenu');
        icon.className = 'fas fa-cog';
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon);
        return button;
    };

    const createResetButton = () => {
        const button = global.document.createElement('button');
        const label = global.document.createElement('span');
        const note = global.document.createElement('span');

        button.id = 'layoutResetDefault';
        button.className = 'layout-settings-action';
        button.type = 'button';
        label.className = 'layout-settings-action-label';
        label.textContent = '恢复默认布局';
        note.className = 'layout-settings-action-note';
        note.textContent = '重置';
        button.append(label, note);
        return button;
    };

    const ensureToolbar = ({ mainLayout } = {}) => {
        if (!mainLayout) {
            return {};
        }

        const existing = mainLayout.querySelector('.page-layout-toolbar');
        if (existing) {
            return {
                componentMenu: existing.querySelector('.layout-component-menu'),
                resetDefaultButton: existing.querySelector(
                    '#layoutResetDefault'
                ),
                saveStatus: existing.querySelector('.layout-save-status'),
                settingsMenu: existing.querySelector('#layoutSettingsMenu'),
                settingsToggle: existing.querySelector('#layoutSettingsToggle'),
                toolbar: existing,
            };
        }

        const toolbar = global.document.createElement('div');
        const settingsToggle = createSettingsToggle();
        const settingsMenu = global.document.createElement('div');
        const settingsHeading = global.document.createElement('strong');
        const windowGroup = global.document.createElement('section');
        const windowGroupLabel = global.document.createElement('span');
        const layoutGroup = global.document.createElement('section');
        const layoutGroupLabel = global.document.createElement('span');
        const resetDefaultButton = createResetButton();
        const componentMenu = global.document.createElement('div');
        const saveStatus = global.document.createElement('span');

        toolbar.className =
            'desktop-window-toolbar page-layout-toolbar page-layout-topbar';
        toolbar.setAttribute('aria-label', '桌面设置');
        settingsMenu.id = 'layoutSettingsMenu';
        settingsMenu.className = 'layout-settings-menu';
        settingsMenu.hidden = true;
        settingsMenu.setAttribute('role', 'dialog');
        settingsMenu.setAttribute('aria-label', '设置');
        settingsHeading.className = 'layout-settings-heading';
        settingsHeading.textContent = '设置';
        windowGroup.className = 'layout-settings-group';
        windowGroupLabel.className = 'layout-settings-group-label';
        windowGroupLabel.textContent = '窗口';
        layoutGroup.className = 'layout-settings-group';
        layoutGroupLabel.className = 'layout-settings-group-label';
        layoutGroupLabel.textContent = '布局';
        componentMenu.className = 'layout-component-menu';
        componentMenu.setAttribute('role', 'group');
        componentMenu.setAttribute('aria-label', '窗口列表');
        saveStatus.className = 'layout-save-status';
        saveStatus.textContent = '已保存';
        saveStatus.hidden = true;
        saveStatus.setAttribute('role', 'status');
        saveStatus.setAttribute('aria-live', 'polite');

        windowGroup.append(windowGroupLabel, componentMenu);
        layoutGroup.append(layoutGroupLabel, resetDefaultButton);
        settingsMenu.append(settingsHeading, windowGroup, layoutGroup);
        toolbar.append(settingsToggle, settingsMenu, saveStatus);
        mainLayout.prepend(toolbar);

        return {
            componentMenu,
            resetDefaultButton,
            saveStatus,
            settingsMenu,
            settingsToggle,
            toolbar,
        };
    };

    const renderToolbarState = ({
        toolbar,
        settingsToggle,
        resetDefaultButton,
    } = {}) => {
        if (toolbar) toolbar.hidden = false;
        if (settingsToggle) settingsToggle.hidden = false;
        if (resetDefaultButton) resetDefaultButton.hidden = false;
    };

    const showSaveStatus = ({
        saveStatus,
        message,
        durationMs = 1800,
    } = {}) => {
        if (!saveStatus) return;
        saveStatus.textContent = message;
        saveStatus.hidden = false;
        clearTimeout(saveStatusTimer);
        saveStatusTimer = setTimeout(() => {
            saveStatus.textContent = '已保存';
            saveStatus.hidden = true;
        }, durationMs);
    };

    const renderResetConfirmState = ({
        resetDefaultButton,
        confirming = false,
    } = {}) => {
        if (!resetDefaultButton) return;
        if (confirming) {
            resetDefaultButton.dataset.confirmReset = 'true';
            setButtonLabel(resetDefaultButton, '再次确认恢复');
            return;
        }
        delete resetDefaultButton.dataset.confirmReset;
        setButtonLabel(resetDefaultButton, '恢复默认布局');
    };

    global.PageLayoutToolbarUI = {
        ensureToolbar,
        renderResetConfirmState,
        renderToolbarState,
        showSaveStatus,
    };
})(window);
