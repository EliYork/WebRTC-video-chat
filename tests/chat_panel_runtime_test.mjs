import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const readSource = (path) =>
    readFileSync(new URL(path, import.meta.url), 'utf8');

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.defaultPrevented = false;
        Object.assign(this, options);
    }

    preventDefault() {
        this.defaultPrevented = true;
    }
}

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

    dispatchEvent(event) {
        event.target = this;
        Array.from(this.listeners.get(event.type) || []).forEach((listener) =>
            listener(event)
        );
        return !event.defaultPrevented;
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }
}

class FakeClassList {
    constructor(element) {
        this.element = element;
    }

    get values() {
        return new Set(this.element.className.split(/\s+/).filter(Boolean));
    }

    write(values) {
        this.element.className = Array.from(values).join(' ');
    }

    add(...names) {
        const values = this.values;
        names.forEach((name) => values.add(name));
        this.write(values);
    }

    remove(...names) {
        const values = this.values;
        names.forEach((name) => values.delete(name));
        this.write(values);
    }

    contains(name) {
        return this.values.has(name);
    }

    toggle(name, force) {
        const values = this.values;
        const enabled =
            force === undefined ? !values.has(name) : Boolean(force);
        if (enabled) {
            values.add(name);
        } else {
            values.delete(name);
        }
        this.write(values);
        return enabled;
    }
}

class FakeElement extends FakeEventTarget {
    constructor(document, tagName) {
        super();
        this.ownerDocument = document;
        this.tagName = tagName.toUpperCase();
        this.nodeName = this.tagName;
        this.children = [];
        this.parentNode = null;
        this.id = '';
        this.className = '';
        this.classList = new FakeClassList(this);
        this.dataset = {};
        this.attributes = new Map();
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this.maxLength = -1;
        this.placeholder = '';
        this.scrollTop = 0;
        this._textContent = '';
    }

    get textContent() {
        return (
            this._textContent +
            this.children.map((child) => child.textContent).join('')
        );
    }

    set textContent(value) {
        this.children.slice().forEach((child) => child.remove());
        this._textContent = String(value ?? '');
    }

    get scrollHeight() {
        return this.children.length * 20;
    }

    append(...nodes) {
        nodes.forEach((node) => {
            if (node.tagName === '#FRAGMENT') {
                node.children.slice().forEach((child) => this.append(child));
                return;
            }
            node.remove();
            node.parentNode = this;
            this.children.push(node);
        });
    }

    prepend(node) {
        node.remove();
        node.parentNode = this;
        this.children.unshift(node);
    }

    replaceChildren(...nodes) {
        this.children.slice().forEach((child) => child.remove());
        this._textContent = '';
        this.append(...nodes);
    }

    remove() {
        if (!this.parentNode) {
            return;
        }
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) {
            this.parentNode.children.splice(index, 1);
        }
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'id') {
            this.id = String(value);
        }
        if (name === 'class') {
            this.className = String(value);
        }
        if (name === 'type') {
            this.type = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    matches(selector) {
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }
        if (selector === 'button[type="submit"]') {
            return this.tagName === 'BUTTON' && this.type === 'submit';
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    querySelector(selector) {
        for (const child of this.children) {
            if (child.matches(selector)) {
                return child;
            }
            const nested = child.querySelector(selector);
            if (nested) {
                return nested;
            }
        }
        return null;
    }

    querySelectorAll(selector) {
        const matches = [];
        for (const child of this.children) {
            if (child.matches(selector)) {
                matches.push(child);
            }
            matches.push(...child.querySelectorAll(selector));
        }
        return matches;
    }

    focus() {
        if (this.ownerDocument.activeElement === this) return;
        this.ownerDocument.activeElement = this;
        this.ownerDocument.dispatchEvent(new FakeEvent('focusin'));
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.activeElement = null;
        this.body = this.createElement('body');
        this.hidden = false;
        this.hasFocus = () => true;
        this.fragmentCount = 0;
    }

    createElement(tagName) {
        return new FakeElement(this, tagName);
    }

    createDocumentFragment() {
        this.fragmentCount += 1;
        return new FakeElement(this, '#fragment');
    }
}

const createFakeTransport = (initialState = 'connected') => {
    const handlers = {
        connection: new Set(),
        history: new Set(),
        message: new Set(),
    };
    const transport = {
        handlers,
        joinCalls: [],
        sendCalls: [],
        unsubscribeCount: 0,
        sendImplementation: () => Promise.resolve({ ok: true }),
        joinRoom(roomId) {
            this.joinCalls.push(roomId);
            return initialState === 'connected';
        },
        sendMessage(payload) {
            this.sendCalls.push(payload);
            return this.sendImplementation(payload);
        },
        subscribeConnectionState(handler) {
            handlers.connection.add(handler);
            handler(initialState);
            return () => {
                if (handlers.connection.delete(handler)) {
                    this.unsubscribeCount += 1;
                }
            };
        },
        subscribeHistory(handler) {
            handlers.history.add(handler);
            return () => {
                if (handlers.history.delete(handler)) {
                    this.unsubscribeCount += 1;
                }
            };
        },
        subscribeMessage(handler) {
            handlers.message.add(handler);
            return () => {
                if (handlers.message.delete(handler)) {
                    this.unsubscribeCount += 1;
                }
            };
        },
        subscribePersistence(handler) {
            handlers.persistence ||= new Set();
            handlers.persistence.add(handler);
            return () => { if (handlers.persistence.delete(handler)) this.unsubscribeCount += 1; };
        },
        emitPersistence(status) { handlers.persistence?.forEach(handler => handler(status)); },
        emitConnection(state) {
            handlers.connection.forEach((handler) => handler(state));
        },
        emitHistory(roomId, messages, persistence) {
            handlers.history.forEach((handler) =>
                handler({ messages, roomId, persistence })
            );
        },
        emitMessage(message) {
            handlers.message.forEach((handler) => handler(message));
        },
    };
    return transport;
};

const loadChatModules = () => {
    const document = new FakeDocument();
    const storage = new Map();
    const warnings = [];
    const window = {
        console: {
            warn: (...args) => warnings.push(args),
        },
        document,
        VoiceViewUtils: {
            createGuestName: () => 'Guest-1000',
            formatTime: (value) => `time:${value || ''}`,
            safeStorageGet: (key) => storage.get(key),
            safeStorageSet: (key, value) => storage.set(key, value),
            setText: (element, value) => {
                element.textContent = String(value ?? '');
            },
        },
    };
    const context = vm.createContext({ window });

    [
        '../src/views/js/chat/chat-name-state.js',
        '../src/views/js/chat/chat-message-ui.js',
        '../src/views/js/chat/chat-form-ui.js',
        '../src/views/js/chat/chat-panel-runtime.js',
    ].forEach((path) => vm.runInContext(readSource(path), context));

    return { document, warnings, window };
};

const createFixture = ({ includeName = true, omit } = {}) => {
    const { document, warnings, window } = loadChatModules();
    const root = document.createElement('aside');
    root.id = 'chat-panel';
    const nameInput = includeName ? document.createElement('input') : null;
    if (nameInput) {
        nameInput.id = 'chatName';
        nameInput.maxLength = 32;
    }
    const messages = document.createElement('ol');
    messages.id = 'chatMessages';
    const form = document.createElement('form');
    form.id = 'chatForm';
    const input = document.createElement('textarea');
    input.id = 'chatInput';
    input.maxLength = 500;
    const button = document.createElement('button');
    button.setAttribute('type', 'submit');
    if (omit !== 'input') {
        form.append(input);
    }
    if (omit !== 'button') {
        form.append(button);
    }
    if (nameInput) {
        root.append(nameInput);
    }
    if (omit !== 'messages') {
        root.append(messages);
    }
    if (omit !== 'form') {
        root.append(form);
    }
    return {
        button,
        document,
        form,
        input,
        messages,
        nameInput,
        root,
        warnings,
        window,
    };
};

const createRuntimeFixture = (options = {}) => {
    const fixture = createFixture(options);
    const transport = options.transport || createFakeTransport();
    const displayNames = [];
    const runtime = fixture.window.VoiceChatPanelRuntime.createChatPanelRuntime(
        {
            root: fixture.root,
            transport,
            messageView: fixture.window.VoiceChatMessageUI,
            formView: fixture.window.VoiceChatFormUI,
            nameState: fixture.window.VoiceChatNameState,
            formatTime: fixture.window.VoiceViewUtils.formatTime,
            onDisplayNameChange: (name) => displayNames.push(name),
            onLiveMessage: options.onLiveMessage,
            onRoomChange: options.onRoomChange,
            onConnectionStateChange: options.onConnectionStateChange,
            logger: fixture.window.console,
        }
    );
    return { ...fixture, displayNames, runtime, transport };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('navigation callbacks receive deduplicated live messages, room changes and connection state', () => {
    const live = [], rooms = [], states = [];
    const f = createRuntimeFixture({ onLiveMessage: m => live.push(m), onRoomChange: r => rooms.push(r), onConnectionStateChange: s => states.push(s) });
    f.runtime.init(); f.runtime.setRoom('lobby');
    const message = { id: 'message-1', roomId: 'lobby', content: 'hello', senderName: 'Guest' };
    f.transport.emitHistory('lobby', [message]);
    assert.equal(live.length, 0, 'history is never unread traffic');
    f.transport.emitMessage(message);
    f.transport.emitMessage({ ...message, id: 'wrong-room', roomId: 'other' });
    assert.equal(live.length, 0, 'duplicates and other rooms never notify');
    f.transport.emitMessage({ ...message, id: 'message-2' });
    assert.equal(live.length, 1);
    f.runtime.setRoom('lobby'); assert.deepEqual(rooms, ['lobby']);
    f.transport.emitConnection('reconnecting'); assert.equal(states.at(-1), 'reconnecting');
    f.runtime.destroy(); f.transport.emitMessage({ ...message, id: 'late' });
    assert.equal(live.length, 1);
});

test('incoming chat preserves the reading position and follows the bottom only when already there', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    Object.defineProperty(f.messages, 'scrollHeight', { value: 1000 });
    Object.assign(f.messages, { clientHeight: 200, scrollTop: 100 });
    f.transport.emitMessage({ id: 'reading', roomId: 'lobby', content: 'new message' });
    assert.equal(f.messages.scrollTop, 100);
    f.messages.scrollTop = 800;
    f.transport.emitMessage({ id: 'following', roomId: 'lobby', content: 'next message' });
    assert.equal(f.messages.scrollTop, 1000);
});

const installChatGeometry = (f) => {
    f.messages.clientHeight = 100;
    f.messages.getBoundingClientRect = () => ({ top: 0, bottom: 100 });
    const createElement = f.document.createElement.bind(f.document);
    f.document.createElement = tag => {
        const item = createElement(tag);
        item.getBoundingClientRect = () => {
            const top = item.parentNode === f.messages ? f.messages.children.indexOf(item) * 20 - f.messages.scrollTop : 0;
            return { top, bottom: top + 20 };
        };
        return item;
    };
};

test('saved panel position follows a stable message across hidden trimming', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const view = f.window.VoiceChatMessageUI;
    const message = n => ({ id: `panel-${n}`, roomId: 'lobby', content: `panel ${n}` });
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', Array.from({ length: 500 }, (_, n) => message(n)));
    f.messages.scrollTop = 5003;
    const position = view.captureReadingPosition(f.messages);
    let hidden = true;
    Object.defineProperty(f.messages, 'scrollHeight', { get: () => hidden ? 0 : f.messages.children.length * 20 });
    f.messages.scrollTop = 0;
    for (let n = 500; n < 520; n++) f.transport.emitMessage(message(n));
    hidden = false;
    view.restoreReadingPosition(f.messages, position);
    const anchor = f.messages.querySelectorAll('.chat-message').find(row => row.children[1].textContent === 'panel 250');
    assert.equal(anchor.getBoundingClientRect().top, -3);
    assert.equal(f.messages.scrollTop, 4623);
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 500);
    assert.equal(Object.values(position).every(value => typeof value !== 'object'), true, 'saved position retains no DOM node');
    f.runtime.destroy();
});

