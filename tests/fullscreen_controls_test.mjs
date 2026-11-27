import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewUtilsSource = readFileSync(
    new URL('../src/views/js/shared/view-utils.js', import.meta.url),
    'utf8'
);
const fullscreenSource = readFileSync(
    new URL('../src/views/js/media/fullscreen-controls.js', import.meta.url),
    'utf8'
);

const createClassList = () => {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
        remove: (...names) => names.forEach((name) => values.delete(name)),
        toggle: (name, force) => {
            if (force) values.add(name);
            else values.delete(name);
        },
    };
};

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }

    async dispatchEvent(event) {
        event.target ||= this;
        await Promise.all(
            Array.from(this.listeners.get(event.type) || []).map((listener) =>
                listener(event)
            )
        );
    }
}

class FakeElement extends FakeEventTarget {
    constructor(document, tagName = 'div') {
        super();
        this.attributes = new Map();
        this.childNodes = [];
        this.classList = createClassList();
        this.document = document;
        this.parentElement = null;
        this.tagName = tagName.toUpperCase();
        this._connected = false;
    }

    get isConnected() {
        return this._connected || Boolean(this.parentElement?.isConnected);
    }

    set className(value) {
        this.classList = createClassList();
        String(value)
            .split(/\s+/)
            .filter(Boolean)
            .forEach((name) => this.classList.add(name));
    }

    append(...nodes) {
        nodes.forEach((node) => {
            node.remove();
            node.parentElement = this;
            node._connected = false;
            this.childNodes.push(node);
        });
    }

    closest(selector) {
        if (
            selector.startsWith('.') &&
            this.classList.contains(selector.slice(1))
        ) {
            return this;
        }
        return this.parentElement?.closest(selector) || null;
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    querySelector(selector) {
        const className = selector.startsWith('.') ? selector.slice(1) : null;
        for (const child of this.childNodes) {
            if (
                className
                    ? child.classList.contains(className)
                    : child.tagName.toLowerCase() === selector
            ) {
                return child;
            }
            const descendant = child.querySelector(selector);
            if (descendant) return descendant;
        }
        return null;
    }

    remove() {
        const siblings = this.parentElement?.childNodes;
        const index = siblings?.indexOf(this) ?? -1;
        if (index >= 0) siblings.splice(index, 1);
        this.parentElement = null;
        this._connected = false;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.fullscreenElement = null;
        this.exitCount = 0;
    }

    createElement = (tagName) => new FakeElement(this, tagName);

    exitFullscreen = async () => {
        this.exitCount += 1;
        this.fullscreenElement = null;
        await this.dispatchEvent({ type: 'fullscreenchange' });
    };

    getElementById() {}

    querySelectorAll() {
        return [];
    }
}

const createFixture = (options = {}) => {
    const document = new FakeDocument();
    const window = { document, ...options };
    vm.runInNewContext(viewUtilsSource, { window });
    vm.runInNewContext(fullscreenSource, { window });

    const tile = document.createElement('section');
    const video = document.createElement('video');
    const headerActions = document.createElement('div');
    headerActions.className = 'tile-header-actions';
    tile.className = 'video-tile is-positioned';
    tile._connected = true;
    tile.setAttribute(
        'style',
        'left: 24px; top: 36px; width: 640px; height: 360px; z-index: 4;'
    );
    tile.append(video, headerActions);
    tile.requestCount = 0;
    tile.requestFullscreen = async () => {
        tile.requestCount += 1;
        document.fullscreenElement = tile;
        await document.dispatchEvent({ type: 'fullscreenchange' });
    };

    return {
        api: window.VoiceFullscreenControls,
        document,
        headerActions,
        originalStyle: tile.getAttribute('style'),
        tile,
        video,
    };
};

const event = (type, target) => ({
    type,
    target,
    preventDefault() {},
    stopPropagation() {},
});

const mobileFixture = (overrides = {}) => {
    const calls = [];
    const orientation = { lock: async mode => { calls.push(mode); }, unlock: () => { calls.push('unlock'); } };
    const f = createFixture({ matchMedia: () => ({ matches: true }), navigator: { maxTouchPoints: 1 }, screen: { orientation }, ...overrides });
    f.video.videoWidth = 1920; f.video.videoHeight = 1080;
    f.api.bindFullscreenChange();
    f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
    return { ...f, calls, orientation };
};

test('mobile landscape fullscreen locks after native entry and unlocks on browser exit', async () => {
    const f = mobileFixture(); const stream = {}; f.video.srcObject = stream;
    f.orientation.lock = async mode => {
        assert.equal(f.document.fullscreenElement, f.tile, 'only lock inside native fullscreen');
        f.calls.push(mode);
    };
    assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile }), true);
    f.api.updateButtonStates();
    assert.deepEqual(f.calls, ['landscape'], 'fullscreenchange and completion must not lock twice');
    await f.document.exitFullscreen();
    assert.deepEqual(f.calls, ['landscape', 'unlock']);
    assert.equal(f.video.srcObject, stream);
    assert.equal(f.video.listenerCount('loadedmetadata'), 1, 'only attached web-fullscreen listener remains');
    f.api.destroy();
    assert.equal(f.video.listenerCount('loadedmetadata'), 0);
    assert.equal(f.video.listenerCount('resize'), 0);
});

