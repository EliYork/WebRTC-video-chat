(function exposeVoiceVideoTileStructureUI(global) {
    'use strict';

    const createTileAvatarText = (displayName) =>
        String(displayName || 'Guest')
            .trim()
            .slice(0, 1)
            .toUpperCase() || 'G';

    const ensureHeader = (tile) => {
        let header = tile.querySelector('.tile-header');

        if (header) {
            return header;
        }

        header = global.document.createElement('div');
        header.className = 'tile-header';
        header.setAttribute('data-drag-handle', 'true');

        const avatar = global.document.createElement('div');
        avatar.className = 'tile-avatar';

        const title = global.document.createElement('div');
        title.className = 'tile-title';

        const badges = global.document.createElement('div');
        badges.className = 'tile-badges';

        header.append(avatar, title, badges);
        tile.prepend(header);
        return header;
    };

    const ensureChild = (tile, selector, className) => {
        let child = tile.querySelector(selector);

        if (!child) {
            child = global.document.createElement('div');
            child.className = className;
            tile.append(child);
        }

        return child;
    };

    const ensureResizeHandles = (tile, resizeDirections = []) => {
        resizeDirections.forEach((direction) => {
            let resizeHandle = tile.querySelector(
                `.tile-resize-handle[data-resize-direction="${direction}"]`
            );

            if (!resizeHandle) {
                resizeHandle = global.document.createElement('div');
                resizeHandle.className = `tile-resize-handle tile-resize-handle--${direction}`;
                resizeHandle.dataset.resizeDirection = direction;
                resizeHandle.setAttribute('aria-hidden', 'true');
                tile.append(resizeHandle);
            }
        });
    };

    const ensureTileStructure = (tile, { resizeDirections = [] } = {}) => {
        const header = ensureHeader(tile);
        const body = ensureChild(tile, '.tile-body', 'tile-body');
        const overlay = ensureChild(tile, '.tile-overlay', 'tile-overlay');
        const footer = ensureChild(tile, '.tile-footer', 'tile-footer');
        const actions = ensureChild(tile, '.tile-actions', 'tile-actions');

        ensureResizeHandles(tile, resizeDirections);

        return { actions, body, footer, header, overlay };
    };

    global.VoiceVideoTileStructureUI = {
        createTileAvatarText,
        ensureTileStructure,
    };
})(window);
