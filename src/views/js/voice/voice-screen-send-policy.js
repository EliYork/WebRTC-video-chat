(function exposeScreenSendPolicy(global) {
    'use strict';
    const tracks = new WeakMap();
    const queues = new WeakMap();
    const originals = new WeakMap();
    const readbacks = new WeakMap();
    const finite = (value) => Number.isFinite(value) ? value : null;
    const fields = (parameters = {}) => ({
        degradationPreference: ['maintain-resolution', 'maintain-framerate', 'balanced'].includes(parameters.degradationPreference) ? parameters.degradationPreference : null,
        encodings: (parameters.encodings || []).map((encoding) => ({
            maxBitrate: finite(encoding.maxBitrate), maxFramerate: finite(encoding.maxFramerate),
            scaleResolutionDownBy: finite(encoding.scaleResolutionDownBy),
        })),
    });
    const observe = (sender, requested, metadata = {}) => {
        readbacks.set(sender, { track: sender.track, requested: fields(requested),
            path: metadata.path === 'SFU' ? 'SFU' : 'P2P',
            startBitrateKbps: finite(metadata.startBitrateKbps), status: metadata.status || 'applied' });
    };
    const getReadback = (pc) => (pc?.getSenders?.() || []).flatMap((sender) => {
        const record = readbacks.get(sender);
        if (!record || sender.track !== record.track || sender.track?.readyState === 'ended') return [];
        let applied;
        try { applied = fields(sender.getParameters()); } catch { applied = fields(); }
        const mismatches = [];
        if (record.requested.degradationPreference !== applied.degradationPreference) mismatches.push('degradationPreference');
        record.requested.encodings.forEach((encoding, index) => {
            for (const key of ['maxBitrate', 'maxFramerate', 'scaleResolutionDownBy']) {
                if (encoding[key] !== applied.encodings[index]?.[key]) mismatches.push(`encodings[${index}].${key}`);
            }
        });
        return [{ 路径: record.path, 启动码率提示_kbps: record.startBitrateKbps,
            状态: record.status, 请求: record.requested, 实际接受: applied, 不一致字段: mismatches }];
    });
    // Per outgoing video, not a server/global bandwidth reservation. Leave
    // nominal headroom on a 30 Mbps path for audio, transport and retransmits.
    // Congestion control still decides the actual rate (including for P2P).
    const SCREEN_MAX_BITRATE = 27000000;
    const register = (track, options = {}) => {
        if (track?.kind !== 'video') return;
        const game = options.mode === 'game';
        const requestedBitrate = Number(options.maxBitrate);
        tracks.set(track, {
            frameRate: options.frameRate || (game ? 60 : 30),
            maxBitrate: Number.isFinite(requestedBitrate) && requestedBitrate > 0 ? Math.min(SCREEN_MAX_BITRATE, requestedBitrate) : SCREEN_MAX_BITRATE,
            degradationPreference: 'maintain-resolution',
        });
        // Preserve desktop detail rather than preferring resolution reduction.
        try {
            track.contentHint = game ? 'motion' : 'detail';
        } catch {
            /* optional browser hint */
        }
    };
    const apply = (pc, onWarning) =>
        Promise.all(
            (pc?.getSenders?.() || []).map((sender) => {
                const task = (queues.get(sender) || Promise.resolve())
                    .then(async () => {
                        const track = sender.track;
                        const policy = tracks.get(track);
                        if (!policy && !originals.has(sender)) return;
                        if (!sender.getParameters || !sender.setParameters) {
                            if (policy) observe(sender, { degradationPreference: policy.degradationPreference,
                                encodings: [{ maxBitrate: policy.maxBitrate, maxFramerate: policy.frameRate, scaleResolutionDownBy: 1 }] }, { status: 'unsupported' });
                            return;
                        }
                        const parameters = sender.getParameters();
                        if (!parameters.encodings?.length) {
                            if (policy) observe(sender, { degradationPreference: policy.degradationPreference,
                                encodings: [{ maxBitrate: policy.maxBitrate, maxFramerate: policy.frameRate, scaleResolutionDownBy: 1 }] }, { status: 'missing-encodings' });
                            return;
                        }
                        const policyFields = (value) =>
                            JSON.stringify({
                                degradationPreference:
                                    value.degradationPreference,
                                encodings: value.encodings.map(
                                    ({
                                        maxBitrate,
                                        maxFramerate,
                                        scaleResolutionDownBy,
                                    }) => ({
                                        maxBitrate,
                                        maxFramerate,
                                        scaleResolutionDownBy,
                                    })
                                ),
                            });
                        const before = policyFields(parameters);
                        if (!originals.has(sender)) {
                            originals.set(sender, {
                                degradationPreference:
                                    parameters.degradationPreference,
                                encodings: parameters.encodings.map(
                                    ({
                                        maxBitrate,
                                        maxFramerate,
                                        scaleResolutionDownBy,
                                    }) => ({
                                        maxBitrate,
                                        maxFramerate,
                                        scaleResolutionDownBy,
                                    })
                                ),
                            });
                        }
                        if (policy) {
                            parameters.degradationPreference =
                                policy.degradationPreference;
                            parameters.encodings.forEach((encoding) => {
                                // Lower FPS must not also reduce the detail budget.
                                encoding.maxBitrate = policy.maxBitrate;
                                encoding.maxFramerate = policy.frameRate;
                                encoding.scaleResolutionDownBy = 1;
                            });
                        } else {
                            const original = originals.get(sender);
                            if (original.degradationPreference === undefined)
                                delete parameters.degradationPreference;
                            else
                                parameters.degradationPreference =
                                    original.degradationPreference;
                            parameters.encodings.forEach((encoding, index) => {
                                for (const key of [
                                    'maxBitrate',
                                    'maxFramerate',
                                    'scaleResolutionDownBy',
                                ]) {
                                    const value =
                                        original.encodings[index]?.[key];
                                    if (value === undefined)
                                        delete encoding[key];
                                    else encoding[key] = value;
                                }
                            });
                        }
                        if (
                            sender.track !== track ||
                            pc.connectionState === 'closed'
                        )
                            return;
                        // Both ICE and connection events can fire for one call.
                        // Read back actual values so renegotiation still repairs
                        // changed settings, without reconfiguring unchanged ones.
                        if (policyFields(parameters) !== before) {
                            if (policy) observe(sender, parameters, { status: 'pending' });
                            await sender.setParameters(parameters);
                        }
                        if (policy) observe(sender, parameters);
                        else { originals.delete(sender); readbacks.delete(sender); }
                    })
                    .catch((error) => {
                        const record = readbacks.get(sender);
                        if (record) record.status = 'failed';
                        onWarning?.(
                            '共享发送策略未生效，保留浏览器默认行为。',
                            error
                        );
                    });
                queues.set(sender, task);
                return task;
            })
        );
    global.VoiceScreenSendPolicy = { register, apply, observe, getReadback };
})(window);