for (const dimensions of [[1080, 1920], [1080, 1080], [0, 0]]) {
    test(`mobile ${dimensions.join('x')} video does not assume landscape`, async () => {
        const f = mobileFixture(); [f.video.videoWidth, f.video.videoHeight] = dimensions;
        await f.api.toggleTileFullscreen({ tile: f.tile });
        assert.deepEqual(f.calls, []);
        assert.equal(f.tile.querySelector('.player-orientation-hint'), null);
        f.api.destroy();
    });
}

for (const narrow of [false, true]) {
    test(`${narrow ? 'narrow ' : ''}desktop fullscreen does not lock screen orientation`, async () => {
        const calls = [];
        const f = createFixture({ matchMedia: query => ({ matches: narrow && !query.includes('pointer') }),
            navigator: { maxTouchPoints: 0 }, screen: { orientation: { lock: () => calls.push('lock'), unlock: () => calls.push('unlock') } } });
        f.video.videoWidth = 1920; f.video.videoHeight = 1080;
        await f.api.toggleTileFullscreen({ tile: f.tile });
        assert.deepEqual(calls, []);
        f.api.destroy();
    });
}

test('metadata arriving after fullscreen locks once, and a portrait source releases the lock', async () => {
    const f = mobileFixture(); f.video.videoWidth = f.video.videoHeight = 0;
    await f.api.toggleTileFullscreen({ tile: f.tile });
    f.video.videoWidth = 1920; f.video.videoHeight = 1080;
    await f.video.dispatchEvent({ type: 'loadedmetadata' });
    await f.video.dispatchEvent({ type: 'resize' });
    assert.deepEqual(f.calls, ['landscape']);
    f.video.videoWidth = 1080; f.video.videoHeight = 1920;
    await f.video.dispatchEvent({ type: 'resize' });
    assert.deepEqual(f.calls, ['landscape', 'unlock']);
    f.api.destroy();
});

for (const support of ['absent', 'reject', 'throw']) {
    test(`orientation lock ${support} keeps fullscreen successful with a rotation hint`, async () => {
        const f = mobileFixture(); const errors = [];
        if (support === 'absent') f.orientation.lock = undefined;
        if (support === 'reject') f.orientation.lock = () => Promise.reject(new Error('NotSupportedError'));
        if (support === 'throw') f.orientation.lock = () => { throw new Error('SecurityError'); };
        assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error) }), true);
        assert.equal(f.document.fullscreenElement, f.tile);
        assert.deepEqual(errors, []);
        const hint = f.tile.querySelector('.player-orientation-hint');
        assert.ok(hint.textContent.includes('请将手机横过来'));
        assert.equal(hint.getAttribute('role'), 'status');
        f.api.updateButtonStates();
        assert.equal(f.tile.querySelector('.player-orientation-hint'), hint, 'no repeated hint or lock request');
        f.api.exitTileFullscreen(f.tile);
        assert.equal(f.tile.querySelector('.player-orientation-hint'), null);
        f.api.destroy();
    });
}

