import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/views/js/shared/room-boot.js', import.meta.url), 'utf8');
function fixture() {
    let clock = 0, id = 0, reloads = 0;
    const timers = new Map(), handlers = {}, events = {};
    const root = { dataset: { roomBoot: 'pending' } };
    const message = { textContent: '' };
    const area = { inert: true, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
    const reload = { addEventListener(type, fn) { events[type] = fn; } };
    const stylesheet = { tagName: 'LINK', matches: (selector) => selector === 'link[data-room-startup-style]' };
    const window = {
        document: {
            documentElement: root,
            querySelector: selector => selector === '[data-room-load-message]' ? message : reload,
            querySelectorAll: () => [area],
            addEventListener(type, fn) { handlers[type] = fn; },
        },
        location: { href: 'https://voice.test/room/lobby', origin: 'https://voice.test', reload() { reloads++; } },
        setTimeout(fn, ms) { timers.set(++id, { at: clock + ms, fn }); return id; },
        clearTimeout(key) { timers.delete(key); },
        addEventListener(type, fn) { handlers[type] = fn; },
    };
    vm.runInNewContext(source, { window, URL });
    const tick = ms => {
        clock += ms;
        for (const [key, timer] of timers) if (timer.at <= clock) { timers.delete(key); timer.fn(); }
    };
    return { window, root, message, area, tick, timers, handlers, events, stylesheet,
        loadStylesheet: () => handlers.load({ target: stylesheet }), reloads: () => reloads };
}

test('slow startup stays loading, without classifying elapsed time as a failure', () => {
    const f = fixture();
    f.tick(1200);
    assert.equal(f.root.dataset.roomBoot, 'loading');
    assert.match(f.message.textContent, /正在加载/);
    f.tick(6800);
    assert.equal(f.root.dataset.roomBoot, 'slow');
    assert.match(f.message.textContent, /仍在继续/);
    assert.doesNotMatch(f.message.textContent, /重试|刷新|失败/);
    f.tick(21000);
    assert.equal(f.root.dataset.roomBoot, 'slow');
    assert.equal(f.reloads(), 0);
});

test('late successful startup dismisses waiting and enables the real controls', () => {
    const f = fixture();
    f.tick(8000);
    assert.equal(f.area.inert, true);
    f.loadStylesheet();
    f.window.VoiceRoomBoot.finish('ready');
    assert.equal(f.root.dataset.roomBoot, 'ready');
    assert.equal(f.message.textContent, '');
    assert.equal(f.area.inert, false);
    assert.equal(f.area.attributes['aria-busy'], 'false');
    assert.equal(f.timers.size, 0);
});

test('fast startup cannot be overwritten by an expired timer or later runtime error', () => {
    const f = fixture();
    f.loadStylesheet();
    f.window.VoiceRoomBoot.finish();
    f.tick(20000);
    f.handlers.error({ filename: 'https://voice.test/script.js' });
    assert.equal(f.root.dataset.roomBoot, 'ready');
    assert.equal(f.area.inert, false);
});

test('an actual application resource failure offers only a user initiated reload', () => {
    const f = fixture();
    f.handlers.error({ target: { tagName: 'SCRIPT', src: 'https://voice.test/js/room/boot-runtime.js?v=1' } });
    assert.equal(f.root.dataset.roomBoot, 'fallback');
    assert.equal(f.timers.size, 0);
    f.handlers.DOMContentLoaded();
    assert.match(f.message.textContent, /未能加载/);
    assert.equal(f.reloads(), 0);
    f.handlers.click({ target: { closest: () => true } });
    assert.equal(f.reloads(), 1);
});

test('explicit main module errors are recognized, while unrelated image and external errors are ignored', () => {
    const f = fixture();
    f.handlers.error({ target: { tagName: 'IMG', src: 'https://voice.test/js/example.js' } });
    f.handlers.error({ filename: 'https://external.test/script.js' });
    f.handlers.error({ filename: 'https://voice.test/not-script.js' });
    assert.equal(f.root.dataset.roomBoot, 'pending');
    f.handlers.error({ filename: 'https://voice.test/script.js?v=2' });
    assert.equal(f.root.dataset.roomBoot, 'fallback');
    f.loadStylesheet();
    f.window.VoiceRoomBoot.finish();
    assert.equal(f.root.dataset.roomBoot, 'ready');
});

test('an error before body parsing is rendered when the DOM becomes available', () => {
    const f = fixture();
    const query = f.window.document.querySelector;
    f.window.document.querySelector = () => null;
    f.handlers.error({ filename: 'https://voice.test/vendor/peerjs/peerjs.min.js' });
    assert.equal(f.message.textContent, '');
    f.window.document.querySelector = query;
    f.handlers.DOMContentLoaded();
    assert.match(f.message.textContent, /未能加载/);
    assert.equal(f.area.inert, true);
});

test('a stalled download permits manual recovery before DOMContentLoaded and still accepts late success', () => {
    const f = fixture();
    f.tick(30000);
    assert.equal(f.root.dataset.roomBoot, 'stalled');
    assert.match(f.message.textContent, /继续等待或重新加载/);
    assert.equal(f.area.inert, true);
    assert.equal(f.reloads(), 0);
    f.handlers.click({ target: { closest: () => null } });
    assert.equal(f.reloads(), 0);
    f.handlers.click({ target: { closest: () => true } });
    assert.equal(f.reloads(), 1);
    f.window.VoiceRoomBoot.finish();
    assert.equal(f.root.dataset.roomBoot, 'stalled');
    f.loadStylesheet();
    assert.equal(f.root.dataset.roomBoot, 'ready');
    assert.equal(f.area.inert, false);
    assert.equal(f.timers.size, 0);
});

test('failed main stylesheet keeps the controls inert and offers reload after scripts finish', () => {
    const f = fixture();
    f.handlers.error({ target: f.stylesheet });
    f.window.VoiceRoomBoot.finish();
    f.handlers.DOMContentLoaded();
    assert.equal(f.root.dataset.roomBoot, 'fallback');
    assert.equal(f.area.inert, true);
    assert.match(f.message.textContent, /重新加载/);
});
