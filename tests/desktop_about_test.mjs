import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbout } from '../desktop/windows/about.cjs';

const fixture = () => {
    let release, cancelled = false;
    const calls = [];
    const service = {};
    const win = {
        isDestroyed: () => false,
        webContents: { executeJavaScript: () => new Promise(resolve => { release = resolve; }) },
    };
    let owner = win;
    const show = createAbout({
        app: { getVersion: () => '0.1.8', isPackaged: true },
        panels: { about: (info, updates) => calls.push({ info, updates }) },
        window: () => owner,
        updates: () => service,
        origin: 'https://voice.eliyork.com',
        cancelled: () => cancelled,
    });
    return { show, service, calls, release: () => release({ webVersion: '1.0.6' }),
        cancel: () => { cancelled = true; }, replace: () => { owner = null; } };
};

test('about does not reopen if the client closes or the owner changes during metadata lookup', async () => {
    await Promise.all(['cancel', 'replace'].map(async reason => {
        const f = fixture();
        const pending = f.show();
        f[reason]();
        f.release();
        await pending;
        assert.deepEqual(f.calls, []);
    }));
});

test('about exposes metadata and the same update service when explicitly opened', async () => {
    const f = fixture();
    const pending = f.show();
    f.release();
    await pending;
    assert.deepEqual(f.calls, [{
        info: { clientVersion: '0.1.8', webVersion: '1.0.6', origin: 'https://voice.eliyork.com', packaged: true },
        updates: f.service,
    }]);
});
