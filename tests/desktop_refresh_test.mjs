/* eslint-disable no-await-in-loop -- Exercise independent confirmation cases sequentially. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefresh, isRefreshKey } from '../desktop/windows/refresh.cjs';
import { createAbout } from '../desktop/windows/about.cjs';

function fixture(activity) {
    let reloads = 0, confirmations = 0;
    const win = { isDestroyed: () => false, webContents: {
        executeJavaScript: async () => activity,
        reload: () => { reloads++; },
    } };
    const create = (answer, blocked) => createRefresh({ window: () => win, blocked,
        confirm: async () => { confirmations++; return answer; } });
    return { win, create, get reloads() { return reloads; }, get confirmations() { return confirmations; } };
}

test('desktop idle refresh reloads only the existing webContents', async () => {
    const f = fixture({ voice: false, sharing: false, pending: false });
    assert.equal(await f.create(false)(), true);
    assert.equal(f.confirmations, 0);
    assert.equal(f.reloads, 1);
});

test('voice, screen, pending and unknown page states require confirmation', async () => {
    for (const activity of [{ voice: true }, { sharing: true }, { pending: true }, { unknown: true }, null]) {
        const f = fixture(activity);
        assert.equal(await f.create(false)(), false);
        assert.equal(f.reloads, 0);
        assert.equal(await f.create(true)(), true);
        assert.equal(f.confirmations, 2);
        assert.equal(f.reloads, 1);
    }
});

test('failed state probe asks; picker/quit blocks; concurrent refreshes coalesce', async () => {
    const f = fixture({ voice: true });
    f.win.webContents.executeJavaScript = async () => { throw Error('renderer loading'); };
    assert.equal(await f.create(false)(), false);
    assert.equal(f.confirmations, 1);
    assert.equal(await f.create(true, () => true)(), false);
    assert.equal(f.confirmations, 1);
    const refresh = f.create(true);
    assert.deepEqual(await Promise.all([refresh(), refresh()]), [true, false]);
    assert.equal(f.reloads, 1);
});

test('Ctrl+R, forced reload and F5 use the same guard', () => {
    for (const input of [{ key: 'r', control: true }, { key: 'R', control: true, shift: true }, { key: 'F5' }])
        assert.equal(isRefreshKey({ type: 'keyDown', ...input }), true);
    for (const input of [{ key: 'r' }, { key: 'r', control: true, alt: true }, { key: 'F5', type: 'keyUp' }])
        assert.equal(isRefreshKey({ type: 'keyDown', ...input }), false);
});

test('about opens local settings with installed/web versions, without automatic download', async () => {
    let shown, selected;
    const updater = { check: () => { throw Error('opening settings must not check or download'); } };
    const win = { isDestroyed: () => false, webContents: {
        executeJavaScript: async () => ({ webVersion: '1.0.5' }),
    } };
    const show = createAbout({
        app: { isPackaged: true, getVersion: () => '0.1.1' },
        panels: { about: async (info, updates) => { shown = info; selected = updates; } },
        window: () => win, origin: 'https://voice.eliyork.com',
        updates: () => updater,
    });
    await show();
    assert.equal(shown.clientVersion, '0.1.1');
    assert.equal(shown.webVersion, '1.0.5');
    assert.equal(shown.origin, 'https://voice.eliyork.com');
    assert.equal(selected, updater);
});

test('preview about never invokes updates; failed web probe still opens settings', async () => {
    let shown, selected;
    const window = { isDestroyed: () => false, webContents: {
        executeJavaScript: async () => { throw Error('loading'); },
    } };
    const show = createAbout({
        app: { isPackaged: false, getVersion: () => '0.1.1' },
        panels: { about: async (info, updates) => { shown = info; selected = updates; } },
        window: () => window,
        origin: 'http://127.0.0.1:3300',
        updates: () => ({ label: () => '', check: () => { throw Error('must not update preview'); } }),
    });
    await show();
    assert.equal(selected, null);
    assert.equal(shown.packaged, false);
    assert.equal(shown.webVersion, '暂时无法读取');
});
