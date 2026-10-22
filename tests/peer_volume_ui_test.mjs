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
        const tagName = selector.replace(':enabled', '');
        for (const child of this.childNodes) {
            if (
                className
                    ? child.classList.contains(className)
                    : child.tagName.toLowerCase() === tagName && (!selector.endsWith(':enabled') || !child.disabled)
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

    contains(node) {
        return node === this || this.childNodes.some(child => child.contains(node));
    }

    get isConnected() {
        return this === this.ownerDocument?.body || Boolean(this.parentElement?.isConnected);
    }

    focus() {
        if (this.isConnected) this.ownerDocument.activeElement = this;
    }
}

class DocumentFake extends EventTargetFake {
    constructor() {
        super();
        this.body = new ElementFake('body');
        this.body.ownerDocument = this;
        this.activeElement = this.body;
    }

    createElement(tagName) {
        const node = new ElementFake(tagName);
        node.ownerDocument = this;
        return node;
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
test('fullscreen menu contains independent voice and shared controls up to 200%', () => {
    const document = new DocumentFake();
    const window = { document, innerHeight: 900, innerWidth: 1400 };
    vm.runInNewContext(viewUtilsSource, { window });
    vm.runInNewContext(volumeUiSource, { window });
    const ui = window.VoiceRemoteVolumeUI;
    const fullscreen = new ElementFake();
    document.body.append(fullscreen);
    document.fullscreenElement = fullscreen;
    const values = [];
    const popover = ui.openPopover({
        event: { clientX: 20, clientY: 20 },
        controls: [
            { titleText: '语音音量', currentVolume: 200, onVolumeInput: (value) => values.push(['voice', value]) },
            { titleText: '共享音量', currentVolume: 50, onVolumeInput: (value) => values.push(['screen', value]) },
        ],
    });
    assert.equal(popover.parentElement, fullscreen);
    const sections = popover.childNodes.filter((node) => node.querySelector('input'));
    const voice = sections[0].querySelector('input');
    const screen = sections[1].querySelector('input');
    assert.equal(String(voice.max), '200');
    voice.value = '180';
    voice.dispatchEvent({ type: 'input' });
    screen.value = '40';
    screen.dispatchEvent({ type: 'input' });
    assert.deepEqual(values, [['voice', 180], ['screen', 40]]);
    ui.init();
    document.dispatchEvent({ type: 'fullscreenchange' });
    assert.equal(popover.parentElement, null);
    ui.destroy();
});

function viewportFixture(width, height) {
    const document = new DocumentFake();
    document.createElement = tag => {
        const node = new ElementFake(tag);
        node.ownerDocument = document;
        node.getBoundingClientRect = () => ({
            width: Math.min(212, parseFloat(node.style.maxWidth) || 212),
            height: Math.min(230, parseFloat(node.style.maxHeight) || 230),
        });
        return node;
    };
    const window = Object.assign(new EventTargetFake(), { document, innerWidth: width, innerHeight: height });
    vm.runInNewContext(viewUtilsSource, { window });
    vm.runInNewContext(volumeUiSource, { window });
    const ui = window.VoiceRemoteVolumeUI;
    return { document, window, ui };
}

for (const [name, width, height, maxWidth, maxHeight, left, top] of [
    ['short', 390, 160, '374px', '144px', '170px', '8px'],
    ['narrow', 180, 240, '164px', '224px', '8px', '8px'],
]) {
    test(`${name} viewport constrains the volume panel before positioning its outer box`, () => {
        const { ui } = viewportFixture(width, height);
        const panel = ui.openPopover({ event: { clientX: width - 2, clientY: height - 2 } });
        assert.equal(panel.style.maxWidth, maxWidth);
        assert.equal(panel.style.maxHeight, maxHeight);
        assert.equal(panel.style.left, left);
        assert.equal(panel.style.top, top);
        ui.closePopover();
    });
}

test('resizing while volume is open repositions the current panel and destroy releases listeners', () => {
    const { ui, window } = viewportFixture(390, 600);
    ui.init();
    const panel = ui.openPopover({ event: { clientX: 388, clientY: 598 } });
    window.innerWidth = 220; window.innerHeight = 180;
    window.dispatchEvent({ type: 'resize' });
    assert.equal(panel.style.left, '8px');
    assert.equal(panel.style.top, '8px');
    assert.equal(panel.style.maxHeight, '164px');
    ui.destroy();
    assert.equal(window.listenerCount('resize'), 0);
    assert.equal(panel.parentElement, null);
});

test('visual viewport resize and scroll keep volume controls within the visible region', () => {
    const { ui, window } = viewportFixture(390, 844);
    const viewport = Object.assign(new EventTargetFake(), { width: 280, height: 180, offsetLeft: 10, offsetTop: 20 });
    window.visualViewport = viewport;
    ui.init(); ui.init();
    const panel = ui.openPopover({ event: { clientX: 388, clientY: 842 } });
    assert.equal(panel.style.left, '70px');
    assert.equal(panel.style.top, '28px');
    viewport.height = 160; viewport.offsetTop = 100;
    viewport.dispatchEvent({ type: 'resize' });
    assert.equal(panel.style.maxHeight, '144px');
    assert.equal(panel.style.top, '108px');
    viewport.offsetLeft = 50;
    viewport.dispatchEvent({ type: 'scroll' });
    assert.equal(panel.style.left, '110px');
    assert.equal(viewport.listenerCount('resize'), 1);
    assert.equal(viewport.listenerCount('scroll'), 1);
    ui.destroy();
    assert.equal(viewport.listenerCount('resize'), 0);
    assert.equal(viewport.listenerCount('scroll'), 0);
});

function keyboardFixture() {
    const context = viewportFixture(1400, 900);
    const { document, ui } = context;
    const opener = document.createElement('button');
    opener.getBoundingClientRect = () => ({ left: 150, bottom: 200 });
    document.body.append(opener); opener.focus(); ui.init();
    const open = (options = {}) => ui.openPopover({
        event: { detail: 0, clientX: 0, clientY: 0, currentTarget: opener }, ...options,
    });
    return { ...context, opener, open };
}

test('keyboard volume opening anchors to its trigger and focuses an enabled control', () => {
    const { ui, document, open } = keyboardFixture();
    const panel = open({ controls: [{ disabled: true }, { currentVolume: 75 }] });
    assert.equal(panel.style.left, '150px');
    assert.equal(panel.style.top, '204px');
    assert.equal(document.activeElement, panel.querySelector('input:enabled'));
    ui.destroy();
});

test('Escape from volume controls returns focus to the connected opener', () => {
    const { ui, document, opener, open } = keyboardFixture();
    const panel = open(); panel.querySelector('input').focus();
    let prevented = false;
    document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(panel.parentElement, null);
    assert.equal(document.activeElement, opener);
    ui.destroy();
});

test('closing a volume panel preserves focus already moved to another page control', () => {
    const { ui, document, open } = keyboardFixture();
    open(); const other = document.createElement('button'); document.body.append(other); other.focus();
    document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(document.activeElement, other);
    ui.destroy();
});

test('a disabled volume panel remains keyboard focusable so its empty state can be read', () => {
    const { ui, document, open } = keyboardFixture();
    const panel = open({ disabled: true, emptyText: '无共享音频', titleText: '屏幕共享音量' });
    assert.equal(document.activeElement, panel);
    assert.equal(panel.attributes.get('role'), 'dialog');
    assert.equal(panel.attributes.get('aria-label'), '屏幕共享音量');
    ui.destroy();
});

test('a previous CloseWatcher callback cannot close or steal focus from a newer volume panel', () => {
    const { ui, window, document, open } = keyboardFixture();
    const watchers = [];
    window.CloseWatcher = class extends EventTargetFake {
        constructor() { super(); watchers.push(this); }
        destroy() { this.destroyed = true; }
    };
    open(); const oldClose = [...watchers[0].listeners.get('close')][0];
    const next = open(); const range = next.querySelector('input'); range.focus(); oldClose();
    assert.equal(watchers[0].destroyed, true);
    assert.equal(next.parentElement, document.body);
    assert.equal(document.activeElement, range);
    ui.destroy();
});

test('pointer volume opening retains its coordinates and current focus', () => {
    const { ui, document, opener } = keyboardFixture();
    const panel = ui.openPopover({ event: { detail: 1, clientX: 50, clientY: 60, currentTarget: opener } });
    assert.equal(panel.style.left, '50px'); assert.equal(panel.style.top, '60px');
    assert.equal(document.activeElement, opener);
    ui.destroy();
});

for (const flag of ['defaultPrevented', 'isComposing']) {
    test(`member volume preserves its panel when Escape belongs to ${flag}`, () => {
        const { ui, document, open } = keyboardFixture();
        const panel = open();
        document.dispatchEvent({ type: 'keydown', key: 'Escape', [flag]: true, preventDefault() {} });
        const retained = panel.isConnected; ui.destroy();
        assert.equal(retained, true);
    });
}
