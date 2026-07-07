(function exposePageLayoutToolbarUI(global) {
    'use strict';

    let saveStatusTimer;

    const setButtonLabel = (button, text) => {
        const label = button?.querySelector('span');

        if (label) {
            label.textContent = text;
        }
    };

    const createIcon = (className) => {
        const icon = global.document.createElement('i');
        icon.className = className;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    };

    const createButton = ({ id, className, iconClassName, labelText }) => {
        const button = global.document.createElement('button');
        const label = global.document.createElement('span');

        button.id = id;
        button.className = className;
        button.type = 'button';
        label.textContent = labelText;
        button.append(createIcon(iconClassName), label);
        return button;
    };

    const ensureToolbar = ({ mainLayout } = {}) => {
        if (!mainLayout) {
            return {};
        }

        const toolbar = global.document.createElement('div');
        const primaryAction = global.document.createElement('div');
        const secondaryActions = global.document.createElement('div');
        const editModeToggle = createButton({
            id: 'layoutEditModeToggle',
            className: 'layout-edit-toggle layout-edit-primary-button',
            iconClassName: 'fas fa-border-all',
            labelText: '编辑布局',
        });
        const addComponentToggle = createButton({
            id: 'layoutAddComponentToggle',
            className: 'layout-tool-button',
            iconClassName: 'fas fa-plus',
            labelText: '添加组件',
        });
        const resetDefaultButton = createButton({
            id: 'layoutResetDefault',
            className: 'layout-tool-button',
            iconClassName: 'fas fa-undo',
            labelText: '恢复默认布局',
        });
        const componentMenu = global.document.createElement('div');
        const saveStatus = global.document.createElement('span');

        toolbar.className =
            'stage-layout-toolbar page-layout-toolbar page-layout-topbar';
        toolbar.setAttribute('aria-label', '布局工具');
        primaryAction.className = 'layout-edit-primary-action';
        secondaryActions.className = 'layout-edit-secondary-actions';
        editModeToggle.setAttribute('aria-pressed', 'false');
        addComponentToggle.setAttribute('aria-expanded', 'false');
        componentMenu.className = 'layout-component-menu';
        componentMenu.hidden = true;
        componentMenu.setAttribute('role', 'menu');
        componentMenu.setAttribute('aria-label', '添加布局组件');
        saveStatus.className = 'layout-save-status';
        saveStatus.textContent = '已保存';

        primaryAction.append(editModeToggle);
        secondaryActions.append(
            addComponentToggle,
            resetDefaultButton,
            saveStatus,
            componentMenu
        );
        toolbar.append(primaryAction, secondaryActions);
        mainLayout.prepend(toolbar);

        return {
            addComponentToggle,
            componentMenu,
            editModeToggle,
            resetDefaultButton,
            saveStatus,
            toolbar,
        };
    };

    const renderToolbarState = ({
        mainLayout,
        pageLayoutBoard,
        editMode = false,
        editModeToggle,
        addComponentToggle,
        resetDefaultButton,
        saveStatus,
    } = {}) => {
        mainLayout?.classList.toggle('is-layout-editing', editMode);
        pageLayoutBoard?.classList.toggle('is-layout-editing', editMode);

        if (editModeToggle) {
            editModeToggle.setAttribute('aria-pressed', String(editMode));
            setButtonLabel(editModeToggle, editMode ? '完成编辑' : '编辑布局');
        }

        [addComponentToggle, resetDefaultButton].forEach((button) => {
            if (button) {
                button.hidden = !editMode;
            }
        });

        if (saveStatus) {
            saveStatus.hidden = !editMode;
        }
    };

    const showSaveStatus = ({
        saveStatus,
        message,
        durationMs = 1800,
    } = {}) => {
        if (!saveStatus) {
            return;
        }

        saveStatus.textContent = message;
        clearTimeout(saveStatusTimer);
        saveStatusTimer = setTimeout(() => {
            saveStatus.textContent = '已保存';
        }, durationMs);
    };

    const renderResetConfirmState = ({
        resetDefaultButton,
        confirming = false,
    } = {}) => {
        if (!resetDefaultButton) {
            return;
        }

        if (confirming) {
            resetDefaultButton.dataset.confirmReset = 'true';
            setButtonLabel(resetDefaultButton, '再次点击确认');
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
