(function exposePageLayoutInteractionUI(global) {
    'use strict';

    let snapPreviewOverlay;
    const resizeCursorState = {
        board: undefined,
        tile: undefined,
    };

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

    const clearResizeHoverState = (target, hoverClasses = []) => {
        target?.classList?.remove(...hoverClasses);
        target?.style?.removeProperty('--layout-resize-cursor');
    };

    const resetResizeCursor = ({ board, hoverClasses = [] } = {}) => {
        if (board) {
            board.style.cursor = '';
        }
        if (resizeCursorState.board) {
            resizeCursorState.board.style.cursor = '';
        }
        if (resizeCursorState.tile) {
            resizeCursorState.tile.style.cursor = '';
        }

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
            resizeCursorState.tile.style.cursor = '';
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

    global.PageLayoutInteractionUI = {
        hideSnapPreview,
        resetResizeCursor,
        setResizeCursor,
        showSnapPreview,
    };
})(window);
