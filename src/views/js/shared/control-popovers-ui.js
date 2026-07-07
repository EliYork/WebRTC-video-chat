(function exposeVoiceControlPopoversUI(global) {
    'use strict';

    const { queryAll } = global.VoiceViewUtils;

    const defaultSelectors = {
        wrap: '.control-button-wrap',
        toggle: '[data-control-menu]',
        panel: '[data-control-panel]',
        openClass: 'is-open',
    };

    const toArray = (items) => Array.from(items || []);

    const createController = ({
        toggles = queryAll(defaultSelectors.toggle),
        panels = queryAll(defaultSelectors.panel),
        root = global.document,
        selectors = {},
    } = {}) => {
        const config = {
            ...defaultSelectors,
            ...selectors,
        };
        const toggleList = toArray(toggles);
        const panelList = toArray(panels);

        const getWrap = (toggle) => toggle?.closest(config.wrap);

        const getPanel = (toggle) =>
            panelList.find(
                (panel) =>
                    panel.dataset.controlPanel === toggle.dataset.controlMenu
            ) ||
            root.querySelector(
                `[data-control-panel="${toggle.dataset.controlMenu}"]`
            );

        const setPopoverOpen = (toggle, isOpen) => {
            const wrap = getWrap(toggle);
            const panel = getPanel(toggle);

            wrap?.classList.toggle(config.openClass, isOpen);
            panel?.classList.toggle(config.openClass, isOpen);
            toggle?.setAttribute('aria-expanded', String(isOpen));
        };

        const closePopover = (toggle) => {
            setPopoverOpen(toggle, false);
        };

        const closeAllPopovers = ({ exceptWrap } = {}) => {
            toggleList.forEach((toggle) => {
                const wrap = getWrap(toggle);

                if (exceptWrap && wrap === exceptWrap) {
                    return;
                }

                closePopover(toggle);
            });

            if (!exceptWrap) {
                panelList.forEach((panel) =>
                    panel.classList.remove(config.openClass)
                );
            }
        };

        const togglePopover = (toggle) => {
            const wrap = getWrap(toggle);
            const shouldOpen = !wrap?.classList.contains(config.openClass);

            closeAllPopovers({ exceptWrap: wrap });

            if (!wrap) {
                return;
            }

            setPopoverOpen(toggle, shouldOpen);
        };

        const registerPopover = (toggle) => {
            toggle?.addEventListener('click', (event) => {
                event.stopPropagation();
                togglePopover(toggle);
            });
        };

        const handleDocumentClick = (event) => {
            if (event.target.closest(`${config.wrap}, ${config.panel}`)) {
                return;
            }

            closeAllPopovers();
        };

        const handleDocumentKeydown = (event) => {
            if (event.key === 'Escape') {
                closeAllPopovers();
            }
        };

        toggleList.forEach(registerPopover);
        root.addEventListener('click', handleDocumentClick);
        root.addEventListener('keydown', handleDocumentKeydown);

        return {
            closeAllPopovers,
            closePopover,
            registerPopover,
            togglePopover,
        };
    };

    global.VoiceControlPopoversUI = {
        createController,
    };
})(window);
