import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbout } from '../desktop/windows/about.cjs';

const fixture = () => {
    let release, cancelled = false;
    const calls = [];
    const state = { status: 'available', version: '0.1.7', ignoredVersion: '' };
    const win = { isDestroyed: () => false, webContents: { executeJavaScript: () => new Promise(resolve => { release = resolve; }) } };
    let owner = win;
    const show = createAbout({ app: { getVersion: () => '0.1.6', isPackaged: true },
        panels: { about: () => calls.push('about'), updatePrompt: () => calls.push('update') },
        window: () => owner, updates: () => ({ snapshot: () => state }), origin: 'https://voice.eliyork.com',
        cancelled: () => cancelled });
    return { show, state, calls, release: () => release({ webVersion: '1.0.5' }), cancel: () => { cancelled = true; }, replace: () => { owner = null; } };
};

test('startup prompt is suppressed when app closes, owner changes, or the version is ignored during metadata lookup', async () => {
    await Promise.all(['cancel', 'replace', 'ignore', 'download'].map(async reason => {
        const f = fixture(), pending = f.show({ startupPrompt: true });
        if (reason === 'cancel') f.cancel();
        if (reason === 'replace') f.replace();
        if (reason === 'ignore') f.state.ignoredVersion = f.state.version;
        if (reason === 'download') f.state.status = 'downloading';
        f.release(); await pending;
        assert.deepEqual(f.calls, []);
    }));
});

test('startup uses compact update UI while manual settings remain accessible for an ignored release', async () => {
    const f = fixture(), offered = f.show({ startupPrompt: true });
    f.release(); await offered;
    f.state.ignoredVersion = f.state.version;
    const manual = f.show(); f.release(); await manual;
    assert.deepEqual(f.calls, ['update', 'about']);
});