test('saved panel position finds the replacement row after hidden history refresh', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const view = f.window.VoiceChatMessageUI;
    const message = n => ({ id: `panel-refresh-${n}`, roomId: 'lobby', content: `panel refresh ${n}` });
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n)));
    f.messages.scrollTop = 103;
    const oldAnchor = f.messages.children[5];
    const position = view.captureReadingPosition(f.messages);
    f.messages.scrollTop = 0;
    f.runtime.rejoinCurrentRoom();
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n + 2)));
    view.restoreReadingPosition(f.messages, position);
    const anchor = f.messages.querySelectorAll('.chat-message').find(row => row.children[1].textContent === 'panel refresh 5');
    assert.notEqual(anchor, oldAnchor);
    assert.equal(anchor.getBoundingClientRect().top, -3);
    assert.equal(f.messages.scrollTop, 63);
    f.runtime.destroy();
});

test('saved panel position falls back to the remaining top if its identified message disappeared', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const view = f.window.VoiceChatMessageUI;
    const message = n => ({ id: `panel-missing-${n}`, roomId: 'lobby', content: `panel missing ${n}` });
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n)));
    f.messages.scrollTop = 103;
    const position = view.captureReadingPosition(f.messages);
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n + 20)));
    f.messages.scrollTop = 80;
    view.restoreReadingPosition(f.messages, position);
    assert.equal(f.messages.scrollTop, 0);
    f.runtime.destroy();
});

test('same-room history refresh preserves a surviving reading row relative to the list viewport', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const message = n => ({ id: `reading-${n}`, roomId: 'lobby', content: `reading ${n}` });
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n)));
    f.messages.scrollTop = 100;
    const findReadingRow = () => f.messages.querySelectorAll('.chat-message').find(row => row.children[1].textContent === 'reading 5');
    const before = findReadingRow().getBoundingClientRect().top;
    f.runtime.rejoinCurrentRoom();
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n + 2)));
    assert.equal(findReadingRow().getBoundingClientRect().top, before);
    assert.equal(f.messages.scrollTop, 60);
    assert.equal(f.root.getAttribute('aria-busy'), 'false');
    f.runtime.destroy();
});

test('history refresh falls back to the remaining top when no visible reading row survives', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const message = n => ({ id: `missing-${n}`, roomId: 'lobby', content: `missing ${n}` });
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n)));
    f.messages.scrollTop = 100;
    f.runtime.rejoinCurrentRoom();
    f.transport.emitHistory('lobby', Array.from({ length: 20 }, (_, n) => message(n + 20)));
    assert.equal(f.messages.scrollTop, 0);
    assert.match(f.messages.querySelector('.chat-message').textContent, /missing 20/);
    f.runtime.destroy();
});

test('history refresh follows the bottom when already there and a new room starts at its latest messages', () => {
    const f = createRuntimeFixture(); installChatGeometry(f);
    const history = roomId => Array.from({ length: 20 }, (_, n) => ({ id: `${roomId}-${n}`, roomId, content: `${roomId} ${n}` }));
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', history('lobby'));
    f.messages.scrollTop = f.messages.scrollHeight - f.messages.clientHeight;
    f.runtime.rejoinCurrentRoom(); f.transport.emitHistory('lobby', history('lobby'));
    assert.equal(f.messages.scrollTop, f.messages.scrollHeight);
    f.messages.scrollTop = 100;
    f.runtime.setRoom('game'); f.transport.emitHistory('game', history('game'));
    assert.equal(f.messages.scrollTop, f.messages.scrollHeight);
    f.runtime.destroy();
});

test('init is idempotent and owns one set of form/input/name listeners', () => {
    const fixture = createRuntimeFixture();

    assert.equal(fixture.runtime.init(), true);
    assert.equal(fixture.runtime.init(), false);
    assert.equal(fixture.form.listenerCount('submit'), 1);
    assert.equal(fixture.input.listenerCount('input'), 1);
    assert.equal(fixture.input.listenerCount('keydown'), 1);
    assert.equal(fixture.input.listenerCount('compositionstart'), 1);
    assert.equal(fixture.input.listenerCount('compositionend'), 1);
    assert.equal(fixture.nameInput.listenerCount('change'), 1);
    assert.equal(fixture.document.listenerCount('focusin'), 1);
    assert.equal(fixture.root.querySelectorAll('.chat-panel-status').length, 1);
});

test('missing optional name input degrades safely; missing required DOM fails before binding', () => {
    const optional = createRuntimeFixture({ includeName: false });
    assert.equal(optional.runtime.init(), true);
    assert.equal(optional.runtime.getDisplayName(), 'Guest-1000');

    for (const omit of ['form', 'input', 'button', 'messages']) {
        const fixture = createRuntimeFixture({ omit });
        assert.throws(
            () => fixture.runtime.init(),
            /Chat Panel is missing required element/
        );
        assert.equal(fixture.transport.handlers.history.size, 0);
        assert.equal(fixture.form.listenerCount('submit'), 0);
        assert.equal(fixture.input.listenerCount('input'), 0);
    }
});

test('subscription failure rolls back without a half-initialized component', () => {
    const transport = createFakeTransport();
    transport.subscribeMessage = () => {
        throw new Error('subscribe failed');
    };
    const fixture = createRuntimeFixture({ transport });

    assert.throws(() => fixture.runtime.init(), /subscribe failed/);
    assert.equal(transport.unsubscribeCount, 1);
    assert.equal(fixture.form.listenerCount('submit'), 0);
    assert.equal(fixture.input.listenerCount('input'), 0);
    assert.equal(fixture.root.querySelector('.chat-panel-status'), null);
});

