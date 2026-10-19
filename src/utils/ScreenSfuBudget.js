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
    const egressBudget = Math.round(number('SFU_EGRESS_MBPS', 20, 4, 10000) * 1e6);
    const reservedEgress = Math.round(number('SFU_RESERVED_MBPS', 4, 1, 9999) * 1e6);
    const videoBitrate = Math.round(
        number('SFU_VIDEO_MBPS', 15, 1, 9999) * 1e6
    );
    const initialViewerBitrate = Math.round(
        number('SFU_INITIAL_VIEWER_MBPS', 3.5, 1, 10) * 1e6
    );
    const audioBitrate = 128000;
    const payloadBudget = Math.round(
        number('SFU_PAYLOAD_MBPS', 16, 2, 9999) * 1e6
    );
    if (payloadBudget + reservedEgress > egressBudget) throw new Error('SFU_PAYLOAD_MBPS + SFU_RESERVED_MBPS exceeds SFU_EGRESS_MBPS');
    if (videoBitrate + audioBitrate > payloadBudget) {
        throw new Error('SFU_VIDEO_MBPS exceeds SFU_PAYLOAD_MBPS');
    }
    if (initialViewerBitrate + audioBitrate > payloadBudget) throw new Error('SFU_INITIAL_VIEWER_MBPS exceeds SFU_PAYLOAD_MBPS');
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
        egressBudget,
        reservedEgress,
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
            if (!Number.isFinite(amount) || amount <= 0) return false;
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
                const allocation = amount;
                if (!Number.isFinite(allocation) || allocation <= 0 || reserved() + allocation > config.payloadBudget)
                    rejected.push(key);
                else reservations.set(key, allocation);
            }
            return rejected;
        },
        refresh(entries) {
            // Existing viewers are not evicted by an estimate. Keep the full
            // demand visible, including overcommit, and block new admission.
            reservations.clear();
            for (const { key, amount } of entries) {
                reservations.set(key, Number.isFinite(amount) && amount > 0 ? amount : perViewer);
            }
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
