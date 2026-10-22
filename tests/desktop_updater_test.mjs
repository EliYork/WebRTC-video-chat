import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdates } from '../desktop/windows/updater.cjs';
import { createUpdatePreferences } from '../desktop/windows/update-preferences.cjs';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
function fixture(options = {}) {
    const updater = new EventEmitter(),
        check = deferred(),
        download = deferred();
    const order = [],
        states = [],
        bars = [];
    let checks = 0,
        downloads = 0,
        accepted = false;
    const token = { cancel: () => { if (downloads) download.reject(Error('cancelled')); } };
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
        ...options,
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

test('startup offers a new version once, after checking ends, without downloading; scheduled checks stay quiet', async () => {
    const callbacks = {}, cleared = [], offers = [];
    const f = fixture({
        timers: { setTimeout: (fn, ms) => { callbacks.startup = fn; assert.equal(ms, 3000); return 1; },
            setInterval: fn => { callbacks.periodic = fn; return 2; },
            clearTimeout: id => cleared.push(id), clearInterval: id => cleared.push(id) },
        onStartupUpdate: state => offers.push(state),
    });
    callbacks.startup(); f.available();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(offers.length, 1);
    assert.equal(offers[0].busy, false);
    assert.equal(f.downloads, 0);
    await f.controller.check({ startup: true });
    callbacks.periodic();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(offers.length, 1);
    f.controller.stop();
    assert.deepEqual(cleared, [1, 2]);
});

test('ignoring a version persists across launches, keeps manual updates available, and allows a later release', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'voice-update-ignore-')), 'updates.json');
    const preferences = createUpdatePreferences(file), offers = [];
    const f = fixture({ preferences, onStartupUpdate: state => offers.push(state.version) });
    const checked = f.controller.check({ startup: true }); f.available(); await checked;
    assert.equal(f.controller.ignoreVersion('stale-version'), false);
    assert.equal(f.controller.ignoreVersion('0.1.4'), true);
    f.controller.stop();
    assert.equal(JSON.parse(readFileSync(file)).ignoredVersion, '0.1.4');
    const g = fixture({ preferences: createUpdatePreferences(file), onStartupUpdate: state => offers.push(state.version) });
    try {
        const check = g.controller.check({ startup: true }); g.available(); await check;
        assert.deepEqual(offers, ['0.1.4']);
        assert.equal(g.controller.snapshot().status, 'available');
        g.updater.emit('update-available', { version: '0.1.5' });
        await g.controller.check({ startup: true });
        assert.deepEqual(offers, ['0.1.4', '0.1.5']);
        const download = g.controller.download(); g.download.resolve(); await download;
        assert.equal(g.downloads, 1);
    } finally { g.controller.stop(); }
});

test('current/offline/stopped startup checks do not open update UI', async () => {
    await Promise.all(['current', 'offline', 'stopped'].map(async scenario => {
        let offered = false;
        const f = fixture({ onStartupUpdate: () => { offered = true; } });
        const check = f.controller.check({ startup: true });
        if (scenario === 'current') {
            f.updater.emit('update-not-available'); f.check.resolve({ isUpdateAvailable: false });
        } else if (scenario === 'offline') f.check.reject(Error('offline'));
        else { f.controller.stop(); f.available(); }
        await check;
        assert.equal(offered, false);
        f.controller.stop();
    }));
});

test('corrupt preferences fall back safely; failed persistence must not claim that a version was ignored', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-update-prefs-')), file = join(dir, 'prefs.json');
    writeFileSync(file, '{broken');
    assert.equal(createUpdatePreferences(file).getIgnoredVersion(), '');
    const blocked = join(dir, 'not-a-file'); mkdirSync(blocked);
    const preferences = createUpdatePreferences(blocked);
    assert.throws(() => preferences.setIgnoredVersion('0.1.4'));
    assert.equal(preferences.getIgnoredVersion(), '');
    assert.throws(() => preferences.setIgnoredVersion('../oops'));
});
