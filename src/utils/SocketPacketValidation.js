const fieldsByEvent = {
    'voice:join': {
        roomId: 'string',
        peerId: 'string',
        clientSessionEpoch: 'number',
    },
    'chat:join': { roomId: 'string', joinRequestId: 'number' },
    'chat:send': { roomId: 'string', senderName: 'string', content: 'string' },
    'presence:joinVoice': {
        senderName: 'string',
        hasMic: 'boolean',
        micPermissionDenied: 'boolean',
        muted: 'boolean',
        cameraOn: 'boolean',
    },
    'presence:update': {
        senderName: 'string',
        hasMic: 'boolean',
        micPermissionDenied: 'boolean',
        muted: 'boolean',
        cameraOn: 'boolean',
    },
    'cursor:move': {
        roomId: 'string',
        senderName: 'string',
        x: 'number',
        y: 'number',
    },
    'cursor:leave': { roomId: 'string' },
    'screen:share': { sharing: 'boolean', voiceSessionGeneration: 'number' },
    'screen:codec-feedback': { peerId: 'string', generation: 'number', reason: 'string', voiceSessionGeneration: 'number', targetSessionGeneration: 'number' },
    'screen:route-pressure': { reason: 'string', voiceSessionGeneration: 'number' },
};

// Socket middleware runs before business listeners. Reject malformed packets
// without throwing, coercing arbitrary objects or broadcasting client content.
export const validateSocketPacket = (packet, next) => {
    const [event, payload, acknowledge] = packet;
    const fields = Object.hasOwn(fieldsByEvent, event)
        ? fieldsByEvent[event]
        : undefined;
    let valid = true;
    if (fields) {
        valid = Boolean(
            payload && typeof payload === 'object' && !Array.isArray(payload)
        );
        if (valid) {
            valid = Object.entries(fields).every(
                ([key, type]) =>
                    payload[key] === undefined ||
                    (typeof payload[key] === type &&
                        (type !== 'number' || Number.isFinite(payload[key])))
            );
        }
        valid &&=
            acknowledge === undefined || typeof acknowledge === 'function';
        if (valid && event === 'chat:join' && payload.joinRequestId !== undefined)
            valid = Number.isSafeInteger(payload.joinRequestId) && payload.joinRequestId > 0;
    } else if (event === 'voice:snapshot' || event === 'voice:diagnostics:collect' || event === 'rtc:ice') {
        valid = payload === undefined || typeof payload === 'function';
    }
    if (!valid) {
        if (typeof acknowledge === 'function') {
            acknowledge({
                ok: false,
                reason: 'invalid-payload',
                error: '请求格式无效。',
            });
        }
        return;
    }
    next();
};
