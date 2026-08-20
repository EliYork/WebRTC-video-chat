(function exposePageLayoutToolbarUI(global) {
    'use strict';

    let saveStatusTimer;

    const setButtonLabel = (button, text) => {
        const label = button?.querySelector('span');
        if (label) {
            label.textContent = text;
        }
    };

    const createButton = ({ id, className, iconClassName, labelText }) => {
        const button = global.document.createElement('button');
        const icon = global.document.createElement('i');
        const label = global.document.createElement('span');

        button.id = id;
        button.className = className;
        button.type = 'button';
        icon.className = iconClassName;
        icon.setAttribute('aria-hidden', 'true');
        label.textContent = labelText;
        button.append(icon, label);
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
                resetDefaultButton: existing.querySelector('#layoutResetDefault'),
                saveStatus: existing.querySelector('.layout-save-status'),
                toolbar: existing,
                windowMenuToggle: existing.querySelector('#layoutWindowMenuToggle'),
            };
        }

        const toolbar = global.document.createElement('div');
        const windowMenuToggle = createButton({
            id: 'layoutWindowMenuToggle',
            className: 'layout-tool-button layout-window-menu-toggle',
            iconClassName: 'fas fa-layer-group',
            labelText: '窗口',
        });
        const resetDefaultButton = createButton({
            id: 'layoutResetDefault',
            className: 'layout-tool-button',
            iconClassName: 'fas fa-undo',
            labelText: '恢复默认',
        });
        const componentMenu = global.document.createElement('div');
        const saveStatus = global.document.createElement('span');

        toolbar.className =
            'desktop-window-toolbar page-layout-toolbar page-layout-topbar';
        toolbar.setAttribute('aria-label', '窗口管理');
        windowMenuToggle.setAttribute('aria-expanded', 'false');
        componentMenu.className = 'layout-component-menu';
        componentMenu.hidden = true;
        componentMenu.setAttribute('role', 'menu');
        componentMenu.setAttribute('aria-label', '窗口列表');
        saveStatus.className = 'layout-save-status';
        saveStatus.textContent = '已保存';
        saveStatus.hidden = true;

        toolbar.append(
            windowMenuToggle,
            resetDefaultButton,
            saveStatus,
            componentMenu
        );
        mainLayout.prepend(toolbar);

        return {
            componentMenu,
            resetDefaultButton,
            saveStatus,
            toolbar,
            windowMenuToggle,
        };
    };

    const renderToolbarState = ({
        toolbar,
        windowMenuToggle,
        resetDefaultButton,
    } = {}) => {
        if (toolbar) toolbar.hidden = false;
        if (windowMenuToggle) windowMenuToggle.hidden = false;
        if (resetDefaultButton) resetDefaultButton.hidden = false;
    };

    const showSaveStatus = ({ saveStatus, message, durationMs = 1800 } = {}) => {
        if (!saveStatus) return;
        saveStatus.textContent = message;
        saveStatus.hidden = false;
        clearTimeout(saveStatusTimer);
        saveStatusTimer = setTimeout(() => {
            saveStatus.textContent = '已保存';
            saveStatus.hidden = true;
        }, durationMs);
    };

    const renderResetConfirmState = ({ resetDefaultButton, confirming = false } = {}) => {
        if (!resetDefaultButton) return;
        if (confirming) {
            resetDefaultButton.dataset.confirmReset = 'true';
            setButtonLabel(resetDefaultButton, '再次确认');
            return;
        }
        delete resetDefaultButton.dataset.confirmReset;
        setButtonLabel(resetDefaultButton, '恢复默认');
    };

    global.PageLayoutToolbarUI = {
        ensureToolbar,
        renderResetConfirmState,
        renderToolbarState,
        showSaveStatus,
    };
})(window);
