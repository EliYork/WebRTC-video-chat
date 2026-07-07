(function exposePageLayoutEditUI(global) {
    'use strict';

    let snapPreviewOverlay;
    const resizeCursorState = {
        board: undefined,
        tile: undefined,
    };

    const clampNumber = (value, min, max) =>
        Math.min(Math.max(min, value), max);

    const ensureSnapPreviewOverlay = (board) => {
        if (!board) {
            return null;
        }

        if (
            !snapPreviewOverlay ||
            !snapPreviewOverlay.isConnected ||
            snapPreviewOverlay.parentElement !== board
        ) {
            snapPreviewOverlay = global.document.createElement('div');
            snapPreviewOverlay.className = 'layout-snap-preview';
            snapPreviewOverlay.setAttribute('aria-hidden', 'true');
            board.append(snapPreviewOverlay);
        }

        return snapPreviewOverlay;
    };

    const showSnapPreview = ({ board, tile, layout } = {}) => {
        if (!tile || !layout) {
            return;
        }

        const overlay = ensureSnapPreviewOverlay(board);
        if (!overlay) {
            return;
        }

        overlay.style.left = `${layout.x}px`;
        overlay.style.top = `${layout.y}px`;
        overlay.style.width = `${layout.width}px`;
        overlay.style.height = `${layout.height}px`;
        overlay.dataset.targetTileId = tile.id;
        overlay.classList.add('is-visible');
    };

    const hideSnapPreview = () => {
        if (snapPreviewOverlay) {
            snapPreviewOverlay.classList.remove('is-visible');
            delete snapPreviewOverlay.dataset.targetTileId;
        }
    };

    const findLayoutComponentToolbar = (tile) => {
        if (!tile?.id) {
            return undefined;
        }

        return Array.from(
            global.document.querySelectorAll('.layout-component-toolbar')
        ).find((toolbar) => toolbar.dataset.targetTileId === tile.id);
    };

    const positionLayoutComponentToolbar = ({ tile, board } = {}) => {
        const toolbar = findLayoutComponentToolbar(tile);
        const targetBoard = board || tile?.parentElement;

        if (!tile || !toolbar || !targetBoard) {
            return;
        }

        const boardRect = targetBoard.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const toolbarWidth = toolbar.offsetWidth || 34;
        const toolbarHeight = toolbar.offsetHeight || 96;
        const gap = 8;
        const centerX = tileRect.left - boardRect.left + tileRect.width / 2;
        const showRight = centerX < boardRect.width / 2;
        const rawLeft = showRight
            ? tileRect.right - boardRect.left + gap
            : tileRect.left - boardRect.left - toolbarWidth - gap;
        const left = clampNumber(
            Math.round(rawLeft),
            4,
            Math.max(4, Math.round(boardRect.width - toolbarWidth - 4))
        );
        const top = clampNumber(
            Math.round(tileRect.top - boardRect.top),
            4,
            Math.max(4, Math.round(boardRect.height - toolbarHeight - 4))
        );

        toolbar.classList.toggle('is-left-side', !showRight);
        toolbar.classList.toggle('is-right-side', showRight);
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
    };

    const clearResizeHoverState = (target, hoverClasses = []) => {
        target?.classList?.remove(...hoverClasses);
        target?.style?.removeProperty('--layout-resize-cursor');
    };

    const resetElementCursor = (element) => {
        if (element) {
            element.style.cursor = '';
        }
    };

    const resetResizeCursor = ({ board, hoverClasses = [] } = {}) => {
        resetElementCursor(board);
        resetElementCursor(resizeCursorState.board);
        resetElementCursor(resizeCursorState.tile);

        global.document.body.style.cursor = '';
        global.document.body.style.removeProperty('--layout-resize-cursor');
        clearResizeHoverState(global.document.body, hoverClasses);
        clearResizeHoverState(board, hoverClasses);
        clearResizeHoverState(resizeCursorState.board, hoverClasses);

        resizeCursorState.tile = undefined;
        resizeCursorState.board = undefined;
    };

    const applyResizeHoverState = (target, direction, cursor, hoverClasses) => {
        if (!target) {
            return;
        }

        target.classList.remove(...hoverClasses);
        target.classList.add(
            'is-layout-resize-hover',
            `resize-hover-${direction}`
        );
        target.style.setProperty('--layout-resize-cursor', cursor);
    };

    const setResizeCursor = ({
        hit,
        board,
        cursors = {},
        hoverClasses = [],
    } = {}) => {
        const cursor = cursors[hit?.direction] || '';

        if (!cursor || !hit?.tile) {
            resetResizeCursor({ board, hoverClasses });
            return;
        }

        if (resizeCursorState.tile && resizeCursorState.tile !== hit.tile) {
            resetElementCursor(resizeCursorState.tile);
        }

        resizeCursorState.tile = hit.tile;
        resizeCursorState.board = board;
        hit.tile.style.cursor = cursor;
        global.document.body.style.cursor = cursor;
        global.document.body.style.setProperty(
            '--layout-resize-cursor',
            cursor
        );
        applyResizeHoverState(
            global.document.body,
            hit.direction,
            cursor,
            hoverClasses
        );

        if (board) {
            board.style.cursor = cursor;
            applyResizeHoverState(board, hit.direction, cursor, hoverClasses);
        }
    };

    global.PageLayoutEditUI = {
        findLayoutComponentToolbar,
        hideSnapPreview,
        positionLayoutComponentToolbar,
        resetResizeCursor,
        setResizeCursor,
        showSnapPreview,
    };
})(window);
