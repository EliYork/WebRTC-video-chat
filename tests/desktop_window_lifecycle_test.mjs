import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWindowPreferences } from '../desktop/windows/window-preferences.cjs';
import { createWindowLifecycle } from '../desktop/windows/window-lifecycle.cjs';

function fixture({
    behavior = 'ask',
    failTray = false,
    writeFails = false,
} = {}) {
    const events = [],
        win = new EventEmitter();
    let quitting = false,
        saved = behavior,
        resolveChoice,
        tray;
    Object.assign(win, {
        isDestroyed: () => false,
        isMinimized: () => true,
        restore: () => events.push('restore'),
        show: () => events.push('show'),
        focus: () => events.push('focus'),
        hide: () => events.push('hide'),
    });
    class FakeTray extends EventEmitter {
        constructor() {
            super();
            if (failTray) throw Error('unavailable');
            tray = this;
        }
        setToolTip(text) {
            this.tooltip = text;
        }
        setContextMenu(menu) {
            this.menu = menu;
        }
        destroy() {
            events.push('destroy-tray');
        }
    }
    const prefs = {
        snapshot: () => ({ closeBehavior: saved }),
        setCloseBehavior(value) {
            if (writeFails) throw Error('read-only');
            saved = value;
        },
    };
    const lifecycle = createWindowLifecycle({
        window: win,
        Tray: FakeTray,
        Menu: { buildFromTemplate: (x) => x },
        icon: {},
        preferences: prefs,
        panels: {
            chooseClose: (options) => {
                events.push(options);
                return new Promise((resolve) => {
                    resolveChoice = resolve;
                });
            },
            close: () => events.push('close-panels'),
        },
        showSettings: () => events.push('settings'),
        quit: () => {
            quitting = true;
            events.push('quit');
        },
        isQuitting: () => quitting,
        beforeHide: () => events.push('close-picker'),
    });
    return {
        win,
        lifecycle,
        events,
        prefs,
        get tray() {
            return tray;
        },
        answer: (value) => resolveChoice(value),
        setQuitting: () => {
            quitting = true;
        },
    };
}

test('window preferences default safely, persist across instances, reject invalid values', () => {
    const file = join(
        mkdtempSync(join(tmpdir(), 'voice-window-pref-')),
        'preferences.json'
    );
    const prefs = createWindowPreferences(file);
    assert.equal(prefs.snapshot().closeBehavior, 'ask');
    prefs.setCloseBehavior('tray');
    assert.equal(
        createWindowPreferences(file).snapshot().closeBehavior,
        'tray'
    );
    prefs.setCloseBehavior('quit');
    assert.equal(JSON.parse(readFileSync(file)).closeBehavior, 'quit');
    assert.throws(() => prefs.setCloseBehavior('arbitrary'));
    assert.equal(prefs.snapshot().closeBehavior, 'quit');
    writeFileSync(file, '{malformed');
    assert.equal(createWindowPreferences(file).snapshot().closeBehavior, 'ask');
    writeFileSync(file, '{"closeBehavior":"surprise"}');
    assert.equal(createWindowPreferences(file).snapshot().closeBehavior, 'ask');
});

test('failed preference write never claims success', () => {
    const directory = mkdtempSync(join(tmpdir(), 'voice-window-pref-failure-'));
    const file = join(directory, 'not-a-directory');
    writeFileSync(file, 'file');
    const prefs = createWindowPreferences(join(file, 'preferences.json'));
    assert.throws(() => prefs.setCloseBehavior('tray'));
    assert.equal(prefs.snapshot().closeBehavior, 'ask');
});

test('close choice coalesces, cancellation preserves window and does not remember', async () => {
    const f = fixture();
    const operation = f.lifecycle.requestClose();
    await f.lifecycle.requestClose();
    assert.equal(f.events.length, 1);
    f.answer({ action: 'cancel', remember: true });
    await operation;
    assert.equal(f.events.length, 1);
    assert.equal(f.prefs.snapshot().closeBehavior, 'ask');
});

test('remembered tray close hides only after closing auxiliary windows; restore reuses window', async () => {
    const f = fixture();
    const operation = f.lifecycle.requestClose();
    f.answer({ action: 'tray', remember: true });
    await operation;
    assert.equal(f.prefs.snapshot().closeBehavior, 'tray');
    assert.deepEqual(f.events.slice(1), [
        'close-picker',
        'close-panels',
        'hide',
    ]);
    f.tray.emit('click');
    assert.deepEqual(f.events.slice(-3), ['restore', 'show', 'focus']);
    await f.lifecycle.requestClose();
    assert.equal(f.events.filter((x) => typeof x === 'object').length, 1);
    // Same settings object can return to asking on next close.
    f.prefs.setCloseBehavior('ask');
    const next = f.lifecycle.requestClose();
    f.answer({ action: 'quit', remember: false });
    await next;
    assert.equal(f.events.at(-1), 'quit');
    assert.equal(f.prefs.snapshot().closeBehavior, 'ask');
});

test('remember quit and explicit quit use application cleanup, bypass further close prompts', async () => {
    const f = fixture();
    const operation = f.lifecycle.requestClose();
    f.answer({ action: 'quit', remember: true });
    await operation;
    assert.equal(f.prefs.snapshot().closeBehavior, 'quit');
    assert.equal(f.events.at(-1), 'quit');
    f.win.emit('close', {
        preventDefault: () => assert.fail('quit must not be intercepted'),
    });
    f.lifecycle.dispose();
    assert.equal(f.events.at(-1), 'destroy-tray');
    assert.equal(f.win.listenerCount('close'), 0);
});

test('tray unavailable cannot leave the application invisibly running', async () => {
    const f = fixture({ behavior: 'tray', failTray: true });
    assert.equal(f.lifecycle.trayAvailable(), false);
    const operation = f.lifecycle.requestClose();
    assert.deepEqual(f.events[0], { trayAvailable: false });
    f.answer({ action: 'tray', remember: true });
    await operation;
    assert.equal(f.events.includes('hide'), false);
});

test('settings, explicit tray quit and shutdown remain reachable', async () => {
    const f = fixture();
    f.tray.menu[1].click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.events.at(-1), 'settings');
    f.win.emit('query-session-end');
    f.win.emit('close', {
        preventDefault: () => assert.fail('must not block OS shutdown'),
    });
    await f.lifecycle.requestClose();
    assert.equal(
        f.events.some((x) => typeof x === 'object'),
        false
    );
    f.tray.menu[3].click();
    assert.equal(f.events.at(-1), 'quit');
});

test('quitting during choice ignores stale answers; failed persistence still allows one hide', async () => {
    const f = fixture();
    const operation = f.lifecycle.requestClose();
    f.setQuitting();
    f.answer({ action: 'tray', remember: true });
    await operation;
    assert.equal(f.events.includes('hide'), false);
    assert.equal(f.prefs.snapshot().closeBehavior, 'ask');
    const g = fixture({ writeFails: true });
    const other = g.lifecycle.requestClose();
    g.answer({ action: 'tray', remember: true });
    await other;
    assert.equal(g.events.at(-1), 'hide');
    assert.equal(g.prefs.snapshot().closeBehavior, 'ask');
});
