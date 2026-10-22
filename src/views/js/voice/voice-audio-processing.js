(function exposeVoiceAudioProcessing(global) {
    'use strict';

    const normalizeMode = (mode) =>
        ['off', 'browser', 'rnnoise', 'deepfilter'].includes(mode) ? mode : 'browser';
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
        getSpeechGateEnabled = () => true,
        supportsRnnoise = () => typeof global.AudioWorkletNode === 'function',
        loadLibrary = () => import('/js/voice/rnnoise-engine.js'),
        loadDeepfilterLibrary = () => import('/js/voice/deepfilter-engine.js'),
        stopStream = (stream) =>
            stream?.getTracks().forEach((track) => track.stop()),
        onSourceEnded,
        onProcessorFailure,
        onProcessingStatus,
    } = {}) => {
        const pipelines = new WeakMap();
        const captures = new WeakMap();
        const modules = new WeakMap();
        const pendingCaptures = new Set();
        const pendingPreparations = new Set();
        let library;
        let active;
        let lastSwitchFailure = null;
        let stageRevision = 0;
        let staging = Promise.resolve();

        const capture = async (
            { mode = 'browser', deviceId = 'default' } = {},
            isCurrent = () => true
        ) => {
            const captureRevision = stageRevision;
            mode = normalizeMode(mode);
            const requested = constraintsFor(mode);
            const supportedConstraints = mediaDevices.getSupportedConstraints?.() || {};
            // Mandatory processing flags make Chromium acquire a compatible
            // source instead of reusing an old source with opposite APM flags.
            const captureConstraints = { ...requested };
            for (const key of ['noiseSuppression', 'autoGainControl']) {
                if (supportedConstraints[key] === true)
                    captureConstraints[key] = { exact: requested[key] };
            }
            const device =
                deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {};
            const ensureCurrent = () => {
                if (captureRevision !== stageRevision || !isCurrent()) throw Object.assign(new Error('superseded-audio-capture'), { name: 'AbortError' });
            };
            const constraintFailure = (error) => ['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name);
            const acquire = async (echoCancellation) => {
                ensureCurrent();
                try {
                    return await mediaDevices.getUserMedia({ audio: { ...captureConstraints, echoCancellation, ...device } });
                } catch (error) {
                    // Relax only the format. Keep device, processing and AEC requirements.
                    if (!constraintFailure(error) || error.constraint === 'echoCancellation') throw error;
                    ensureCurrent();
                    return mediaDevices.getUserMedia({ audio: {
                        echoCancellation,
                        noiseSuppression: captureConstraints.noiseSuppression,
                        autoGainControl: captureConstraints.autoGainControl,
                        ...device,
                    } });
                }
            };
            let rawStream;
            let aecFallback = supportedConstraints.echoCancellation === false ? 'unsupported' : null;
            try {
                // Request the AEC mode while acquiring the source. Some Chromium
                // sources cannot change AEC type later through applyConstraints.
                rawStream = await acquire(aecFallback ? true : { exact: 'all' });
            } catch (error) {
                // Retry only a format/constraint failure. Never hide permission,
                // missing-device or busy-device errors, or select another mic.
                if (aecFallback || (!constraintFailure(error) && error?.name !== 'TypeError')) throw error;
                ensureCurrent();
                aecFallback = error?.name || 'all-failed';
                rawStream = await acquire(true);
            }
            const track = rawStream.getAudioTracks()[0];
            pendingCaptures.add(rawStream);
            try {
                ensureCurrent();
                if (!track || track.readyState === 'ended')
                    throw new Error('microphone-track-unavailable');
                const capabilities = track.getCapabilities?.().echoCancellation;
                const allSupported = Array.isArray(capabilities)
                    ? capabilities.includes('all')
                    : null;
                if (readSettings(track).echoCancellation !== 'all') {
                    aecFallback ||= allSupported === false ? 'unsupported' : 'not-reported-as-all';
                    // Also undo legacy engines silently coercing the string to true.
                    await track.applyConstraints?.(requested);
                    ensureCurrent();
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
                    ensureCurrent();
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
                    aecAcquisition: aecFallback ? 'ordinary-fallback' : 'initial-all',
                });
                return rawStream;
            } catch (error) {
                stopStream(rawStream);
                throw error;
            } finally {
                pendingCaptures.delete(rawStream);
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
        const waitForProcessor = (node, wait = bounded, mode = 'rnnoise') =>
            wait(
                new Promise((resolve, reject) => {
                    node.port.onmessage = ({ data }) => {
                        if (data?.type === 'ready') resolve(data);
                        if (data?.type === 'error')
                            reject(new Error(
                                /content security|unsafe-eval/i.test(String(data.detail || data.message || ''))
                                    ? `${mode}-csp-blocked`
                                    : `${mode}-init-failed`
                            ));
                    };
                    node.onprocessorerror = () =>
                        reject(new Error(`${mode}-processor-error`));
                    node.port.start?.();
                }),
                mode === 'deepfilter' ? 10000 : 2500,
                `${mode}-init-timeout`
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
        const configureSpeechGate = (pipeline, enabled) => {
            if (!pipeline?.processor || pipeline.mode === 'off') return true;
            if (!pipeline.speechGateSupported) return false;
            const revision = (pipeline.speechGateRevision || 0) + 1;
            try {
                pipeline.processor.port.postMessage({ type: 'speech-gate', enabled: Boolean(enabled), revision });
                pipeline.speechGateRequested = Boolean(enabled);
                pipeline.speechGateRevision = revision;
                return true;
            } catch {
                return false;
            }
        };
        const releaseProcessor = (pipeline) => {
            pipeline.modelAbort?.abort();
            if (pipeline.processor) {
                pipeline.processor.onprocessorerror = null;
                pipeline.processor.port.onmessage = null;
                try {
                    pipeline.processor.destroy?.();
                } catch {
                    /* already destroyed */
                }
            }
            disconnect(pipeline.processor);
            disconnect(pipeline.processorSource);
            stopStream(pipeline.bridgeStream);
            if (pipeline.processorContext) close(pipeline.processorContext);
            pipeline.processorContext = null;
            pipeline.bridgeStream = null;
        };
        const releaseBranch = (pipeline, { preserveRaw = false } = {}) => {
            pipeline.rawTrack?.removeEventListener?.('ended', pipeline.endedListener);
            releaseProcessor(pipeline);
            disconnect(pipeline.source);
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

        const releasePreparation = (pipeline) => {
            if (pipeline.released) return;
            pipeline.released = true;
            pipeline.cancelWaiters.forEach(cancel => cancel());
            releaseBranch(pipeline);
            stopStream(pipeline.stream);
            if (pipeline.ownsContext) close(pipeline.context);
        };
        const cancelPendingResources = () => {
            pendingCaptures.forEach(stream => stopStream(stream));
            pendingCaptures.clear();
            pendingPreparations.forEach(releasePreparation);
            pendingPreparations.clear();
        };

        const prepare = async (
            rawStream,
            request = { mode: 'browser', deviceId: 'default' }
        ) => {
            const revision = stageRevision;
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
                cancelWaiters: new Set(),
                ownsContext: !reusable,
                rawStream,
                ...captures.get(rawStream),
                request,
            };
            pendingPreparations.add(pipeline);
            const ensureCurrent = () => {
                if (pipeline.released || revision !== stageRevision)
                    throw Object.assign(new Error('superseded-audio-preparation'), { name: 'AbortError' });
            };
            const wait = (promise, ms, message) => new Promise((resolve, reject) => {
                let settled = false, timer;
                const finish = (complete, value) => {
                    if (settled) return;
                    settled = true;
                    global.clearTimeout(timer);
                    pipeline.cancelWaiters.delete(cancel);
                    complete(value);
                };
                const cancel = () => finish(reject,
                    Object.assign(new Error('superseded-audio-preparation'), { name: 'AbortError' }));
                pipeline.cancelWaiters.add(cancel);
                if (ms !== undefined)
                    timer = global.setTimeout(() => finish(reject, new Error(message)), ms);
                Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
                if (pipeline.released) cancel();
            });
            try {
                if (context.state !== 'running')
                    await wait(
                        Promise.resolve(context.resume()),
                        1500,
                        'microphone-audio-context-timeout'
                    );
                ensureCurrent();
                if (context.state !== 'running')
                    throw new Error('microphone-audio-context-not-running');
                pipeline.destination = context.createMediaStreamDestination();
                pipeline.destination.channelCount = 1;
                pipeline.stream = pipeline.destination.stream;
                pipeline.gain = createGain(
                    context,
                    Math.max(0, getGain() / 100)
                );
                if (request.mode === 'deepfilter') {
                    if (!supportsRnnoise() || context.sampleRate !== 48000)
                        throw new Error('deepfilter-unsupported');
                    // A private worklet context releases libDF's WASM heap on
                    // every switch. The shared output context/track stays live.
                    const child = pipeline.processorContext = createContext();
                    if (child.state !== 'running') await wait(Promise.resolve(child.resume()), 1500, 'deepfilter-context-timeout');
                    ensureCurrent();
                    if (child.state !== 'running' || child.sampleRate !== 48000) throw new Error('deepfilter-unsupported');
                    pipeline.modelAbort = new global.AbortController();
                    const api = await wait(loadDeepfilterLibrary(), 8000, 'deepfilter-library-timeout');
                    ensureCurrent();
                    const assets = await wait(api.loadDeepfilter({ signal: pipeline.modelAbort.signal }), 22000, 'deepfilter-load-timeout');
                    ensureCurrent();
                    await wait(child.audioWorklet.addModule(api.DEEPFILTER_ASSETS.worklet), 8000, 'deepfilter-module-timeout');
                    ensureCurrent();
                    pipeline.processor = new api.DeepfilterWorkletNode(child, assets);
                    const ready = await waitForProcessor(pipeline.processor, wait, 'deepfilter');
                    ensureCurrent();
                    if (ready.frameSamples !== 480) throw new Error('deepfilter-frame-size-invalid');
                    pipeline.engine = 'deepfilternet3-0.2.0';
                    pipeline.processorSource = child.createMediaStreamSource(rawStream);
                    const bridge = child.createMediaStreamDestination();
                    bridge.channelCount = 1;
                    pipeline.bridgeStream = bridge.stream;
                    pipeline.processorSource.connect(pipeline.processor);
                    pipeline.processor.connect(bridge);
                    pipeline.source = context.createMediaStreamSource(bridge.stream);
                    const fail = (reason) => {
                        if (pipeline.released || pipeline.processorFailed) return;
                        pipeline.processorFailed = true;
                        pipeline.processorFailureReason = reason;
                        if (active === pipeline) onProcessorFailure?.(pipeline);
                    };
                    pipeline.processor.port.onmessage = ({ data }) => {
                        if (data?.type === 'error') fail('deepfilter-processor-error');
                        if (data?.type === 'overload') fail('deepfilter-overload');
                        if (data?.type === 'load-report' && !pipeline.processorFailed) {
                            pipeline.processingLoad = { median: data.medianLoad, p95: data.p95Load, max: data.maxLoad, slowFrames: data.slowFrames };
                            if (active === pipeline) onProcessingStatus?.();
                        }
                    };
                    pipeline.processor.onprocessorerror = () => fail('deepfilter-processor-error');
                } else pipeline.source = context.createMediaStreamSource(rawStream);
                let output = pipeline.source;
                if (request.mode === 'rnnoise') {
                    if (!supportsRnnoise() || context.sampleRate !== 48000)
                        throw new Error('rnnoise-unsupported');
                    const { api, wasmBinary } = await wait(loadRnnoise());
                    ensureCurrent();
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
                    await wait(modules.get(context));
                    ensureCurrent();
                    pipeline.processor = new api.RnnoiseWorkletNode(context, {
                        wasmBinary,
                        maxChannels: 1,
                    });
                    pipeline.processor.channelCount = 1;
                    pipeline.processor.channelCountMode = 'explicit';
                    const ready = await waitForProcessor(pipeline.processor, wait);
                    ensureCurrent();
                    pipeline.engine = ready.engine || 'rnnoise-legacy-2022';
                    pipeline.engineFallback = ready.engineFallback || null;
                    pipeline.probeP95Ms = ready.probeP95Ms ?? null;
                    pipeline.speechGateSupported = ready.speechGate === true;
                    pipeline.speechGateEnabled = pipeline.speechGateSupported ? ready.speechGateEnabled === true : false;
                    pipeline.processor.port.onmessage = ({ data }) => {
                        if (data?.type !== 'speech-gate-state' || data.revision !== pipeline.speechGateRevision) return;
                        pipeline.speechGateEnabled = data.enabled === true;
                        if (active === pipeline) onProcessingStatus?.();
                    };
                    if (pipeline.speechGateSupported && !configureSpeechGate(pipeline, getSpeechGateEnabled())) {
                        throw new Error('rnnoise-speech-gate-config-failed');
                    }
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
                    ['rnnoise', 'deepfilter'].includes(request.mode)
                        ? request.mode
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
                if (request.mode === 'rnnoise' && !pipeline.released && revision === stageRevision) library = undefined;
                releasePreparation(pipeline);
                throw error;
            } finally {
                pendingPreparations.delete(pipeline);
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
            cancelPendingResources();
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
                        if (revision === stageRevision && error?.name !== 'AbortError') {
                            lastSwitchFailure = {
                                mode: normalizeMode(request.mode),
                                code: /^(rnnoise|deepfilter)-csp-blocked$/.test(error?.message)
                                    ? error.message
                                    : error?.audioProcessingFailure
                                      ? 'processor-unavailable'
                                      : 'capture-failed',
                            };
                        }
                        // Captures of one hardware source may share browser APM
                        // settings. Restore the old branch before processing the
                        // next queued request, including RNNoise startup failures.
                        if (active === baseline)
                            await restoreActiveConstraints();
                        if (revision !== stageRevision) throw aborted();
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
                (candidate.processorContext && candidate.processorContext.state !== 'running') ||
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
            if (candidate.speechGateSupported && !configureSpeechGate(candidate, getSpeechGateEnabled())) {
                throw new Error('rnnoise-speech-gate-config-failed');
            }
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
            lastSwitchFailure = null;
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
                speechGateSupported: pipeline?.speechGateSupported || false,
                engine: pipeline?.engine || null,
                engineFallback: pipeline?.engineFallback || null,
                probeP95Ms: pipeline?.probeP95Ms ?? null,
                processingLoad: pipeline?.processingLoad || null,
                speechGateEnabled: Boolean(pipeline?.processor && pipeline.speechGateEnabled),
                speechGateRequested: pipeline?.speechGateRequested,
                allSupported: info.allSupported,
                aecFallback: info.aecFallback,
                aecAcquisition: info.aecAcquisition,
                fallbackReason: info.fallbackReason,
                restoreError: info.restoreError,
                lastSwitchFailure,
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
                cancelPendingResources();
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
                releaseProcessor(pipeline);
                pipeline.processor = null;
                pipeline.processorFailed = false;
                pipeline.source = pipeline.context.createMediaStreamSource(pipeline.rawStream);
                pipeline.source.connect(pipeline.gain);
                pipeline.mode = 'off';
                pipeline.fallbackReason = pipeline.processorFailureReason || `${pipeline.request.mode}-processor-error`;
                return true;
            },
            setGain: (percent) => {
                if (active) active.gain.gain.value = Math.max(0, percent / 100);
            },
            setSpeechGate: (enabled) => configureSpeechGate(active, enabled),
        };
    };
    global.VoiceAudioProcessing = {
        createRuntime,
        constraintsFor,
        normalizeMode,
    };
})(window);
