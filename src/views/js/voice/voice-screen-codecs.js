(function exposeScreenCodecs(global) {
    'use strict';
    // Only validated codecs are enabled. A future codec adds its capability
    // matcher and probe here; selection and both routing adapters stay shared.
    const codecs = Object.freeze({
        h264: {
            mimeType: 'video/H264',
            autoPriority: 1,
            fallbacks: ['vp8'],
            probe: (target, options) => probeH264(target, options),
            matches: (codec) => /^video\/h264$/i.test(codec.mimeType || '') &&
                (codec.parameters?.['packetization-mode'] === 1 ||
                    /(?:^|;)\s*packetization-mode=1(?:;|$)/i.test(codec.sdpFmtpLine || '')),
        },
        vp8: { mimeType: 'video/VP8', fallbacks: [], matches: (codec) => /^video\/vp8$/i.test(codec.mimeType || '') },
    });
    const decisions = new WeakMap();
    const normalizeMode = (mode) => Object.hasOwn(codecs, mode) ? mode : 'auto';
    const candidates = (primary) => Object.hasOwn(codecs, primary) ? [primary, ...codecs[primary].fallbacks] : ['vp8'];
    const findCodec = (available, primary) => candidates(primary)
        .map((key) => available?.find(codecs[key].matches)).find(Boolean);
    const capabilities = () => {
        try { return global.RTCRtpSender?.getCapabilities?.('video')?.codecs || []; }
        catch { return []; }
    };
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
    const evaluateWindow = (before, after, target) => {
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
        const reason = !/^video\/h264$/i.test(after.codec || '') ? 'codec-mismatch' :
            after.width !== target.width || after.height !== target.height ? 'resolution-reduced' :
            captureFps < minimum ? 'probe-source-slow' : encodeFps < minimum ? 'encoder-slow' : 'passed';
        return { passed: reason === 'passed', reason,
            captureFps: Math.round(captureFps * 100) / 100,
            encodeFps: Math.round(encodeFps * 100) / 100 };
    };
    // Local loopback only: no camera/microphone permission, STUN, or server.
    // Two one-second windows at >=95% of target, without lowering dimensions.
    const probeH264 = (target, { signal } = {}) => new Promise((resolve) => {
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
            if (!global.RTCPeerConnection || !capabilities().some(codecs.h264.matches))
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
            transceiver.setCodecPreferences(capabilities().filter((codec) => codecs.h264.matches(codec) || /^video\/rtx$/i.test(codec.mimeType || '')));
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
            const windows = [evaluateWindow(baseline, first, target), evaluateWindow(first, second, target)];
            finish({ passed: windows.every((row) => row.passed),
                reason: windows.find((row) => !row.passed)?.reason || 'passed', windows });
        })().catch(() => finish({ passed: false, reason: 'probe-failed', windows: [] }));
    });
    /* eslint-disable no-await-in-loop -- Codec trials must retire before the next candidate allocates an encoder. */
    const prepare = async (track, options = {}, { signal, probe } = {}) => {
        const mode = normalizeMode(options.codecMode);
        const target = targetFor(track, options);
        let result = { passed: false, reason: 'manual-vp8', windows: [] };
        let primary = 'vp8';
        const candidateKeys = mode === 'auto'
            ? Object.keys(codecs).filter((key) => codecs[key].autoPriority).sort((a, b) => codecs[a].autoPriority - codecs[b].autoPriority)
            : [mode];
        for (const candidate of candidateKeys) {
            if (!codecs[candidate]?.probe || signal?.aborted || track.readyState === 'ended') continue;
            try { result = await (probe || codecs[candidate].probe)(target, { signal }); }
            catch { result = { passed: false, reason: 'probe-failed', windows: [] }; }
            if (mode === 'auto' ? result.passed : capabilities().some(codecs[candidate].matches)) {
                primary = candidate;
                break;
            }
        }
        const decision = { mode, primary, target, probe: result,
            reason: mode !== 'auto' && primary === mode && codecs[mode].probe ? 'manual-preference' : result.reason };
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
    global.VoiceScreenCodecs = { codecs, normalizeMode, candidates, findCodec, prepare,
        probeH264, probeSample, evaluateWindow, transformOffer, getDecision: (track) => decisions.get(track) };
})(window);
