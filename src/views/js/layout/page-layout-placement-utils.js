(function exposePageLayoutPlacementUtils(global) {
    'use strict';

    const getAutoLayoutGridSizes = (options = {}) =>
        options.autoLayoutGridSizes || {};

    const clampGridLayout = (layout, options = {}) =>
        typeof options.clampGridLayout === 'function'
            ? options.clampGridLayout(layout)
            : layout;

    const convertTileLayoutToGrid = (layout, options = {}) =>
        typeof options.convertTileLayoutToGrid === 'function'
            ? options.convertTileLayoutToGrid(layout)
            : layout?.grid || layout;

    const isAutoPlacedLayoutType = (type, options = {}) =>
        Boolean(getAutoLayoutGridSizes(options)[type]);

    const getAutoLayoutGridSize = (type, options = {}) =>
        clampGridLayout(
            {
                x: 0,
                y: 0,
                ...(getAutoLayoutGridSizes(options)[type] || {
                    w: options.minGridW,
                    h: options.minGridH,
                }),
            },
            options
        );

    const isAbnormallyLargeAutoGrid = (type, grid, options = {}) =>
        isAutoPlacedLayoutType(type, options) &&
        (Number(grid?.w) >= options.columns - 1 ||
            Number(grid?.h) >= options.rows - 1);

    const normalizeAutoLayoutGrid = (type, grid = {}, options = {}) => {
        if (!isAutoPlacedLayoutType(type, options)) {
            return clampGridLayout(grid, options);
        }

        const defaultSize = getAutoLayoutGridSize(type, options);
        const width = Number(grid.w);
        const height = Number(grid.h);
        const hasUsableSize =
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0 &&
            !isAbnormallyLargeAutoGrid(type, { w: width, h: height }, options);

        return clampGridLayout(
            {
                x: grid.x,
                y: grid.y,
                w: hasUsableSize ? width : defaultSize.w,
                h: hasUsableSize ? height : defaultSize.h,
            },
            options
        );
    };

    const getFallbackTileLayoutForType = (type, layout = {}, options = {}) => {
        if (layout?.grid && isAutoPlacedLayoutType(type, options)) {
            return {
                grid: normalizeAutoLayoutGrid(type, layout.grid, options),
                zIndex: layout.zIndex,
            };
        }

        if (
            isAutoPlacedLayoutType(type, options) &&
            Number.isFinite(Number(layout?.width)) &&
            Number.isFinite(Number(layout?.height))
        ) {
            const grid = convertTileLayoutToGrid(layout, options);
            if (isAbnormallyLargeAutoGrid(type, grid, options)) {
                return {
                    grid: {
                        ...grid,
                        w: getAutoLayoutGridSize(type, options).w,
                        h: getAutoLayoutGridSize(type, options).h,
                    },
                    zIndex: layout.zIndex,
                };
            }
        }

        if (
            layout?.grid ||
            Number.isFinite(Number(layout?.width)) ||
            Number.isFinite(Number(layout?.height))
        ) {
            return layout;
        }

        if (!isAutoPlacedLayoutType(type, options)) {
            return layout;
        }

        return {
            grid: getAutoLayoutGridSize(type, options),
            zIndex: layout?.zIndex,
        };
    };

    const isRectWithinGrid = (rect, options = {}) =>
        rect &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.w > 0 &&
        rect.h > 0 &&
        rect.x + rect.w <= options.columns &&
        rect.y + rect.h <= options.rows;

    const rectOverlapArea = (a, b) => {
        if (!a || !b) {
            return 0;
        }

        const overlapW = Math.max(
            0,
            Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        );
        const overlapH = Math.max(
            0,
            Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        );

        return overlapW * overlapH;
    };

    const scoreLayoutSlot = (rect, occupiedRects, options = {}) => {
        const centerX = options.centerX ?? options.columns / 2;
        const centerY = options.centerY ?? options.rows / 2;
        const rectCenterX = rect.x + rect.w / 2;
        const rectCenterY = rect.y + rect.h / 2;
        const overlapArea = occupiedRects.reduce(
            (total, occupied) => total + rectOverlapArea(rect, occupied),
            0
        );
        const distanceFromCenter =
            Math.abs(rectCenterX - centerX) + Math.abs(rectCenterY - centerY);
        const edgePenalty =
            (rect.x === 0 ? 2 : 0) +
            (rect.y === 0 ? 1 : 0) +
            (rect.x + rect.w === options.columns ? 2 : 0) +
            (rect.y + rect.h === options.rows ? 1 : 0);

        return overlapArea * 1000 + distanceFromCenter * 10 + edgePenalty;
    };

    const findAvailableLayoutSlot = (type, preferredSize, options = {}) => {
        const size = clampGridLayout(
            {
                x: 0,
                y: 0,
                ...(preferredSize || getAutoLayoutGridSize(type, options)),
            },
            options
        );
        const occupiedRects = options.occupiedRects || [];
        let bestSlot = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (let y = 0; y <= options.rows - size.h; y += 1) {
            for (let x = 0; x <= options.columns - size.w; x += 1) {
                const candidate = { x, y, w: size.w, h: size.h };

                if (!isRectWithinGrid(candidate, options)) {
                    continue;
                }

                const score = scoreLayoutSlot(
                    candidate,
                    occupiedRects,
                    options
                );

                if (score < bestScore) {
                    bestScore = score;
                    bestSlot = candidate;
                }
            }
        }

        return (
            bestSlot ||
            clampGridLayout({ x: 0, y: 0, w: size.w, h: size.h }, options)
        );
    };

    global.PageLayoutPlacementUtils = {
        isAutoPlacedLayoutType,
        getAutoLayoutGridSize,
        isAbnormallyLargeAutoGrid,
        normalizeAutoLayoutGrid,
        getFallbackTileLayoutForType,
        isRectWithinGrid,
        rectOverlapArea,
        scoreLayoutSlot,
        findAvailableLayoutSlot,
    };
})(window);