test('fullscreen rejection never starts an orientation lock', async () => {
    const f = mobileFixture(); const errors = [];
    f.tile.requestFullscreen = async () => { throw new Error('denied'); };
    assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error.message) }), false);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(errors, ['denied']);
    assert.equal(f.video.listenerCount('resize'), 1);
    f.api.destroy();
});

for (const cancel of ['exit', 'detach', 'destroy']) {
    for (const result of ['resolve', 'reject']) {
        test(`${cancel} releases a pending orientation lock and ignores late ${result}`, async () => {
            const f = mobileFixture(); let finish, fail;
            f.orientation.lock = () => { f.calls.push('landscape'); return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); };
            assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile }), true, 'fullscreen must not wait for orientation promise');
            if (cancel === 'exit') f.api.exitTileFullscreen(f.tile);
            if (cancel === 'detach') f.api.detachTile(f.tile);
            if (cancel === 'destroy') f.api.destroy();
            assert.deepEqual(f.calls, ['landscape', 'unlock']);
            if (result === 'resolve') finish(); else fail(new Error('AbortError'));
            await Promise.resolve(); await Promise.resolve();
            assert.equal(f.tile.querySelector('.player-orientation-hint'), null);
            assert.equal(f.document.fullscreenElement, null);
            f.api.destroy();
            assert.equal(f.video.listenerCount('resize'), 0);
        });
    }
}

for (const sameTile of [true, false]) {
    for (const result of ['resolve', 'reject']) {
        test(`late orientation ${result} cannot unlock newer fullscreen (${sameTile ? 'same' : 'different'} tile)`, async () => {
            const f = mobileFixture(); let finish, fail;
            f.orientation.lock = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
            await f.api.toggleTileFullscreen({ tile: f.tile });
            f.api.exitTileFullscreen(f.tile);
            const next = sameTile ? f.tile : f.document.createElement('section');
            if (!sameTile) {
                next._connected = true;
                const video = f.document.createElement('video'); video.videoWidth = 1280; video.videoHeight = 720;
                next.append(video);
                next.requestFullscreen = async () => { f.document.fullscreenElement = next; await f.document.dispatchEvent({ type: 'fullscreenchange' }); };
                f.api.attachTileButton({ tile: next });
            }
            f.orientation.lock = async mode => f.calls.push(mode);
            await f.api.toggleTileFullscreen({ tile: next });
            const before = [...f.calls];
            if (result === 'resolve') finish(); else fail(new Error('AbortError'));
            await Promise.resolve(); await Promise.resolve();
            assert.deepEqual(f.calls, before, 'old completion cannot release the new lease');
            assert.equal(f.document.fullscreenElement, next);
            assert.equal(next.querySelector('.player-orientation-hint'), null);
            f.api.destroy();
        });
    }
}

test('web fullscreen offers manual rotation without requesting system orientation', async () => {
    const f = mobileFixture();
    const button = f.tile.querySelector('.web-fullscreen-btn');
    await button.dispatchEvent(event('click', button));
    assert.deepEqual(f.calls, []);
    assert.ok(f.tile.querySelector('.player-orientation-hint'));
    await f.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(f.tile.querySelector('.player-orientation-hint'), null);
    f.api.destroy();
});

test('iOS video-only fullscreen preserves native playback without retaining orientation listeners', async () => {
    const f = mobileFixture(); let entered = 0;
    f.tile.requestFullscreen = undefined;
    f.video.webkitEnterFullscreen = () => { entered++; };
    assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile }), true);
    assert.equal(entered, 1);
    assert.deepEqual(f.calls, []);
    assert.equal(f.video.listenerCount('resize'), 1);
    f.api.destroy();
});

