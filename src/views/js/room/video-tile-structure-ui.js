(function exposeVoiceVideoTileStructureUI(global) {
    'use strict';

    const createTileAvatarText = (displayName) =>
        String(displayName || 'Guest')
            .trim()
            .slice(0, 1)
            .toUpperCase() || 'G';

    const ensureHeader = (tile) => {
        let header = tile.querySelector('.tile-header');

        if (!header) {
            header = global.document.createElement('div');
            header.className = 'tile-header';
            header.setAttribute('data-drag-handle', 'true');
            tile.prepend(header);
        }

        const ensureHeaderChild = (selector, className) => {
            let child = header.querySelector(selector);
            if (!child) {
                child = global.document.createElement('div');
                child.className = className;
                header.append(child);
            }
            return child;
        };

        ensureHeaderChild('.tile-avatar', 'tile-avatar');
        ensureHeaderChild('.tile-title', 'tile-title');
        ensureHeaderChild('.tile-badges', 'tile-badges');

        const controls = ensureHeaderChild(
            '.tile-header-controls',
            'tile-header-controls'
        );
        let quality = controls.querySelector('.voice-media-quality-pill');
        if (!quality) {
            quality = global.document.createElement('div');
            quality.className = 'voice-media-quality-pill hidden';
            quality.setAttribute('aria-hidden', 'true');
            controls.append(quality);
        }

        let actions = controls.querySelector('.tile-header-actions');
        if (!actions) {
            actions = global.document.createElement('div');
            actions.className = 'tile-header-actions';
            controls.append(actions);
        }

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
        const headerActions = header.querySelector('.tile-header-actions');
        const body = ensureChild(tile, '.tile-body', 'tile-body');
        const overlay = ensureChild(tile, '.tile-overlay', 'tile-overlay');
        const footer = ensureChild(tile, '.tile-footer', 'tile-footer');
        const actions = ensureChild(tile, '.tile-actions', 'tile-actions');

        ensureResizeHandles(tile, resizeDirections);

        return { actions, body, footer, header, headerActions, overlay };
    };

    global.VoiceVideoTileStructureUI = {
        createTileAvatarText,
        ensureTileStructure,
    };
})(window);
