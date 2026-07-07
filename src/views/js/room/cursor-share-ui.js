(function exposeVoiceCursorShareUI(global) {
    'use strict';

    const { setText, toggleClass } = global.VoiceViewUtils;

    const getCursorSelector = (socketId) =>
        `.shared-cursor[data-socket-id="${socketId}"]`;

    const getCursorOverlay = () => {
        let overlay = global.document.getElementById('cursorOverlay');

        if (!overlay) {
            overlay = global.document.createElement('div');
            overlay.id = 'cursorOverlay';
            overlay.className = 'cursor-overlay';
            global.document.body.append(overlay);
        }

        return overlay;
    };

    const createCursor = (socketId) => {
        const cursor = global.document.createElement('div');
        const pointer = global.document.createElement('div');
        const label = global.document.createElement('div');

        cursor.className = 'shared-cursor';
        cursor.dataset.socketId = socketId;
        pointer.className = 'shared-cursor-pointer';
        label.className = 'shared-cursor-label';
        cursor.append(pointer, label);

        return cursor;
    };

    const renderRemoteCursor = ({
        color,
        senderName = 'Guest',
        socketId,
        x = 0,
        y = 0,
    } = {}) => {
        if (!socketId) {
            return;
        }

        const overlay = getCursorOverlay();
        let cursor = overlay.querySelector(getCursorSelector(socketId));

        if (!cursor) {
            cursor = createCursor(socketId);
            overlay.append(cursor);
        }

        cursor.style.left = `${x * 100}vw`;
        cursor.style.top = `${y * 100}vh`;
        cursor.style.setProperty('--cursor-color', color);
        setText(cursor.querySelector('.shared-cursor-label'), senderName);
        toggleClass(cursor, 'is-idle', false);
    };

    const setCursorIdle = (socketId) => {
        const cursor = global.document.querySelector(
            getCursorSelector(socketId)
        );
        toggleClass(cursor, 'is-idle', true);
    };

    const removeRemoteCursor = (socketId) => {
        global.document
            .querySelectorAll(getCursorSelector(socketId))
            .forEach((cursor) => cursor.remove());
    };

    const clearRemoteCursors = () => {
        global.document.querySelectorAll('.shared-cursor').forEach((cursor) => {
            cursor.remove();
        });
    };

    const removeCursorOverlay = () => {
        clearRemoteCursors();
        global.document.getElementById('cursorOverlay')?.remove();
    };

    global.VoiceCursorShareUI = {
        clearRemoteCursors,
        getCursorOverlay,
        removeCursorOverlay,
        removeRemoteCursor,
        renderRemoteCursor,
        setCursorIdle,
    };
})(window);