test('room readiness, blank content, and disconnected state block sends', async () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.input.value = 'hello';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 0);

    fixture.runtime.setRoom('lobby');
    fixture.input.value = '   ';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 0);

    fixture.transport.emitConnection('reconnecting');
    fixture.input.value = 'offline message';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 0);
    assert.equal(fixture.button.disabled, true);
});

test('normal submit sends once, guards rapid submit, normalizes name, clears, and focuses', async () => {
    const fixture = createRuntimeFixture();
    let resolveSend;
    fixture.transport.sendImplementation = () =>
        new Promise((resolve) => {
            resolveSend = resolve;
        });
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    fixture.nameInput.value = '  Eli  ';
    fixture.input.value = '  hello  ';
    fixture.input.focus();

    fixture.form.dispatchEvent(new FakeEvent('submit'));
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    assert.equal(fixture.transport.sendCalls.length, 1);
    assert.equal(fixture.transport.sendCalls[0].content, 'hello');
    assert.equal(fixture.transport.sendCalls[0].roomId, 'lobby');
    assert.equal(fixture.transport.sendCalls[0].senderName, 'Eli');
    assert.equal(fixture.button.disabled, true);

    resolveSend({ ok: true });
    await flush();
    assert.equal(fixture.input.value, '');
    assert.equal(fixture.document.activeElement, fixture.input);
    assert.deepEqual(fixture.displayNames, ['Eli']);
});

test('Enter submits once while Shift+Enter and Chinese composition do not submit', async () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    fixture.input.value = '中文消息';
    fixture.input.dispatchEvent(new FakeEvent('compositionstart'));
    fixture.input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 0);

    fixture.input.dispatchEvent(new FakeEvent('compositionend'));
    fixture.input.dispatchEvent(
        new FakeEvent('keydown', { key: 'Enter', shiftKey: true })
    );
    assert.equal(fixture.transport.sendCalls.length, 0);

    fixture.input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 1);
});

test('a successful acknowledgement preserves a draft edited away from and back to its submitted text', async () => {
    const f = createRuntimeFixture(); let finish;
    f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'same final text'; f.form.dispatchEvent(new FakeEvent('submit'));
    f.input.value = 'temporary edit'; f.input.dispatchEvent(new FakeEvent('input'));
    f.input.value = 'same final text'; f.input.dispatchEvent(new FakeEvent('input'));
    f.nameInput.focus();
    finish({ ok: true }); await flush();
    assert.equal(f.input.value, 'same final text');
    assert.equal(f.document.activeElement, f.nameInput);
    assert.equal(f.button.disabled, false); assert.equal(f.button.getAttribute('aria-busy'), 'false');
    assert.equal(f.transport.sendCalls.length, 1);
    // A later explicit submission owns this unchanged draft and can clear it.
    f.form.dispatchEvent(new FakeEvent('submit')); finish({ ok: true }); await flush();
    assert.equal(f.input.value, ''); assert.equal(f.transport.sendCalls.length, 2);
    f.runtime.destroy();
});

test('a successful acknowledgement cannot clear a draft after composition starts even before text changes', async () => {
    const f = createRuntimeFixture(); let finish;
    f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = '组合输入前的原文'; f.form.dispatchEvent(new FakeEvent('submit'));
    f.input.dispatchEvent(new FakeEvent('compositionstart'));
    finish({ ok: true }); await flush();
    assert.equal(f.input.value, '组合输入前的原文');
    assert.equal(f.button.getAttribute('aria-busy'), 'false');
    f.form.dispatchEvent(new FakeEvent('submit'));
    f.input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    assert.equal(f.transport.sendCalls.length, 1, 'ACK does not end composition or resubmit');
    f.input.dispatchEvent(new FakeEvent('compositionend'));
    f.form.dispatchEvent(new FakeEvent('submit')); finish({ ok: true }); await flush();
    assert.equal(f.input.value, ''); assert.equal(f.transport.sendCalls.length, 2);
    f.runtime.destroy();
});

test('successful send clears unchanged text without reclaiming focus after another control was used', async () => {
    await Promise.all([false, true].map(async blurToBody => {
        const f = createRuntimeFixture(); let finish;
        f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
        f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
        f.input.value = 'sent unchanged'; f.button.focus();
        f.form.dispatchEvent(new FakeEvent('submit'));
        f.document.activeElement = f.document.body; // Native disabled-button blur.
        f.nameInput.focus();
        if (blurToBody) f.document.activeElement = f.document.body;
        const focused = f.document.activeElement;
        finish({ ok: true }); await flush();
        assert.equal(f.input.value, '');
        assert.equal(f.document.activeElement, focused);
        assert.equal(f.transport.sendCalls.length, 1);
        f.runtime.destroy();
    }));
});

test('successful send does not request focus in a hidden or unfocused document', async () => {
    await Promise.all([{ hidden: true, focused: true }, { hidden: false, focused: false }].map(async state => {
        const f = createRuntimeFixture(); let finish, focusCalls = 0;
        f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
        f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
        f.input.value = 'sent before backgrounding'; f.input.focus();
        f.form.dispatchEvent(new FakeEvent('submit'));
        f.document.hidden = state.hidden; f.document.hasFocus = () => state.focused;
        f.input.focus = () => { focusCalls++; };
        finish({ ok: true }); await flush();
        assert.equal(f.input.value, ''); assert.equal(focusCalls, 0);
        f.runtime.destroy();
    }));
});

test('successful button send restores input focus after only its native disabled-button blur', async () => {
    const f = createRuntimeFixture(); let finish;
    f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'normal button send'; f.button.focus();
    f.form.dispatchEvent(new FakeEvent('submit'));
    f.document.activeElement = f.document.body;
    finish({ ok: true }); await flush();
    assert.equal(f.input.value, ''); assert.equal(f.document.activeElement, f.input);
    f.runtime.destroy();
});

test('send failure preserves input and renders one controlled error', async () => {
    const fixture = createRuntimeFixture();
    fixture.transport.sendImplementation = () =>
        Promise.reject(new Error('network failed'));
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    fixture.input.value = 'retry me';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();

    assert.equal(fixture.input.value, 'retry me');
    const status = fixture.root.querySelector('.chat-panel-status');
    assert.match(status.textContent, /发送失败/);
    assert.equal(status.dataset.statusKind, 'error');
    assert.equal(fixture.warnings.length, 1);
});

test('connection notices temporarily outrank an explicit send rejection and preserve its unchanged draft', async () => {
    const f = createRuntimeFixture();
    f.transport.sendImplementation = () => Promise.reject(new Error('server rejected'));
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'rejected draft'; f.form.dispatchEvent(new FakeEvent('submit')); await flush();
    const status = f.root.querySelector('.chat-panel-status');
    assert.equal(status.dataset.statusKind, 'error');
    for (const [state, notice] of [['offline', /当前离线/], ['reconnecting', /重新连接/], ['connecting', /正在连接/], ['failed', /连接失败/]]) {
        f.transport.emitConnection(state);
        assert.equal(status.dataset.statusKind, 'connection');
        assert.match(status.textContent, notice);
        assert.equal(f.button.disabled, true); assert.equal(f.input.value, 'rejected draft');
        f.transport.emitConnection('connected');
        assert.equal(status.dataset.statusKind, 'error'); assert.match(status.textContent, /发送失败/);
    }
    assert.equal(f.transport.sendCalls.length, 1);
    f.runtime.destroy();
});

test('editing a rejected draft while offline clears only its send error and keeps connection and storage notices', async () => {
    const f = createRuntimeFixture();
    f.transport.sendImplementation = () => Promise.reject(new Error('server rejected'));
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'rejected draft'; f.form.dispatchEvent(new FakeEvent('submit')); await flush();
    const status = f.root.querySelector('.chat-panel-status');
    f.transport.emitPersistence({ roomId: 'lobby', state: 'failed', revision: 2 });
    assert.equal(status.dataset.statusKind, 'error');
    f.transport.emitConnection('offline');
    assert.match(status.textContent, /当前离线/);
    f.input.value = 'edited offline'; f.input.dispatchEvent(new FakeEvent('input'));
    assert.match(status.textContent, /当前离线/); assert.equal(status.dataset.statusKind, 'connection');
    f.transport.emitConnection('connected'); f.runtime.rejoinCurrentRoom();
    f.transport.emitHistory('lobby', [], { state: 'failed', revision: 3 });
    assert.match(status.textContent, /暂未保存/); assert.doesNotMatch(status.textContent, /发送失败/);
    assert.equal(f.input.value, 'edited offline'); assert.equal(f.button.disabled, false);
    assert.equal(f.transport.sendCalls.length, 1);
    f.transport.emitPersistence({ roomId: 'lobby', state: 'saved', revision: 4 });
    assert.equal(status.hidden, true);
    f.runtime.destroy();
});

