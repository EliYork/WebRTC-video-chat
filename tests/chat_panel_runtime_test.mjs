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
        this.ownerDocument.activeElement = this;
    }
}

class FakeDocument {
    constructor() {
        this.activeElement = null;
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
        emitConnection(state) {
            handlers.connection.forEach((handler) => handler(state));
        },
        emitHistory(roomId, messages) {
            handlers.history.forEach((handler) =>
                handler({ messages, roomId })
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
            logger: fixture.window.console,
        }
    );
    return { ...fixture, displayNames, runtime, transport };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    fixture.nameInput.value = '  Eli  ';
    fixture.input.value = '  hello  ';

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

test('send failure preserves input and renders one controlled error', async () => {
    const fixture = createRuntimeFixture();
    fixture.transport.sendImplementation = () =>
        Promise.reject(new Error('network failed'));
    fixture.runtime.init();
    fixture.runtime.setRoom('lobby');
    fixture.input.value = 'retry me';
    fixture.form.dispatchEvent(new FakeEvent('submit'));
    await flush();

    assert.equal(fixture.input.value, 'retry me');
    const status = fixture.root.querySelector('.chat-panel-status');
    assert.match(status.textContent, /发送失败/);
    assert.equal(status.dataset.statusKind, 'error');
    assert.equal(fixture.warnings.length, 1);
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
    assert.equal(status.hidden, true);
    fixture.input.value = 'ready';
    fixture.input.dispatchEvent(new FakeEvent('input'));
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
    assert.equal(fixture.transport.unsubscribeCount, 3);
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

    receive(name, payload) {
        this.events.get(name)?.forEach((listener) => listener(payload));
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

    await transport.sendMessage({
        content: 'hello',
        roomId: 'lobby',
        senderName: 'Eli',
    });
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
