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
            tile.prepend(header);
        }

        const ensureHeaderChild = (parent, selector, className) => {
            let child = header.querySelector(selector);
            if (!child) {
                child = global.document.createElement('div');
                child.className = className;
            }
            if (child.parentElement !== parent) {
                parent.append(child);
            }
            return child;
        };

        const titleRegion = ensureHeaderChild(
            header,
            '.window-title-region',
            'window-title-region'
        );
        ensureHeaderChild(titleRegion, '.tile-avatar', 'tile-avatar');
        ensureHeaderChild(titleRegion, '.tile-title', 'tile-title');
        ensureHeaderChild(titleRegion, '.tile-badges', 'tile-badges');

        const controls = ensureHeaderChild(
            header,
            '.tile-header-controls',
            'tile-header-controls window-controls'
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

    const ensureTileStructure = (tile) => {
        const header = ensureHeader(tile);
        const headerActions = header.querySelector('.tile-header-actions');
        const body = ensureChild(tile, '.tile-body', 'tile-body');
        const overlay = ensureChild(tile, '.tile-overlay', 'tile-overlay');
        const footer = ensureChild(tile, '.tile-footer', 'tile-footer');
        const actions = ensureChild(tile, '.tile-actions', 'tile-actions');


        return { actions, body, footer, header, headerActions, overlay };
    };

    global.VoiceVideoTileStructureUI = {
        createTileAvatarText,
        ensureTileStructure,
    };
})(window);