test('reconnect releases a pending send and old completion cannot unlock or clear a newer send', async () => {
    const f = createRuntimeFixture(), completions = [];
    f.transport.sendImplementation = () => new Promise(resolve => completions.push(resolve));
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', []);
    f.input.value = 'first'; f.form.dispatchEvent(new FakeEvent('submit'));
    f.transport.emitConnection('reconnecting'); f.transport.emitConnection('connected');
    f.runtime.rejoinCurrentRoom(); f.transport.emitHistory('lobby', []);
    assert.equal(f.button.disabled, false, 'rejoined chat must not remain stuck sending');
    assert.equal(f.button.getAttribute('aria-busy'), 'false');
    assert.match(f.root.querySelector('.chat-panel-status').textContent, /核对聊天记录/);
    f.input.value = 'new draft'; f.input.dispatchEvent(new FakeEvent('input'));
    f.form.dispatchEvent(new FakeEvent('submit')); assert.equal(f.transport.sendCalls.length, 2);
    completions[0]({ ok: true }); await flush();
    assert.equal(f.input.value, 'new draft'); assert.equal(f.button.disabled, true);
    completions[1]({ ok: true }); await flush();
    assert.equal(f.input.value, ''); assert.equal(f.button.getAttribute('aria-busy'), 'false');
});

test('offline invalidates the pending completion before reconnect and preserves its draft', async () => {
    const f = createRuntimeFixture(); let finish;
    f.transport.sendImplementation = () => new Promise(resolve => { finish = resolve; });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'check before resending';
    f.form.dispatchEvent(new FakeEvent('submit')); f.transport.emitConnection('offline');
    finish({ ok: true }); await flush();
    assert.equal(f.input.value, 'check before resending'); assert.equal(f.button.disabled, true);
    assert.equal(f.button.getAttribute('aria-busy'), 'false');
    f.transport.emitConnection('connected'); f.runtime.rejoinCurrentRoom();
    assert.equal(f.button.disabled, true, 'the new join is still waiting for history');
    f.transport.emitHistory('lobby', []);
    assert.equal(f.button.disabled, false); assert.equal(f.transport.sendCalls.length, 1);
    f.runtime.setRoom('game'); assert.equal(f.root.querySelector('.chat-panel-status').textContent, '正在同步聊天记录…');
});

test('same-room rejoin releases pending send ownership even without a disconnect event', async () => {
    const f = createRuntimeFixture(); let reject;
    f.transport.sendImplementation = () => new Promise((_, fail) => { reject = fail; });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'still editable';
    f.form.dispatchEvent(new FakeEvent('submit')); f.runtime.rejoinCurrentRoom();
    assert.equal(f.button.disabled, true);
    assert.equal(f.button.getAttribute('aria-busy'), 'false', 'old sending ownership is released even while history loads');
    reject(Error('late failure')); await flush();
    assert.equal(f.input.value, 'still editable'); assert.equal(f.warnings.length, 0);
    assert.doesNotMatch(f.root.querySelector('.chat-panel-status').textContent, /发送失败/);
    f.transport.emitHistory('lobby', []);
    assert.equal(f.button.disabled, false);
});

test('uncertain delivery preserves draft and asks to check history without reporting rejection', async () => {
    const f = createRuntimeFixture();
    f.transport.sendImplementation = () => Promise.reject(Object.assign(Error('ack timed out'), { deliveryUncertain: true }));
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    f.input.value = 'possibly delivered';
    f.form.dispatchEvent(new FakeEvent('submit')); await flush();
    const status = f.root.querySelector('.chat-panel-status');
    assert.equal(f.input.value, 'possibly delivered'); assert.equal(f.button.disabled, false);
    assert.match(status.textContent, /未确认.*核对聊天记录/); assert.doesNotMatch(status.textContent, /发送失败/);
    assert.equal(status.dataset.statusKind, 'warning');
    f.transport.emitConnection('reconnecting'); assert.equal(status.dataset.statusKind, 'connection');
    f.transport.emitConnection('connected'); assert.match(status.textContent, /未确认/);
    f.transport.emitPersistence({ roomId: 'lobby', state: 'failed', revision: 2 });
    assert.match(status.textContent, /未确认/);
    f.input.value = 'different draft'; f.input.dispatchEvent(new FakeEvent('input'));
    assert.match(status.textContent, /暂未保存/); assert.equal(f.transport.sendCalls.length, 1);
});

test('accepted messages with storage failure clear the submitted draft and show no resend instruction', async () => {
    const f=createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', []);
    f.transport.sendImplementation=()=>Promise.resolve({ok:true,messageId:'accepted',persistence:{state:'failed',revision:2}});
    f.input.value='accepted once'; f.form.dispatchEvent(new FakeEvent('submit')); await flush();
    const status=f.root.querySelector('.chat-panel-status');
    assert.equal(f.input.value,''); assert.equal(f.transport.sendCalls.length,1);
    assert.equal(status.dataset.statusKind,'warning'); assert.match(status.textContent,/无需重发/);
    f.input.value='new draft'; f.input.dispatchEvent(new FakeEvent('input'));
    assert.match(status.textContent,/暂未保存/);
    f.transport.emitPersistence({roomId:'lobby',state:'saved',revision:3});
    assert.equal(status.hidden,true); assert.equal(f.input.value,'new draft');
    f.transport.emitPersistence({roomId:'lobby',state:'pending',revision:1});
    assert.equal(status.hidden,true);
    f.runtime.destroy();
});

test('history storage state is isolated by room and reset after reconnect to a restarted server', () => {
    const f=createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby',[],{state:'failed',revision:20});
    const status=f.root.querySelector('.chat-panel-status'); assert.match(status.textContent,/暂未保存/);
    f.runtime.setRoom('game'); assert.equal(status.textContent,'正在同步聊天记录…');
    f.transport.emitPersistence({roomId:'lobby',state:'failed',revision:21}); assert.equal(status.textContent,'正在同步聊天记录…');
    f.transport.emitHistory('game',[],{state:'failed',revision:22}); assert.equal(status.dataset.statusKind,'warning');
    f.transport.emitConnection('reconnecting'); assert.equal(status.dataset.statusKind,'connection');
    f.transport.emitConnection('connected');
    f.transport.emitHistory('game',[],{state:'saved',revision:0}); assert.equal(status.hidden,true);
    f.runtime.destroy(); f.transport.emitPersistence({roomId:'game',state:'failed',revision:30});
    assert.equal(f.transport.handlers.persistence.size,0);
});

test('late acceptance cannot overwrite a newer save status or leak storage errors across a room switch', async () => {
    const f=createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', []);
    let finish; f.transport.sendImplementation=()=>new Promise(resolve=>{finish=resolve;});
    f.input.value='first'; f.form.dispatchEvent(new FakeEvent('submit'));
    f.transport.emitPersistence({roomId:'lobby',state:'saved',revision:4});
    finish({ok:true,persistence:{state:'failed',revision:2}}); await flush();
    const status=f.root.querySelector('.chat-panel-status'); assert.equal(status.hidden,true);
    f.input.value='second'; f.form.dispatchEvent(new FakeEvent('submit'));
    f.runtime.setRoom('game'); finish({ok:true,persistence:{state:'failed',revision:5}}); await flush();
    assert.equal(status.textContent,'正在同步聊天记录…'); assert.equal(f.input.value,'second'); f.runtime.destroy();
});

test('room switches are isolated, same-room set is idempotent, and stale events are rejected', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    assert.equal(fixture.runtime.setRoom('lobby'), true);
    assert.equal(fixture.runtime.setRoom('lobby'), false);
    fixture.transport.emitHistory('lobby', [
        { id: 'l1', roomId: 'lobby', senderName: 'A', content: 'lobby' },
    ]);
    assert.match(fixture.messages.textContent, /lobby/);

    fixture.runtime.setRoom('game');
    fixture.transport.emitHistory('lobby', [
        { id: 'late', roomId: 'lobby', senderName: 'A', content: 'late' },
    ]);
    fixture.transport.emitMessage({
        id: 'old-live',
        roomId: 'lobby',
        senderName: 'A',
        content: 'old live',
    });
    assert.doesNotMatch(fixture.messages.textContent, /late|old live/);
    fixture.transport.emitHistory('game', []);
    assert.match(fixture.messages.textContent, /暂无消息/);

    fixture.runtime.setRoom('project');
    fixture.transport.emitHistory('project', [
        {
            id: 'p1',
            roomId: 'project',
            senderName: 'B',
            content: 'project only',
        },
    ]);
    assert.match(fixture.messages.textContent, /project only/);
    assert.deepEqual(fixture.transport.joinCalls, ['lobby', 'game', 'project']);
});

