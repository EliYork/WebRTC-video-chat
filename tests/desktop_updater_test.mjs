import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdates } from '../desktop/windows/updater.cjs';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
function fixture() {
    const updater = new EventEmitter(),
        check = deferred(),
        download = deferred();
    const order = [],
        states = [],
        bars = [];
    let checks = 0,
        downloads = 0,
        accepted = false;
    const token = { cancel: () => download.reject(Error('cancelled')) };
    updater.checkForUpdates = () => {
        checks++;
        return check.promise;
    };
    updater.downloadUpdate = (supplied) => {
        assert.equal(supplied, token);
        downloads++;
        return download.promise;
    };
    updater.quitAndInstall = () => order.push('install');
    const controller = createUpdates({
        updater,
        app: { getVersion: () => '0.1.3' },
        window: () => ({
            isDestroyed: () => false,
            setProgressBar: (value) => bars.push(value),
        }),
        log: () => {},
        prepareInstall: async () => order.push('media-stopped'),
        confirmInstall: async () => accepted,
    });
    controller.subscribe((state) => states.push(state));
    return {
        updater,
        controller,
        check,
        download,
        order,
        states,
        bars,
        accept: () => {
            accepted = true;
        },
        available: () => {
            updater.emit('update-available', { version: '0.1.4' });
            check.resolve({
                isUpdateAvailable: true,
                cancellationToken: token,
            });
        },
        get checks() {
            return checks;
        },
        get downloads() {
            return downloads;
        },
    };
}

test('checking and real progress are observable, operations coalesce, install requires explicit confirmation', async () => {
    const f = fixture();
    try {
        const checking = f.controller.check();
        assert.equal(f.controller.snapshot().status, 'checking');
        assert.equal(f.controller.snapshot().busy, true);
        await f.controller.check();
        assert.equal(f.checks, 1);
        f.available();
        await checking;
        assert.equal(f.downloads, 0);
        assert.equal(f.controller.snapshot().busy, false);
        const downloading = f.controller.download();
        await f.controller.download();
        assert.equal(f.downloads, 1);
        f.updater.emit('download-progress', {
            percent: 42,
            transferred: 420,
            total: 1000,
            bytesPerSecond: 100,
        });
        assert.equal(f.controller.snapshot().progress.percent, 42);
        assert.equal(f.controller.snapshot().canCancel, true);
        assert.equal(f.bars.at(-1), 0.42);
        f.updater.emit('download-progress', {
            percent: 100,
            transferred: 1000,
            total: 1000,
            bytesPerSecond: 100,
        });
        assert.equal(f.controller.snapshot().status, 'verifying');
        await f.controller.install();
        assert.deepEqual(f.order, []);
        f.updater.emit('update-downloaded', { version: '0.1.4' });
        f.download.resolve();
        await downloading;
        assert.equal(f.controller.snapshot().status, 'downloaded');
        assert.equal(f.bars.at(-1), -1);
        await f.controller.check();
        assert.equal(f.checks, 1);
        await f.controller.install();
        assert.deepEqual(f.order, []);
        assert.equal(f.controller.snapshot().status, 'downloaded');
        f.accept();
        await f.controller.install();
        assert.deepEqual(f.order, ['media-stopped', 'install']);
        assert.equal(f.controller.snapshot().status, 'installing');
        assert.equal(f.updater.autoDownload, false);
        assert.equal(f.updater.autoInstallOnAppQuit, false);
    } finally {
        f.controller.stop();
    }
});

test('cancel cannot install, retry requires a fresh check, closing subscribers does not cancel a download', async () => {
    const f = fixture();
    try {
        const checked = f.controller.check();
        f.available();
        await checked;
        const unsubscribe = f.controller.subscribe(() => {});
        const pending = f.controller.download();
        unsubscribe();
        assert.equal(f.controller.snapshot().status, 'downloading');
        f.controller.cancel();
        await pending;
        assert.equal(f.controller.snapshot().status, 'cancelled');
        f.updater.emit('update-downloaded', { version: '0.1.4' });
        assert.equal(f.controller.snapshot().status, 'cancelled');
        await f.controller.download();
        assert.equal(f.downloads, 1);
        f.accept();
        await f.controller.install();
        assert.deepEqual(f.order, []);
    } finally {
        f.controller.stop();
    }
});

test('network and digest failures surface in state without popups; stop clears progress and ignores late events', async () => {
    const f = fixture();
    const pending = f.controller.check();
    f.check.reject(Error('offline'));
    await pending;
    assert.equal(f.controller.snapshot().status, 'error');
    assert.match(f.controller.snapshot().error, /网络/);
    assert.equal(f.controller.snapshot().busy, false);
    f.controller.stop();
    const count = f.states.length;
    f.updater.emit('error', Error('late error'));
    f.updater.emit('update-available', { version: 'unexpected' });
    assert.equal(f.states.length, count);
    assert.equal(f.bars.at(-1), -1);
    const g = fixture();
    try {
        const checked = g.controller.check();
        g.available();
        await checked;
        const downloading = g.controller.download();
        g.download.reject(Error('SHA512 mismatch'));
        await downloading;
        assert.equal(g.controller.snapshot().status, 'error');
        assert.match(g.controller.snapshot().error, /校验/);
        g.accept();
        await g.controller.install();
        assert.deepEqual(g.order, []);
    } finally {
        g.controller.stop();
    }
});
