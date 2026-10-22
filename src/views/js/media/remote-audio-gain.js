(function exposeRemoteAudioGain(global) {
    'use strict';
    // Keep native RTC playout at <=100%. Allocate Web Audio only for amplification.
    const createRuntime = ({
        createContext = () => new global.AudioContext({ latencyHint: 'interactive' }),
        MediaStreamCtor = global.MediaStream,
        onFailure,
    } = {}) => {
        const branches = new Map();
        let context;
        const retireContext = () => {
            if (branches.size || !context) return;
            const retired = context;
            context = undefined;
            try { void Promise.resolve(retired.close()).catch(() => {}); } catch { /* already closed */ }
        };
        const release = (element) => {
            const branch = branches.get(element);
            if (!branch) return;
            branch.sources.forEach((source) => { try { source.disconnect(); } catch { /* already disconnected */ } });
            try { branch.gain.disconnect(); } catch { /* already disconnected */ }
            branches.delete(element);
            retireContext();
        };
        const native = (element, volume, muted) => {
            element.volume = Math.min(1, volume);
            element.muted = Boolean(muted);
        };
        const activateOutput = (element) => {
            const branch = branches.get(element);
            if (!branch) return;
            const sinkId = element.dataset?.outputSinkId;
            const matched = (!sinkId || sinkId === 'default')
                ? !context.sinkId || context.sinkId === 'default'
                : context.sinkId === sinkId;
            const volume = matched ? branch.volume : 0;
            if (branch.gain.gain.setTargetAtTime)
                branch.gain.gain.setTargetAtTime(volume, context.currentTime, 0.005);
            else branch.gain.gain.value = volume;
        };
        const setVolume = (element, { volume = 1, muted = false } = {}) => {
            if (!element) return false;
            volume = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(2, Number(volume))) : 1;
            const tracks = (element.srcObject?.getAudioTracks?.() || []).filter((track) => track.readyState === 'live');
            if (volume <= 1 || !tracks.length || muted) {
                release(element);
                native(element, volume, muted);
                return true;
            }
            let branch = branches.get(element);
            // A new receiver can retain the previous track ID. Reuse only the
            // same live track objects; their container/order does not matter.
            if (branch && (branch.tracks.length !== tracks.length ||
                tracks.some((track) => !branch.tracks.includes(track)))) {
                release(element);
                branch = undefined;
            }
            try {
                context ||= createContext();
                if (!branch) {
                    branch = { sources: [], gain: context.createGain(), tracks };
                    branch.gain.gain.value = 0;
                    branches.set(element, branch);
                    for (const track of tracks) {
                        const source = context.createMediaStreamSource(new MediaStreamCtor([track]));
                        branch.sources.push(source);
                        source.connect(branch.gain);
                    }
                    branch.gain.connect(context.destination);
                }
                branch.volume = volume;
                activateOutput(element);
                // Prevent the native element from duplicating the amplified audio.
                native(element, 1, true);
                if (context.state !== 'running') {
                    const outputContext = context;
                    const resumeRevision = branch.resumeRevision = (branch.resumeRevision || 0) + 1;
                    void Promise.resolve(context.resume()).catch((error) => {
                        // The same graph can outlive a resume request. A newer
                        // attempt or another player may already own recovery.
                        if (branches.get(element) !== branch || branch.resumeRevision !== resumeRevision ||
                            outputContext.state === 'running') return;
                        release(element);
                        native(element, 1, false);
                        onFailure?.(error);
                    });
                }
                return true;
            } catch (error) {
                release(element);
                retireContext();
                native(element, 1, false);
                onFailure?.(error);
                return false;
            }
        };
        return {
            setVolume,
            release,
            getBranchToken: (element) => branches.get(element),
            fallback(element, token) {
                const branch = branches.get(element);
                if (!branch || branch !== token) return;
                const volume = branch.volume;
                release(element);
                native(element, volume, false);
                onFailure?.(new Error('amplification-output-unsupported'));
            },
            getOutputTarget: (element) => branches.has(element) ? context : null,
            activateOutput,
            getSnapshot: () => ({ amplifiedPlayers: branches.size, contextState: context?.state || null }),
            describePlayer: (element) => ({
                播放器存在: Boolean(element),
                音频轨道数: (element?.srcObject?.getAudioTracks?.() || []).filter((track) => track.readyState === 'live').length,
                原生静音: element?.muted ?? null,
                WebAudio放大: branches.has(element),
                重复播放风险: branches.has(element) && element?.muted === false,
            }),
            destroy: () => [...branches.keys()].forEach(release),
        };
    };
    global.VoiceRemoteAudioGain = { createRuntime };
})(window);