test('history and live messages share the safe renderer, use a fragment, and dedupe stable ids', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    const unsafeText = '<img src=x onerror=alert(1)>';
    fixture.transport.emitMessage({
        id: 'same',
        roomId: 'lobby',
        senderName: '<b>Eli</b>',
        content: unsafeText,
    });
    fixture.transport.emitHistory('lobby', [
        {
            id: 'same',
            roomId: 'lobby',
            senderName: '<b>Eli</b>',
            content: unsafeText,
        },
        { id: 'two', roomId: 'lobby', senderName: 'B', content: 'second' },
    ]);

    const items = fixture.messages.querySelectorAll('.chat-message');
    assert.equal(items.length, 2);
    assert.equal(items[0].children[1].textContent, unsafeText);
    assert.equal(items[0].children[1].children.length, 0);
    assert.equal(fixture.document.fragmentCount, 1);
    assert.equal(fixture.messages.scrollTop, fixture.messages.scrollHeight);

    fixture.transport.emitMessage({
        id: 'two',
        roomId: 'lobby',
        senderName: 'B',
        content: 'second',
    });
    assert.equal(fixture.messages.querySelectorAll('.chat-message').length, 2);
});

test('large history takes one fragment path and keeps all safe message nodes', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    const history = Array.from({ length: 100 }, (_, index) => ({
        id: `history-${index}`,
        roomId: 'lobby',
        senderName: 'Batch',
        content: `message ${index}`,
    }));
    fixture.transport.emitHistory('lobby', history);
    assert.equal(
        fixture.messages.querySelectorAll('.chat-message').length,
        100
    );
    assert.equal(fixture.document.fragmentCount, 1);
    assert.equal(fixture.messages.scrollTop, fixture.messages.scrollHeight);
});

test('long live chat retains 500 rows, one retention notice and a bounded recent duplicate window', () => {
    const live = [], f = createRuntimeFixture({ onLiveMessage: m => live.push(m.id) });
    f.runtime.init(); f.runtime.setRoom('lobby'); f.transport.emitHistory('lobby', []);
    const message = n => ({ id: `long-${n}`, roomId: 'lobby', content: `message ${n}` });
    for (let n = 0; n < 2000; n++) f.transport.emitMessage(message(n));
    const items = f.messages.querySelectorAll('.chat-message');
    assert.equal(items.length, 500); assert.equal(items[0].children[1].textContent, 'message 1500');
    assert.equal(items.at(-1).children[1].textContent, 'message 1999');
    assert.equal(f.messages.querySelectorAll('.chat-retention-note').length, 1);
    assert.match(f.messages.querySelector('.chat-retention-note').textContent, /最近 500 条/);
    assert.equal(live.length, 2000);
    f.transport.emitMessage(message(1000)); f.transport.emitMessage(message(1999));
    assert.equal(live.length, 2000, 'recent duplicates never render or notify again');
    f.transport.emitMessage(message(0));
    assert.equal(live.length, 2001, 'expired duplicate IDs leave the bounded window');
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 500);
    f.runtime.setRoom('game'); assert.equal(f.messages.querySelector('.chat-retention-note'), null);
});

test('large history and live-before-history merging retain only the latest 500 unique messages', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    const message = n => ({ id: `queued-${n}`, roomId: 'lobby', content: `queued ${n}` });
    for (let n = 0; n < 1600; n++) f.transport.emitMessage(message(n));
    f.transport.emitHistory('lobby', Array.from({ length: 1500 }, (_, n) => message(n)));
    const items = f.messages.querySelectorAll('.chat-message');
    assert.equal(items.length, 500); assert.equal(items[0].children[1].textContent, 'queued 1100');
    assert.equal(items.at(-1).children[1].textContent, 'queued 1599');
    assert.equal(f.messages.querySelectorAll('.chat-retention-note').length, 1);
    assert.equal(f.root.getAttribute('aria-busy'), 'false');
    f.runtime.clearMessages(); assert.equal(f.messages.children.length, 0);
    f.transport.emitMessage(message(1599)); assert.equal(f.messages.querySelectorAll('.chat-message').length, 1);
    const large = Array.from({ length: 2200 }, (_, n) => message(n));
    f.transport.emitHistory('lobby', large);
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 500);
    assert.equal(f.messages.querySelectorAll('.chat-message')[0].children[1].textContent, 'queued 1700');
});

test('messages without protocol ids are not given unsafe strong dedupe semantics', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    const message = { roomId: 'lobby', senderName: 'A', content: 'same text' };
    fixture.transport.emitHistory('lobby', []);
    fixture.transport.emitMessage(message);
    fixture.transport.emitMessage(message);
    assert.equal(fixture.messages.querySelectorAll('.chat-message').length, 2);
});

test('history overlap keeps earlier live messages before the snapshot and later live messages after it', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    const message = n => ({ id: `overlap-${n}`, roomId: 'lobby', content: `ordered ${n}`, createdAt: '2026-10-22T00:00:00.000Z' });
    [0, 1, 2, 3, 4, 5, 6].forEach(n => f.transport.emitMessage(message(n)));
    f.transport.emitHistory('lobby', [2, 3, 4, 5].map(message));
    assert.deepEqual(f.messages.querySelectorAll('.chat-message').map(item => item.children[1].textContent),
        Array.from({ length: 7 }, (_, n) => `ordered ${n}`));
    f.runtime.destroy();
});

test('overlapping history trims the oldest live rows instead of newer snapshot rows', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    const message = n => ({ id: `bounded-overlap-${n}`, roomId: 'lobby', content: `bounded ${n}` });
    for (let n = 0; n < 500; n++) f.transport.emitMessage(message(n));
    f.transport.emitHistory('lobby', Array.from({ length: 100 }, (_, n) => message(n + 450)));
    const rows = f.messages.querySelectorAll('.chat-message');
    assert.equal(rows.length, 500);
    assert.deepEqual(rows.map(item => item.children[1].textContent), Array.from({ length: 500 }, (_, n) => `bounded ${n + 50}`));
    assert.equal(f.messages.querySelectorAll('.chat-retention-note').length, 1);
    assert.equal(f.root.getAttribute('aria-busy'), 'false');
    f.runtime.destroy();
});

test('history fills live-stream gaps in server order while preserving prefix and suffix messages', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    const message = n => ({ id: `gap-${n}`, roomId: 'lobby', content: `gap ${n}` });
    [0, 2, 4, 6].forEach(n => f.transport.emitMessage(message(n)));
    f.transport.emitHistory('lobby', [1, 2, 3, 4, 5].map(message));
    assert.deepEqual(f.messages.querySelectorAll('.chat-message').map(item => item.children[1].textContent),
        Array.from({ length: 7 }, (_, n) => `gap ${n}`));
    f.transport.emitMessage(message(4));
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 7, 'overlapping IDs stay deduplicated after history');
    f.runtime.destroy();
});

test('moving the real root preserves identity, listeners, draft, send, receive, and focus API', async () => {
    const fixture = createRuntimeFixture();
    const originalParent = fixture.document.createElement('main');
    const layoutTile = fixture.document.createElement('section');
    originalParent.append(fixture.root);
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    fixture.input.value = 'unfinished';

    layoutTile.append(fixture.root);
    assert.equal(fixture.runtime.getRootElement(), fixture.root);
    assert.equal(fixture.input.value, 'unfinished');
    assert.equal(fixture.runtime.focusInput(), true);
    assert.equal(fixture.document.activeElement, fixture.input);
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 1);
    fixture.transport.emitMessage({
        id: 'moved',
        roomId: 'lobby',
        senderName: 'A',
        content: 'received after move',
    });
    assert.match(fixture.messages.textContent, /received after move/);

    originalParent.append(fixture.root);
    assert.equal(fixture.runtime.getRootElement(), fixture.root);
    assert.equal(fixture.form.listenerCount('submit'), 1);
});

test('reconnect keeps messages and draft, disables sending, then rejoins without clearing', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', [
        { id: 'one', roomId: 'lobby', senderName: 'A', content: 'kept' },
    ]);
    fixture.input.value = 'draft';
    fixture.transport.emitConnection('reconnecting');
    assert.match(fixture.messages.textContent, /kept/);
    assert.equal(fixture.input.value, 'draft');
    assert.equal(fixture.button.disabled, true);

    fixture.transport.emitConnection('connected');
    assert.equal(fixture.runtime.rejoinCurrentRoom(), true);
    assert.match(fixture.messages.textContent, /kept/);
    assert.equal(fixture.input.value, 'draft');
    assert.deepEqual(fixture.transport.joinCalls, ['lobby', 'lobby']);
});