for (const cancel of ['exit', 'detach', 'destroy']) {
    test(`${cancel} invalidates a pending native fullscreen request before it enters`, async () => {
        const f = mobileFixture(); f.api.bindFullscreenChange();
        f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
        const stream = {}; f.video.srcObject = stream;
        let finish;
        f.tile.requestFullscreen = () => new Promise(resolve => {
            finish = async () => {
                f.document.fullscreenElement = f.tile;
                await f.document.dispatchEvent({ type: 'fullscreenchange' });
                resolve();
            };
        });
        const pending = f.api.toggleTileFullscreen({ tile: f.tile });
        if (cancel === 'exit') f.api.exitTileFullscreen(f.tile);
        if (cancel === 'detach') f.api.detachTile(f.tile);
        if (cancel === 'destroy') f.api.destroy();
        await finish();
        assert.equal(await pending, false, 'a cancelled request must not report a successful entry');
        assert.equal(f.document.fullscreenElement, null, 'late entry must leave fullscreen again');
        assert.equal(f.document.exitCount, 1);
        assert.equal(f.api.isTileLayoutWriteBlocked(f.tile), false);
        assert.equal(f.tile.getAttribute('style'), f.originalStyle);
        assert.equal(f.video.srcObject, stream);
        assert.deepEqual(f.calls, [], 'cancelled fullscreen cannot acquire an orientation lock');
        f.api.destroy();
    });
}

for (const completion of ['resolve', 'reject']) {
    test(`an obsolete fullscreen ${completion} preserves a newer request for the same tile`, async () => {
        const f = createFixture(); f.api.bindFullscreenChange();
        f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
        const request = f.tile.requestFullscreen;
        let finish, fail;
        f.tile.requestFullscreen = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        const errors = [];
        const old = f.api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error) });
        f.api.exitTileFullscreen(f.tile);
        f.tile.requestFullscreen = request;
        assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile }), true);
        if (completion === 'resolve') finish();
        else fail(new Error('obsolete fullscreen request rejected'));
        assert.equal(await old, false);
        assert.equal(f.document.fullscreenElement, f.tile);
        assert.equal(f.document.exitCount, 0, 'old completion cannot exit the newer fullscreen');
        assert.equal(f.api.isTileLayoutWriteBlocked(f.tile), true);
        assert.deepEqual(errors, []);
        f.api.destroy();
    });
}

test('an old completion cannot exit a newer fullscreen on a different tile', async () => {
    const f = createFixture(); f.api.bindFullscreenChange();
    f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
    let finish;
    f.tile.requestFullscreen = () => new Promise(resolve => { finish = resolve; });
    const old = f.api.toggleTileFullscreen({ tile: f.tile });
    const other = f.document.createElement('section'); other._connected = true;
    other.append(f.document.createElement('video')); f.api.attachTileButton({ tile: other });
    other.requestFullscreen = async () => {
        f.document.fullscreenElement = other;
        await f.document.dispatchEvent({ type: 'fullscreenchange' });
    };
    assert.equal(await f.api.toggleTileFullscreen({ tile: other }), true);
    finish(); assert.equal(await old, false);
    assert.equal(f.document.fullscreenElement, other);
    assert.equal(f.document.exitCount, 0);
    f.api.destroy();
});

test('a current native fullscreen failure restores layout and reports the failure once', async () => {
    const f = createFixture(); f.api.bindFullscreenChange();
    const errors = [];
    f.tile.requestFullscreen = () => Promise.reject(new Error('current fullscreen request denied'));
    assert.equal(await f.api.toggleTileFullscreen({ tile: f.tile, onError: error => errors.push(error.message) }), false);
    assert.deepEqual(errors, ['current fullscreen request denied']);
    assert.equal(f.api.isTileLayoutWriteBlocked(f.tile), false);
    assert.equal(f.tile.getAttribute('style'), f.originalStyle);
    f.api.destroy();
});

test('switching to web fullscreen cancels a pending native entry and keeps the web view', async () => {
    const f = createFixture(); f.api.bindFullscreenChange();
    f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
    let finish;
    f.tile.requestFullscreen = () => new Promise(resolve => {
        finish = async () => {
            f.document.fullscreenElement = f.tile;
            await f.document.dispatchEvent({ type: 'fullscreenchange' }); resolve();
        };
    });
    const pending = f.api.toggleTileFullscreen({ tile: f.tile });
    const web = f.tile.querySelector('.web-fullscreen-btn');
    await web.dispatchEvent(event('click', web));
    await finish();
    assert.equal(await pending, false);
    assert.equal(f.document.fullscreenElement, null);
    assert.equal(f.tile.classList.contains('is-web-fullscreen'), true);
    assert.equal(f.api.isTileLayoutWriteBlocked(f.tile), true);
    assert.equal(web.getAttribute('aria-pressed'), 'true');
    f.api.destroy();
});

