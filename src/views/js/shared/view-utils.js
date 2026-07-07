(function exposeVoiceViewUtils(global) {
    'use strict';

    const byId = (id) => global.document.getElementById(id);

    const queryAll = (selector, root = global.document) =>
        Array.from(root.querySelectorAll(selector));

    const setText = (element, value = '') => {
        if (element) {
            element.textContent = value;
        }
    };

    const setHidden = (element, hidden = true) => {
        element?.classList.toggle('hidden', hidden);
    };

    const toggleClass = (element, className, force) => {
        if (!element) {
            return false;
        }

        if (force === undefined) {
            return element.classList.toggle(className);
        }

        return element.classList.toggle(className, force);
    };

    const createGuestName = () =>
        `Guest-${Math.floor(1000 + Math.random() * 9000)}`;

    const formatDuration = (durationMs) => {
        const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    const formatTime = (createdAt) =>
        new Date(createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });

    const safeStorageGet = (key, fallback = null) => {
        try {
            const value = global.localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch {
            return fallback;
        }
    };

    const safeStorageSet = (key, value) => {
        try {
            global.localStorage.setItem(key, String(value));
            return true;
        } catch {
            return false;
        }
    };

    const readJsonStorage = (key, fallback = null) => {
        const raw = safeStorageGet(key);
        if (!raw) {
            return fallback;
        }

        try {
            return JSON.parse(raw) ?? fallback;
        } catch {
            return fallback;
        }
    };

    const writeJsonStorage = (key, value) =>
        safeStorageSet(key, JSON.stringify(value));

    global.VoiceViewUtils = {
        byId,
        createGuestName,
        formatDuration,
        formatTime,
        queryAll,
        readJsonStorage,
        safeStorageGet,
        safeStorageSet,
        setHidden,
        setText,
        toggleClass,
        writeJsonStorage,
    };
})(window);
