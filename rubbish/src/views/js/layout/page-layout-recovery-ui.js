(function exposePageLayoutRecoveryUI(global) {
    'use strict';

    const setRecoveryToolbarVisible = (toolbar, visible = false) => {
        if (toolbar) {
            toolbar.hidden = !visible;
        }
    };

    const createRecoveryButton = ({ id, text, onClick }) => {
        const button = global.document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => {
            onClick?.();
        });
        return button;
    };

    const ensureRecoveryToolbar = ({
        visible = false,
        onReset,
        onRestore,
    } = {}) => {
        const existing = global.document.querySelector(
            '.layout-recovery-toolbar'
        );

        if (existing) {
            setRecoveryToolbarVisible(existing, visible);
            return existing;
        }

        const bar = global.document.createElement('div');
        const resetButton = createRecoveryButton({
            id: 'layoutRecoveryReset',
            text: '重置布局',
            onClick: onReset,
        });
        const restoreButton = createRecoveryButton({
            id: 'layoutRecoveryRestore',
            text: '恢复原始页面',
            onClick: onRestore,
        });

        bar.className = 'layout-recovery-toolbar';
        bar.hidden = true;
        bar.append(resetButton, restoreButton);
        setRecoveryToolbarVisible(bar, visible);
        global.document.body.append(bar);
        return bar;
    };

    const printDebugTable = (rows) => {
        global.console.table(rows);
    };

    global.PageLayoutRecoveryUI = {
        ensureRecoveryToolbar,
        printDebugTable,
        setRecoveryToolbarVisible,
    };
})(window);
