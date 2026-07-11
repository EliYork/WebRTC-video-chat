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
        let sending = false;
        let composing = false;
        let connectionState = 'connecting';
        let loadingHistory = false;
        let refs;
        let statusElement;
        let emptyStateElement;
        let statusKind;
        let maxLength = 500;
        const subscriptions = [];
        const renderedMessageIds = new Set();
        const pendingLiveMessages = [];

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

            statusKind = kind || undefined;
            statusElement.textContent = message;
            statusElement.hidden = !message;
            statusElement.dataset.statusKind = kind;
        };
        const syncStatus = () => {
            if (statusKind === 'error') {
                return;
            }

            setStatus(
                CONNECTION_MESSAGES[connectionState] || '',
                connectionState === 'connected' ? '' : 'connection'
            );
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
                    !currentRoomId || !isConnected() || !getMessageContent(),
                loading: sending,
            });
        };
        const getMessageViewModel = (message) => ({
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
            if (showLoading) {
                renderEmptyState('正在加载消息…');
            }
        };

        const renderHistory = (messages = [], { roomId } = {}) => {
            if (!assertActive() || (roomId && roomId !== currentRoomId)) {
                return false;
            }

            const safeMessages = (
                Array.isArray(messages) ? messages : []
            ).filter(
                (message) =>
                    message?.content && isMessageForCurrentRoom(message, roomId)
            );
            const pendingMessages = pendingLiveMessages.splice(0);
            const nextMessages = [];
            const nextIds = new Set();

            [...safeMessages, ...pendingMessages].forEach((message) => {
                if (message?.id && nextIds.has(message.id)) {
                    return;
                }
                if (message?.id) {
                    nextIds.add(message.id);
                }
                nextMessages.push(message);
            });

            removeEmptyState();
            renderedMessageIds.clear();
            nextMessages.forEach(rememberMessage);
            messageView.renderChatHistory(
                refs.messages,
                nextMessages.map(getMessageViewModel)
            );
            loadingHistory = false;
            root.setAttribute('aria-busy', 'false');
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
            }
            messageView.appendChatMessage(
                refs.messages,
                getMessageViewModel(message)
            );
            return true;
        };

        const setConnectionState = (state) => {
            if (!CONNECTION_STATES.has(state) || destroyed) {
                return false;
            }

            connectionState = state;
            root.dataset.chatConnectionState = state;
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
            roomRevision += 1;
            loadingHistory = true;
            sending = false;
            clearMessages({ showLoading: true });
            loadingHistory = true;
            root.dataset.chatRoomId = roomId;
            root.setAttribute('aria-busy', 'true');
            syncFormState();
            transport.joinRoom(roomId);
            return true;
        };

        const rejoinCurrentRoom = () => {
            if (!assertActive() || !currentRoomId || !isConnected()) {
                return false;
            }

            roomRevision += 1;
            loadingHistory = true;
            pendingLiveMessages.length = 0;
            root.setAttribute('aria-busy', 'true');
            return transport.joinRoom(currentRoomId);
        };

        const sendCurrentMessage = async () => {
            if (
                !assertActive() ||
                sending ||
                composing ||
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
            const senderName = commitDisplayName();
            setStatus('', '');
            setSendingState(true);

            try {
                await transport.sendMessage({ content, roomId, senderName });
                if (
                    !assertActive() ||
                    revision !== roomRevision ||
                    roomId !== currentRoomId
                ) {
                    return false;
                }
                if (refs.input.value === submittedValue) {
                    formView.resetForm({
                        refs: getFormRefs(),
                        focus: true,
                    });
                }
                return true;
            } catch (error) {
                if (
                    assertActive() &&
                    revision === roomRevision &&
                    roomId === currentRoomId
                ) {
                    setStatus('消息发送失败，请检查连接后重试。', 'error');
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
            if (statusKind === 'error') {
                setStatus('', '');
                syncStatus();
            }
            syncFormState();
        };
        const handleCompositionStart = () => {
            composing = true;
        };
        const handleCompositionEnd = () => {
            composing = false;
            syncFormState();
        };
        const handleNameChange = () => {
            commitDisplayName();
        };

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
                initialized = true;

                stagedSubscriptions.push(
                    transport.subscribeHistory(({ messages, roomId } = {}) =>
                        renderHistory(messages, { roomId })
                    )
                );
                stagedSubscriptions.push(
                    transport.subscribeMessage(appendMessage)
                );
                stagedSubscriptions.push(
                    transport.subscribeConnectionState(setConnectionState)
                );
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
                syncFormState();
                return true;
            } catch (error) {
                stagedSubscriptions.forEach((unsubscribe) => unsubscribe?.());
                initialized = false;
                statusElement?.remove();
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
            subscriptions.splice(0).forEach((unsubscribe) => unsubscribe?.());
            removeEmptyState();
            statusElement?.remove();
            statusElement = undefined;
            sending = false;
            composing = false;
            loadingHistory = false;
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
