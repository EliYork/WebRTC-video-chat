(function exposeVoiceChatNameState(global) {
    'use strict';

    const { createGuestName, safeStorageGet, safeStorageSet } =
        global.VoiceViewUtils;
    const CHAT_NAME_STORAGE_KEY = 'webrtc-video-chat-name';
    const CHAT_NAME_MAX_LENGTH = 32;

    const normalizeChatName = (name) =>
        String(name ?? '')
            .trim()
            .slice(0, CHAT_NAME_MAX_LENGTH);

    const getStoredChatName = () => {
        const storedName = safeStorageGet(CHAT_NAME_STORAGE_KEY);

        if (storedName) {
            return storedName;
        }

        const guestName = createGuestName();
        safeStorageSet(CHAT_NAME_STORAGE_KEY, guestName);
        return guestName;
    };

    const getChatName = (inputValue) =>
        normalizeChatName(inputValue) || getStoredChatName();

    const saveChatName = (inputValue) => {
        const name = normalizeChatName(inputValue) || createGuestName();
        safeStorageSet(CHAT_NAME_STORAGE_KEY, name);
        return name;
    };

    global.VoiceChatNameState = {
        CHAT_NAME_STORAGE_KEY,
        getChatName,
        getStoredChatName,
        normalizeChatName,
        saveChatName,
    };
})(window);