test('connecting, offline, failed, and connected states render controlled availability', () => {
    const fixture = createRuntimeFixture({
        transport: createFakeTransport('connecting'),
    });
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    const status = fixture.root.querySelector('.chat-panel-status');

    fixture.transport.emitConnection('offline');
    assert.match(status.textContent, /离线/);
    assert.equal(fixture.root.dataset.chatConnectionState, 'offline');
    assert.equal(fixture.button.disabled, true);

    fixture.transport.emitConnection('failed');
    assert.match(status.textContent, /连接失败/);
    fixture.transport.emitConnection('connected');
    assert.equal(status.textContent, '正在同步聊天记录…');
    fixture.input.value = 'ready';
    fixture.input.dispatchEvent(new FakeEvent('input'));
    assert.equal(fixture.button.disabled, true);
    fixture.transport.emitHistory('lobby', []);
    assert.equal(fixture.button.disabled, false);
});

test('a late send completion cannot clear the next room draft', async () => {
    const fixture = createRuntimeFixture();
    let resolveSend;
    fixture.transport.sendImplementation = () =>
        new Promise((resolve) => {
            resolveSend = resolve;
        });
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    fixture.input.value = 'lobby draft';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    fixture.runtime.setRoom('game');
    fixture.input.value = 'game draft';
    resolveSend({ ok: true });
    await flush();
    assert.equal(fixture.input.value, 'game draft');
});

test('destroy is idempotent, unsubscribes, blocks late writes/submits, and prohibits re-init', async () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.transport.emitHistory('lobby', []);
    assert.equal(fixture.runtime.destroy(), true);
    assert.equal(fixture.runtime.destroy(), false);
    assert.equal(fixture.transport.unsubscribeCount, 4);
    assert.equal(fixture.document.listenerCount('focusin'), 0);
    assert.equal(fixture.form.listenerCount('submit'), 0);
    assert.equal(fixture.input.listenerCount('input'), 0);
    assert.equal(fixture.root.querySelector('.chat-panel-status'), null);

    fixture.input.value = 'late submit';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    fixture.transport.emitHistory('lobby', [
        { id: 'late', roomId: 'lobby', senderName: 'A', content: 'late' },
    ]);
    fixture.transport.emitMessage({
        id: 'later',
        roomId: 'lobby',
        senderName: 'A',
        content: 'later',
    });
    await flush();
    assert.equal(fixture.transport.sendCalls.length, 0);
    assert.doesNotMatch(fixture.messages.textContent, /late|later/);
    assert.throws(() => fixture.runtime.init(), /cannot be re-initialized/);
});

test('two Chat Panel runtimes keep room, DOM, subscriptions, and state isolated', () => {
    const first = createRuntimeFixture();
    const second = createRuntimeFixture();
    first.runtime.init();
    second.runtime.init();
    first.runtime.setRoom('lobby');
    second.runtime.setRoom('game');
    first.transport.emitHistory('lobby', [
        { id: 'one', roomId: 'lobby', senderName: 'A', content: 'first' },
    ]);
    second.transport.emitHistory('game', [
        { id: 'two', roomId: 'game', senderName: 'B', content: 'second' },
    ]);

    assert.match(first.messages.textContent, /first/);
    assert.doesNotMatch(first.messages.textContent, /second/);
    assert.match(second.messages.textContent, /second/);
    assert.doesNotMatch(second.messages.textContent, /first/);
    first.runtime.destroy();
    second.transport.emitMessage({
        id: 'three',
        roomId: 'game',
        senderName: 'B',
        content: 'still active',
    });
    assert.match(second.messages.textContent, /still active/);
});

class FakeEmitter {
    constructor() {
        this.connected = false;
        this.events = new Map();
        this.emitted = [];
        this.io = new FakeEmitterManager();
    }

    on(name, listener) {
        const listeners = this.events.get(name) || new Set();
        listeners.add(listener);
        this.events.set(name, listeners);
    }

    off(name, listener) {
        this.events.get(name)?.delete(listener);
    }

    emit(name, payload) {
        this.emitted.push({ name, payload });
    }

    receive(name, ...args) {
        this.events.get(name)?.forEach((listener) => listener(...args));
    }

    listenerCount(name) {
        return this.events.get(name)?.size || 0;
    }
}

class FakeEmitterManager {
    constructor() {
        this.events = new Map();
    }

    on(name, listener) {
        const listeners = this.events.get(name) || new Set();
        listeners.add(listener);
        this.events.set(name, listeners);
    }

    off(name, listener) {
        this.events.get(name)?.delete(listener);
    }

    receive(name, payload) {
        this.events.get(name)?.forEach((listener) => listener(payload));
    }

    listenerCount(name) {
        return this.events.get(name)?.size || 0;
    }
}

