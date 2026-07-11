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

const createFixture = () => {
    const document = new FakeDocument();
    const window = { document };
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
    const persistedLayout = { height: 360, width: 640, x: 24, y: 36 };
    const fullscreenLayout = { height: 1080, width: 1920, x: 0, y: 0 };
    if (!api.isTileLayoutWriteBlocked(tile)) {
        Object.assign(persistedLayout, fullscreenLayout);
    }
    assert.deepEqual(persistedLayout, {
        height: 360,
        width: 640,
        x: 24,
        y: 36,
    });

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
