(function exposeVoiceSpeakingRuntime(global) {
    'use strict';

    // A meter only: no connection to context.destination, no capture requests,
    // no track cloning/stopping and no changes to the playback audio graph.
    const createRuntime = ({ getSources, onSpeaking, onLevel = () => {}, createContext = () => new global.AudioContext(),
        createStream = (track) => new global.MediaStream([track]), now = () => Date.now(),
        setTimer = global.setTimeout.bind(global), clearTimer = global.clearTimeout.bind(global) } = {}) => {
        const meters = new Map();
        let context;
        let timer;
        let running = false;
        const release = (id) => {
            const meter = meters.get(id);
            if (!meter) return;
            meter.source.disconnect();
            meter.analyser.disconnect();
            meters.delete(id);
            onSpeaking(id, false);
            onLevel(id, 0);
        };
        const resume = () => {
            if (context?.state === 'suspended') void context.resume().catch(() => {});
        };
        const sample = () => {
            if (!running) return;
            const sources = getSources();
            const live = new Set();
            for (const entry of sources) {
                const track = entry.enabled && entry.stream?.getAudioTracks?.()
                    .find((item) => item.readyState === 'live' && item.enabled !== false && !item.muted);
                if (!track) { release(entry.id); continue; }
                live.add(entry.id);
                let meter = meters.get(entry.id);
                if (meter?.track !== track) {
                    release(entry.id);
                    try {
                        context ||= createContext();
                        resume();
                        const analyser = context.createAnalyser();
                        analyser.fftSize = 1024;
                        const source = context.createMediaStreamSource(createStream(track));
                        source.connect(analyser);
                        meter = { track, source, analyser, samples: new Float32Array(1024), until: 0, speaking: false, level: 0 };
                        meters.set(entry.id, meter);
                    } catch { continue; }
                }
                meter.analyser.getFloatTimeDomainData(meter.samples);
                const rms = Math.sqrt(meter.samples.reduce((sum, value) => sum + value * value, 0) / meter.samples.length);
                if (context.state === 'running' && rms > 0.018) meter.until = now() + 350;
                const speaking = context.state === 'running' && now() < meter.until;
                if (meter.speaking !== speaking) { meter.speaking = speaking; onSpeaking(entry.id, speaking); }
                // Display the measured RMS on a perceptual -60..-12 dBFS scale.
                // Fast attack, gentle release; silence is never held as "speaking".
                const target = context.state === 'running' && Number.isFinite(rms) && rms > .001
                    ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 48)) : 0;
                meter.level = target === 0 ? 0 : Math.max(target, meter.level * .72);
                onLevel(entry.id, meter.level);
            }
            for (const id of meters.keys()) if (!live.has(id)) release(id);
            timer = setTimer(sample, global.document?.hidden ? 500 : 50);
        };
        return {
            start: () => {
                if (running) return;
                running = true;
                global.document?.addEventListener('pointerdown', resume);
                global.document?.addEventListener('keydown', resume);
                sample();
            },
            destroy: () => {
                running = false;
                clearTimer(timer);
                global.document?.removeEventListener('pointerdown', resume);
                global.document?.removeEventListener('keydown', resume);
                Array.from(meters.keys()).forEach(release);
                void context?.close()?.catch?.(() => {});
                context = undefined;
            },
        };
    };
    global.VoiceSpeakingRuntime = { createRuntime };
})(window);
