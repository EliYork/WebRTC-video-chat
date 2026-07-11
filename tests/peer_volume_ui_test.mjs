import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewUtilsSource = readFileSync(
    new URL('../src/views/js/shared/view-utils.js', import.meta.url),
    'utf8'
);
const volumeUiSource = readFileSync(
    new URL('../src/views/js/media/peer-volume-ui.js', import.meta.url),
    'utf8'
);

class EventTargetFake {
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

    dispatchEvent(event) {
        event.target ||= this;
        Array.from(this.listeners.get(event.type) || []).forEach((listener) =>
            listener(event)
        );
    }
}

const classList = () => {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        contains: (name) => values.has(name),
    };
};

class ElementFake extends EventTargetFake {
    constructor(tagName = 'div') {
        super();
        this.attributes = new Map();
        this.childNodes = [];
        this.classList = classList();
        this.parentElement = null;
        this.style = {};
        this.tagName = tagName.toUpperCase();
        this.textContent = '';
    }

    set className(value) {
        this.classList = classList();
        String(value)
            .split(/\s+/)
            .filter(Boolean)
            .forEach((name) => this.classList.add(name));
    }

    append(...nodes) {
        nodes.forEach((node) => {
            node.remove();
            node.parentElement = this;
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

    getBoundingClientRect() {
        return { height: 180, width: 190 };
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

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
}

class DocumentFake extends EventTargetFake {
    constructor() {
        super();
        this.body = new ElementFake('body');
    }

    createElement(tagName) {
        return new ElementFake(tagName);
    }

    getElementById() {}

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    querySelectorAll() {
        return [];
    }
}

test('screen-share copy, no-audio state, and repeated init/open stay single-owned', () => {
    const document = new DocumentFake();
    const window = { document, innerHeight: 900, innerWidth: 1400 };
    vm.runInNewContext(viewUtilsSource, { window });
    vm.runInNewContext(volumeUiSource, { window });
    const ui = window.VoiceRemoteVolumeUI;

    const firstBinding = ui.init();
    const secondBinding = ui.init();
    assert.equal(firstBinding, secondBinding);
    assert.equal(document.listenerCount('click'), 1);
    assert.equal(document.listenerCount('keydown'), 1);

    let volumeEvents = 0;
    let mutedEvents = 0;
    const popover = ui.openPopover({
        currentVolume: 65,
        event: { clientX: 20, clientY: 30 },
        iconClass: 'fas fa-desktop',
        muteLabel: '共享静音',
        muted: false,
        onMutedChange: (muted) => {
            mutedEvents += 1;
            assert.equal(muted, true);
        },
        onVolumeInput: (volume) => {
            volumeEvents += 1;
            assert.equal(volume, 35);
        },
        titleText: '屏幕共享音量',
    });
    const range = popover.querySelector('input');
    const mute = popover.querySelector('.peer-volume-mute');
    assert.equal(
        popover.querySelector('.peer-volume-title').childNodes[0].textContent,
        '屏幕共享音量'
    );
    assert.equal(mute.textContent, '共享静音：关');
    range.value = '35';
    range.dispatchEvent({ type: 'input' });
    mute.dispatchEvent({ type: 'click' });
    assert.equal(volumeEvents, 1);
    assert.equal(mutedEvents, 1);
    assert.equal(mute.textContent, '共享静音：开');

    const noAudio = ui.openPopover({
        disabled: true,
        emptyText: '无共享音频',
        event: { clientX: 20, clientY: 30 },
        muteLabel: '共享静音',
        titleText: '屏幕共享音量',
    });
    assert.equal(popover.parentElement, null);
    assert.equal(noAudio.querySelector('input').disabled, true);
    assert.equal(noAudio.querySelector('.peer-volume-mute').disabled, true);
    assert.equal(
        noAudio.querySelector('.peer-volume-empty').textContent,
        '无共享音频'
    );
    assert.equal(document.listenerCount('click'), 1);
    assert.equal(document.listenerCount('keydown'), 1);

    ui.destroy();
    assert.equal(document.listenerCount('click'), 0);
    assert.equal(document.listenerCount('keydown'), 0);
    assert.equal(document.querySelector('.peer-volume-popover'), null);
});
