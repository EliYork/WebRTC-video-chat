(function exposeVoiceChatMessageUI(global) {
    'use strict';

    const { setText } = global.VoiceViewUtils;
    const MESSAGE_LIMIT = 500;
    const scrollCorrections = new WeakMap();
    const messageIds = new WeakMap();

    const clearMessages = (container) => {
        if (container) scrollCorrections.delete(container);
        container?.replaceChildren();
    };

    const renderChatMessageItem = ({
        id,
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
        if (id) messageIds.set(item, id);
        meta.className = 'chat-message-meta';
        body.className = 'chat-message-content';

        setText(meta, `${displayName} · ${timeText}`);
        setText(body, content);
        item.append(meta, body);

        return item;
    };

    const captureReadingPosition = (container) => {
        const top = container.getBoundingClientRect?.().top;
        const anchor = Number.isFinite(top)
            ? Array.from(container.querySelectorAll('.chat-message')).find(row => {
                const bounds = row.getBoundingClientRect();
                return bounds.bottom > top && bounds.top < top + container.clientHeight;
            }) : undefined;
        return {
            scrollTop: container.scrollTop,
            anchorId: anchor && messageIds.get(anchor),
            anchorOffset: anchor && anchor.getBoundingClientRect().top - top,
        };
    };

    const restoreReadingPosition = (container, position) => {
        scrollCorrections.delete(container);
        if (!position.anchorId || !Number.isFinite(position.anchorOffset)) {
            container.scrollTop = position.scrollTop;
            return;
        }
        const anchor = Array.from(container.querySelectorAll('.chat-message'))
            .find(row => messageIds.get(row) === position.anchorId);
        if (!anchor) {
            container.scrollTop = 0;
            return;
        }
        const target = container.scrollTop + anchor.getBoundingClientRect().top -
            container.getBoundingClientRect().top - position.anchorOffset;
        container.scrollTop = target;
        scrollCorrections.set(container, {
            scrollTop: container.scrollTop,
            remainder: target >= 0 && target <= container.scrollHeight - container.clientHeight
                ? target - container.scrollTop : 0,
        });
    };

    const scrollToBottom = (container) => {
        if (container) {
            scrollCorrections.delete(container);
            container.scrollTop = container.scrollHeight;
        }
    };

    const showRetentionNote = container => {
        if (container.querySelector('.chat-retention-note')) return;
        const note = global.document.createElement('li');
        note.className = 'chat-retention-note';
        setText(note, `此页面仅显示最近 ${MESSAGE_LIMIT} 条消息。`);
        container.prepend(note);
    };

    const appendChatMessage = (container, messageView) => {
        if (!container || !messageView?.content) {
            return;
        }

        const followsLatest = !(container.scrollHeight - container.scrollTop - container.clientHeight > 48);
        const items = Array.from(container.querySelectorAll('.chat-message'));
        const removeCount = Math.max(0, items.length + 1 - MESSAGE_LIMIT);
        // CSS disables native anchoring so this is the single owner of
        // the reading position while old rows and the notice are changed.
        const top = container.getBoundingClientRect?.().top;
        const anchor = !followsLatest && removeCount > 0 && Number.isFinite(top)
            ? items.slice(removeCount).find(item => item.getBoundingClientRect().bottom > top)
            : undefined;
        const anchorTop = anchor?.getBoundingClientRect().top;
        const previousCorrection = scrollCorrections.get(container);
        const remainder = previousCorrection?.scrollTop === container.scrollTop ? previousCorrection.remainder : 0;
        container.append(renderChatMessageItem(messageView));
        if (removeCount) {
            items.slice(0, removeCount).forEach(item => item.remove());
            showRetentionNote(container);
        }
        if (followsLatest) scrollToBottom(container);
        else if (anchor) {
            const target = container.scrollTop + anchor.getBoundingClientRect().top - anchorTop + remainder;
            container.scrollTop = target;
            // Chromium can round scroll offsets; carry subpixel error forward
            // rather than accumulating drift on every message removed.
            scrollCorrections.set(container, {
                scrollTop: container.scrollTop,
                remainder: target >= 0 && target <= container.scrollHeight - container.clientHeight
                    ? target - container.scrollTop : 0,
            });
        }
    };

    const renderChatHistory = (container, messages = [], { truncated = false, preserveReadingPosition = false } = {}) => {
        if (!container) {
            return;
        }

        const nonemptyMessages = messages.filter(message => message?.content);
        const visibleMessages = nonemptyMessages.slice(-MESSAGE_LIMIT);
        const followsLatest = !preserveReadingPosition || !(container.scrollHeight - container.scrollTop - container.clientHeight > 48);
        const top = container.getBoundingClientRect?.().top;
        const availableIds = new Set(visibleMessages.map(message => message.id).filter(Boolean));
        const anchor = !followsLatest && Number.isFinite(top)
            ? Array.from(container.querySelectorAll('.chat-message')).find(item => {
                const bounds = item.getBoundingClientRect();
                return availableIds.has(messageIds.get(item)) && bounds.bottom > top && bounds.top < top + container.clientHeight;
            }) : undefined;
        const anchorId = anchor && messageIds.get(anchor);
        const anchorOffset = anchor && anchor.getBoundingClientRect().top - top;
        const previousCorrection = scrollCorrections.get(container);
        const remainder = previousCorrection?.scrollTop === container.scrollTop ? previousCorrection.remainder : 0;
        let replacementAnchor;
        const fragment = global.document.createDocumentFragment();
        visibleMessages.forEach((message) => {
            if (message?.content) {
                const item = renderChatMessageItem(message);
                if (anchor && !replacementAnchor && message.id === anchorId) replacementAnchor = item;
                fragment.append(item);
            }
        });
        clearMessages(container);
        container.append(fragment);
        if (truncated || nonemptyMessages.length > MESSAGE_LIMIT) showRetentionNote(container);
        if (followsLatest) scrollToBottom(container);
        else if (replacementAnchor) {
            const target = container.scrollTop + replacementAnchor.getBoundingClientRect().top - container.getBoundingClientRect().top - anchorOffset + remainder;
            container.scrollTop = target;
            scrollCorrections.set(container, {
                scrollTop: container.scrollTop,
                remainder: target >= 0 && target <= container.scrollHeight - container.clientHeight ? target - container.scrollTop : 0,
            });
        } else {
            // The server's smaller history window may no longer contain the
            // reading row. Show the remaining top rather than jumping to bottom.
            container.scrollTop = 0;
        }
    };

    global.VoiceChatMessageUI = {
        MESSAGE_LIMIT,
        appendChatMessage,
        captureReadingPosition,
        clearMessages,
        renderChatHistory,
        renderChatMessageItem,
        restoreReadingPosition,
        scrollToBottom,
    };
})(window);
