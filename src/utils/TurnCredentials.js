import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { iceServers } from './iceServers.js';
import { createChatRateLimiter } from './ChatRateLimit.js';

const validTurnUrl = value => {
    const match = /^(turns?):(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/.exec(value);
    if (!match || value.length > 512) return false;
    const [, protocol, host, port, transport] = match;
    if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
    if (protocol === 'turns' && transport === 'udp') return false;
    if (host.startsWith('[')) return isIP(host.slice(1, -1)) === 6;
    if (/^[0-9.]+$/.test(host) && isIP(host) !== 4) return false;
    return host.length <= 253 && host.split('.').every(label =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
};

// Values never appear in configuration errors: URLs and secrets may be private.
export const readTurnConfig = (env = process.env) => {
    const urlsValue = env.TURN_URLS?.trim() || '';
    const secret = env.TURN_SHARED_SECRET || '';
    if (!urlsValue && !secret) return { enabled: false };
    if (!urlsValue || secret.length < 32 || secret.length > 1024 || secret.trim() !== secret)
        throw Error('[turn] Configure TURN_URLS and a TURN_SHARED_SECRET of 32–1024 characters together');
    const urls = [...new Set(urlsValue.split(',').map(url => url.trim()))];
    if (urls.length > 8 || !urls.every(validTurnUrl)) throw Error('[turn] Invalid TURN_URLS');
    const ttlSeconds = Number(env.TURN_TTL_SECONDS?.trim() || 3600);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 600 || ttlSeconds > 86400)
        throw Error('[turn] TURN_TTL_SECONDS must be an integer from 600 to 86400');
    return { enabled: true, urls, secret, ttlSeconds };
};

export const createTurnCredentials = ({ config = readTurnConfig(), now = Date.now } = {}) => {
    const cache = new WeakMap();
    const perSocket = createChatRateLimiter({ maxMessages: 6, windowMs: 60000, now });
    const globalIssues = createChatRateLimiter({ maxMessages: 120, windowMs: 60000, now });
    const stun = () => iceServers.map(entry => ({ ...entry }));
    return {
        enabled: config.enabled,
        clear(socket) { cache.delete(socket); perSocket.clear(socket.id); },
        request(socket) {
            if (!socket?.connected) return { ok: false, reason: 'socket-disconnected' };
            if (!config.enabled) return { ok: true, turnEnabled: false, iceServers: stun(), ttlSeconds: null };
            if (!perSocket.allow(socket.id)) return { ok: false, reason: 'ice-rate-limited' };
            const seconds = Math.floor(now() / 1000);
            let entry = cache.get(socket);
            if (!entry || entry.expiresAt - seconds <= config.ttlSeconds / 2) {
                if (!globalIssues.allow('issuance')) return { ok: false, reason: 'ice-rate-limited' };
                const expiresAt = seconds + config.ttlSeconds;
                const username = `${expiresAt}:${randomBytes(16).toString('hex')}`;
                const credential = createHmac('sha1', config.secret).update(username).digest('base64');
                entry = { expiresAt, username, credential };
                cache.set(socket, entry);
            }
            return { ok: true, turnEnabled: true, ttlSeconds: entry.expiresAt - seconds,
                iceServers: [...stun(), { urls: [...config.urls], username: entry.username, credential: entry.credential }] };
        },
    };
};
