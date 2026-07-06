(function exposeVoiceRoomUIState(global) {
    'use strict';

    const {
        formatDuration,
        setHidden: setElementHidden,
        setText: setElementText,
        toggleClass: toggleElementClass,
    } = global.VoiceViewUtils;

    const setText = (element, value = '') => {
        setElementText(element, value);
    };

    const setButtonDisabled = (button, disabled = true) => {
        if (button) {
            button.disabled = Boolean(disabled);
        }
    };

    const toggleClass = (element, className, force) =>
        toggleElementClass(element, className, force);

    const renderCallTimer = ({ refs = {}, elapsedMs, text } = {}) => {
        const nextText =
            text ??
            (Number.isFinite(elapsedMs) ? formatDuration(elapsedMs) : '');

        setText(refs.duration, nextText);
    };

    const renderLocalUserCard = ({
        refs = {},
        displayName = '',
        channelName = '',
        statusText = '',
        screenText = '',
        screenHidden = true,
        connected = false,
        connecting = false,
        muted = false,
        speaking = false,
        micStatusKey = '',
    } = {}) => {
        setText(refs.name, displayName);
        setText(refs.channelName, channelName);
        setText(refs.statusText, statusText);

        if (refs.screenStatus) {
            setText(refs.screenStatus, screenText);
            setElementHidden(refs.screenStatus, screenHidden);
        }

        toggleClass(refs.card, 'is-connected', connected);
        toggleClass(refs.card, 'is-connecting', connecting);
        toggleClass(refs.card, 'is-muted', muted);
        toggleClass(refs.card, 'is-speaking', speaking);

        if (refs.card) {
            refs.card.dataset.micStatus = micStatusKey;
        }
    };

    const renderMobileTileNav = ({
        refs = {},
        allTiles = [],
        activeTile,
        activeIndex = 0,
        totalTiles = 0,
        isInRoom = false,
    } = {}) => {
        toggleClass(refs.mainLayout, 'mobile-in-room', isInRoom);

        allTiles.forEach((tile) => {
            toggleClass(tile, 'is-mobile-active', false);
        });
        toggleClass(activeTile, 'is-mobile-active', Boolean(activeTile));

        setText(
            refs.count,
            totalTiles === 0 ? '0 / 0' : `${activeIndex + 1} / ${totalTiles}`
        );
        setButtonDisabled(refs.previousButton, totalTiles <= 1);
        setButtonDisabled(refs.nextButton, totalTiles <= 1);
    };

    const renderRoomHeader = ({
        refs = {},
        channelName = '',
        chatTitleText,
    } = {}) => {
        setText(refs.chatTitle, chatTitleText ?? `${channelName}聊天`);
    };

    global.VoiceRoomUIState = {
        renderCallTimer,
        renderLocalUserCard,
        renderMobileTileNav,
        renderRoomHeader,
        setButtonDisabled,
        setText,
        toggleClass,
    };
})(window);
