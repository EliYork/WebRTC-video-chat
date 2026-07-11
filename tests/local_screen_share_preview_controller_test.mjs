import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL(
        '../src/views/js/media/local-screen-share-preview-controller.js',
        import.meta.url
    ),
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

class FakeElement {
    constructor(tagName = 'div') {
        this.attributes = new Map();
        this.childNodes = [];
        this.classList = createClassList();
        this.disabled = false;
        this.hidden = false;
        this.listeners = new Map();
        this.parentElement = null;
        this.srcObject = null;
        this.tagName = tagName.toUpperCase();
        this.textContent = '';
    }

    set className(value) {
        this.classList = createClassList();
        String(value)
            .split(/\s+/)
            .filter(Boolean)
            .forEach((name) => this.classList.add(name));
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    append(...nodes) {
        nodes.forEach((node) => {
            node.remove();
            node.parentElement = this;
            this.childNodes.push(node);
        });
    }

    async dispatchEvent(event) {
        event.target ||= this;
        await Promise.all(
            Array.from(this.listeners.get(event.type) || []).map((listener) =>
                listener(event)
            )
        );
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
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
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
}

const createFixture = () => {
    const window = {
        document: {
            createElement: (tagName) => new FakeElement(tagName),
        },
    };
    vm.runInNewContext(source, { window });

    const tile = new FakeElement('section');
    const header = new FakeElement();
    const actions = new FakeElement();
    const body = new FakeElement();
    const video = new FakeElement('video');
    header.className = 'tile-header';
    actions.className = 'tile-header-actions';
    body.className = 'tile-body';
    header.append(actions);
    body.append(video);
    tile.append(header, body);

    const calls = { attach: [], clear: [], exitFullscreen: 0 };
    let fullscreen = false;
    const controller =
        window.VoiceLocalScreenSharePreviewController.createController({
            attachMediaElement: (element, stream) => {
                calls.attach.push({ element, stream });
                element.srcObject = stream;
            },
            clearMediaElement: (element) => {
                calls.clear.push(element);
                element.srcObject = null;
            },
            exitFullscreen: async () => {
                calls.exitFullscreen += 1;
                fullscreen = false;
                return true;
            },
            isFullscreen: () => fullscreen,
        });

    return {
        actions,
        body,
        calls,
        controller,
        setFullscreen: (value) => {
            fullscreen = value;
        },
        tile,
        video,
    };
};

const click = (target) => ({
    type: 'click',
    target,
    preventDefault() {},
    stopPropagation() {},
});

const createStream = (id) => ({
    id,
    screenAudioTrack: { enabled: true, readyState: 'live' },
    screenVideoTrack: { enabled: true, readyState: 'live' },
});

test('local preview hides rendering without changing the shared stream and restores the same stream', async () => {
    const fixture = createFixture();
    const { actions, body, calls, controller, tile, video } = fixture;
    const session = { id: 'session-1' };
    const stream = createStream('stream-1');
    const tileIdentity = tile;

    controller.bindSource({
        generation: 1,
        mediaElement: video,
        session,
        stream,
        target: body,
        tile,
    });

    const button = actions.querySelector('.local-screen-preview-toggle');
    const placeholder = body.querySelector('.local-screen-preview-placeholder');
    assert.ok(button);
    assert.equal(button.textContent, '隐藏预览');
    assert.equal(button.listenerCount('click'), 1);
    assert.equal(video.srcObject, stream);

    await button.dispatchEvent(click(button));
    assert.equal(video.srcObject, null);
    assert.equal(video.hidden, true);
    assert.equal(placeholder.hidden, false);
    assert.equal(tile.classList.contains('is-local-preview-hidden'), true);
    assert.equal(button.textContent, '显示预览');
    assert.equal(stream.screenVideoTrack.readyState, 'live');
    assert.equal(stream.screenVideoTrack.enabled, true);
    assert.equal(stream.screenAudioTrack.enabled, true);

    await button.dispatchEvent(click(button));
    assert.equal(video.srcObject, stream);
    assert.equal(video.hidden, false);
    assert.equal(placeholder.hidden, true);
    assert.equal(tile, tileIdentity);
    assert.equal(actions.querySelector('.local-screen-preview-toggle'), button);
    assert.equal(button.listenerCount('click'), 1);
    assert.equal(calls.attach.length, 2);
});

test('hidden replacement keeps the preview hidden and stale generations cannot replace the latest stream', async () => {
    const fixture = createFixture();
    const { actions, body, controller, tile, video } = fixture;
    const session = { id: 'session-1' };
    const firstStream = createStream('stream-1');
    const latestStream = createStream('stream-2');

    controller.bindSource({
        generation: 1,
        mediaElement: video,
        session,
        stream: firstStream,
        target: body,
        tile,
    });
    const button = actions.querySelector('.local-screen-preview-toggle');
    await button.dispatchEvent(click(button));

    controller.bindSource({
        generation: 2,
        mediaElement: video,
        session,
        stream: latestStream,
        target: body,
        tile,
    });
    const stale = controller.bindSource({
        generation: 1,
        mediaElement: video,
        session,
        stream: firstStream,
        target: body,
        tile,
    });

    assert.equal(stale.accepted, false);
    assert.equal(controller.getSnapshot().stream, latestStream);
    assert.equal(controller.getSnapshot().hidden, true);
    assert.equal(video.srcObject, null);

    await button.dispatchEvent(click(button));
    assert.equal(video.srcObject, latestStream);
    assert.equal(button.listenerCount('click'), 1);
});

test('fullscreen exits through the supplied owner and session cleanup is generation-safe and idempotent', async () => {
    const fixture = createFixture();
    const { actions, body, calls, controller, setFullscreen, tile, video } =
        fixture;
    const firstSession = { id: 'session-1' };
    const nextSession = { id: 'session-2' };
    const originalLayout = { height: 360, width: 640, x: 24, y: 36 };

    controller.bindSource({
        generation: 1,
        mediaElement: video,
        session: firstSession,
        stream: createStream('stream-1'),
        target: body,
        tile,
    });
    setFullscreen(true);
    const button = actions.querySelector('.local-screen-preview-toggle');
    await button.dispatchEvent(click(button));
    assert.equal(calls.exitFullscreen, 1);
    assert.deepEqual(originalLayout, {
        height: 360,
        width: 640,
        x: 24,
        y: 36,
    });

    controller.bindSource({
        generation: 1,
        mediaElement: video,
        session: nextSession,
        stream: createStream('stream-2'),
        target: body,
        tile,
    });
    assert.equal(controller.getSnapshot().hidden, false);
    assert.equal(controller.stopSession(firstSession), false);
    assert.equal(controller.getSnapshot().active, true);
    const lateOldSource = controller.bindSource({
        generation: 2,
        mediaElement: video,
        session: firstSession,
        stream: createStream('late-old-stream'),
        target: body,
        tile,
    });
    assert.equal(lateOldSource.accepted, false);
    assert.equal(controller.getSnapshot().session, nextSession);
    assert.equal(controller.stopSession(nextSession), true);
    assert.equal(controller.getSnapshot().stream, undefined);
    assert.equal(button.listenerCount('click'), 0);
    assert.equal(actions.querySelector('.local-screen-preview-toggle'), null);
    assert.equal(controller.stopSession(nextSession), false);
    controller.destroy();
    controller.destroy();
});
