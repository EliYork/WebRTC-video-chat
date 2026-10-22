function createNativeRuntime({ launch, stopChild, changed = () => {}, log = () => {}, timeoutMs = 30000 }) {
    let child = null, port = null, state = 'idle', operation = null, stopped = false, cancelReady;
    const stopping = new WeakMap();
    function cleanup(owner) {
        if (!stopping.has(owner)) {
            const task = Promise.resolve().then(() => stopChild(owner));
            stopping.set(owner, task);
            void task.catch(() => stopping.delete(owner));
        }
        return stopping.get(owner);
    }
    const snapshot = () => ({ state, port });
    const publish = next => { state = next; changed(snapshot()); };
    function start() {
        if (stopped) return Promise.reject(Error('Native runtime stopped'));
        if (operation) return operation;
        if (state === 'ready') return Promise.resolve(snapshot());
        // Failed children must finish cleanup before another instance can bind.
        operation = (async () => {
            if (child) { await cleanup(child); child = null; }
            if (stopped) throw Error('Native runtime stopped');
            port = null;
            publish('starting');
            try {
                const owner = launch();
                child = owner;
                log(`native-start pid=${owner.pid}`);
                await new Promise((resolve, reject) => {
                    let output = '', ready = false;
                    const timer = setTimeout(() => reject(Error('原生共享组件启动超时，请重试恢复。')), timeoutMs);
                    const finish = callback => value => { clearTimeout(timer); callback(value); };
                    cancelReady = finish(reject);
                    owner.stdin.on('error', () => {});
                    owner.stderr.on('data', () => {}); // Never log capability-bearing output.
                    owner.stdout.on('data', bytes => {
                        if (ready || child !== owner || stopped) return;
                        output += bytes.toString();
                        let end;
                        while ((end = output.indexOf('\n')) >= 0) {
                            const line = output.slice(0, end); output = output.slice(end + 1);
                            if (line.length > 65536 || !line.startsWith('{')) continue;
                            try {
                                const endpoint = JSON.parse(line);
                                if (typeof endpoint.instanceToken !== 'string' || !endpoint.instanceToken ||
                                    !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) continue;
                                port = endpoint.port; ready = true; finish(resolve)(); break;
                            } catch { /* Incomplete/other structured output grants no readiness. */ }
                        }
                        if (output.length > 65536) output = '';
                    });
                    owner.on('error', finish(reject));
                    owner.on('exit', code => {
                        finish(reject)(Error('原生共享组件已退出，请重试恢复。'));
                        log(`native-exit code=${code}`);
                        if (child !== owner) return;
                        port = null;
                        if (!stopped) publish('failed');
                    });
                });
                if (stopped || owner.exitCode !== null || owner.signalCode !== null)
                    throw Error('原生共享组件已退出，请重试恢复。');
                publish('ready');
                return snapshot();
            } catch (error) {
                port = null;
                // A timed-out process cannot be left running behind a failure notice.
                if (child) {
                    try { await cleanup(child); }
                    catch { log('native-cleanup-failed'); }
                }
                if (!stopped) publish('failed');
                throw error;
            } finally { cancelReady = null; }
        })().finally(() => { operation = null; });
        return operation;
    }
    return {
        start,
        snapshot,
        get child() { return child; },
        async stop() {
            stopped = true; port = null;
            cancelReady?.(Error('Native runtime stopped'));
            if (child) await cleanup(child);
            await operation?.catch(() => {});
            publish('stopped');
        },
    };
}
module.exports = { createNativeRuntime };
