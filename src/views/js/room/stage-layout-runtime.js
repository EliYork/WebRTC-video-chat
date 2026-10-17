(function exposeVoiceStageLayout(global) {
    'use strict';

    // Presentation only. The existing tiles continue to own their players,
    // diagnostics, route dialogs and independent audio controls.
    const createRuntime = ({ root, stage, members, sources, chat, getTiles, getMember, getCameraStream = () => null, onVolume } = {}) => {
        const proxies = new Map();
        const choices = new Map();
        const speaking = new Map();
        const cameraPreviews = new Map();
        const bindings = [];
        let selectedId;
        let activeShares = [];
        let chatOpen = global.innerWidth > 640;
        let channelsOpen = false;
        let initialized = false;
        let disposed = false;
        let savedChatScroll = 0;
        const doc = root.ownerDocument || global.document;
        const byId = (id) => doc.getElementById(id);
        const button = (label, className) => {
            const node = doc.createElement('button');
            node.type = 'button';
            node.className = className;
            node.textContent = label;
            return node;
        };
        const bind = (node, type, handler) => {
            node?.addEventListener(type, handler);
            if (node) bindings.push(() => node.removeEventListener(type, handler));
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
            root.classList.toggle('stage-chat-closed', !chatOpen);
            root.classList.toggle('stage-channels-open', channelsOpen);
            const chatToggle = byId('stageChatToggle');
            chatToggle?.setAttribute('aria-expanded', String(chatOpen));
            if (chatToggle) chatToggle.textContent = chatOpen ? '收起聊天' : '展开聊天';
            byId('stageChannelsToggle')?.setAttribute('aria-expanded', String(channelsOpen));
            chat.inert = !chatOpen;
            chat.setAttribute('aria-hidden', String(!chatOpen));
        };
        const setChatOpen = (open) => {
            const next = Boolean(open);
            if (next && channelsOpen) { channelsOpen = false; renderControls(); }
            if (next === chatOpen) return;
            const messages = byId('chatMessages');
            if (!next) {
                savedChatScroll = messages?.scrollTop || 0;
                if (chat.contains(doc.activeElement)) byId('stageChatToggle')?.focus();
            }
            chatOpen = next;
            renderControls();
            if (next && messages) messages.scrollTop = savedChatScroll;
        };
        const setChannelsOpen = (open) => {
            channelsOpen = Boolean(open);
            renderControls();
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
                    proxy.addEventListener('contextmenu', (event) => onVolume?.(event, tile));
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
                    tile.classList.remove('is-stage-focus');
                    tile.inert = false;
                    tile.removeAttribute('aria-hidden');
                    place(tile, members);
                }
            });
            if (!shareIds.has(selectedId)) selectedId = activeShares[0]?.id;
            if (selectedId) focusShare(selectedId);
            renderControls();
            const count = byId('member-count');
            if (count) count.textContent = `${tiles.length} 人`;
            const empty = byId('members-empty');
            if (empty) empty.hidden = tiles.length !== 0;
        };
        const init = () => {
            if (initialized || disposed) return;
            initialized = true;
            bind(byId('stageChatToggle'), 'click', () => setChatOpen(!chatOpen));
            bind(byId('stageChannelsToggle'), 'click', () => setChannelsOpen(!channelsOpen));
            bind(root.querySelector('.sidebar-channel-tree'), 'click', (event) => {
                if (event.target.closest('a')) setChannelsOpen(false);
            });
            sync();
        };
        return {
            init, sync, focusShare, setChatOpen, setChannelsOpen, setSpeaking,
            syncViewport: renderControls,
            snapshot: () => ({ mode: activeShares.length ? 'sharing' : 'voice', selectedId, chatOpen, channelsOpen, shareIds: activeShares.map((tile) => tile.id) }),
            destroy: () => {
                disposed = true;
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