test('Socket adapter preserves protocol, tags history, reports connection state, and unsubscribes', async () => {
    const socket = new FakeEmitter();
    const window = {};
    vm.runInNewContext(
        readSource('../src/views/js/chat/chat-socket-transport.js'),
        { window }
    );
    const transport = window.VoiceChatSocketTransport.createChatSocketTransport(
        {
            getSocket: () => socket,
        }
    );
    const histories = [];
    const messages = [];
    const states = [];
    const unsubscribers = [
        transport.subscribeHistory((history) => histories.push(history)),
        transport.subscribeMessage((message) => messages.push(message)),
        transport.subscribeConnectionState((state) => states.push(state)),
    ];

    assert.equal(transport.joinRoom('lobby'), false);
    socket.connected = true;
    assert.equal(transport.joinRoom('lobby'), true);
    assert.equal(socket.emitted.at(-1).name, 'chat:join');
    assert.equal(socket.emitted.at(-1).payload.roomId, 'lobby');
    assert.equal(transport.joinRoom('game'), true);
    assert.equal(
        socket.emitted.filter(({ name }) => name === 'chat:join').length,
        1
    );
    socket.receive('chat:history', []);
    assert.equal(socket.emitted.at(-1).payload.roomId, 'game');
    socket.receive('chat:history', []);
    socket.receive('chat:message', { id: 'one', roomId: 'lobby' });
    assert.equal(histories[0].roomId, 'lobby');
    assert.deepEqual(histories[0].messages, []);
    assert.equal(histories[1].roomId, 'game');
    assert.equal(messages[0].id, 'one');

    let acknowledge;
    socket.timeout = (milliseconds) => {
        assert.equal(milliseconds, 8000);
        return {
            emit(name, payload, callback) {
                socket.emit(name, payload);
                acknowledge = callback;
            },
        };
    };
    const sending = transport.sendMessage({
        content: 'hello',
        roomId: 'lobby',
        senderName: 'Eli',
    });
    let completed = false;
    sending.then(() => {
        completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    acknowledge(null, { ok: true, messageId: 'confirmed' });
    await sending;
    const rejected = transport.sendMessage({
        content: 'limited',
        roomId: 'game',
    });
    acknowledge(null, { ok: false, error: 'rate limited' });
    await assert.rejects(rejected, error => error.deliveryUncertain === false && /rate limited/.test(error.message));
    const timedOut = transport.sendMessage({
        content: 'timeout',
        roomId: 'game',
    });
    acknowledge(new Error('timeout'));
    await assert.rejects(timedOut, error => error.deliveryUncertain === true && /服务端确认/.test(error.message));
    const malformed = transport.sendMessage({ content: 'malformed ack', roomId: 'game' });
    acknowledge(null, {});
    await assert.rejects(malformed, error => error.deliveryUncertain === true);
    assert.equal(socket.emitted.at(-1).name, 'chat:send');
    socket.io.receive('reconnect_attempt', 1);
    socket.io.receive('reconnect_failed');
    assert.deepEqual(states, ['connecting', 'reconnecting', 'failed']);

    unsubscribers.forEach((unsubscribe) => unsubscribe());
    assert.equal(socket.listenerCount('chat:history'), 0);
    assert.equal(socket.listenerCount('chat:message'), 0);
    assert.equal(socket.io.listenerCount('reconnect_attempt'), 0);
    assert.equal(socket.io.listenerCount('reconnect_failed'), 0);
});

const createSocketRuntimeFixture = () => {
    const socket = new FakeEmitter();
    socket.connected = true;
    const window = {};
    vm.runInNewContext(readSource('../src/views/js/chat/chat-socket-transport.js'), { window });
    const transport = window.VoiceChatSocketTransport.createChatSocketTransport({ getSocket: () => socket });
    return { ...createRuntimeFixture({ transport }), socket };
};

function historyTimeoutFixture() {
    const socket = new FakeEmitter(); socket.connected = true;
    const timers = new Map(); let nextTimer = 0;
    const window = { setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
        clearTimeout: id => timers.delete(id) };
    vm.runInNewContext(readSource('../src/views/js/chat/chat-socket-transport.js'), { window });
    const transport = window.VoiceChatSocketTransport.createChatSocketTransport({ getSocket: () => socket });
    const histories = [], failures = [];
    const stopHistory = transport.subscribeHistory(value => histories.push(value));
    const stopFailure = transport.subscribeHistoryFailure?.(value => failures.push(value));
    const stopConnection = transport.subscribeConnectionState(() => {});
    const expire = () => { const [id, timer] = [...timers][0] || []; assert.ok(timer, 'a history request must own a bounded timer'); timers.delete(id); timer.fn(); };
    const close = () => { stopHistory(); stopFailure?.(); stopConnection(); };
    return { transport, socket, timers, histories, failures, expire, close };
}

test('history timeout permits explicit retry and stale history cannot complete the new request', () => {
    const f = historyTimeoutFixture();
    f.transport.joinRoom('lobby', { requestRevision: 1 });
    const old = f.socket.emitted.at(-1).payload;
    f.expire();
    assert.equal(f.failures.length, 1); assert.equal(f.failures[0].requestRevision, 1);
    assert.equal(f.socket.emitted.length, 1, 'timeout cannot automatically resend');
    f.transport.joinRoom('lobby', { requestRevision: 2 });
    const current = f.socket.emitted.at(-1).payload;
    assert.notEqual(old.joinRequestId, current.joinRequestId);
    f.socket.receive('chat:history', [], { roomId: 'lobby', joinRequestId: old.joinRequestId });
    f.socket.receive('chat:history', [], { roomId: 'lobby' });
    assert.equal(f.histories.length, 0); assert.equal(f.timers.size, 1);
    f.socket.receive('chat:history', [], { roomId: 'lobby', joinRequestId: current.joinRequestId });
    assert.equal(f.histories.length, 1); assert.equal(f.histories[0].requestRevision, 2);
    assert.equal(f.timers.size, 0); f.close();
});

test('timed-out history advances only the latest queued channel selection', () => {
    const f = historyTimeoutFixture();
    f.transport.joinRoom('lobby', { requestRevision: 1 });
    f.transport.joinRoom('game', { requestRevision: 2 });
    f.transport.joinRoom('project', { requestRevision: 3 });
    f.expire();
    assert.deepEqual(f.socket.emitted.map(item => item.payload.roomId), ['lobby', 'project']);
    assert.equal(f.failures[0].roomId, 'lobby'); assert.equal(f.timers.size, 1);
    f.close(); assert.equal(f.timers.size, 0);
});

test('disconnect and history unsubscribe release pending request timers without reporting timeout', () => {
    const f = historyTimeoutFixture();
    f.transport.joinRoom('lobby'); assert.equal(f.timers.size, 1);
    f.socket.receive('disconnect'); assert.equal(f.timers.size, 0);
    assert.equal(f.failures.length, 0);
    f.transport.joinRoom('game'); assert.equal(f.timers.size, 1);
    f.close(); assert.equal(f.timers.size, 0);
});

function retryPanelFixture() {
    const f = createRuntimeFixture(), handlers = new Set();
    f.transport.subscribeHistoryFailure = handler => { handlers.add(handler); return () => handlers.delete(handler); };
    return { ...f, failureHandlers: handlers, timeout: value => handlers.forEach(handler => handler(value)) };
}

test('history timeout preserves draft and messages, blocks send and offers a manual retry', () => {
    const f = retryPanelFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', [{ id: 'kept', roomId: 'lobby', content: 'kept message' }]);
    f.input.value = 'keep draft'; f.input.dispatchEvent(new FakeEvent('input'));
    f.runtime.rejoinCurrentRoom(); f.timeout({ roomId: 'lobby', requestRevision: 2 });
    const retry = f.root.querySelector('.chat-history-retry');
    assert.ok(retry && !retry.hidden);
    assert.match(f.root.querySelector('.chat-panel-status').textContent, /同步超时/);
    f.form.dispatchEvent(new FakeEvent('submit')); assert.equal(f.transport.sendCalls.length, 0);
    assert.equal(f.input.value, 'keep draft'); assert.match(f.messages.textContent, /kept message/);
    retry.dispatchEvent(new FakeEvent('click'));
    assert.equal(f.transport.joinCalls.length, 3); assert.equal(retry.hidden, true);
    f.transport.emitHistory('lobby', []); assert.equal(f.button.disabled, false);
    assert.equal(f.input.value, 'keep draft'); assert.equal(f.transport.sendCalls.length, 0);
    f.runtime.destroy();
});

test('same-room history retry keeps live messages received before and after the retry in stream order', () => {
    const f = retryPanelFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', []); f.runtime.rejoinCurrentRoom();
    const message = n => ({ id: `retry-live-${n}`, roomId: 'lobby', content: `retry live ${n}` });
    for (let n = 1; n <= 55; n++) f.transport.emitMessage(message(n));
    f.input.value = 'draft through history retry'; f.input.dispatchEvent(new FakeEvent('input'));
    f.timeout({ roomId: 'lobby', requestRevision: 2 });
    f.root.querySelector('.chat-history-retry').dispatchEvent(new FakeEvent('click'));
    f.transport.emitMessage(message(56));
    f.transport.emitHistory('lobby', Array.from({ length: 50 }, (_, n) => message(n + 6)));
    assert.deepEqual(f.messages.querySelectorAll('.chat-message').map(row => row.children[1].textContent),
        Array.from({ length: 56 }, (_, n) => `retry live ${n + 1}`));
    f.transport.emitMessage(message(55));
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 56);
    assert.equal(f.input.value, 'draft through history retry'); assert.equal(f.button.disabled, false);
    assert.equal(f.transport.sendCalls.length, 0); f.runtime.destroy();
});

test('repeated same-room history requests retain the bounded live window and its truncation notice', () => {
    const f = createRuntimeFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    const message = n => ({ id: `retry-bounded-${n}`, roomId: 'lobby', content: `retry bounded ${n}` });
    for (let n = 0; n < 600; n++) f.transport.emitMessage(message(n));
    f.runtime.rejoinCurrentRoom(); f.runtime.rejoinCurrentRoom();
    f.transport.emitHistory('lobby', Array.from({ length: 50 }, (_, n) => message(n + 550)));
    assert.deepEqual(f.messages.querySelectorAll('.chat-message').map(row => row.children[1].textContent),
        Array.from({ length: 500 }, (_, n) => `retry bounded ${n + 100}`));
    assert.equal(f.messages.querySelectorAll('.chat-retention-note').length, 1);
    f.transport.emitMessage(message(600));
    assert.equal(f.messages.querySelectorAll('.chat-message').length, 500);
    assert.equal(f.messages.querySelectorAll('.chat-message')[0].children[1].textContent, 'retry bounded 101');
    f.runtime.destroy();
});

test('switching channels during history retry discards the previous channel live queue', () => {
    const f = retryPanelFixture(); f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitMessage({ id: 'old-live', roomId: 'lobby', content: 'previous channel live' });
    f.timeout({ roomId: 'lobby', requestRevision: 1 });
    f.root.querySelector('.chat-history-retry').dispatchEvent(new FakeEvent('click'));
    f.runtime.setRoom('game');
    f.transport.emitHistory('lobby', [{ id: 'old-history', roomId: 'lobby', content: 'previous channel history' }]);
    f.transport.emitMessage({ id: 'new-live', roomId: 'game', content: 'new channel live' });
    f.transport.emitHistory('game', [{ id: 'new-history', roomId: 'game', content: 'new channel history' }]);
    assert.deepEqual(f.messages.querySelectorAll('.chat-message').map(row => row.children[1].textContent),
        ['new channel history', 'new channel live']);
    assert.equal(f.root.querySelector('.chat-history-retry').hidden, true);
    assert.equal(f.transport.sendCalls.length, 0); f.runtime.destroy();
});

test('old-room and old-revision timeouts do not replace the current history state', () => {
    const f = retryPanelFixture(); f.runtime.init(); f.runtime.setRoom('lobby'); f.runtime.setRoom('game');
    f.timeout({ roomId: 'lobby', requestRevision: 1 });
    f.timeout({ roomId: 'game', requestRevision: 1 });
    const retry = f.root.querySelector('.chat-history-retry'); assert.ok(retry); assert.equal(retry.hidden, true);
    f.transport.emitHistory('game', []);
    f.timeout({ roomId: 'game', requestRevision: 2 }); assert.equal(retry.hidden, true);
    f.runtime.destroy(); assert.equal(f.failureHandlers.size, 0); assert.equal(retry.parentNode, null);
});

test('current room history must be ready before button, Enter or direct submit can send', async () => {
    const f = createRuntimeFixture();
    f.runtime.init();
    f.runtime.setRoom('lobby');
    f.input.value = 'keep this draft';
    f.input.dispatchEvent(new FakeEvent('input'));
    f.form.dispatchEvent(new FakeEvent('submit'));
    f.input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    await flush();
    assert.equal(f.button.disabled, true);
    assert.equal(f.transport.sendCalls.length, 0);
    assert.equal(f.input.value, 'keep this draft');
    f.transport.emitHistory('lobby', []);
    assert.equal(f.button.disabled, false);
    f.form.dispatchEvent(new FakeEvent('submit'));
    await flush();
    assert.equal(f.transport.sendCalls.length, 1);
    assert.equal(f.input.value, '');
    f.runtime.destroy();
});

test('connection restoration waits for fresh room history without discarding the draft or old messages', () => {
    const f = createRuntimeFixture();
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.transport.emitHistory('lobby', [{ id: 'kept', roomId: 'lobby', content: 'kept message' }]);
    f.input.value = 'draft after reconnect';
    f.input.dispatchEvent(new FakeEvent('input'));
    assert.equal(f.button.disabled, false);
    f.transport.emitConnection('reconnecting');
    f.transport.emitHistory('lobby', [{ id: 'offline', roomId: 'lobby', content: 'stale offline history' }]);
    f.transport.emitConnection('connected');
    assert.equal(f.button.disabled, true);
    assert.match(f.messages.textContent, /kept message/);
    assert.doesNotMatch(f.messages.textContent, /stale offline history/);
    f.runtime.rejoinCurrentRoom();
    assert.equal(f.button.disabled, true);
    f.transport.emitHistory('lobby', [{ id: 'fresh', roomId: 'lobby', content: 'fresh history' }]);
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.value, 'draft after reconnect');
    f.runtime.destroy();
});

