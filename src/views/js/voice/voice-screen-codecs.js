(function exposeScreenCodecs(global) {
    'use strict';
    // AV1 is opt-in. Auto retains the measured H.264 -> VP8 policy.
    const codecs = Object.freeze({
        av1: {
            mimeType: 'video/AV1', fallbacks: ['h264', 'vp8'],
            probe: (target, options) => measuredCodec('av1', target, options),
            matches: (codec) => /^video\/AV1$/i.test(codec.mimeType || '') &&
                Number(codec.parameters?.profile ?? /(?:^|;)\s*profile=(\d+)/.exec(codec.sdpFmtpLine || '')?.[1] ?? 0) === 0,
        },
        h264: {
            mimeType: 'video/H264',
            autoPriority: 1,
            fallbacks: ['vp8'],
            probe: (target, options) => measuredH264(target, options),
            matches: (codec) => /^video\/h264$/i.test(codec.mimeType || '') &&
                (codec.parameters?.['packetization-mode'] === 1 ||
                    /(?:^|;)\s*packetization-mode=1(?:;|$)/i.test(codec.sdpFmtpLine || '')),
        },
        vp8: { mimeType: 'video/VP8', fallbacks: [], matches: (codec) => /^video\/vp8$/i.test(codec.mimeType || '') },
    });
    const decisions = new WeakMap();
    const probeCache = new Map();
    const measuredH264 = (target, options) => measuredCodec('h264', target, options);
    const measuredCodec = async (primary, target, options) => {
        const key = `${primary}:${target.width}x${target.height}@${target.frameRate}`;
        const cached = probeCache.get(key);
        const age = cached ? Date.now() - cached.time : Infinity;
        if (age >= 0 && age < 30000 && !options?.signal?.aborted)
            return { ...cached.result, windows: cached.result.windows.map((row) => ({ ...row })), cacheHit: true, ageMs: age };
        const result = await probeCodec(primary, target, options);
        if (!options?.signal?.aborted && result.windows?.length === 2 &&
            result.windows.every((row) => Number.isFinite(row.captureFps) && Number.isFinite(row.encodeFps))) {
            if (probeCache.size >= 8) probeCache.delete(probeCache.keys().next().value);
            probeCache.set(key, { time: Date.now(), result });
        }
        return result;
    };
    const normalizeMode = (mode) => Object.hasOwn(codecs, mode) ? mode : 'auto';
    const candidates = (primary) => Object.hasOwn(codecs, primary) ? [primary, ...codecs[primary].fallbacks] : ['vp8'];
    const findCodec = (available, primary) => candidates(primary)
        .map((key) => available?.find(codecs[key].matches)).find(Boolean);
    const capabilities = () => {
        try { return global.RTCRtpSender?.getCapabilities?.('video')?.codecs || []; }
        catch { return []; }
    };
    const receiverCapabilities = () => {
        try { return global.RTCRtpReceiver?.getCapabilities?.('video')?.codecs; }
        catch { return undefined; }
    };
    const support = () => ({
        av1Send: capabilities().some(codecs.av1.matches),
        av1Receive: receiverCapabilities() ? receiverCapabilities().some(codecs.av1.matches) : null,
    });
    const targetFor = (track, options) => {
        const settings = track.getSettings?.() || {};
        return {
            width: Math.round(settings.width || 1920),
            height: Math.round(settings.height || 1080),
            frameRate: [15, 30, 60].includes(Number(options.frameRate)) ? Number(options.frameRate) : 60,
        };
    };
    const probeSample = (reports) => {
        const rows = [...reports.values()];
        const output = rows.find((row) => row.type === 'outbound-rtp' &&
            (row.kind === 'video' || row.mediaType === 'video') && !row.isRemote);
        const source = rows.find((row) => row.id === output?.mediaSourceId);
        const codec = rows.find((row) => row.id === output?.codecId);
        return output ? {
            id: output.id, sourceId: source?.id, timestamp: output.timestamp,
            encoded: output.framesEncoded, captured: source?.frames,
            width: output.frameWidth, height: output.frameHeight,
            codec: codec?.mimeType,
        } : null;
    };
    const evaluateWindow = (before, after, target, primary = 'h264') => {
        if (!before || !after || before.id !== after.id || before.sourceId !== after.sourceId ||
            !before.sourceId || !Number.isFinite(after.timestamp) || after.timestamp <= before.timestamp ||
            ![before.encoded, after.encoded, before.captured, after.captured].every(Number.isFinite) ||
            after.encoded < before.encoded || after.captured < before.captured)
            return { passed: false, reason: 'missing-stats', captureFps: null, encodeFps: null };
        const seconds = (after.timestamp - before.timestamp) / 1000;
        if (seconds < 0.9 || seconds > 1.5)
            return { passed: false, reason: 'missing-stats', captureFps: null, encodeFps: null };
        const captureFps = (after.captured - before.captured) / seconds;
        const encodeFps = (after.encoded - before.encoded) / seconds;
        const minimum = target.frameRate * 0.95;
        const reason = !codecs[primary]?.matches({ mimeType: after.codec, parameters: { 'packetization-mode': 1 } }) ? 'codec-mismatch' :
            after.width !== target.width || after.height !== target.height ? 'resolution-reduced' :
            captureFps < minimum ? 'probe-source-slow' : encodeFps < minimum ? 'encoder-slow' : 'passed';
        return { passed: reason === 'passed', reason,
            captureFps: Math.round(captureFps * 100) / 100,
            encodeFps: Math.round(encodeFps * 100) / 100,
            actualCodec: after.codec, width: after.width, height: after.height,
            resolutionReduced: after.width !== target.width || after.height !== target.height };
    };
    // Local loopback only: no camera/microphone permission, STUN, or server.
    // Two one-second windows at >=95% of target, without lowering dimensions.
    const probeH264 = (target, options) => probeCodec('h264', target, options);
    const probeCodec = (primary, target, { signal } = {}) => new Promise((resolve) => {
        let finished = false;
        let send;
        let receive;
        let stream;
        let frameTimer;
        let deadline;
        const waits = new Map();
        const finish = (result) => {
            if (finished) return;
            finished = true;
            global.clearTimeout(deadline);
            global.clearInterval(frameTimer);
            waits.forEach((resume, timer) => { global.clearTimeout(timer); resume(); });
            waits.clear();
            signal?.removeEventListener('abort', aborted);
            for (const pc of [send, receive]) {
                if (!pc) continue;
                pc.onicecandidate = null;
                try { pc.close(); } catch { /* already closed */ }
            }
            stream?.getTracks?.().forEach((track) => track.stop());
            resolve(result);
        };
        const aborted = () => finish({ passed: false, reason: 'cancelled', windows: [] });
        const alive = () => { if (finished) throw new Error('retired-probe'); };
        const wait = (ms) => new Promise((resume) => {
            const timer = global.setTimeout(() => { waits.delete(timer); resume(); }, ms);
            waits.set(timer, resume);
        });
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) { aborted(); return; }
        deadline = global.setTimeout(() => finish({ passed: false, reason: 'timeout', windows: [] }), 6500);
        void (async () => {
            if (!global.RTCPeerConnection || !capabilities().some(codecs[primary].matches) ||
                (receiverCapabilities() && !receiverCapabilities().some(codecs[primary].matches)))
                return finish({ passed: false, reason: 'unsupported', windows: [] });
            if (target.width <= 0 || target.height <= 0 || target.width * target.height > 3840 * 2160)
                return finish({ passed: false, reason: 'probe-size-unsupported', windows: [] });
            const canvas = global.document.createElement('canvas');
            canvas.width = target.width;
            canvas.height = target.height;
            const context = canvas.getContext('2d', { alpha: false });
            if (!context || !canvas.captureStream) return finish({ passed: false, reason: 'unsupported', windows: [] });
            stream = canvas.captureStream(0);
            const track = stream.getVideoTracks()[0];
            if (!track?.requestFrame) return finish({ passed: false, reason: 'unsupported', windows: [] });
            track.contentHint = 'motion';
            let frame = 0;
            const draw = () => {
                context.fillStyle = '#162232';
                context.fillRect(0, 0, canvas.width, canvas.height);
                for (let index = 0; index < 48; index++) {
                    context.fillStyle = `hsl(${(index * 37 + frame * 3) % 360} 70% 55%)`;
                    context.fillRect((index * 113 + frame * 13) % canvas.width,
                        (index * 79 + frame * 7) % canvas.height, canvas.width / 10, canvas.height / 10);
                }
                frame++;
                track.requestFrame();
            };
            send = new global.RTCPeerConnection({ iceServers: [] });
            receive = new global.RTCPeerConnection({ iceServers: [] });
            const pending = new Map([[send, []], [receive, []]]);
            const link = (from, to) => { from.onicecandidate = ({ candidate }) => {
                if (!candidate || finished) return;
                if (!to.remoteDescription) pending.get(to).push(candidate);
                else void to.addIceCandidate(candidate).catch(() => {});
            }; };
            link(send, receive);
            link(receive, send);
            const transceiver = send.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
            if (!transceiver.setCodecPreferences) return finish({ passed: false, reason: 'unsupported', windows: [] });
            transceiver.setCodecPreferences(capabilities().filter((codec) => codecs[primary].matches(codec) || /^video\/rtx$/i.test(codec.mimeType || '')));
            await send.setLocalDescription(await send.createOffer()); alive();
            await receive.setRemoteDescription(send.localDescription); alive();
            await Promise.all(pending.get(receive).splice(0).map((candidate) => receive.addIceCandidate(candidate))); alive();
            await receive.setLocalDescription(await receive.createAnswer()); alive();
            await send.setRemoteDescription(receive.localDescription); alive();
            await Promise.all(pending.get(send).splice(0).map((candidate) => send.addIceCandidate(candidate))); alive();
            const parameters = transceiver.sender.getParameters();
            if (!parameters.encodings?.length) return finish({ passed: false, reason: 'missing-parameters', windows: [] });
            parameters.degradationPreference = 'maintain-resolution';
            parameters.encodings.forEach((encoding) => {
                encoding.maxBitrate = 27000000;
                encoding.maxFramerate = target.frameRate;
                encoding.scaleResolutionDownBy = 1;
            });
            await transceiver.sender.setParameters(parameters); alive();
            frameTimer = global.setInterval(draw, 1000 / target.frameRate);
            draw();
            await wait(700); alive();
            const baseline = probeSample(await send.getStats()); alive();
            await wait(1000); alive();
            const first = probeSample(await send.getStats()); alive();
            await wait(1000); alive();
            const second = probeSample(await send.getStats()); alive();
            const windows = [evaluateWindow(baseline, first, target, primary), evaluateWindow(first, second, target, primary)];
            finish({ passed: windows.every((row) => row.passed),
                reason: windows.find((row) => !row.passed)?.reason || 'passed', windows });
        })().catch(() => finish({ passed: false, reason: 'probe-failed', windows: [] }));
    });
    /* eslint-disable no-await-in-loop -- Codec trials must retire before the next candidate allocates an encoder. */
    const prepare = async (track, options = {}, { signal, probe } = {}) => {
        const startedAt = Date.now();
        const mode = normalizeMode(options.codecMode);
        const target = targetFor(track, options);
        let result = { passed: false, reason: 'manual-vp8', windows: [] };
        let primary = 'vp8';
        const trials = [];
        const candidateKeys = mode === 'auto'
            ? Object.keys(codecs).filter((key) => codecs[key].autoPriority).sort((a, b) => codecs[a].autoPriority - codecs[b].autoPriority)
            : mode === 'av1' ? ['av1', 'h264'] : [mode];
        for (const candidate of candidateKeys) {
            if (!codecs[candidate]?.probe || signal?.aborted || track.readyState === 'ended') continue;
            // A failed AV1 trial has already consumed the startup budget. Keep
            // H.264 as a compatibility preference; never allocate two long probes.
            if (candidate === 'h264' && trials.some((trial) => trial.primary === 'av1' && trial.reason !== 'unsupported')) {
                result = { passed: false, reason: 'compatibility-fallback', windows: [] };
            } else try { result = await (probe || codecs[candidate].probe)(target, { signal, primary: candidate }); }
            catch { result = { passed: false, reason: 'probe-failed', windows: [] }; }
            trials.push({ primary: candidate, ...result });
            // Explicit AV1 experiments may miss the requested cadence while
            // still encoding valid full-size video. Keep the measured failure
            // visible; actual offer/answer and frame startup remain mandatory.
            const av1Trial = result.passed || (['probe-source-slow', 'encoder-slow'].includes(result.reason) && result.windows?.length === 2 &&
                result.windows.every((row) => row.captureFps > 0 && row.encodeFps > 0 && row.actualCodec === 'video/AV1' &&
                    row.width === target.width && row.height === target.height && row.resolutionReduced === false));
            if (mode === 'auto' ? result.passed : capabilities().some(codecs[candidate].matches) && (candidate === 'av1' ? av1Trial : true)) {
                primary = candidate;
                break;
            }
        }
        const decision = { mode, primary, target, probe: result, trials, support: support(), hardwareAcceleration: 'unknown', preparationMs: Date.now() - startedAt,
            reason: mode === 'av1' && primary === 'av1' && !result.passed ? 'manual-av1-below-target' :
                mode !== 'auto' && primary === mode && codecs[mode].probe ? 'manual-preference' : result.reason };
        if (!signal?.aborted && track.readyState !== 'ended') decisions.set(track, decision);
        return decision;
    };
    /* eslint-enable no-await-in-loop */
    // PeerJS generates its first offer before returning the call. Its supported
    // SDP transform is therefore the negotiation boundary, rather than a late
    // setCodecPreferences call. Retain only matching RTX; leave audio untouched.
    const transformOffer = (sdp, primary) => {
        if (!Object.hasOwn(codecs, primary) || typeof sdp !== 'string') return sdp;
        const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
        const sections = sdp.split(/(?=^m=)/m);
        return sections.map((section) => {
            if (!section.startsWith('m=video ')) return section;
            const lines = section.split(/\r?\n/);
            const fields = lines[0].split(/\s+/);
            const payloads = fields.slice(3);
            const formats = new Map();
            const repair = new Map();
            lines.forEach((line) => {
                const format = /^a=rtpmap:(\d+) ([^/]+)/.exec(line);
                if (format) formats.set(format[1], `video/${format[2]}`);
                const apt = /^a=fmtp:(\d+) .*\bapt=(\d+)/.exec(line);
                if (apt) repair.set(apt[1], apt[2]);
            });
            const selected = candidates(primary).flatMap((key) => payloads.filter((payload) =>
                codecs[key].matches({ mimeType: formats.get(payload),
                    sdpFmtpLine: lines.find((line) => line.startsWith(`a=fmtp:${payload} `))?.split(' ').slice(1).join(' ') || '' })));
            if (!selected.length) return section;
            const retained = [...selected, ...payloads.filter((payload) =>
                /^video\/rtx$/i.test(formats.get(payload) || '') && selected.includes(repair.get(payload)))];
            lines[0] = [...fields.slice(0, 3), ...retained].join(' ');
            return lines.filter((line) => {
                const attribute = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)(?:\s|$)/.exec(line);
                return !attribute || retained.includes(attribute[1]);
            }).join(newline);
        }).join('');
    };
    const connections = new WeakMap();
    const describePath = (pc, reports) => {
        if (pc?.screenRoute === 'SFU') return 'SFU';
        const rows = Array.from(reports?.values?.() || reports || []);
        const transport = rows.find((row) => row.type === 'transport' && row.selectedCandidatePairId);
        const pair = rows.find((row) => row.id === transport?.selectedCandidatePairId) ||
            rows.find((row) => row.type === 'candidate-pair' && row.state === 'succeeded' && (row.nominated || row.selected));
        const local = rows.find((row) => row.id === pair?.localCandidateId);
        const remote = rows.find((row) => row.id === pair?.remoteCandidateId);
        if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') return 'TURN';
        return local?.candidateType && remote?.candidateType ? 'direct' : 'unknown';
    };
    const negotiatedCodec = (pc, sending) => {
        const sdp = (sending ? pc.remoteDescription : pc.localDescription)?.sdp;
        const section = sdp?.split(/(?=^m=)/m).find((item) => item.startsWith('m=video ') && !item.startsWith('m=video 0 '));
        if (!section) return null;
        for (const pt of section.split(/\r?\n/)[0].split(/\s+/).slice(3)) {
            const name = new RegExp(`^a=rtpmap:${pt} (AV1|H264|VP8)/`, 'im').exec(section)?.[1];
            if (name) return `video/${name.toUpperCase() === 'H264' ? 'H264' : name.toUpperCase()}`;
        }
        return null;
    };
    const registerConnection = (pc, options) => {
        if (!pc) return;
        connections.set(pc, { ...options, startedAt: Date.now(), ready: false, status: 'waiting-negotiation', reason: options.fallbackReason || null });
    };
    const markConnected = (pc) => {
        const state = connections.get(pc);
        if (state && !state.connectedAt) state.connectedAt = Date.now();
    };
    const failConnection = (pc, reason) => {
        const state = connections.get(pc);
        if (!state || state.retired || !state.isCurrent?.() || state.failed) return false;
        state.failed = true;
        state.status = 'fallback-requested';
        state.reason = reason;
        state.onFallback?.(reason);
        return true;
    };
    // Called by existing diagnostic/quality samples. No additional getStats loop.
    const observeConnection = (pc, reports) => {
        const state = connections.get(pc);
        if (!state || state.retired || !state.isCurrent?.() || state.failed) return;
        if (['connected', 'completed'].includes(pc.connectionState) || ['connected', 'completed'].includes(pc.iceConnectionState)) markConnected(pc);
        const rows = Array.from(reports?.values?.() || reports || []);
        const output = rows.find((row) => row.type === (state.sending ? 'outbound-rtp' : 'inbound-rtp') &&
            (row.kind === 'video' || row.mediaType === 'video') && !row.isRemote);
        const mime = rows.find((row) => row.id === output?.codecId)?.mimeType;
        state.negotiated = negotiatedCodec(pc, state.sending);
        const remoteVideo = pc.remoteDescription?.sdp?.split(/(?=^m=)/m).find((item) => item.startsWith('m=video ') && !item.startsWith('m=video 0 '));
        // SDP reflects this negotiation, not the peer's complete decoder capabilities.
        state.remoteSdpAV1 = remoteVideo ? /^a=rtpmap:\d+ AV1\/90000\s*$/im.test(remoteVideo) : null;
        state.actual = /^video\/(AV1|H264|VP8)$/i.test(mime || '') ? mime : null;
        if (!state.fallbackReason && state.primary === 'av1' && state.actual && !/^video\/AV1$/i.test(state.actual)) state.reason = 'remote-codec-fallback';
        const count = output?.[state.sending ? 'framesEncoded' : 'framesDecoded'];
        if (count > 0) { state.ready = true; state.status = 'frames-verified'; }
        else if (state.connectedAt) state.status = 'waiting-frames';
        if (state.connectedAt && !state.ready && Date.now() - state.connectedAt >= 8000)
            failConnection(pc, state.sending ? 'encoder-start-failed' : 'decoder-start-failed');
    };
    const getConnectionState = (pc) => {
        const state = connections.get(pc);
        return state ? { requested: state.requested, primary: state.primary, negotiated: state.negotiated || null,
            actual: state.actual || null, remoteSdpAV1: state.remoteSdpAV1 ?? null, status: state.status, reason: state.reason, hardwareAcceleration: 'unknown' } : null;
    };
    const retireConnection = (pc) => { const state = connections.get(pc); if (state) state.retired = true; };
    global.VoiceScreenCodecs = { codecs, normalizeMode, candidates, findCodec, prepare, support,
        registerConnection, markConnected, observeConnection, failConnection, getConnectionState, retireConnection, describePath,
        probeH264, probeSample, evaluateWindow, transformOffer, getDecision: (track) => decisions.get(track) };
})(window);
