(function exposePageLayoutComponentActionsUI(global) {
    'use strict';

    const layoutEditUI = global.PageLayoutEditUI;

    const findToolbar = (tile) => layoutEditUI.findLayoutComponentToolbar(tile);

    const positionToolbar = ({ tile, board } = {}) => {
        layoutEditUI.positionLayoutComponentToolbar({ tile, board });
    };

    const setActiveTile = ({ tile, enabled = false, onPosition } = {}) => {
        document
            .querySelectorAll('.video-tile.is-layout-selected')
            .forEach((activeTile) =>
                activeTile.classList.remove('is-layout-selected')
            );
        document
            .querySelectorAll('.layout-component-toolbar')
            .forEach((toolbar) => toolbar.classList.remove('is-visible'));

        if (!enabled || !tile) {
            return;
        }

        tile.classList.add('is-layout-selected');
        const toolbar = findToolbar(tile);
        if (toolbar) {
            toolbar.classList.add('is-visible');
            if (typeof onPosition === 'function') {
                onPosition(tile);
            } else {
                positionToolbar({ tile, board: tile.parentElement });
            }
        }
    };

    const syncToolbarState = ({ tile, freeMoveEnabled = false } = {}) => {
        const toolbar = findToolbar(tile);
        const freeMoveButton = toolbar?.querySelector(
            '.layout-toolbar-free-move'
        );

        tile?.classList.toggle('is-free-move-enabled', freeMoveEnabled);

        if (freeMoveButton) {
            freeMoveButton.setAttribute(
                'aria-pressed',
                String(freeMoveEnabled)
            );
            freeMoveButton.title = freeMoveEnabled
                ? '关闭自由移动'
                : '开启自由移动';
        }
    };

    const ensureToolbar = ({
        board,
        tile,
        freeMoveEnabled = false,
        onHide,
        onToggleFreeMove,
        onActivate,
    } = {}) => {
        if (!board || !tile?.id) {
            return null;
        }

        let toolbar = findToolbar(tile);

        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.className = 'layout-component-toolbar';
            toolbar.dataset.targetTileId = tile.id;

            const hideButton = document.createElement('button');
            hideButton.type = 'button';
            hideButton.className = 'layout-toolbar-button layout-toolbar-hide';
            hideButton.title = '隐藏组件';
            hideButton.setAttribute('aria-label', '隐藏组件');
            hideButton.textContent = '\u00D7';
            hideButton.hidden = tile.dataset.panelCanHide === 'false';
            hideButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onHide?.(tile);
                toolbar.classList.remove('is-visible');
            });

            const freeMoveButton = document.createElement('button');
            freeMoveButton.type = 'button';
            freeMoveButton.className =
                'layout-toolbar-button layout-toolbar-free-move';
            freeMoveButton.setAttribute('aria-label', '自由移动');
            freeMoveButton.textContent = '移';
            freeMoveButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleFreeMove?.(tile);
            });

            const helpWrap = document.createElement('span');
            helpWrap.className = 'layout-toolbar-help-wrap';
            const helpButton = document.createElement('button');
            helpButton.type = 'button';
            helpButton.className = 'layout-toolbar-button layout-toolbar-help';
            helpButton.setAttribute('aria-label', '自由移动说明');
            helpButton.textContent = '?';
            const tooltip = document.createElement('span');
            tooltip.className = 'layout-toolbar-tooltip';
            tooltip.textContent =
                '开启自由移动后，退出编辑模式也可以拖动这个组件。';
            helpWrap.append(helpButton, tooltip);

            toolbar.append(hideButton, freeMoveButton, helpWrap);
            toolbar.addEventListener('mouseenter', () => onActivate?.(tile));
            board.append(toolbar);
        }

        toolbar.querySelector('.layout-toolbar-hide').hidden =
            tile.dataset.panelCanHide === 'false';
        syncToolbarState({ tile, freeMoveEnabled });
        positionToolbar({ tile, board });
        return toolbar;
    };

    global.PageLayoutComponentActionsUI = {
        findToolbar,
        positionToolbar,
        setActiveTile,
        syncToolbarState,
        ensureToolbar,
    };
})(window);
