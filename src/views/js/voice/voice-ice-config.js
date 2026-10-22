(function exposeVoiceIceConfig(global) {
    'use strict';

    const clone = servers => servers.map(entry => ({ ...entry, ...(Array.isArray(entry.urls) ? { urls: [...entry.urls] } : {}) }));
    const createRuntime = ({ enabled, baseServers, request, onUpdate = () => {}, now = () => global.performance.now(), timers = global }) => {
        let generation = 0, running = false, current, inFlight, timer;
        const clearTimer = () => { timers.clearTimeout(timer); timer = undefined; };
        const schedule = delay => {
            clearTimer();
            if (running) timer = timers.setTimeout(() => { void refresh().catch(() => {}); }, delay);
        };
        const refresh = () => {
            if (!running) return Promise.reject(Error('ice-request-cancelled'));
            if (inFlight) return inFlight;
            const epoch = generation, started = now();
            const promise = Promise.resolve().then(() => {
                if (!running || epoch !== generation) throw Error('ice-request-cancelled');
                return request();
            }).then(result => {
                if (!running || epoch !== generation) throw Error('ice-request-cancelled');
                if (!result?.ok || !Array.isArray(result.iceServers) || result.iceServers.length > 32 ||
                    !result.iceServers.every(entry => entry &&
                        (typeof entry.urls === 'string' || (Array.isArray(entry.urls) && entry.urls.length > 0 && entry.urls.every(url => typeof url === 'string')))))
                    throw Error('ice-configuration-unavailable');
                const ttlMs = result.turnEnabled === false ? Infinity : result.ttlSeconds * 1000 - (now() - started);
                if (result.turnEnabled !== false && (result.turnEnabled !== true || !Number.isInteger(result.ttlSeconds) ||
                    result.ttlSeconds > 86400 || ttlMs < 15000 || !result.iceServers.some(entry =>
                        [entry.urls].flat().some(url => /^turns?:/.test(url)) && typeof entry.username === 'string' && typeof entry.credential === 'string')))
                    throw Error('ice-configuration-unavailable');
                const servers = clone(result.iceServers);
                current = { servers, validUntil: now() + ttlMs };
                onUpdate({ iceServers: clone(servers) });
                clearTimer();
                if (Number.isFinite(ttlMs)) schedule(Math.floor(ttlMs * 0.75));
                return { iceServers: clone(servers) };
            }).catch(error => {
                if (running && epoch === generation) schedule(30000);
                throw error;
            }).finally(() => { if (inFlight === promise) inFlight = undefined; });
            inFlight = promise;
            return promise;
        };
        return {
            getConfiguration() {
                if (!enabled) return { iceServers: clone(baseServers) };
                if (current && current.validUntil - now() > 10000) return { iceServers: clone(current.servers) };
                return undefined;
            },
            prepare() {
                if (!enabled) return Promise.resolve({ iceServers: clone(baseServers) });
                running = true;
                if (current && current.validUntil - now() > 10000) return Promise.resolve({ iceServers: clone(current.servers) });
                return refresh();
            },
            reconnect() { if (running) return refresh(); return Promise.resolve(); },
            stop() { running = false; generation++; current = undefined; inFlight = undefined; clearTimer(); },
        };
    };
    global.VoiceIceConfig = { createRuntime };
})(window);