test('web fullscreen stays inside page, blocks layout writes and restores on Escape', async () => {
    const { api, document, headerActions, originalStyle, tile } = createFixture();
    api.bindFullscreenChange();
    api.attachTileButton({ tile, actions: headerActions });
    const button = tile.querySelector('.web-fullscreen-btn');
    await button.dispatchEvent(event('click', button));
    assert.equal(tile.classList.contains('is-web-fullscreen'), true);
    assert.equal(Boolean(document.fullscreenElement), false);
    assert.equal(api.isTileLayoutWriteBlocked(tile), true);
    assert.equal(button.getAttribute('aria-label'), '退出网页内全屏');
    await document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(tile.classList.contains('is-web-fullscreen'), false);
    assert.equal(tile.getAttribute('style'), originalStyle);
    assert.equal(api.isTileLayoutWriteBlocked(tile), false);
    api.destroy();
    assert.equal(document.listenerCount('keydown'), 0);
});

for (const overlayType of ['dialog', 'device-popover']) {
    test(`Escape leaves web fullscreen while an external ${overlayType} owns the close request`, async () => {
        const { api, document, tile, headerActions } = createFixture();
        api.bindFullscreenChange(); api.attachTileButton({ tile, actions: headerActions });
        const web = tile.querySelector('.web-fullscreen-btn');
        await web.dispatchEvent(event('click', web));
        let overlayOpen = true;
        const overlay = document.createElement(overlayType === 'dialog' ? 'dialog' : 'div');
        document.querySelector = () => overlayOpen ? overlay : null;
        await document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { this.defaultPrevented = true; } });
        const retained = tile.classList.contains('is-web-fullscreen');
        overlayOpen = false;
        await document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { this.defaultPrevented = true; } });
        assert.equal(retained, true);
        assert.equal(tile.classList.contains('is-web-fullscreen'), false);
        api.destroy();
    });
}

test('Escape used by an input method cannot exit web fullscreen', async () => {
    const { api, document, tile, headerActions } = createFixture();
    api.bindFullscreenChange(); api.attachTileButton({ tile, actions: headerActions });
    const web = tile.querySelector('.web-fullscreen-btn'); await web.dispatchEvent(event('click', web));
    await document.dispatchEvent({ type: 'keydown', key: 'Escape', isComposing: true });
    const retained = tile.classList.contains('is-web-fullscreen'); api.destroy();
    assert.equal(retained, true);
});

test('mobile immersive controls hide, reveal on touch and release timers and close requests', async () => {
    const timers = new Map(), watchers = []; let timerId = 0;
    const f = createFixture({ matchMedia: () => ({ matches: true }),
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
        CloseWatcher: class {
            constructor() { watchers.push(this); }
            addEventListener(_, handler) { this.close = handler; }
            destroy() { this.destroyed = true; }
        },
    });
    f.api.bindFullscreenChange(); f.api.attachTileButton({ tile: f.tile, actions: f.headerActions });
    const stream = {}; f.video.srcObject = stream;
    const web = f.tile.querySelector('.web-fullscreen-btn');
    await web.dispatchEvent(event('click', web));
    assert.equal(f.tile.classList.contains('is-immersive-player'), true);
    assert.equal(f.tile.querySelector('.fullscreen-btn').getAttribute('aria-label'), '退出全屏');
    [...timers.values()].at(-1)();
    assert.equal(f.tile.classList.contains('player-controls-hidden'), true);
    await f.tile.dispatchEvent(event('pointerup', f.video));
    assert.equal(f.tile.classList.contains('player-controls-hidden'), false);
    watchers[0].close();
    assert.equal(f.tile.classList.contains('is-web-fullscreen'), false);
    assert.equal(f.tile.classList.contains('player-controls-hidden'), false);
    assert.equal(f.video.srcObject, stream);
    await web.dispatchEvent(event('click', web));
    await f.tile.querySelector('.fullscreen-btn').dispatchEvent(event('click', web));
    assert.equal(f.tile.requestCount, 0, 'exit icon leaves page fullscreen rather than entering native fullscreen');
    await f.tile.querySelector('.fullscreen-btn').dispatchEvent(event('click', web));
    assert.equal(f.document.fullscreenElement, f.tile);
    f.api.exitTileFullscreen(f.tile);
    assert.equal(f.document.fullscreenElement, null);
    f.api.detachTile(f.tile);
    assert.equal(f.tile.listenerCount('pointerup'), 0);
    assert.equal(timers.size, 0);
    assert.equal(watchers.at(-1).destroyed, true);
});

