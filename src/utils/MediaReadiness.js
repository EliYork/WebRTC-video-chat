// Health output contains capability booleans only, never worker stats, user
// identifiers, internal addresses or configuration error details.
export function createMediaReadiness({ piikEnabled, piikBaseURL, screenSfu,
    sfuConfigValid = true, fetcher = fetch, timeoutMs = 1500 }) {
    return async () => {
        const snapshot = screenSfu.snapshot();
        const sfu = {
            enabled: snapshot.enabled === true,
            ready: snapshot.ready === true,
            healthy: snapshot.unhealthy !== true,
            configValid: sfuConfigValid,
        };
        let mediaReady = sfuConfigValid && (!sfu.enabled || (sfu.ready && sfu.healthy));
        if (piikEnabled) {
            try {
                mediaReady = (await fetcher(new URL('/healthz', piikBaseURL), { signal: AbortSignal.timeout(timeoutMs) })).ok === true;
            } catch { mediaReady = false; }
        }
        return { screenProvider: piikEnabled ? 'piik' : 'legacy', mediaReady, screenSfu: sfu };
    };
}
