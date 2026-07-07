(function exposePageLayoutSnapUtils(global) {
    'use strict';

    const clampNumber = (value, min, max) =>
        Math.min(Math.max(min, value), max);

    const getTileBounds = ({ board, minTileWidth, minTileHeight } = {}) => {
        const boardRect = board?.getBoundingClientRect?.() || {};
        const fallbackWidth =
            boardRect.width || board?.parentElement?.offsetWidth;
        const fallbackHeight =
            boardRect.height || board?.parentElement?.offsetHeight;

        return {
            width: Math.max(minTileWidth, fallbackWidth || minTileWidth),
            height: Math.max(minTileHeight, fallbackHeight || minTileHeight),
        };
    };

    const getLayoutGridMetrics = (context = {}) => {
        const {
            columns,
            rows,
            minGridW,
            minGridH,
            minTileWidth,
            minTileHeight,
        } = context;
        const bounds = getTileBounds(context);
        const cellWidth = bounds.width / columns;
        const cellHeight = bounds.height / rows;

        return {
            bounds,
            cellWidth,
            cellHeight,
            minGridW: Math.max(minGridW, Math.ceil(minTileWidth / cellWidth)),
            minGridH: Math.max(minGridH, Math.ceil(minTileHeight / cellHeight)),
        };
    };

    const normalizeZIndex = (zIndex, context = {}) =>
        typeof context.normalizeZIndex === 'function'
            ? context.normalizeZIndex(zIndex)
            : Number(zIndex) || 0;

    const clampTileLayout = (
        { x, y, width, height, zIndex } = {},
        context = {}
    ) => {
        const bounds = getTileBounds(context);
        const minW = context.minTileWidth;
        const minH = context.minTileHeight;
        const nextWidth = Math.min(Math.max(width, minW), bounds.width);
        const nextHeight = Math.min(Math.max(height, minH), bounds.height);

        return {
            x: Math.min(Math.max(0, x), Math.max(0, bounds.width - nextWidth)),
            y: Math.min(
                Math.max(0, y),
                Math.max(0, bounds.height - nextHeight)
            ),
            width: nextWidth,
            height: nextHeight,
            zIndex: normalizeZIndex(zIndex, context),
        };
    };

    const clampGridLayout = ({ x, y, w, h } = {}, context = {}) => {
        const { columns, rows } = context;
        const { minGridW, minGridH } = getLayoutGridMetrics(context);
        const nextW = clampNumber(
            Math.round(Number(w) || minGridW),
            minGridW,
            columns
        );
        const nextH = clampNumber(
            Math.round(Number(h) || minGridH),
            minGridH,
            rows
        );
        const nextX = clampNumber(
            Math.round(Number(x) || 0),
            0,
            columns - nextW
        );
        const nextY = clampNumber(Math.round(Number(y) || 0), 0, rows - nextH);

        return { x: nextX, y: nextY, w: nextW, h: nextH };
    };

    const convertTileLayoutToGrid = (
        { x, y, width, height } = {},
        context = {}
    ) => {
        const { cellWidth, cellHeight } = getLayoutGridMetrics(context);

        return clampGridLayout(
            {
                x: Math.round(x / cellWidth),
                y: Math.round(y / cellHeight),
                w: Math.round(width / cellWidth),
                h: Math.round(height / cellHeight),
            },
            context
        );
    };

    const convertGridLayoutToPixels = (
        { x, y, w, h, zIndex } = {},
        context = {}
    ) => {
        const grid = clampGridLayout({ x, y, w, h }, context);
        const { cellWidth, cellHeight } = getLayoutGridMetrics(context);

        return clampTileLayout(
            {
                x: grid.x * cellWidth,
                y: grid.y * cellHeight,
                width: grid.w * cellWidth,
                height: grid.h * cellHeight,
                zIndex,
            },
            context
        );
    };

    const snapTileLayoutToGrid = (layout = {}, context = {}) =>
        convertGridLayoutToPixels(
            {
                ...convertTileLayoutToGrid(layout, context),
                zIndex: layout.zIndex,
            },
            context
        );

    const snapLayoutItemToGrid = (item, context = {}) => {
        if (!item?.id) {
            return null;
        }

        const tile = context.findTileForLayoutItem?.(item);
        const itemContext =
            (tile && context.getContextForTile?.(tile)) || context;
        const layoutSource =
            tile && !tile.classList.contains('is-layout-hidden')
                ? itemContext.getCurrentTileLayout(tile)
                : item.layout ||
                  convertGridLayoutToPixels(item.grid || {}, itemContext);
        const snappedLayout = snapTileLayoutToGrid(layoutSource, itemContext);
        const snappedGrid = convertTileLayoutToGrid(snappedLayout, itemContext);
        const nextItem = {
            ...item,
            layout: snappedLayout,
            grid: snappedGrid,
            positioned: true,
        };

        context.setLayoutItem?.(nextItem);

        if (tile) {
            context.applyTileLayoutItemToElement?.(tile, nextItem, {
                applyPosition: true,
            });
        }

        return nextItem;
    };

    const snapAllLayoutItemsToGrid = (layoutItems, context = {}) => {
        layoutItems?.forEach?.((item) => {
            snapLayoutItemToGrid(item, context);
        });
    };

    const snapTileLayoutToGridForTile = (tile, context = {}) => {
        if (!tile) {
            return null;
        }

        const snappedLayout = snapTileLayoutToGrid(
            context.getCurrentTileLayout(tile),
            context
        );
        context.applyTileLayout(tile, snappedLayout);
        return snappedLayout;
    };

    global.PageLayoutSnapUtils = {
        clampGridLayout,
        clampTileLayout,
        convertGridLayoutToPixels,
        convertTileLayoutToGrid,
        getLayoutGridMetrics,
        getTileBounds,
        snapAllLayoutItemsToGrid,
        snapLayoutItemToGrid,
        snapTileLayoutToGrid,
        snapTileLayoutToGridForTile,
    };
})(window);
