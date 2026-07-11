(function exposeVoiceChatMessageUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;

    const clearMessages = (container) => {
        container?.replaceChildren();
    };

    const renderChatMessageItem = ({
        content = '',
        isLocal = false,
        isSystem = false,
        senderName = '',
        timeText = '',
        type = 'normal',
    } = {}) => {
        const item = global.document.createElement('li');
        const meta = global.document.createElement('div');
        const body = global.document.createElement('div');
        const displayName = isLocal ? `${senderName} (我)` : senderName;

        item.className = 'chat-message';
        item.classList.toggle('is-local', isLocal);
        item.classList.toggle('is-system', isSystem);
        item.dataset.messageType = type;
        meta.className = 'chat-message-meta';
        body.className = 'chat-message-content';

        setText(meta, `${displayName} · ${timeText}`);
        setText(body, content);
        item.append(meta, body);

        return item;
    };

    const scrollToBottom = (container) => {
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    };

    const appendChatMessage = (container, messageView) => {
        if (!container || !messageView?.content) {
            return;
        }

        container.append(renderChatMessageItem(messageView));
        scrollToBottom(container);
    };

    const renderChatHistory = (container, messages = []) => {
        if (!container) {
            return;
        }

        const fragment = global.document.createDocumentFragment();

        messages.forEach((message) => {
            if (message?.content) {
                fragment.append(renderChatMessageItem(message));
            }
        });
        clearMessages(container);
        container.append(fragment);
        scrollToBottom(container);
    };

    global.VoiceChatMessageUI = {
        appendChatMessage,
        clearMessages,
        renderChatHistory,
        renderChatMessageItem,
        scrollToBottom,
    };
})(window);
