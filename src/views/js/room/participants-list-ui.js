(function exposeVoiceParticipantsListUI(global) {
    'use strict';

    const { setText, toggleClass } = global.VoiceViewUtils;

    const clearChildren = (element) => {
        element?.replaceChildren();
    };

    const createStatusIcon = ({ key = '', label = '', icon = '' } = {}) => {
        const status = global.document.createElement('span');
        const statusIcon = global.document.createElement('i');

        status.className = `member-status member-status-${key}`;
        status.title = label;
        status.setAttribute('aria-label', label);
        statusIcon.className = icon;
        status.append(statusIcon);

        return status;
    };

    const createTileToggleButton = ({
        label = '',
        icon = '',
        onClick,
    } = {}) => {
        const button = global.document.createElement('button');
        const buttonIcon = global.document.createElement('i');

        button.type = 'button';
        button.className = 'member-toggle-tile';
        button.title = label;
        button.setAttribute('aria-label', label);
        buttonIcon.className = icon;
        button.append(buttonIcon);

        if (typeof onClick === 'function') {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick(event);
            });
        }

        return button;
    };

    const updateParticipantItemClasses = (element, participant = {}) => {
        if (!element) {
            return;
        }

        toggleClass(element, 'is-local', participant.isLocal);
        toggleClass(element, 'is-connected', participant.isConnected);
        toggleClass(element, 'is-speaking', participant.isSpeaking);
        toggleClass(element, 'is-muted', participant.isMuted);
        toggleClass(element, 'is-screen-sharing', participant.isScreenSharing);
    };

    const renderParticipantItem = (participant = {}) => {
        const item = global.document.createElement('li');
        const name = global.document.createElement('span');
        const statuses = global.document.createElement('span');

        item.className = 'channel-member';
        name.className = 'channel-member-name';
        statuses.className = 'channel-member-statuses';

        setText(name, participant.name || 'Guest');
        (participant.statuses || []).forEach((status) => {
            statuses.append(createStatusIcon(status));
        });

        if (participant.tileToggle) {
            statuses.append(createTileToggleButton(participant.tileToggle));
        }

        item.append(name, statuses);
        updateParticipantItemClasses(item, participant);

        return item;
    };

    const renderEmptyParticipants = (container, message = '') => {
        clearChildren(container);

        if (!container || !message) {
            return;
        }

        const item = global.document.createElement('li');

        item.className = 'channel-member channel-member-empty';
        setText(item, message);
        container.append(item);
    };

    const renderParticipantsList = (
        container,
        participants = [],
        { emptyMessage = '' } = {}
    ) => {
        if (!container) {
            return;
        }

        clearChildren(container);

        if (!participants.length) {
            renderEmptyParticipants(container, emptyMessage);
            return;
        }

        participants.forEach((participant) => {
            container.append(renderParticipantItem(participant));
        });
    };

    const renderChannelCountBadge = (badge, count = 0) => {
        setText(badge, String(count || 0));
    };

    global.VoiceParticipantsListUI = {
        clearChildren,
        renderChannelCountBadge,
        renderEmptyParticipants,
        renderParticipantItem,
        renderParticipantsList,
        updateParticipantItemClasses,
    };
})(window);
