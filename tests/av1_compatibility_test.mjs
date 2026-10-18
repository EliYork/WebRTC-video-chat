import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const ortc = await import('../node_modules/mediasoup/node/lib/ortc.js').catch(() => null);
import * as clientOrtc from '../node_modules/mediasoup-client/lib/ortc.js';
import { screenRouterCodecs } from '../src/utils/ScreenSfuService.js';
import { sanitizeVoiceDiagnostic } from '../src/views/js/shared/voice-diagnostic-schema.js';
import { createVoiceCallSignaling } from '../src/utils/VoiceCallSignaling.js';

test('installed mediasoup and client ORTC accept AV1 + RTX and reject an incompatible mixed receiver without transcoding', { skip: !ortc && 'optional mediasoup not installed' }, () => {
    const caps = ortc.generateRouterRtpCapabilities(structuredClone(screenRouterCodecs));
    const params = { codecs: [
        { mimeType: 'video/AV1', payloadType: 96, clockRate: 90000, parameters: { profile: 0 }, rtcpFeedback: [{ type: 'nack', parameter: '' }, { type: 'nack', parameter: 'pli' }] },
        { mimeType: 'video/rtx', payloadType: 97, clockRate: 90000, parameters: { apt: 96 }, rtcpFeedback: [] },
    ], headerExtensions: [], encodings: [{ ssrc: 111111, rtx: { ssrc: 222222 }, scalabilityMode: 'L1T1' }], rtcp: { cname: 'synthetic' } };
    const mapping = ortc.getProducerRtpParametersMapping(params, caps);
    const consumable = ortc.getConsumableRtpParameters('video', params, caps, mapping);
    assert.equal(ortc.canConsume(consumable, caps), true);
    const consumer = ortc.getConsumerRtpParameters({ consumableRtpParameters: consumable, remoteRtpCapabilities: caps, pipe: false, enableRtx: true });
    assert.equal(consumer.codecs[0].mimeType, 'video/AV1');
    assert.equal(consumer.codecs[1].mimeType, 'video/rtx');
    assert.equal(consumer.codecs[1].parameters.apt, consumer.codecs[0].payloadType);
    const phone = ortc.generateRouterRtpCapabilities([{ kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }]);
    assert.equal(ortc.canConsume(consumable, phone), false);
    const extended = clientOrtc.getExtendedRtpCapabilities(caps, caps);
    assert.equal(clientOrtc.canSend('video', extended), true);
    assert.ok(clientOrtc.getRecvRtpCapabilities(extended).codecs.some((codec) => codec.mimeType === 'video/AV1'));
});

test('codec/route feedback is room/session scoped, bounded, rejects forged reasons and forwards no extra fields', () => {
    const member = (id, roomId = 'room', sharing = false) => ({ id, rooms: new Set([roomId]), data: {
        voiceRoomId: roomId, voicePeerId: id, voiceSessionGeneration: 1, voiceScreenSharing: sharing,
    }, events: [], emit(event, data) { this.events.push({ event, data }); } });
    const sharer = member('source', 'room', true);
    const viewer = member('viewer');
    const foreign = member('foreign', 'other');
    const io = { sockets: { sockets: new Map([sharer, viewer, foreign].map((row) => [row.id, row])) } };
    const signaling = createVoiceCallSignaling({ io, resolveRoomId: (value) => value });
    const feedback = { peerId: 'source', generation: 5, targetSessionGeneration: 1, voiceSessionGeneration: 1, reason: 'decoder-start-failed', sdp: 'secret', url: 'secret' };
    assert.equal(signaling.relayCodecFeedback({ ...feedback, voiceSessionGeneration: 2 }, viewer), false);
    assert.equal(signaling.relayCodecFeedback(feedback, foreign), false);
    assert.equal(signaling.relayCodecFeedback({ ...feedback, reason: 'invented' }, viewer), false);
    assert.equal(signaling.relayCodecFeedback(feedback, viewer), true);
    assert.equal(signaling.relayCodecFeedback(feedback, viewer), false, 'rate bounded');
    assert.doesNotMatch(JSON.stringify(sharer.events), /secret|url|sdp/);
    assert.equal(signaling.relayRoutePressure({ voiceSessionGeneration: 1, reason: 'sender-encoder-pressure', ip: 'secret' }, viewer), false);
    assert.equal(signaling.relayRoutePressure({ voiceSessionGeneration: 1, reason: 'sender-encoder-pressure', ip: 'secret' }, sharer), true);
    assert.equal(foreign.events.length, 0);
    assert.equal(viewer.events.at(-1).data.reason, 'sender-encoder-pressure');
    assert.doesNotMatch(JSON.stringify(viewer.events), /secret|ip/);
});

test('AV1 real codec, capability/probe and path data survive bounded diagnostic cleaning without raw identifiers', () => {
    const report = sanitizeVoiceDiagnostic({ 编码器选择: { mode: 'av1', primary: 'vp8', support: { av1Send: true, av1Receive: false },
        hardwareAcceleration: 'unknown', trials: [{ primary: 'av1', reason: 'encoder-slow', windows: [{ actualCodec: 'video/AV1', captureFps: 60, encodeFps: 35, width: 3840, height: 2160, resolutionReduced: false, deviceId: 'secret' }] }] },
        连接: [{ 实际传输路径: 'TURN', 编码协商: { requested: 'av1', actual: 'video/VP8', negotiated: 'video/VP8', reason: 'remote-codec-fallback', sdp: 'secret' } }], candidate: 'secret' });
    assert.equal(report.连接[0].编码协商.actual, 'video/VP8');
    assert.equal(report.编码器选择.trials[0].windows[0].encodeFps, 35);
    assert.doesNotMatch(JSON.stringify(report), /secret|deviceId|candidate|sdp/);
});

test('actual ICE path distinguishes direct P2P, either-side TURN and unknown without exposing addresses', () => {
    const window = {};
    vm.runInNewContext(readFileSync(new URL('../src/views/js/voice/voice-screen-codecs.js', import.meta.url), 'utf8'), { window });
    const path = window.VoiceScreenCodecs.describePath;
    const rows = [ { type: 'transport', selectedCandidatePairId: 'pair' }, { id: 'pair', localCandidateId: 'local', remoteCandidateId: 'remote' },
        { id: 'local', candidateType: 'host', address: 'secret' }, { id: 'remote', candidateType: 'srflx', address: 'secret' } ];
    assert.equal(path({}, rows), 'direct');
    rows[3].candidateType = 'relay';
    assert.equal(path({}, rows), 'TURN');
    rows[3].candidateType = 'host'; rows[2].candidateType = 'relay';
    assert.equal(path({}, rows), 'TURN');
    assert.equal(path({}, []), 'unknown');
    assert.equal(path({ screenRoute: 'SFU' }, rows), 'SFU');
});
