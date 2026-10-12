// Reserve payload capacity globally, across every channel. Transport limits
// include some retransmission headroom; this is not an OS traffic shaper.
export const readScreenSfuConfig = (env = process.env) => {
    const number = (key, fallback, min, max) => {
        const value = env[key] === undefined ? fallback : Number(env[key]);
        if (!Number.isFinite(value) || value < min || value > max) {
            throw new Error(`Invalid ${key}`);
        }
        return value;
    };
    const videoBitrate = Math.round(
        number('SFU_VIDEO_MBPS', 22, 1, 22.5) * 1e6
    );
    const initialViewerBitrate = Math.round(
        number('SFU_INITIAL_VIEWER_MBPS', 5.5, 1, 10) * 1e6
    );
    const audioBitrate = 128000;
    const payloadBudget = Math.round(
        number('SFU_PAYLOAD_MBPS', 23, 2, 24) * 1e6
    );
    if (videoBitrate + audioBitrate > payloadBudget) {
        throw new Error('SFU_VIDEO_MBPS exceeds SFU_PAYLOAD_MBPS');
    }
    const port = number('SFU_PORT', 44444, 1024, 65535);
    if (!Number.isInteger(port)) throw new Error('Invalid SFU_PORT');
    return {
        enabled:
            env.SFU_ENABLED !== 'false' && Boolean(env.SFU_ANNOUNCED_ADDRESS),
        announcedAddress: env.SFU_ANNOUNCED_ADDRESS,
        listenIp: env.SFU_LISTEN_IP || '0.0.0.0',
        port,
        videoBitrate,
        initialViewerBitrate,
        audioBitrate,
        payloadBudget,
        ingressBudget: 40000000,
        maxPublishers: 2,
        maxClients: 24,
        maxMemoryBytes:
            number('SFU_MEMORY_LIMIT_MB', 700, 128, 4096) * 1024 * 1024,
        minFreeBytes: 128 * 1024 * 1024,
        maxCpuPercent: number('SFU_CPU_LIMIT_PERCENT', 85, 20, 100),
    };
};

export const createScreenSfuBudget = (config) => {
    const reservations = new Map();
    const perViewer = config.initialViewerBitrate + config.audioBitrate;
    const reserved = () =>
        [...reservations.values()].reduce((total, amount) => total + amount, 0);
    return {
        reserve(key, amount = perViewer) {
            if (reservations.has(key)) return true;
            if (reserved() + amount > config.payloadBudget) return false;
            reservations.set(key, amount);
            return true;
        },
        rebalance(entries) {
            // Entries arrive in viewing order. Never average away an older
            // receiver's allocation to make room for a later receiver.
            reservations.clear();
            const rejected = [];
            for (const { key, amount } of entries) {
                const allocation = Math.min(config.payloadBudget, amount);
                if (reserved() + allocation > config.payloadBudget)
                    rejected.push(key);
                else reservations.set(key, allocation);
            }
            return rejected;
        },
        release: (key) => reservations.delete(key),
        clear: () => reservations.clear(),
        snapshot: () => ({
            viewers: reservations.size,
            reservedBps: reserved(),
            payloadBudgetBps: config.payloadBudget,
        }),
    };
};
