(function exposeVoiceChatPanelRuntime(global) {
    'use strict';

    const CONNECTION_STATES = new Set([
        'connecting',
        'connected',
        'reconnecting',
        'offline',
        'failed',
    ]);
    const CONNECTION_MESSAGES = {
        connecting: '正在连接聊天…',
        reconnecting: '聊天正在重新连接…',
        offline: '当前离线，暂时无法发送消息。',
        failed: '聊天连接失败，请稍后重试。',
    };
    const REQUIRED_SELECTORS = {
        form: '#chatForm',
        input: '#chatInput',
        messages: '#chatMessages',
        submitButton: 'button[type="submit"]',
    };

    const createChatPanelRuntime = ({
        root,
        transport,
        messageView = global.VoiceChatMessageUI,
        formView = global.VoiceChatFormUI,
        nameState = global.VoiceChatNameState,
        formatTime = global.VoiceViewUtils?.formatTime,
        onDisplayNameChange = () => {},
        onLiveMessage = () => {},
        onRoomChange = () => {},
        onConnectionStateChange = () => {},
        logger = global.console,
    } = {}) => {
        if (!root) {
            throw new Error('Chat Panel requires a root element.');
        }
        if (!transport) {
            throw new Error('Chat Panel requires a transport adapter.');
        }
        [
            ['messageView.clearMessages', messageView?.clearMessages],
            ['messageView.renderChatHistory', messageView?.renderChatHistory],
            ['messageView.appendChatMessage', messageView?.appendChatMessage],
            ['formView.getMessageContent', formView?.getMessageContent],
            ['formView.renderInputState', formView?.renderInputState],
            ['formView.renderSubmitState', formView?.renderSubmitState],
            ['formView.resetForm', formView?.resetForm],
            ['formView.focusInput', formView?.focusInput],
            ['nameState.getChatName', nameState?.getChatName],
            ['nameState.getStoredChatName', nameState?.getStoredChatName],
            ['nameState.saveChatName', nameState?.saveChatName],
            ['transport.joinRoom', transport?.joinRoom],
            ['transport.sendMessage', transport?.sendMessage],
            ['transport.subscribeHistory', transport?.subscribeHistory],
            ['transport.subscribeMessage', transport?.subscribeMessage],
            [
                'transport.subscribeConnectionState',
                transport?.subscribeConnectionState,
            ],
        ].forEach(([label, value]) => {
            if (typeof value !== 'function') {
                throw new TypeError(`Chat Panel requires ${label}().`);
            }
        });

        let initialized = false;
        let destroyed = false;
        let currentRoomId;
        let roomRevision = 0;
        let draftRevision = 0;
        let focusRevision = 0;
        let sending = false;
        let composing = false;
        let connectionState = 'connecting';
        let loadingHistory = false;
        let refs;
        let statusElement;
        let emptyStateElement;
        let sendError;
        let persistenceStatus;
        let sendOutcomeWarning;
        let historyError;
        let historyRetryButton;
        let maxLength = 500;
        const subscriptions = [];
        const renderedMessageIds = new Set();
        const pendingLiveMessages = [];
        const messageLimit = messageView.MESSAGE_LIMIT || 500;
        const duplicateLimit = messageLimit * 2;
        let pendingHistoryTruncated = false;

        const assertActive = () => !destroyed && initialized;
        const resolveRefs = () => {
            const form = root.querySelector(REQUIRED_SELECTORS.form);
            const input = root.querySelector(REQUIRED_SELECTORS.input);
            const messages = root.querySelector(REQUIRED_SELECTORS.messages);
            const submitButton = form?.querySelector(
                REQUIRED_SELECTORS.submitButton
            );
            const nameInput = root.querySelector('#chatName');
            const missing = Object.entries({
                form,
                input,
                messages,
                submitButton,
            })
                .filter(([, value]) => !value)
                .map(([key]) => key);

            if (missing.length) {
                throw new Error(
                    `Chat Panel is missing required element(s): ${missing.join(', ')}.`
                );
            }

            return { form, input, messages, nameInput, submitButton };
        };
        const getFormRefs = () => ({
            form: refs.form,
            input: refs.input,
            submitButton: refs.submitButton,
        });
        const getDisplayName = () =>
            nameState.getChatName(refs?.nameInput?.value);
        const commitDisplayName = () => {
            const name = nameState.saveChatName(refs?.nameInput?.value);
            if (refs?.nameInput) {
                refs.nameInput.value = name;
            }
            onDisplayNameChange(name);
            return name;
        };
        const isConnected = () => connectionState === 'connected';
        const getMessageContent = () =>
            formView.getMessageContent({
                refs: getFormRefs(),
                maxLength,
            });
        const removeEmptyState = () => {
            emptyStateElement?.remove();
            emptyStateElement = undefined;
        };
        const renderEmptyState = (text = '暂无消息') => {
            if (!refs?.messages) {
                return;
            }

            removeEmptyState();
            emptyStateElement = global.document.createElement('li');
            emptyStateElement.className = 'chat-empty-state';
            emptyStateElement.dataset.chatEmptyState = 'true';
            emptyStateElement.textContent = text;
            refs.messages.append(emptyStateElement);
        };
        const setStatus = (message = '', kind = '') => {
            if (!statusElement) {
                return;
            }

            statusElement.textContent = message;
            statusElement.hidden = !message;
            statusElement.dataset.statusKind = kind;
        };
        const syncStatus = () => {
            const historyNotice = currentRoomId && loadingHistory ? '正在同步聊天记录…' : '';
            const persistenceWarning = persistenceStatus?.state === 'failed'
                ? '部分聊天记录暂未保存，正在自动重试；已发送的消息无需重发。'
                : persistenceStatus?.state === 'disabled' ? '当前聊天记录仅临时保留，服务重启后可能丢失。' : '';
            setStatus(
                CONNECTION_MESSAGES[connectionState] || sendOutcomeWarning || sendError || historyError || persistenceWarning || historyNotice,
                connectionState !== 'connected' ? 'connection'
                    : sendOutcomeWarning ? 'warning' : sendError || historyError ? 'error' : persistenceWarning ? 'warning' : historyNotice ? 'history' : ''
            );
            if (historyRetryButton) {
                historyRetryButton.hidden = !historyError;
                historyRetryButton.disabled = !isConnected();
            }
        };
        const handleHistoryFailure = ({ roomId, requestRevision } = {}) => {
            if (!assertActive() || !isConnected() || !loadingHistory || roomId !== currentRoomId || requestRevision !== roomRevision) return;
            historyError = '聊天记录同步超时，请重试。';
            root.setAttribute('aria-busy', 'false');
            syncStatus();
        };
        const releasePendingSend = () => {
            if (!sending) return false;
            sending = false;
            sendOutcomeWarning = '发送时连接中断，请先核对聊天记录，避免重复发送。';
            return true;
        };
        const setPersistence = ({ roomId, ...status } = {}) => {
            if (!assertActive() || roomId !== currentRoomId ||
                !['saved', 'pending', 'failed', 'disabled'].includes(status.state) ||
                !Number.isSafeInteger(status.revision) || status.revision < 0 ||
                (persistenceStatus && status.revision < persistenceStatus.revision)) return false;
            persistenceStatus = status;
            syncStatus();
            return true;
        };
        const syncFormState = () => {
            if (!refs) {
                return;
            }

            formView.renderInputState({
                refs: getFormRefs(),
                maxLength,
            });
            formView.renderSubmitState({
                refs: getFormRefs(),
                disabled:
                    !currentRoomId || !isConnected() || loadingHistory || !getMessageContent(),
                loading: sending,
            });
        };
        const getMessageViewModel = (message) => ({
            id: message?.id,
            content: String(message?.content || ''),
            isLocal: message?.senderName === getDisplayName(),
            isSystem: message?.type === 'system',
            roomId: message?.roomId,
            senderName: String(message?.senderName || ''),
            timeText:
                typeof formatTime === 'function'
                    ? formatTime(message?.createdAt)
                    : '',
            type: message?.type || 'normal',
        });
        const isMessageForCurrentRoom = (message, roomId) => {
            const messageRoomId = roomId || message?.roomId;
            return !messageRoomId || messageRoomId === currentRoomId;
        };
        const rememberMessage = (message) => {
            if (message?.id) {
                renderedMessageIds.add(message.id);
                if (renderedMessageIds.size > duplicateLimit)
                    renderedMessageIds.delete(renderedMessageIds.values().next().value);
            }
        };
        const isDuplicateMessage = (message) =>
            Boolean(message?.id && renderedMessageIds.has(message.id));

        const clearMessages = ({ showLoading = false } = {}) => {
            if (!refs?.messages) {
                return;
            }

            messageView.clearMessages(refs.messages);
            emptyStateElement = undefined;
            renderedMessageIds.clear();
            pendingLiveMessages.length = 0;
            pendingHistoryTruncated = false;
            if (showLoading) {
                renderEmptyState('正在加载消息…');
            }
        };

        const renderHistory = (messages = [], { roomId, persistence, requestRevision } = {}) => {
            if (!assertActive() || !isConnected() || (roomId && roomId !== currentRoomId) ||
                (requestRevision !== undefined && requestRevision !== roomRevision)) {
                return false;
            }

            const safeMessages = (
                Array.isArray(messages) ? messages : []
            ).filter(
                (message) =>
                    message?.content && isMessageForCurrentRoom(message, roomId)
            );
            const pendingMessages = pendingLiveMessages.splice(0);
            const historyMessages = safeMessages.slice(-messageLimit);
            const historyIds = new Set(historyMessages.map(message => message.id).filter(Boolean));
            // Live events may precede the server's bounded history snapshot.
            // A shared ID locates the earlier live prefix without sorting by
            // timestamps, which can tie or move backwards with the server clock.
            const overlapIndex = pendingMessages.findIndex(message => message.id && historyIds.has(message.id));
            const prefixLength = Math.max(0, overlapIndex);
            const nextMessages = [];
            const nextIds = new Set();

            [...pendingMessages.slice(0, prefixLength), ...historyMessages, ...pendingMessages.slice(prefixLength)].forEach((message) => {
                if (message?.id && nextIds.has(message.id)) {
                    return;
                }
                if (message?.id) {
                    nextIds.add(message.id);
                }
                nextMessages.push(message);
            });
            const truncated = pendingHistoryTruncated || safeMessages.length > messageLimit || nextMessages.length > messageLimit;
            const visibleMessages = nextMessages.slice(-messageLimit);
            pendingHistoryTruncated = false;

            removeEmptyState();
            renderedMessageIds.clear();
            visibleMessages.forEach(rememberMessage);
            messageView.renderChatHistory(
                refs.messages,
                visibleMessages.map(getMessageViewModel),
                { truncated, preserveReadingPosition: true }
            );
            loadingHistory = false;
            historyError = undefined;
            if (persistence) setPersistence({ roomId: currentRoomId, ...persistence });
            syncStatus();
            root.setAttribute('aria-busy', 'false');
            syncFormState();
            if (!nextMessages.length) {
                renderEmptyState();
            }
            return true;
        };

        const appendMessage = (message) => {
            if (
                !assertActive() ||
                !message?.content ||
                !isMessageForCurrentRoom(message) ||
                isDuplicateMessage(message)
            ) {
                return false;
            }

            removeEmptyState();
            rememberMessage(message);
            if (loadingHistory) {
                pendingLiveMessages.push(message);
                if (pendingLiveMessages.length > messageLimit) {
                    pendingLiveMessages.shift();
                    pendingHistoryTruncated = true;
                }
            }
            messageView.appendChatMessage(
                refs.messages,
                getMessageViewModel(message)
            );
            onLiveMessage(message);
            return true;
        };

        const setConnectionState = (state) => {
            if (!CONNECTION_STATES.has(state) || destroyed) {
                return false;
            }

            connectionState = state;
            if (state !== 'connected') {
                historyError = undefined;
                persistenceStatus = undefined;
                if (currentRoomId) {
                    loadingHistory = true;
                    root.setAttribute('aria-busy', 'true');
                }
                if (releasePendingSend()) roomRevision += 1;
            }
            root.dataset.chatConnectionState = state;
            onConnectionStateChange(state);
            syncStatus();
            syncFormState();
            return true;
        };

        const setSendingState = (isSending) => {
            sending = Boolean(isSending);
            syncFormState();
        };

        const setRoom = (roomId) => {
            if (!assertActive() || !roomId || roomId === currentRoomId) {
                return false;
            }

            currentRoomId = roomId;
            historyError = undefined;
            persistenceStatus = undefined;
            sendOutcomeWarning = undefined;
            sendError = undefined;
            roomRevision += 1;
            loadingHistory = true;
            sending = false;
            clearMessages({ showLoading: true });
            loadingHistory = true;
            root.dataset.chatRoomId = roomId;
            onRoomChange(roomId);
            root.setAttribute('aria-busy', 'true');
            syncStatus();
            syncFormState();
            transport.joinRoom(roomId, { requestRevision: roomRevision });
            return true;
        };

        const rejoinCurrentRoom = () => {
            if (!assertActive() || !currentRoomId || !isConnected()) {
                return false;
            }

            roomRevision += 1;
            releasePendingSend();
            historyError = undefined;
            loadingHistory = true;
            // Same-room retries still need live rows older than the server's
            // bounded snapshot. Room changes and accepted history clear them.
            root.setAttribute('aria-busy', 'true');
            syncStatus();
            syncFormState();
            return transport.joinRoom(currentRoomId, { requestRevision: roomRevision });
        };

        const sendCurrentMessage = async () => {
            if (
                !assertActive() ||
                sending ||
                composing ||
                loadingHistory ||
                !currentRoomId ||
                !isConnected()
            ) {
                syncFormState();
                return false;
            }

            const content = getMessageContent();
            if (!content) {
                syncFormState();
                return false;
            }

            const revision = roomRevision;
            const roomId = currentRoomId;
            const submittedValue = refs.input.value;
            const submittedDraftRevision = draftRevision;
            const submittedFocusRevision = focusRevision;
            const focusAtSubmit = global.document.activeElement;
            const senderName = commitDisplayName();
            sendOutcomeWarning = undefined;
            sendError = undefined;
            setStatus('', '');
            syncStatus();
            setSendingState(true);

            try {
                const result = await transport.sendMessage({ content, roomId, senderName });
                if (
                    !assertActive() ||
                    revision !== roomRevision ||
                    roomId !== currentRoomId
                ) {
                    return false;
                }
                if (result?.persistence) setPersistence({ roomId, ...result.persistence });
                // Equal text can belong to a newer edit or composition session.
                if (draftRevision === submittedDraftRevision && refs.input.value === submittedValue) {
                    const activeElement = global.document.activeElement;
                    // Disabling the clicked submit button can blur it to body.
                    // Restore that focus only if no newer control was focused.
                    const implicitButtonBlur = focusAtSubmit === refs.submitButton && focusRevision === submittedFocusRevision &&
                        (!activeElement || activeElement === global.document.body);
                    formView.resetForm({
                        refs: getFormRefs(),
                        focus: !global.document.hidden && (global.document.hasFocus?.() ?? true) &&
                            (activeElement === refs.input || activeElement === refs.submitButton || implicitButtonBlur),
                    });
                }
                return true;
            } catch (error) {
                if (
                    assertActive() &&
                    revision === roomRevision &&
                    roomId === currentRoomId
                ) {
                    if (error?.deliveryUncertain) {
                        sendOutcomeWarning = '消息发送结果未确认，请先核对聊天记录，避免重复发送。';
                        syncStatus();
                    } else {
                        sendError = '消息发送失败，请检查连接后重试。';
                        syncStatus();
                    }
                    logger?.warn?.('Chat message send failed.', error);
                }
                return false;
            } finally {
                if (
                    assertActive() &&
                    revision === roomRevision &&
                    roomId === currentRoomId
                ) {
                    setSendingState(false);
                }
            }
        };

        const handleSubmit = (event) => {
            event.preventDefault();
            void sendCurrentMessage();
        };
        const handleKeydown = (event) => {
            if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.isComposing ||
                composing
            ) {
                return;
            }

            event.preventDefault();
            void sendCurrentMessage();
        };
        const handleInput = () => {
            draftRevision += 1;
            if (sendError || sendOutcomeWarning) {
                sendOutcomeWarning = undefined;
                sendError = undefined;
                setStatus('', '');
                syncStatus();
            }
            syncFormState();
        };
        const handleCompositionStart = () => {
            draftRevision += 1;
            composing = true;
        };
        const handleCompositionEnd = () => {
            composing = false;
            syncFormState();
        };
        const handleNameChange = () => {
            commitDisplayName();
        };
        const handleDocumentFocus = () => { focusRevision += 1; };
        const retryHistory = () => rejoinCurrentRoom();

        const init = () => {
            if (destroyed) {
                throw new Error(
                    'Destroyed Chat Panel runtime cannot be re-initialized.'
                );
            }
            if (initialized) {
                return false;
            }

            const resolvedRefs = resolveRefs();
            refs = resolvedRefs;
            maxLength =
                Number(refs.input.maxLength) > 0
                    ? Number(refs.input.maxLength)
                    : 500;
            if (refs.nameInput) {
                refs.nameInput.value = nameState.getStoredChatName();
            }
            const stagedSubscriptions = [];

            try {
                statusElement = global.document.createElement('p');
                statusElement.className = 'chat-panel-status';
                statusElement.hidden = true;
                statusElement.setAttribute('role', 'status');
                statusElement.setAttribute('aria-live', 'polite');
                root.append(statusElement);
                historyRetryButton = global.document.createElement('button');
                historyRetryButton.type = 'button';
                historyRetryButton.className = 'chat-history-retry';
                historyRetryButton.textContent = '重新同步聊天记录';
                historyRetryButton.hidden = true;
                historyRetryButton.addEventListener('click', retryHistory);
                root.append(historyRetryButton);
                initialized = true;

                stagedSubscriptions.push(
                    transport.subscribeHistory(({ messages, roomId, persistence, requestRevision } = {}) =>
                        renderHistory(messages, { roomId, persistence, requestRevision })
                    )
                );
                stagedSubscriptions.push(
                    transport.subscribeMessage(appendMessage)
                );
                if (transport.subscribeHistoryFailure)
                    stagedSubscriptions.push(transport.subscribeHistoryFailure(handleHistoryFailure));
                stagedSubscriptions.push(
                    transport.subscribeConnectionState(setConnectionState)
                );
                if (transport.subscribePersistence) stagedSubscriptions.push(transport.subscribePersistence(setPersistence));
                if (
                    stagedSubscriptions.some(
                        (unsubscribe) => typeof unsubscribe !== 'function'
                    )
                ) {
                    throw new TypeError(
                        'Chat Panel transport subscriptions must return unsubscribe functions.'
                    );
                }
                subscriptions.push(...stagedSubscriptions);
                refs.form.addEventListener('submit', handleSubmit);
                refs.input.addEventListener('keydown', handleKeydown);
                refs.input.addEventListener('input', handleInput);
                refs.input.addEventListener(
                    'compositionstart',
                    handleCompositionStart
                );
                refs.input.addEventListener(
                    'compositionend',
                    handleCompositionEnd
                );
                refs.nameInput?.addEventListener('change', handleNameChange);
                global.document.addEventListener('focusin', handleDocumentFocus);
                syncFormState();
                return true;
            } catch (error) {
                global.document.removeEventListener('focusin', handleDocumentFocus);
                stagedSubscriptions.forEach((unsubscribe) => unsubscribe?.());
                initialized = false;
                statusElement?.remove();
                historyRetryButton?.removeEventListener('click', retryHistory);
                historyRetryButton?.remove();
                historyRetryButton = undefined;
                statusElement = undefined;
                refs = undefined;
                throw error;
            }
        };

        const focusInput = () => {
            if (!assertActive()) {
                return false;
            }
            formView.focusInput({ refs: getFormRefs() });
            return true;
        };

        const getMessagePreviews = (limit = 3) => {
            if (!assertActive()) {
                return [];
            }
            return Array.from(refs.messages.querySelectorAll('.chat-message'))
                .slice(-Math.max(0, limit))
                .map((message) => message.textContent.trim())
                .filter(Boolean);
        };

        const destroy = () => {
            if (destroyed) {
                return false;
            }

            destroyed = true;
            roomRevision += 1;
            refs?.form.removeEventListener('submit', handleSubmit);
            refs?.input.removeEventListener('keydown', handleKeydown);
            refs?.input.removeEventListener('input', handleInput);
            refs?.input.removeEventListener(
                'compositionstart',
                handleCompositionStart
            );
            refs?.input.removeEventListener(
                'compositionend',
                handleCompositionEnd
            );
            refs?.nameInput?.removeEventListener('change', handleNameChange);
            global.document.removeEventListener('focusin', handleDocumentFocus);
            subscriptions.splice(0).forEach((unsubscribe) => unsubscribe?.());
            removeEmptyState();
            statusElement?.remove();
            historyRetryButton?.removeEventListener('click', retryHistory);
            historyRetryButton?.remove();
            historyRetryButton = undefined;
            statusElement = undefined;
            sending = false;
            composing = false;
            loadingHistory = false;
            renderedMessageIds.clear();
            pendingLiveMessages.length = 0;
            pendingHistoryTruncated = false;
            return true;
        };

        return {
            appendMessage,
            clearMessages,
            destroy,
            focusInput,
            getDisplayName,
            getMessagePreviews,
            getRootElement: () => root,
            init,
            rejoinCurrentRoom,
            renderHistory,
            setConnectionState,
            setRoom,
            setSendingState,
        };
    };

    global.VoiceChatPanelRuntime = {
        CONNECTION_STATES,
        createChatPanelRuntime,
    };
})(window);
