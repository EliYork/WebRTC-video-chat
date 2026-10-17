(function exposePageLayoutResizeUtils(global) {
    'use strict';

    const detectTileResizeDirection = ({
        point = {},
        size = {},
        edgeInsetPx = 0,
        edgeOutsetPx = 0,
        cornerSizePx = 0,
    } = {}) => {
        const { x, y } = point;
        const { width, height } = size;

        if (!width || !height) {
            return null;
        }

        const withinHorizontalBand =
            x >= -edgeOutsetPx && x <= width + edgeOutsetPx;
        const withinVerticalBand =
            y >= -edgeOutsetPx && y <= height + edgeOutsetPx;

        if (!withinHorizontalBand || !withinVerticalBand) {
            return null;
        }

        const nearLeftCorner = x >= -edgeOutsetPx && x <= cornerSizePx;
        const nearRightCorner =
            x >= width - cornerSizePx && x <= width + edgeOutsetPx;
        const nearTopCorner = y >= -edgeOutsetPx && y <= cornerSizePx;
        const nearBottomCorner =
            y >= height - cornerSizePx && y <= height + edgeOutsetPx;
        const nearLeftEdge = x >= -edgeOutsetPx && x <= edgeInsetPx;
        const nearRightEdge =
            x >= width - edgeInsetPx && x <= width + edgeOutsetPx;
        const nearTopEdge = y >= -edgeOutsetPx && y <= edgeInsetPx;
        const nearBottomEdge =
            y >= height - edgeInsetPx && y <= height + edgeOutsetPx;

        if (nearTopCorner && nearLeftCorner) {
            return 'nw';
        }

        if (nearTopCorner && nearRightCorner) {
            return 'ne';
        }

        if (nearBottomCorner && nearLeftCorner) {
            return 'sw';
        }

        if (nearBottomCorner && nearRightCorner) {
            return 'se';
        }

        if (nearTopEdge) {
            return 'n';
        }

        if (nearRightEdge) {
            return 'e';
        }

        if (nearBottomEdge) {
            return 's';
        }

        if (nearLeftEdge) {
            return 'w';
        }

        return null;
    };

    const resolveTileResizeLayout = ({
        startLayout = {},
        direction = '',
        deltaX = 0,
        deltaY = 0,
        bounds = {},
        minWidth = 0,
        minHeight = 0,
    } = {}) => {
        const next = { ...startLayout };

        if (direction.includes('e')) {
            next.width = Math.min(
                Math.max(minWidth, startLayout.width + deltaX),
                bounds.width - startLayout.x
            );
        }

        if (direction.includes('s')) {
            next.height = Math.min(
                Math.max(minHeight, startLayout.height + deltaY),
                bounds.height - startLayout.y
            );
        }

        if (direction.includes('w')) {
            const right = startLayout.x + startLayout.width;
            next.x = Math.min(
                Math.max(0, startLayout.x + deltaX),
                right - minWidth
            );
            next.width = right - next.x;
        }

        if (direction.includes('n')) {
            const bottom = startLayout.y + startLayout.height;
            next.y = Math.min(
                Math.max(0, startLayout.y + deltaY),
                bottom - minHeight
            );
            next.height = bottom - next.y;
        }

        return next;
    };

    global.PageLayoutResizeUtils = {
        detectTileResizeDirection,
        resolveTileResizeLayout,
    };
})(window);
