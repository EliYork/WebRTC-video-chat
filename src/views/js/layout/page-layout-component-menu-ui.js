(function exposePageLayoutComponentMenuUI(global) {
    'use strict';

    const closeMenu = ({ menu, toggleButton } = {}) => {
        if (menu) {
            menu.hidden = true;
        }

        toggleButton?.setAttribute('aria-expanded', 'false');
    };

    const toggleMenu = ({ menu, toggleButton } = {}) => {
        if (!menu) {
            return false;
        }

        menu.hidden = !menu.hidden;
        toggleButton?.setAttribute('aria-expanded', String(!menu.hidden));
        return !menu.hidden;
    };

    const renderMenu = ({ menu, items = [], onSelect } = {}) => {
        if (!menu) {
            return;
        }

        menu.replaceChildren();

        items.forEach(({ type, label, disabled = false, statusText = '' }) => {
            const button = global.document.createElement('button');
            const status = global.document.createElement('span');

            button.type = 'button';
            button.className = 'layout-component-menu-item';
            button.dataset.layoutComponentType = type;
            button.disabled = Boolean(disabled);
            button.textContent = label || type;
            status.className = 'layout-component-menu-status';
            status.textContent = statusText;
            button.append(status);
            button.addEventListener('click', () => {
                onSelect?.(type);
            });
            menu.append(button);
        });
    };

    global.PageLayoutComponentMenuUI = {
        closeMenu,
        renderMenu,
        toggleMenu,
    };
})(window);