test('button, double click, and Esc share fullscreenchange restoration without duplicate listeners', async () => {
    const fixture = createFixture();
    const { api, document, headerActions, originalStyle, tile, video } =
        fixture;
    const firstBinding = api.bindFullscreenChange();
    const secondBinding = api.bindFullscreenChange();
    assert.equal(firstBinding, secondBinding);
    assert.equal(document.listenerCount('fullscreenchange'), 1);
    assert.equal(document.listenerCount('webkitfullscreenchange'), 1);

    const firstButton = api.attachTileButton({ tile, actions: headerActions });
    const secondButton = api.attachTileButton({ tile, actions: headerActions });
    assert.equal(firstButton, secondButton);
    assert.equal(firstButton.listenerCount('click'), 1);
    assert.equal(tile.listenerCount('dblclick'), 1);
    assert.equal(firstButton.parentElement, headerActions);

    await firstButton.dispatchEvent(event('click', firstButton));
    assert.equal(document.fullscreenElement, tile);
    assert.equal(tile.requestCount, 1);
    assert.equal(tile.classList.contains('is-fullscreen'), true);
    assert.equal(api.isTileLayoutWriteBlocked(tile), true);

    tile.setAttribute(
        'style',
        'position: fixed; inset: 0; width: 100vw; height: 100vh; transform: none; z-index: 9999;'
    );
    tile.classList.add('is-expanded', 'is-focused', 'is-maximized');
    await firstButton.dispatchEvent(event('click', firstButton));
    assert.equal(document.fullscreenElement, null);
    assert.equal(document.exitCount, 1);
    assert.equal(tile.getAttribute('style'), originalStyle);
    assert.equal(tile.classList.contains('is-positioned'), true);
    ['is-fullscreen', 'is-expanded', 'is-focused', 'is-maximized'].forEach(
        (className) => assert.equal(tile.classList.contains(className), false)
    );
    assert.equal(api.isTileLayoutWriteBlocked(tile), false);

    await tile.dispatchEvent(event('dblclick', video));
    assert.equal(document.fullscreenElement, tile);
    assert.equal(tile.requestCount, 2);
    await tile.dispatchEvent(event('dblclick', video));
    assert.equal(document.fullscreenElement, null);
    assert.equal(document.exitCount, 2);

    await firstButton.dispatchEvent(event('click', firstButton));
    tile.setAttribute('style', 'width: 100vw; height: 100vh;');
    tile.classList.add('is-expanded', 'is-focused');
    document.fullscreenElement = null;
    await document.dispatchEvent({ type: 'fullscreenchange' });
    assert.equal(tile.getAttribute('style'), originalStyle);
    assert.equal(tile.classList.contains('is-fullscreen'), false);
    assert.equal(tile.classList.contains('is-expanded'), false);
    assert.equal(tile.classList.contains('is-focused'), false);

    api.detachTile(tile);
    assert.equal(firstButton.listenerCount('click'), 0);
    assert.equal(tile.listenerCount('dblclick'), 0);
    assert.equal(firstButton.isConnected, false);
    await tile.dispatchEvent(event('dblclick', video));
    assert.equal(tile.requestCount, 3);

    api.destroy();
    assert.equal(document.listenerCount('fullscreenchange'), 0);
    assert.equal(document.listenerCount('webkitfullscreenchange'), 0);
});