test('a round trip room selection rejects the first history for the same room and keeps current pending live messages', () => {
    const f = createSocketRuntimeFixture();
    f.runtime.init();
    f.runtime.setRoom('lobby'); f.runtime.setRoom('game'); f.runtime.setRoom('lobby');
    f.input.value = 'current draft'; f.input.dispatchEvent(new FakeEvent('input'));
    f.socket.receive('chat:message', { id: 'live', roomId: 'lobby', content: 'current live message' });
    f.socket.receive('chat:history', [{ id: 'old', roomId: 'lobby', content: 'obsolete first history' }], { roomId: 'lobby' });
    assert.doesNotMatch(f.messages.textContent, /obsolete first history/);
    assert.match(f.messages.textContent, /current live message/);
    assert.equal(f.root.getAttribute('aria-busy'), 'true');
    assert.equal(f.button.disabled, true);
    const requests = f.socket.emitted.filter(event => event.name === 'chat:join');
    assert.deepEqual(requests.map(event => event.payload.roomId), ['lobby', 'lobby']);
    f.socket.receive('chat:history', [{ id: 'new', roomId: 'lobby', content: 'current history' }], { roomId: 'lobby' });
    assert.match(f.messages.textContent, /current history/);
    assert.match(f.messages.textContent, /current live message/);
    assert.equal(f.root.getAttribute('aria-busy'), 'false');
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.value, 'current draft');
    f.runtime.destroy();
});

test('same-room rejoin cannot accept the older pending history as the fresh response', () => {
    const f = createSocketRuntimeFixture();
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.runtime.rejoinCurrentRoom();
    f.socket.receive('chat:history', [{ id: 'old', roomId: 'lobby', content: 'old join history' }], { roomId: 'lobby' });
    assert.doesNotMatch(f.messages.textContent, /old join history/);
    assert.equal(f.root.getAttribute('aria-busy'), 'true');
    f.socket.receive('chat:history', [], { roomId: 'lobby' });
    assert.equal(f.root.getAttribute('aria-busy'), 'false');
    assert.match(f.messages.textContent, /暂无消息/);
    f.runtime.destroy();
});

test('queued chat joins retain only the latest selection and associate history with its local request revision', () => {
    const f = createSocketRuntimeFixture();
    const histories = [];
    const unsubscribe = f.transport.subscribeHistory(history => histories.push(history));
    f.transport.joinRoom('lobby', { requestRevision: 1 });
    f.transport.joinRoom('game', { requestRevision: 2 });
    f.transport.joinRoom('project', { requestRevision: 3 });
    f.socket.receive('chat:history', [], { roomId: 'lobby' });
    assert.equal(histories[0].requestRevision, 1);
    assert.deepEqual(f.socket.emitted.filter(event => event.name === 'chat:join').map(event => event.payload.roomId), ['lobby', 'project']);
    f.socket.receive('chat:history', [], { roomId: 'project' });
    assert.equal(histories[1].requestRevision, 3);
    assert.deepEqual(Object.keys(f.socket.emitted[0].payload), ['roomId', 'joinRequestId']);
    assert.equal(Number.isSafeInteger(f.socket.emitted[0].payload.joinRequestId), true);
    unsubscribe();
});

const bindPageNetworkHandlers = (fixture) => {
    const source = readSource('../src/views/script.js');
    const begin = source.indexOf('const handleNetworkOffline =');
    const end = source.indexOf("window.addEventListener('offline',", begin);
    assert.ok(begin >= 0 && end > begin);
    return vm.runInNewContext(source.slice(begin, end) + '\n({ offline: handleNetworkOffline, online: handleNetworkOnline })', {
        chatPanelRuntime: fixture.runtime,
        socket: fixture.socket,
        sidebarRuntime: { setConnectionState() {} },
        peerRetryController: { setOnline() {} },
        voiceSessionRuntime: {
            socketDisconnected: () => false,
            getSnapshot: () => ({ desiredVoiceState: 'left' }),
        },
        notifyMediaDock() {},
        voiceMediaDebug: { record() {} },
    });
};

test('page online refreshes chat history when the existing socket survived offline', () => {
    const f = createSocketRuntimeFixture();
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.socket.receive('chat:history', [{ id: 'kept', roomId: 'lobby', content: 'kept before offline' }], { roomId: 'lobby' });
    f.input.value = 'draft while briefly offline'; f.input.dispatchEvent(new FakeEvent('input'));
    const handlers = bindPageNetworkHandlers(f);
    handlers.offline();
    assert.equal(f.button.disabled, true);
    assert.equal(f.socket.connected, true);
    handlers.online();
    assert.equal(f.socket.emitted.filter(event => event.name === 'chat:join').length, 2, 'online requests fresh history without waiting for a socket connect event');
    assert.equal(f.root.getAttribute('aria-busy'), 'true');
    assert.equal(f.button.disabled, true);
    assert.match(f.messages.textContent, /kept before offline/);
    f.socket.receive('chat:history', [{ id: 'fresh', roomId: 'lobby', content: 'fresh after online' }], { roomId: 'lobby' });
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.value, 'draft while briefly offline');
    assert.match(f.messages.textContent, /fresh after online/);
    f.runtime.destroy();
});

test('page online rejoins the latest room selected offline and rejects its older in-flight history', () => {
    const f = createSocketRuntimeFixture();
    f.runtime.init(); f.runtime.setRoom('lobby');
    const handlers = bindPageNetworkHandlers(f);
    handlers.offline();
    f.runtime.setRoom('game'); f.runtime.setRoom('lobby');
    f.input.value = 'latest room draft'; f.input.dispatchEvent(new FakeEvent('input'));
    handlers.online();
    f.socket.receive('chat:history', [{ id: 'old', roomId: 'lobby', content: 'stale before online' }], { roomId: 'lobby' });
    assert.equal(f.button.disabled, true);
    assert.doesNotMatch(f.messages.textContent, /stale before online/);
    f.socket.receive('chat:history', [{ id: 'fresh', roomId: 'lobby', content: 'latest room refreshed' }], { roomId: 'lobby' });
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.value, 'latest room draft');
    assert.deepEqual(f.socket.emitted.filter(event => event.name === 'chat:join').map(event => event.payload.roomId), ['lobby', 'lobby']);
    f.runtime.destroy();
});

test('page online starts a disconnected socket without prematurely issuing or buffering chat joins', () => {
    const f = createSocketRuntimeFixture();
    f.runtime.init(); f.runtime.setRoom('lobby');
    f.socket.receive('chat:history', [], { roomId: 'lobby' });
    f.input.value = 'draft pending socket connect'; f.input.dispatchEvent(new FakeEvent('input'));
    let connects = 0;
    f.socket.connect = () => { connects++; };
    const handlers = bindPageNetworkHandlers(f);
    handlers.offline();
    f.socket.connected = false; f.socket.receive('disconnect');
    handlers.online();
    assert.equal(connects, 1);
    assert.equal(f.root.dataset.chatConnectionState, 'connecting');
    assert.equal(f.button.disabled, true);
    assert.equal(f.input.value, 'draft pending socket connect');
    assert.equal(f.socket.emitted.filter(event => event.name === 'chat:join').length, 1);
    f.runtime.destroy();
});
