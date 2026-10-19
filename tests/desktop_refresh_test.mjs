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

test('about shows installed/web versions and uses the existing manual updater', async () => {
    let shown, checks = 0;
    const win = { isDestroyed: () => false, webContents: {
        executeJavaScript: async () => ({ webVersion: '1.0.5' }),
    } };
    const show = createAbout({
        app: { isPackaged: true, getVersion: () => '0.1.1' },
        dialog: { showMessageBox: async (_, options) => { shown = options; return { response: 0 }; } },
        window: () => win, origin: 'https://voice.eliyork.com',
        updates: () => ({ label: () => '检查客户端更新…', check: async () => { checks++; } }),
    });
    await show();
    assert.match(shown.detail, /客户端版本：0.1.1/);
    assert.match(shown.detail, /网页版本：1.0.5/);
    assert.match(shown.detail, /https:\/\/voice.eliyork.com/);
    assert.equal(shown.defaultId, shown.cancelId);
    assert.equal(shown.buttons[shown.cancelId], '关闭');
    assert.equal(checks, 1);
});

test('preview about never invokes updates; failed web probe still opens settings', async () => {
    let shown;
    const show = createAbout({
        app: { isPackaged: false, getVersion: () => '0.1.1' },
        dialog: { showMessageBox: async (_, options) => { shown = options; return { response: 0 }; } },
        window: () => ({ isDestroyed: () => false, webContents: {
            executeJavaScript: async () => { throw Error('loading'); },
        } }),
        origin: 'http://127.0.0.1:3300',
        updates: () => ({ label: () => '', check: () => { throw Error('must not update preview'); } }),
    });
    await show();
    assert.deepEqual(shown.buttons, ['关闭']);
    assert.match(shown.detail, /本地开发预览/);
    assert.match(shown.detail, /暂时无法读取/);
});
