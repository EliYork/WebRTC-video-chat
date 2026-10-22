(function exposeVoiceChannelSounds(global) {
    'use strict';
    const ENABLED_KEY = 'voice-channel-sounds-enabled';
    const VOLUME_KEY = 'voice-channel-sounds-volume';
    const NOTES = Object.freeze({
        join: [523.251, 587.33],
        leave: [587.33, 523.251],
    });
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

    // Observe the authoritative roster, never video tiles or media reconnects.
    function createTracker({ notify, now = () => Date.now() }) {
        let room = '',
            members = null,
            lastRemote = -Infinity;
        function observe(
            snapshot,
            { localSocketId, localPeerId, connected = true } = {}
        ) {
            if (!room) return;
            const channel = snapshot?.channels?.find(
                (channel) => channel.slug === room
            );
            if (!channel || !Array.isArray(channel.members)) return;
            const next = new Set(
                channel.members
                    .filter(
                        (member) =>
                            member.joinedVoice === true &&
                            member.socketId &&
                            member.socketId !== localSocketId &&
                            (!localPeerId || member.peerId !== localPeerId)
                    )
                    .map((member) => member.socketId)
            );
            if (members && connected) {
                const added = [...next].some((id) => !members.has(id));
                const removed = [...members].some((id) => !next.has(id));
                if ((added || removed) && now() - lastRemote >= 500) {
                    lastRemote = now();
                    notify(added ? 'join' : 'leave');
                }
            }
            // Initial/recovery snapshots establish a silent baseline.
            members = connected ? next : null;
        }
        return {
            observe,
            active: () => Boolean(room),
            enter(roomId, snapshot, identity) {
                if (!roomId || room === roomId) return false;
                room = roomId;
                members = null;
                lastRemote = -Infinity;
                observe(snapshot, identity);
                notify('join');
                return true;
            },
            leave() {
                if (!room) return false;
                room = '';
                members = null;
                notify('leave');
                return true;
            },
            rebase() {
                members = null;
            },
            reset() {
                room = '';
                members = null;
            },
        };
    }

    function createTonePlayer({
        getSettings,
        getOutput,
        createContext = () => new global.AudioContext(),
    }) {
        let context,
            master,
            sink = 'default',
            requestedSink = 'default',
            disposed = false,
            revision = 0;
        let routing = Promise.resolve(true);
        const nodes = new Set();
        const level = () => {
            const settings = getSettings(),
                output = getOutput();
            return settings.enabled && !output.muted
                ? clamp(settings.volume) * clamp(output.volume)
                : 0;
        };
        const clearNodes = () => {
            for (const { oscillator, gain } of nodes) {
                oscillator.onended = null;
                try {
                    oscillator.stop();
                } catch {
                    /* Already ended. */
                }
                oscillator.disconnect();
                gain.disconnect();
            }
            nodes.clear();
        };
        function syncOutput() {
            if (!context || disposed) return Promise.resolve(false);
            const target = getOutput().deviceId || 'default';
            const switching = sink !== target;
            const invalidated = requestedSink !== target || !level();
            requestedSink = target;
            master.gain.value = switching ? 0 : level();
            if (invalidated) revision++;
            if (switching || invalidated) clearNodes();
            routing = routing
                .catch(() => false)
                .then(async () => {
                    if (disposed) return false;
                    const target = getOutput().deviceId || 'default';
                    if (target !== sink) {
                        master.gain.value = 0;
                        // Never unexpectedly play through default speakers if a selected headset fails.
                        if (typeof context.setSinkId !== 'function')
                            return false;
                        try {
                            await context.setSinkId(target);
                            if (disposed) return false;
                            sink = target;
                        } catch {
                            return false;
                        }
                    }
                    const matched = sink === (getOutput().deviceId || 'default');
                    master.gain.value = matched ? level() : 0;
                    return matched;
                });
            return routing;
        }
        return {
            async unlock() {
                if (disposed || !getSettings().enabled) return false;
                try {
                    if (!context) {
                        context = createContext();
                        master = context.createGain();
                        master.gain.value = 0;
                        master.connect(context.destination);
                    }
                    // Called directly from the join/setting gesture; no notes are played here.
                    await context.resume();
                    return await syncOutput();
                } catch {
                    return false;
                }
            },
            async play(kind) {
                if (
                    disposed ||
                    !NOTES[kind] ||
                    !context ||
                    context.state !== 'running' ||
                    !level()
                )
                    return false;
                try {
                    const pendingRoute = syncOutput();
                    const token = ++revision;
                    if (
                        !(await pendingRoute) ||
                        token !== revision ||
                        disposed ||
                        !level() ||
                        context.state !== 'running'
                    )
                        return false;
                    clearNodes(); // Replace a burst; never queue old membership sounds.
                    NOTES[kind].forEach((frequency, index) => {
                        const oscillator = context.createOscillator(),
                            gain = context.createGain();
                        const start =
                            context.currentTime + 0.008 + index * 0.15;
                        oscillator.type = 'sine';
                        oscillator.frequency.value = frequency;
                        gain.gain.setValueAtTime(0, start);
                        gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
                        gain.gain.exponentialRampToValueAtTime(
                            0.0001,
                            start + 0.13
                        );
                        oscillator.connect(gain);
                        gain.connect(master);
                        const entry = { oscillator, gain };
                        nodes.add(entry);
                        oscillator.onended = () => {
                            oscillator.disconnect();
                            gain.disconnect();
                            nodes.delete(entry);
                        };
                        oscillator.start(start);
                        oscillator.stop(start + 0.14);
                    });
                    return true;
                } catch {
                    clearNodes();
                    return false;
                }
            },
            syncOutput,
            destroy() {
                if (disposed) return;
                disposed = true;
                revision++;
                clearNodes();
                master?.disconnect();
                if (context) void context.close().catch(() => {});
            },
        };
    }

    function createRuntime({
        getOutput,
        getIdentity,
        isConnected,
        document = global.document,
    }) {
        const { safeStorageGet, safeStorageSet } = global.VoiceViewUtils;
        const stored = safeStorageGet(VOLUME_KEY);
        const settings = {
            enabled: safeStorageGet(ENABLED_KEY) !== 'false',
            volume:
                stored !== null &&
                stored !== '' &&
                Number.isFinite(Number(stored))
                    ? clamp(stored)
                    : 0.35,
        };
        const player = createTonePlayer({
            getSettings: () => settings,
            getOutput,
        });
        const tracker = createTracker({
            notify: (kind) => {
                void player.play(kind);
            },
        });
        const enabled = document.getElementById('voiceEventSounds');
        const volume = document.getElementById('voiceEventVolume');
        const label = document.getElementById('voiceEventVolumeValue');
        const status = document.getElementById('voiceEventSoundStatus');
        const render = () => {
            if (enabled) enabled.checked = settings.enabled;
            if (volume) {
                volume.value = settings.volume;
                volume.disabled = !settings.enabled;
            }
            if (label)
                label.textContent = `${Math.round(settings.volume * 100)}%`;
        };
        const save = (key, value) => {
            if (status)
                status.textContent = safeStorageSet(key, value)
                    ? ''
                    : '本次已生效，浏览器未允许保存偏好。';
            else safeStorageSet(key, value);
            render();
            void player.syncOutput();
        };
        const changeEnabled = () => {
            settings.enabled = enabled.checked;
            save(ENABLED_KEY, settings.enabled);
            if (settings.enabled) void player.unlock();
        };
        const changeVolume = () => {
            settings.volume = clamp(volume.value);
            save(VOLUME_KEY, settings.volume);
        };
        const gesture = (event) => {
            if (event.isTrusted && tracker.active()) void player.unlock();
        };
        enabled?.addEventListener('change', changeEnabled);
        volume?.addEventListener('input', changeVolume);
        document.addEventListener('pointerdown', gesture, true);
        document.addEventListener('keydown', gesture, true);
        render();
        return {
            unlock: () => player.unlock(),
            enter: (roomId, snapshot) =>
                tracker.enter(roomId, snapshot, getIdentity()),
            leave: () => tracker.leave(),
            observe: (snapshot) =>
                tracker.observe(snapshot, {
                    ...getIdentity(),
                    connected: isConnected(),
                }),
            rebase: () => tracker.rebase(),
            syncOutput: () => player.syncOutput(),
            destroy() {
                tracker.reset();
                player.destroy();
                enabled?.removeEventListener('change', changeEnabled);
                volume?.removeEventListener('input', changeVolume);
                document.removeEventListener('pointerdown', gesture, true);
                document.removeEventListener('keydown', gesture, true);
            },
        };
    }
    global.VoiceChannelSounds = {
        createTracker,
        createTonePlayer,
        createRuntime,
        NOTES,
    };
})(window);
