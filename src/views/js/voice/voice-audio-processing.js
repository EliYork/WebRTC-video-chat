(function exposeVoiceAudioProcessing(global) {
    'use strict';

    const normalizeMode = (mode) =>
        ['off', 'browser', 'rnnoise'].includes(mode) ? mode : 'browser';
    const constraintsFor = (mode) => ({
        echoCancellation: true,
        noiseSuppression: normalizeMode(mode) === 'browser',
        autoGainControl: normalizeMode(mode) === 'browser',
        channelCount: 1,
    });
    const readSettings = (track) => {
        const settings = track?.getSettings?.() || {};
        return Object.fromEntries(
            [
                'echoCancellation',
                'noiseSuppression',
                'autoGainControl',
                'sampleRate',
                'channelCount',
            ].map((key) => [key, settings[key] ?? null])
        );
    };
    const bounded = (promise, ms, message) => {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = global.setTimeout(() => reject(new Error(message)), ms);
            }),
        ]).finally(() => global.clearTimeout(timer));
    };
    const createRuntime = ({
        mediaDevices = global.navigator?.mediaDevices,
        createContext = () => new global.AudioContext({ sampleRate: 48000 }),
        createGain = (context, gain) => new global.GainNode(context, { gain }),
        getGain = () => 100,
        supportsRnnoise = () => typeof global.AudioWorkletNode === 'function',
        loadLibrary = () => import('/vendor/web-noise-suppressor.js'),
        stopStream = (stream) =>
            stream?.getTracks().forEach((track) => track.stop()),
        onSourceEnded,
        onProcessorFailure,
    } = {}) => {
        const pipelines = new WeakMap();
        const captures = new WeakMap();
        const modules = new WeakMap();
        let library;
        let active;
        let stageRevision = 0;
        let staging = Promise.resolve();

        const capture = async (
            { mode = 'browser', deviceId = 'default' } = {},
            isCurrent = () => true
        ) => {
            mode = normalizeMode(mode);
            const requested = constraintsFor(mode);
            const device =
                deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {};
            let rawStream;
            try {
                rawStream = await mediaDevices.getUserMedia({
                    audio: { ...requested, ...device },
                });
            } catch (error) {
                // Retry only a format/constraint failure. Never hide permission,
                // missing-device or busy-device errors, or select another mic.
                if (
                    ![
                        'OverconstrainedError',
                        'ConstraintNotSatisfiedError',
                    ].includes(error?.name)
                )
                    throw error;
                rawStream = await mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: requested.noiseSuppression,
                        autoGainControl: requested.autoGainControl,
                        ...device,
                    },
                });
            }
            const track = rawStream.getAudioTracks()[0];
            try {
                if (!isCurrent())
                    throw Object.assign(new Error('superseded-audio-capture'), {
                        name: 'AbortError',
                    });
                if (!track || track.readyState === 'ended')
                    throw new Error('microphone-track-unavailable');
                const supported =
                    mediaDevices.getSupportedConstraints?.().echoCancellation;
                const capabilities = track.getCapabilities?.().echoCancellation;
                const allSupported = Array.isArray(capabilities)
                    ? capabilities.includes('all')
                    : null;
                let aecFallback = 'unsupported';
                if (
                    supported !== false &&
                    allSupported !== false &&
                    track.applyConstraints
                ) {
                    try {
                        // exact prevents silently interpreting an unknown string as true.
                        await track.applyConstraints({
                            ...requested,
                            echoCancellation: { exact: 'all' },
                        });
                        aecFallback =
                            readSettings(track).echoCancellation === 'all'
                                ? null
                                : 'not-reported-as-all';
                    } catch (error) {
                        aecFallback = error?.name || 'all-failed';
                    }
                    if (aecFallback) await track.applyConstraints(requested);
                }
                if (
                    mode !== 'browser' &&
                    readSettings(track).noiseSuppression === true
                ) {
                    await track.applyConstraints({
                        ...requested,
                        noiseSuppression: { exact: false },
                        echoCancellation:
                            readSettings(track).echoCancellation === 'all'
                                ? { exact: 'all' }
                                : true,
                    });
                    if (readSettings(track).noiseSuppression === true)
                        throw new Error(
                            'browser-noise-suppression-still-enabled'
                        );
                }
                if (readSettings(track).echoCancellation === 'all')
                    aecFallback = null;
                captures.set(rawStream, {
                    request: { mode, deviceId },
                    requested: { ...requested, echoCancellation: 'all' },
                    actual: readSettings(track),
                    allSupported,
                    aecFallback,
                });
                return rawStream;
            } catch (error) {
                stopStream(rawStream);
                throw error;
            }
        };

        const loadRnnoise = () => {
            library ||= bounded(
                loadLibrary().then(async (api) => ({
                    api,
                    wasmBinary: await api.loadRnnoise({
                        url: '/wasm/rnnoise.wasm',
                        simdUrl: '/wasm/rnnoise_simd.wasm',
                    }),
                })),
                8000,
                'rnnoise-load-timeout'
            ).catch((error) => {
                library = undefined;
                throw error;
            });
            return library;
        };
        const waitForProcessor = (node) =>
            bounded(
                new Promise((resolve, reject) => {
                    node.port.onmessage = ({ data }) => {
                        if (data?.type === 'ready') resolve();
                        if (data?.type === 'error')
                            reject(new Error('rnnoise-init-failed'));
                    };
                    node.onprocessorerror = () =>
                        reject(new Error('rnnoise-processor-error'));
                    node.port.start?.();
                }),
                2500,
                'rnnoise-init-timeout'
            ).finally(() => {
                node.port.onmessage = null;
            });

        const disconnect = (node) => {
            try {
                node?.disconnect();
            } catch {
                /* already detached */
            }
        };
        const releaseBranch = (pipeline, { preserveRaw = false } = {}) => {
            pipeline.rawTrack?.removeEventListener?.(
                'ended',
                pipeline.endedListener
            );
            if (pipeline.processor) {
                pipeline.processor.onprocessorerror = null;
                try {
                    pipeline.processor.destroy?.();
                } catch {
                    /* already destroyed */
                }
            }
            disconnect(pipeline.source);
            disconnect(pipeline.processor);
            disconnect(pipeline.gain);
            if (!preserveRaw) stopStream(pipeline.rawStream);
        };
        const close = (context) => {
            try {
                void Promise.resolve(context.close()).catch(() => {});
            } catch {
                /* closed */
            }
        };
        const dispose = (stream, options = {}) => {
            const pipeline = stream && pipelines.get(stream);
            if (!pipeline) return;
            pipelines.delete(stream);
            if (active === pipeline) active = undefined;
            releaseBranch(pipeline, options);
            stopStream(stream);
            if (pipeline.ownsContext) close(pipeline.context);
        };

        const prepare = async (
            rawStream,
            request = { mode: 'browser', deviceId: 'default' }
        ) => {
            const reusable =
                active?.context.state === 'running' &&
                active.stream.getAudioTracks()[0]?.readyState === 'live';
            let context;
            try {
                context = reusable ? active.context : createContext();
            } catch (error) {
                stopStream(rawStream);
                throw error;
            }
            const pipeline = {
                context,
                ownsContext: !reusable,
                rawStream,
                ...captures.get(rawStream),
                request,
            };
            try {
                if (context.state !== 'running')
                    await bounded(
                        Promise.resolve(context.resume()),
                        1500,
                        'microphone-audio-context-timeout'
                    );
                if (context.state !== 'running')
                    throw new Error('microphone-audio-context-not-running');
                pipeline.source = context.createMediaStreamSource(rawStream);
                pipeline.destination = context.createMediaStreamDestination();
                pipeline.destination.channelCount = 1;
                pipeline.stream = pipeline.destination.stream;
                pipeline.gain = createGain(
                    context,
                    Math.max(0, getGain() / 100)
                );
                let output = pipeline.source;
                if (request.mode === 'rnnoise') {
                    if (!supportsRnnoise() || context.sampleRate !== 48000)
                        throw new Error('rnnoise-unsupported');
                    const { api, wasmBinary } = await loadRnnoise();
                    if (!modules.has(context))
                        modules.set(
                            context,
                            context.audioWorklet
                                .addModule(
                                    '/audio-worklet/rnnoise-processor.js'
                                )
                                .catch((error) => {
                                    modules.delete(context);
                                    throw error;
                                })
                        );
                    await modules.get(context);
                    pipeline.processor = new api.RnnoiseWorkletNode(context, {
                        wasmBinary,
                        maxChannels: 1,
                    });
                    pipeline.processor.channelCount = 1;
                    pipeline.processor.channelCountMode = 'explicit';
                    await waitForProcessor(pipeline.processor);
                    pipeline.processor.onprocessorerror = () => {
                        pipeline.processorFailed = true;
                        if (active === pipeline) onProcessorFailure?.(pipeline);
                    };
                    output.connect(pipeline.processor);
                    output = pipeline.processor;
                }
                output.connect(pipeline.gain);
                pipeline.gain.connect(pipeline.destination);
                pipeline.mode =
                    request.mode === 'rnnoise'
                        ? 'rnnoise'
                        : readSettings(rawStream.getAudioTracks()[0])
                                .noiseSuppression === true
                          ? 'browser'
                          : readSettings(rawStream.getAudioTracks()[0])
                                  .noiseSuppression === false
                            ? 'off'
                            : 'unknown';
                pipelines.set(pipeline.stream, pipeline);
                return pipeline.stream;
            } catch (error) {
                if (request.mode === 'rnnoise') library = undefined;
                releaseBranch(pipeline);
                stopStream(pipeline.stream);
                if (pipeline.ownsContext) close(context);
                throw error;
            }
        };

        const restoreActiveConstraints = async () => {
            const pipeline = active;
            if (!pipeline?.rawTrack || pipeline.rawTrack.readyState !== 'live')
                return;
            const actual = pipeline.actual || {};
            try {
                await pipeline.rawTrack.applyConstraints?.({
                    ...constraintsFor(pipeline.request.mode),
                    echoCancellation:
                        actual.echoCancellation === 'all'
                            ? { exact: 'all' }
                            : true,
                });
                pipeline.restoreError = null;
            } catch {
                pipeline.restoreError = 'constraint-restore-failed';
            }
        };
        const stage = (request) => {
            const revision = ++stageRevision;
            const aborted = () =>
                Object.assign(new Error('superseded-audio-settings'), {
                    name: 'AbortError',
                });
            const promise = staging
                .catch(() => {})
                .then(async () => {
                    if (revision !== stageRevision) throw aborted();
                    const baseline = active;
                    try {
                        const rawStream = await capture(
                            request,
                            () => revision === stageRevision
                        );
                        if (revision !== stageRevision) {
                            stopStream(rawStream);
                            throw aborted();
                        }
                        let stream;
                        try {
                            stream = await prepare(rawStream, request);
                        } catch (error) {
                            error.audioProcessingFailure = true;
                            throw error;
                        }
                        if (revision !== stageRevision) {
                            dispose(stream);
                            throw aborted();
                        }
                        return stream;
                    } catch (error) {
                        // Captures of one hardware source may share browser APM
                        // settings. Restore the old branch before processing the
                        // next queued request, including RNNoise startup failures.
                        if (active === baseline)
                            await restoreActiveConstraints();
                        throw error;
                    }
                });
            staging = promise;
            return promise;
        };

        const adopt = (stream) => {
            const candidate = pipelines.get(stream);
            if (!candidate) {
                active = undefined;
                return stream;
            }
            if (
                candidate.context.state !== 'running' ||
                candidate.processorFailed ||
                candidate.rawStream.getAudioTracks()[0]?.readyState !== 'live'
            ) {
                throw new Error('audio-branch-no-longer-usable');
            }
            if (
                candidate.request.mode !== 'browser' &&
                readSettings(candidate.rawStream.getAudioTracks()[0])
                    .noiseSuppression === true
            ) {
                throw new Error('audio-branch-noise-settings-changed');
            }
            const previous = active;
            candidate.gain.gain.value = Math.max(0, getGain() / 100);
            if (
                previous &&
                previous !== candidate &&
                previous.context === candidate.context
            ) {
                // Redirect just the prepared branch. RTP keeps its existing track,
                // including its mute flag, and video/share senders stay untouched.
                disconnect(candidate.gain);
                candidate.gain.connect(previous.destination);
                releaseBranch(previous);
                pipelines.delete(stream);
                stopStream(stream);
                candidate.stream = previous.stream;
                candidate.destination = previous.destination;
                candidate.ownsContext = true;
                pipelines.set(candidate.stream, candidate);
            } else if (previous && previous !== candidate)
                dispose(previous.stream);
            active = candidate;
            candidate.rawTrack = candidate.rawStream.getAudioTracks()[0];
            candidate.endedListener = () => {
                if (active === candidate) onSourceEnded?.(candidate.stream);
            };
            candidate.rawTrack.addEventListener?.(
                'ended',
                candidate.endedListener
            );
            return candidate.stream;
        };
        const diagnostics = (stream = active?.stream) => {
            const pipeline = stream && pipelines.get(stream);
            const info = pipeline || captures.get(stream);
            if (!info) return null;
            return {
                request: info.request,
                requested: info.requested,
                actual: readSettings(
                    info.rawStream?.getAudioTracks()[0] ||
                        stream?.getAudioTracks()[0]
                ),
                mode: pipeline?.mode || 'raw',
                allSupported: info.allSupported,
                aecFallback: info.aecFallback,
                fallbackReason: info.fallbackReason,
                restoreError: info.restoreError,
                sourceLive:
                    (info.rawStream || stream)?.getAudioTracks()[0]
                        ?.readyState === 'live',
            };
        };
        return {
            capture,
            prepare,
            stage,
            adopt,
            dispose,
            diagnostics,
            pipelines,
            restoreCurrent: () => {
                const baseline = active;
                staging = staging
                    .catch(() => {})
                    .then(() => {
                        if (active === baseline)
                            return restoreActiveConstraints();
                    });
                return staging;
            },
            cancelPending: () => {
                stageRevision += 1;
                staging = Promise.resolve();
            },
            bypassFailedProcessor: (stream) => {
                const pipeline = pipelines.get(stream);
                if (
                    !pipeline?.processor ||
                    pipeline.context.state !== 'running'
                )
                    return false;
                disconnect(pipeline.source);
                disconnect(pipeline.processor);
                pipeline.processor.onprocessorerror = null;
                pipeline.processor.destroy?.();
                pipeline.processor = null;
                pipeline.source.connect(pipeline.gain);
                pipeline.mode = 'off';
                pipeline.fallbackReason = 'rnnoise-processor-error';
                return true;
            },
            setGain: (percent) => {
                if (active) active.gain.gain.value = Math.max(0, percent / 100);
            },
        };
    };
    global.VoiceAudioProcessing = {
        createRuntime,
        constraintsFor,
        normalizeMode,
    };
})(window);
