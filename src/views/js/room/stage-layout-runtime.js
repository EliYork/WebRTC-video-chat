(function exposeVoiceStageLayout(global) {
    'use strict';

    // Presentation only. The existing tiles continue to own their players,
    // diagnostics, route dialogs and independent audio controls.
    const createRuntime = ({ root, stage, members, sources, chat, chatView = global.VoiceChatMessageUI, getTiles, getMember, getCameraStream = () => null, getChannelState = () => ({}), onJoin, onVolume } = {}) => {
        const proxies = new Map();
        const choices = new Map();
        const speaking = new Map();
        const cameraPreviews = new Map();
        const bindings = [];
        const compactQuery = global.matchMedia?.('(max-width: 640px), (max-width: 1000px) and (max-height: 550px)');
        const isCompactViewport = () => compactQuery?.matches ?? (global.innerWidth <= 640 ||
            (global.innerWidth <= 1000 && global.innerHeight <= 550));
        let compact = isCompactViewport();
        let desktopChatOpen = true;
        let selectedId;
        let activeShares = [];
        let chatOpen = !compact;
        let channelsOpen = false;
        let toolsOpen = false;
        let initialized = false;
        let disposed = false;
        let savedChatPosition;
        let unread = 0;
        let chatConnection = 'connected';
        let panelCloseWatcher;
        let toolsCloseWatcher;
        const doc = root.ownerDocument || global.document;
        const byId = (id) => doc.getElementById(id);
        const atLatest = () => {
            const messages = byId('chatMessages');
            return !messages || !(messages.scrollHeight - messages.scrollTop - messages.clientHeight > 48);
        };
        const resetUnread = () => { unread = 0; renderUnread(); };
        const resetChatRoom = () => {
            // A new channel owns a new message list, not the last panel offset.
            savedChatPosition = undefined;
            resetUnread();
        };
        const saveChatPosition = () => {
            const messages = byId('chatMessages');
            savedChatPosition = messages ? chatView.captureReadingPosition(messages) : undefined;
        };
        const restoreChatPosition = () => {
            const messages = byId('chatMessages');
            if (!messages) return;
            if (savedChatPosition) chatView.restoreReadingPosition(messages, savedChatPosition);
            else messages.scrollTop = messages.scrollHeight;
        };
        const renderUnread = () => {
            const toggle = byId('stageChatToggle');
            if (toggle) {
                toggle.dataset.unreadCount = String(unread);
                toggle.dataset.unreadLabel = unread > 99 ? '99+' : String(unread);
                toggle.setAttribute('aria-label', unread ? `聊天，${unread} 条未读消息` : '聊天');
            }
            const jump = byId('chatJumpToLatest');
            if (jump) { jump.hidden = !unread; jump.textContent = `查看 ${unread} 条新消息 ↓`; }
        };
        const notifyChatMessage = (message) => {
            if (disposed || message?.type === 'system') return;
            if (!doc.hidden && chatOpen && atLatest()) resetUnread();
            else { unread = Math.min(999, unread + 1); renderUnread(); }
        };
        const setChatConnection = (state) => { chatConnection = state; renderConnection(); };
        const renderConnection = () => {
            const status = byId('stageConnectionStatus');
            if (!status) return;
            const state = getChannelState().connectionState;
            const voiceMessage = {
                joining: '正在加入语音…', 'reconnecting-socket': '频道正在重新连接，语音可能仍在继续…',
                'reconnecting-peer': '语音正在重新连接…', restoring: '正在恢复语音…',
                degraded: '部分语音连接异常，正在恢复…', failed: '语音连接失败，可使用下方通话按钮重试。',
            }[state];
            const chatMessage = { connecting: '正在连接聊天…', reconnecting: '聊天正在重新连接…',
                offline: '聊天已离线，暂时无法发送消息。', failed: '聊天连接失败，请检查网络。' }[chatConnection];
            const message = voiceMessage || chatMessage || '';
            status.hidden = !message;
            status.textContent = message;
        };
        const syncCloseWatchers = () => {
            if (!global.CloseWatcher) return;
            const panelOpen = compact && (chatOpen || channelsOpen);
            if (!panelOpen) { panelCloseWatcher?.destroy(); panelCloseWatcher = undefined; }
            else if (!panelCloseWatcher) {
                panelCloseWatcher = new global.CloseWatcher();
                panelCloseWatcher.addEventListener('close', () => { panelCloseWatcher = undefined; showStage(); });
            }
            if (!toolsOpen) { toolsCloseWatcher?.destroy(); toolsCloseWatcher = undefined; }
            else if (!toolsCloseWatcher) {
                const watcher = toolsCloseWatcher = new global.CloseWatcher();
                watcher.addEventListener('close', () => {
                    if (toolsCloseWatcher !== watcher) return;
                    const toggle = byId('stageMoreToggle');
                    const restoreFocus = byId('workspace-tools')?.contains(doc.activeElement) || doc.activeElement === toggle;
                    toolsCloseWatcher = undefined; toolsOpen = false; renderControls();
                    if (restoreFocus) toggle?.focus();
                });
            }
        };
        const button = (label, className) => {
            const node = doc.createElement('button');
            node.type = 'button';
            node.className = className;
            node.textContent = label;
            return node;
        };
        const bind = (node, type, handler) => {
            node?.addEventListener?.(type, handler);
            if (node?.addEventListener) bindings.push(() => node.removeEventListener(type, handler));
        };
        const place = (node, host) => {
            if (node.parentElement === host) return;
            // State-preserving DOM moves also retain fullscreen and playback.
            if (host.moveBefore && node.isConnected && host.isConnected) {
                host.moveBefore(node, null);
            } else {
                const playing = Array.from(node.querySelectorAll('video, audio'))
                    .filter((media) => media.srcObject && !media.paused);
                host.append(node);
                // Older engines may pause on reparent. Never reassign a stream.
                playing.forEach((media) => { void media.play()?.catch?.(() => {}); });
            }
        };
        const renderControls = () => {
            const sharing = activeShares.length > 0;
            root.dataset.stageMode = sharing ? 'sharing' : 'voice';
            root.dataset.viewportMode = compact ? 'compact' : 'wide';
            root.classList.toggle('stage-chat-closed', !chatOpen);
            root.classList.toggle('stage-channels-open', channelsOpen);
            root.dataset.mobilePanel = channelsOpen ? 'channels' : chatOpen ? 'chat' : 'stage';
            const chatToggle = byId('stageChatToggle');
            chatToggle?.setAttribute('aria-expanded', String(chatOpen));
            if (chatToggle) chatToggle.textContent = compact ? '聊天' : chatOpen ? '收起聊天' : '展开聊天';
            chatToggle?.setAttribute('aria-pressed', String(chatOpen));
            byId('stageChannelsToggle')?.setAttribute('aria-expanded', String(channelsOpen));
            byId('stageChannelsToggle')?.setAttribute('aria-pressed', String(channelsOpen));
            const stageToggle = byId('stageStageToggle');
            if (stageToggle) stageToggle.textContent = sharing ? '共享' : '语音';
            stageToggle?.setAttribute('aria-pressed', String(!chatOpen && !channelsOpen));
            chat.inert = !chatOpen;
            chat.setAttribute('aria-hidden', String(!chatOpen));
            const channels = byId('stage-channels');
            if (channels) channels.inert = compact && !channelsOpen;
            const tools = byId('workspace-tools');
            if (tools) tools.inert = !toolsOpen;
            byId('stageMoreToggle')?.setAttribute('aria-expanded', String(toolsOpen));
            tools?.classList.toggle('is-open', toolsOpen);
            renderUnread();
            renderConnection();
            syncCloseWatchers();
        };
        const syncViewport = () => {
            if (disposed) return;
            const nextCompact = isCompactViewport();
            let restoreChat = false;
            if (nextCompact !== compact) {
                if (nextCompact) {
                    desktopChatOpen = chatOpen;
                    if (chatOpen) saveChatPosition();
                    chatOpen = false;
                }
                else { restoreChat = !chatOpen && desktopChatOpen; chatOpen = desktopChatOpen; }
                channelsOpen = false; toolsOpen = false;
                compact = nextCompact;
            }
            const viewport = global.visualViewport;
            const usableHeight = viewport && viewport.scale === 1 ? viewport.height : global.innerHeight;
            root.style.setProperty?.('--stage-viewport-height', `${usableHeight}px`);
            root.classList.toggle('stage-mobile-keyboard', Boolean(compact && chatOpen &&
                viewport?.scale === 1 && global.innerHeight - viewport.height > 120 && chat.contains(doc.activeElement)));
            renderControls();
            if (restoreChat) restoreChatPosition();
        };
        const renderChannelState = (tiles) => {
            const state = getChannelState();
            const joined = state.joined ?? tiles.length > 0;
            const count = joined ? tiles.length : state.memberCount;
            const pending = state.pending === true;
            root.dataset.voiceState = joined ? 'joined' : pending ? 'joining' : 'not-joined';
            root.dataset.channelOccupancy = state.memberCount === undefined ? 'unknown' : state.memberCount > 0 ? 'occupied' : 'empty';
            members.dataset.memberCount = String(tiles.length);
            const name = byId('stageChannelName');
            if (name) name.textContent = state.channelName || '语音频道';
            const status = byId('stageChannelStatus');
            if (status) status.textContent = joined ? (activeShares.length ? '正在共享 · 下方是全部语音成员' : '语音成员 · 说话时头像亮起') : '语音频道';
            const counter = byId('member-count');
            if (counter) counter.textContent = count === undefined ? '同步成员中' : `${count} 人${joined ? '' : '在频道'}`;
            const empty = byId('members-empty');
            if (empty) empty.hidden = joined && tiles.length > 0;
            members.hidden = !joined || tiles.length === 0;
            const title = byId('stageWelcomeTitle');
            if (title) title.textContent = joined ? '已加入，等待伙伴到来' : pending ? '正在加入语音…' : state.memberCount > 0 ? `${state.memberCount} 位伙伴在频道里` : state.memberCount === 0 ? '频道还很安静，来做第一个吧' : '加入语音，一起待一会儿';
            const detail = byId('stageWelcomeDetail');
            if (detail) detail.textContent = joined ? '成员头像与摄像头将在这里显示。' : pending ? '正在连接，请稍候。' : state.memberCount > 0 ? '加入后即可聊天、观看摄像头与屏幕共享。' : '加入后，成员头像与摄像头会显示在中央；共享屏幕时自动切换到观看舞台。';
            const join = byId('stageJoinVoice');
            if (join) { join.hidden = joined; join.disabled = pending; join.textContent = pending ? '正在加入…' : '加入语音'; }
        };
        const setChatOpen = (open) => {
            const next = Boolean(open);
            if (next && channelsOpen) { channelsOpen = false; renderControls(); }
            if (next === chatOpen) return;
            if (!next) {
                saveChatPosition();
                if (chat.contains(doc.activeElement)) byId('stageChatToggle')?.focus();
            }
            chatOpen = next;
            toolsOpen = false;
            syncViewport();
            if (next) restoreChatPosition();
            if (next && !doc.hidden && atLatest()) resetUnread();
        };
        const setChannelsOpen = (open) => {
            if (open && compact) setChatOpen(false);
            channelsOpen = Boolean(open);
            toolsOpen = false;
            renderControls();
        };
        const showStage = () => {
            setChatOpen(false);
            setChannelsOpen(false);
        };
        const focusShare = (id) => {
            if (!activeShares.some((tile) => tile.id === id)) return false;
            selectedId = id;
            activeShares.forEach((tile) => {
                const active = tile.id === selectedId;
                tile.classList.toggle('is-stage-focus', active);
                tile.inert = !active;
                tile.setAttribute('aria-hidden', String(!active));
                choices.get(tile.id)?.setAttribute('aria-pressed', String(active));
            });
            return true;
        };
        const setSpeaking = (id, active) => {
            if (active) speaking.set(id, true);
            else speaking.delete(id);
            getTiles().find((tile) => tile.id === id)?.classList.toggle('is-speaking', Boolean(active));
            proxies.get(id)?.classList.toggle('is-speaking', Boolean(active));
        };
        const releaseCameraPreview = (id) => {
            const preview = cameraPreviews.get(id);
            if (!preview) return;
            preview.video.pause();
            preview.video.srcObject = null;
            preview.video.remove();
            cameraPreviews.delete(id);
        };
        const ensureProxy = (tile, member) => {
            let proxy = proxies.get(tile.id);
            if (!proxy) {
                proxy = doc.createElement('article');
                proxy.className = 'member-card stage-member-proxy';
                proxy.setAttribute('role', 'listitem');
                proxy.dataset.sourceId = tile.id;
                const { body, headerActions } = global.VoiceVideoTileStructureUI.ensureTileStructure(proxy);
                const placeholder = doc.createElement('div');
                placeholder.className = 'voice-placeholder';
                ['avatar', 'title', 'status'].forEach((part) => {
                    const child = doc.createElement('div');
                    child.className = `voice-placeholder-${part}`;
                    placeholder.append(child);
                });
                body.append(placeholder);
                const watch = button('观看', 'member-watch-button');
                watch.addEventListener('click', () => focusShare(tile.id));
                headerActions.append(watch);
                if (tile.id !== 'local-video') {
                    const volume = button('音量', 'member-volume-button');
                    volume.addEventListener('click', (event) => onVolume?.(event, tile));
                    headerActions.append(volume);
                }
                proxies.set(tile.id, proxy);
            }
            const name = member.senderName || 'Guest';
            // A sharer can have a separately captured local camera. Display
            // only that camera track here, never duplicate the screen player.
            const track = member.cameraOn && getCameraStream(tile)?.getVideoTracks?.()
                .find((item) => item.readyState === 'live');
            if (cameraPreviews.get(tile.id)?.track !== track) {
                releaseCameraPreview(tile.id);
                if (track) {
                    const video = doc.createElement('video');
                    video.muted = true;
                    video.autoplay = true;
                    video.playsInline = true;
                    video.srcObject = new global.MediaStream([track]);
                    proxy.querySelector('.tile-body').append(video);
                    cameraPreviews.set(tile.id, { video, track });
                    void video.play()?.catch?.(() => {});
                }
            }
            proxy.querySelector('.voice-placeholder').hidden = Boolean(track);
            global.VoiceTileStatusUI.renderTileStatus(proxy, {
                avatarText: global.VoiceVideoTileStructureUI.createTileAvatarText(name),
                titleText: tile.id === 'local-video' ? `${name}（我）` : name,
                hasVideo: Boolean(track),
                statuses: global.VoicePresenceViewModel.getMemberStatusIcons(member),
                statusText: '正在共享屏幕',
            });
            proxy.classList.toggle('is-speaking', speaking.has(tile.id));
            return proxy;
        };
        const sync = () => {
            if (disposed) return;
            const tiles = getTiles();
            const liveIds = new Set(tiles.map((tile) => tile.id));
            activeShares = tiles.filter((tile) => getMember(tile).screenSharing === true);
            const shareIds = new Set(activeShares.map((tile) => tile.id));
            for (const [id, proxy] of proxies) {
                if (!shareIds.has(id)) { releaseCameraPreview(id); proxy.remove(); proxies.delete(id); }
            }
            for (const [id, choice] of choices) {
                if (!shareIds.has(id)) { choice.remove(); choices.delete(id); }
            }
            for (const id of speaking.keys()) if (!liveIds.has(id)) speaking.delete(id);
            tiles.forEach((tile) => {
                const member = getMember(tile);
                const sharing = shareIds.has(tile.id);
                tile.classList.toggle('member-card', !sharing);
                tile.classList.toggle('is-speaking', speaking.has(tile.id));
                tile.setAttribute('role', sharing ? 'group' : 'listitem');
                if (sharing) {
                    place(tile, stage);
                    const proxy = ensureProxy(tile, member);
                    place(proxy, members);
                    let choice = choices.get(tile.id);
                    if (!choice) {
                        choice = button('', 'share-source-choice');
                        choice.addEventListener('click', () => focusShare(tile.id));
                        choices.set(tile.id, choice);
                        sources.append(choice);
                    }
                    choice.textContent = `▣ ${member.senderName || 'Guest'}`;
                    choice.setAttribute('aria-label', `观看 ${member.senderName || 'Guest'} 的共享`);
                } else {
                    if (tile.classList.contains('is-stage-focus')) global.VoiceFullscreenControls?.exitTileFullscreen(tile);
                    tile.classList.remove('is-stage-focus');
                    tile.inert = false;
                    tile.removeAttribute('aria-hidden');
                    place(tile, members);
                }
            });
            if (!shareIds.has(selectedId)) selectedId = activeShares[0]?.id;
            if (selectedId) focusShare(selectedId);
            renderControls();
            renderChannelState(tiles);
        };
        const init = () => {
            if (initialized || disposed) return;
            initialized = true;
            bind(byId('stageChatToggle'), 'click', () => { syncViewport(); setChatOpen(!chatOpen); });
            bind(byId('stageChannelsToggle'), 'click', () => { syncViewport(); setChannelsOpen(!channelsOpen); });
            bind(byId('stageStageToggle'), 'click', showStage);
            bind(byId('stageMoreToggle'), 'click', () => { toolsOpen = !toolsOpen; renderControls(); });
            bind(doc, 'click', (event) => {
                if (toolsOpen && !byId('workspace-tools')?.contains(event.target) &&
                    !byId('stageMoreToggle')?.contains(event.target)) {
                    toolsOpen = false; renderControls();
                }
            });
            bind(doc, 'keydown', (event) => {
                if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
                if (toolsOpen) { event.preventDefault(); toolsOpen = false; renderControls(); byId('stageMoreToggle')?.focus(); }
                else if (compact && (channelsOpen || chatOpen) && !event.defaultPrevented) {
                    event.preventDefault();
                    showStage(); byId('stageStageToggle')?.focus();
                }
            });
            bind(global.visualViewport, 'resize', syncViewport);
            bind(compactQuery, 'change', syncViewport);
            bind(doc, 'visibilitychange', syncViewport);
            bind(doc, 'visibilitychange', () => { if (!doc.hidden && chatOpen && atLatest()) resetUnread(); });
            bind(chat, 'focusin', syncViewport);
            bind(chat, 'focusout', () => global.queueMicrotask?.(syncViewport));
            bind(byId('stageJoinVoice'), 'click', () => onJoin?.());
            bind(byId('chatMessages'), 'scroll', () => { if (!doc.hidden && chatOpen && atLatest()) resetUnread(); });
            bind(byId('chatJumpToLatest'), 'click', () => {
                const messages = byId('chatMessages');
                if (messages) messages.scrollTop = messages.scrollHeight;
                resetUnread();
            });
            bind(root.querySelector('.sidebar-channel-tree'), 'click', (event) => {
                if (event.target.closest('a')) setChannelsOpen(false);
            });
            sync();
            syncViewport();
        };
        return {
            init, sync, focusShare, setChatOpen, setChannelsOpen, setSpeaking,
            syncViewport,
            notifyChatMessage, resetUnread, resetChatRoom, setChatConnection,
            snapshot: () => ({ mode: activeShares.length ? 'sharing' : 'voice', selectedId, chatOpen, channelsOpen, unread, shareIds: activeShares.map((tile) => tile.id) }),
            destroy: () => {
                disposed = true;
                savedChatPosition = undefined;
                panelCloseWatcher?.destroy(); toolsCloseWatcher?.destroy();
                bindings.splice(0).forEach((unbind) => unbind());
                Array.from(cameraPreviews.keys()).forEach(releaseCameraPreview);
                proxies.forEach((proxy) => proxy.remove());
                choices.forEach((choice) => choice.remove());
                proxies.clear(); choices.clear(); speaking.clear();
            },
        };
    };
    global.VoiceStageLayout = { createRuntime };
})(window);
