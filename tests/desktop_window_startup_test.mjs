import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWindowStartup } from '../desktop/windows/window-startup.cjs';
import { createWindowLifecycle } from '../desktop/windows/window-lifecycle.cjs';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture({hidden = false, timeoutMs = 1000} = {}) {
    const navigation = deferred(), css = deferred(), paint = deferred();
    const events = [], contents = new EventEmitter(), win = new EventEmitter();
    Object.assign(contents, {
        getURL: () => 'https://voice.eliyork.com/room/lobby',
        insertCSS: () => { events.push('style'); return css.promise; },
        executeJavaScript: () => { events.push('paint'); return paint.promise; },
        stop: () => events.push('stop'),
    });
    Object.assign(win, { webContents: contents, isDestroyed: () => false,
        loadURL: () => navigation.promise, show: () => events.push('show'),
        isMinimized: () => false, focus: () => events.push('focus') });
    const startup = createWindowStartup({window:win,hidden,timeoutMs,trusted:url=>url.startsWith('https://voice.eliyork.com/'),css:'titlebar'});
    return {startup, win, navigation, css, paint, events};
}

test('initial window stays hidden through navigation and CSS until the room paints', async () => {
    const f=fixture(), loading=f.startup.load('https://voice.eliyork.com/room/lobby');
    const lifecycle=createWindowLifecycle({window:f.win,enableTray:false,canRestore:f.startup.isReady,isQuitting:()=>false});
    lifecycle.restore();assert.deepEqual(f.events,[]);
    f.win.webContents.emit('dom-ready');f.navigation.resolve();
    await Promise.resolve();assert.deepEqual(f.events,['style']);
    f.css.resolve();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.events,['style','paint']);assert.equal(f.startup.isReady(),false);
    f.paint.resolve();await loading;assert.deepEqual(f.events,['style','paint','show']);
    lifecycle.restore();assert.equal(f.events.at(-1),'focus');
    lifecycle.dispose();f.startup.dispose();
});

test('silent automation remains hidden after successful paint, refresh still styles the same window', async () => {
    const f=fixture({hidden:true}), loading=f.startup.load('https://voice.eliyork.com/room/lobby');
    f.win.webContents.emit('dom-ready');f.css.resolve();f.navigation.resolve();f.paint.resolve();await loading;
    assert.equal(f.startup.isReady(),true);assert.ok(!f.events.includes('show'));
    f.win.webContents.emit('dom-ready');assert.equal(f.events.filter(e=>e==='style').length,2);
    f.startup.dispose();
});

test('slow/offline startup has a deadline and late network completion cannot reveal an empty window', async () => {
    const f=fixture({timeoutMs:10});
    await assert.rejects(f.startup.load('https://voice.eliyork.com/room/lobby'),/timeout/);
    f.navigation.resolve();f.css.resolve();f.paint.resolve();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.startup.isReady(),false);assert.deepEqual(f.events,['stop']);f.startup.dispose();
});

test('navigation and CSS failure propagate to the local error UI without showing the room', async () => {
    await Promise.all(['navigation','css'].map(async failure => {
        const f=fixture(), loading=f.startup.load('https://voice.eliyork.com/room/lobby');
        if(failure==='navigation')f.navigation.reject(Error('offline'));
        else {f.win.webContents.emit('dom-ready');f.navigation.resolve();f.css.reject(Error('style failure'));}
        await assert.rejects(loading,/offline|style failure/);assert.ok(!f.events.includes('show'));f.startup.dispose();
    }));
});

test('quit cancels hidden startup, removes styling subscription and prevents late show', async () => {
    const f=fixture(), loading=f.startup.load('https://voice.eliyork.com/room/lobby');
    f.startup.dispose();await assert.rejects(loading,/cancelled/);
    f.navigation.resolve();await Promise.resolve();
    assert.equal(f.win.webContents.listenerCount('dom-ready'),0);assert.ok(!f.events.includes('show'));
});
