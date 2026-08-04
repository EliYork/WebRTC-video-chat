/**
 * ChatRateLimit
 *
 * A small sliding-window rate limiter for chat messages, keyed by socket id.
 * The limiter keeps message timestamps per key and prunes entries older than
 * the window on every call, so the map does not grow unboundedly for active
 * keys; disconnected keys should still be cleared via `clear(key)`.
 */
export const createChatRateLimiter = ({
    maxMessages = 5,
    now = Date.now,
    windowMs = 10_000,
} = {}) => {
    const timestampsByKey = new Map();

    const allow = (key) => {
        const current = now();
        const windowStart = current - windowMs;
        const timestamps = (timestampsByKey.get(key) || []).filter(
            (timestamp) => timestamp > windowStart
        );

        if (timestamps.length >= maxMessages) {
            timestampsByKey.set(key, timestamps);
            return false;
        }

        timestamps.push(current);
        timestampsByKey.set(key, timestamps);
        return true;
    };

    const clear = (key) => {
        timestampsByKey.delete(key);
    };

    return { allow, clear };
};
