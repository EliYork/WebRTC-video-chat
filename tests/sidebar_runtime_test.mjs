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
        this.propagationStopped = false;
        Object.assign(this, options);
    }

    preventDefault() {
        this.defaultPrevented = true;
    }

    stopPropagation() {
        this.propagationStopped = true;
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
        event.target ||= this;
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
        this.disabled = false;
        this.title = '';
        this.type = '';
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

    prepend(...nodes) {
        nodes.reverse().forEach((node) => {
            node.remove();
            node.parentNode = this;
            this.children.unshift(node);
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
        if (name === 'href') {
            this.href = String(value);
        }
        if (name === 'type') {
            this.type = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    matches(selector) {
        if (selector.startsWith('#')) {
            return this.id === selector.slice(1);
        }
        if (selector.startsWith('.')) {
            return this.classList.contains(selector.slice(1));
        }
        if (selector === '[data-channel-room]') {
            return this.dataset.channelRoom !== undefined;
        }
        if (selector === '[data-channel-count]') {
            return this.dataset.channelCount !== undefined;
        }
        if (selector === '[data-members-for]') {
            return this.dataset.membersFor !== undefined;
        }
        if (selector === '[data-sidebar-copy-room]') {
            return this.dataset.sidebarCopyRoom !== undefined;
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

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    contains(element) {
        if (element === this) {
            return true;
        }
        return this.children.some((child) => child.contains(element));
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
        presence: new Set(),
    };
    return {
        handlers,
        unsubscribeCount: 0,
        subscribeConnectionState(handler) {
            handlers.connection.add(handler);
            handler(initialState);
            return () => {
                if (handlers.connection.delete(handler)) {
                    this.unsubscribeCount += 1;
                }
            };
        },
        subscribePresence(handler) {
            handlers.presence.add(handler);
            return () => {
                if (handlers.presence.delete(handler)) {
                    this.unsubscribeCount += 1;
                }
            };
        },
        emitConnection(state) {
            handlers.connection.forEach((handler) => handler(state));
        },
        emitPresence(snapshot) {
            handlers.presence.forEach((handler) => handler(snapshot));
        },
    };
};

const loadSidebarModules = () => {
    const document = new FakeDocument();
    const warnings = [];
    const window = {
        console: { warn: (...args) => warnings.push(args) },
        document,
        VoiceViewUtils: {
            setText: (element, value) => {
                element.textContent = String(value ?? '');
            },
            toggleClass: (element, className, force) =>
                element?.classList.toggle(className, Boolean(force)),
        },
    };
    const context = vm.createContext({ window });
    [
        '../src/views/js/room/channel-sidebar-ui.js',
        '../src/views/js/room/participants-list-ui.js',
        '../src/views/js/room/presence-view-model.js',
        '../src/views/js/sidebar/sidebar-runtime.js',
    ].forEach((path) => vm.runInContext(readSource(path), context));
    return { document, warnings, window };
};

const roomDefinitions = [
    ['lobby', '大厅'],
    ['game', '游戏'],
    ['project', '项目'],
];

const createFixture = ({
    copyButton = false,
    omit,
    rooms = roomDefinitions,
} = {}) => {
    const { document, warnings, window } = loadSidebarModules();
    const root = document.createElement('nav');
    root.id = 'channel-sidebar';
    root.className = 'sidebar-channel-tree';
    const refs = new Map();

    rooms.forEach(([roomId, name], index) => {
        const channel = document.createElement('div');
        channel.className = 'tree-channel voice-channel';
        channel.dataset.channelRoom = roomId;
        channel.dataset.channelName = name;
        const link = document.createElement('a');
        link.className = 'tree-channel-link';
        link.setAttribute('href', `/room/${roomId}`);
        link.textContent = name;
        const count = document.createElement('span');
        count.className = 'tree-channel-count';
        count.dataset.channelCount = roomId;
        count.textContent = '0';
        const members = document.createElement('ul');
        members.className = 'channel-members';
        members.dataset.membersFor = roomId;
        if (omit !== `link:${roomId}`) {
            channel.append(link);
        }
        if (omit !== `count:${roomId}`) {
            link.append(count);
        }
        if (omit !== `members:${roomId}`) {
            channel.append(members);
        }
        if (copyButton && index === 0) {
            const copy = document.createElement('button');
            copy.dataset.sidebarCopyRoom = roomId;
            copy.textContent = '复制';
            channel.append(copy);
            refs.set(`${roomId}:copy`, copy);
        }
        root.append(channel);
        refs.set(roomId, { channel, count, link, members });
    });
    return { document, refs, root, warnings, window };
};

const createRuntimeFixture = (options = {}) => {
    const fixture = createFixture(options);
    const transport = options.transport || createFakeTransport();
    const viewRequests = [];
    const voiceRequests = [];
    const presenceCallbacks = [];
    const copyRequests = [];
    const runtime = fixture.window.VoiceSidebarRuntime.createSidebarRuntime({
        root: fixture.root,
        transport,
        stateView: fixture.window.VoiceChannelSidebarUI,
        participantsView: fixture.window.VoiceParticipantsListUI,
        presenceViewModel: fixture.window.VoicePresenceViewModel,
        initialViewingRoomId: options.initialViewingRoomId ?? 'lobby',
        initialVoiceRoomId: options.initialVoiceRoomId ?? '',
        initialVoiceTargetRoomId: options.initialVoiceTargetRoomId ?? 'lobby',
        onRequestViewRoom:
            options.onRequestViewRoom ||
            ((roomId) => {
                viewRequests.push(roomId);
                return true;
            }),
        onRequestVoiceRoom: (roomId) => {
            voiceRequests.push(roomId);
            return true;
        },
        onPresenceSnapshot: (snapshot) => presenceCallbacks.push(snapshot),
        onCopyRoomLink: (request) => {
            copyRequests.push(request);
            return true;
        },
        getRoomUrl: (roomId) => `https://voice.test/room/${roomId}`,
        isLocalMember: (member) => member.socketId === 'local-socket',
        getMemberTileToggle: () => undefined,
        logger: fixture.window.console,
    });
    return {
        ...fixture,
        copyRequests,
        presenceCallbacks,
        runtime,
        transport,
        viewRequests,
        voiceRequests,
    };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const clickRoom = (fixture, roomId, type = 'click') => {
    const event = new FakeEvent(type, {
        target: fixture.refs.get(roomId).link,
    });
    fixture.root.dispatchEvent(event);
    return event;
};
const getMemberRows = (fixture, roomId) =>
    fixture.refs.get(roomId).members.querySelectorAll('.channel-member');

test('init is idempotent and binds one delegated click/dblclick subscription set', () => {
    const fixture = createRuntimeFixture();
    assert.equal(fixture.runtime.init(), true);
    assert.equal(fixture.runtime.init(), false);
    assert.equal(fixture.root.listenerCount('click'), 1);
    assert.equal(fixture.root.listenerCount('dblclick'), 1);
    assert.equal(fixture.transport.handlers.presence.size, 1);
    assert.equal(fixture.transport.handlers.connection.size, 1);
    assert.equal(
        fixture.refs.get('lobby').channel.classList.contains('is-viewing'),
        true
    );
});

test('missing optional copy control is safe; required channel DOM fails before binding', () => {
    const optional = createRuntimeFixture();
    assert.equal(optional.runtime.init(), true);
    assert.equal(optional.root.querySelector('[data-sidebar-copy-room]'), null);

    for (const omit of ['link:lobby', 'count:lobby', 'members:lobby']) {
        const fixture = createRuntimeFixture({ omit });
        assert.throws(() => fixture.runtime.init(), /missing required element/);
        assert.equal(fixture.root.listenerCount('click'), 0);
        assert.equal(fixture.transport.handlers.presence.size, 0);
    }

    const empty = createRuntimeFixture({ rooms: [] });
    assert.throws(() => empty.runtime.init(), /at least one channel/);
    assert.equal(empty.root.listenerCount('click'), 0);
});

test('one click emits one high-level view request and current-room click is idempotent', async () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    const event = clickRoom(fixture, 'game');
    await flush();
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(fixture.viewRequests, ['game']);
    assert.equal(
        fixture.refs.get('game').channel.classList.contains('is-viewing'),
        true
    );
    clickRoom(fixture, 'game');
    await flush();
    assert.deepEqual(fixture.viewRequests, ['game']);
});

test('rapid lobby to game to project keeps only the latest accepted navigation active', async () => {
    const pending = new Map();
    const requests = [];
    const fixture = createRuntimeFixture({
        onRequestViewRoom: (roomId) => {
            requests.push(roomId);
            return new Promise((resolve) => pending.set(roomId, resolve));
        },
    });
    fixture.runtime.init();
    clickRoom(fixture, 'game');
    clickRoom(fixture, 'project');
    pending.get('project')(true);
    pending.get('game')(true);
    await flush();
    assert.deepEqual(requests, ['game', 'project']);
    assert.equal(
        fixture.refs.get('project').channel.classList.contains('is-viewing'),
        true
    );
    assert.equal(
        fixture.refs.get('game').channel.classList.contains('is-viewing'),
        false
    );
});

test('navigation failure keeps the confirmed active room and reports one controlled warning', async () => {
    const fixture = createRuntimeFixture({
        onRequestViewRoom: () => {
            throw new Error('navigation failed');
        },
    });
    fixture.runtime.init();
    clickRoom(fixture, 'game');
    await flush();
    assert.equal(
        fixture.refs.get('lobby').channel.classList.contains('is-viewing'),
        true
    );
    assert.equal(
        fixture.refs.get('game').channel.classList.contains('is-viewing'),
        false
    );
    assert.equal(fixture.warnings.length, 1);
});

test('external viewing sync supports history navigation and rejects invalid rooms', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    assert.equal(fixture.runtime.setViewingRoom('project'), true);
    assert.equal(fixture.runtime.setViewingRoom('project'), false);
    assert.equal(fixture.runtime.setViewingRoom('unknown'), false);
    assert.equal(
        fixture.refs.get('project').link.getAttribute('aria-current'),
        'page'
    );
    assert.equal(
        fixture.refs.get('lobby').link.getAttribute('aria-current'),
        null
    );
});

test('viewing room, voice room, and voice target stay independent', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.runtime.setViewingRoom('project');
    fixture.runtime.setVoiceRoom('game', { targetRoomId: 'game' });
    assert.equal(
        fixture.refs.get('project').channel.classList.contains('is-viewing'),
        true
    );
    assert.equal(
        fixture.refs.get('game').channel.classList.contains('is-voice'),
        true
    );
    assert.equal(
        fixture.refs.get('project').channel.classList.contains('is-voice'),
        false
    );
    assert.equal(fixture.voiceRequests.length, 0);

    fixture.runtime.setVoiceRoom('', { targetRoomId: 'lobby' });
    assert.equal(
        fixture.refs.get('lobby').channel.classList.contains('is-voice-target'),
        true
    );
});

test('double click emits one high-level voice request without changing the viewed room', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    const event = clickRoom(fixture, 'game', 'dblclick');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(fixture.voiceRequests, ['game']);
    assert.equal(
        fixture.refs.get('lobby').channel.classList.contains('is-viewing'),
        true
    );
});

test('presence creates safe member rows, correct counts, and mic/camera/screen states', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.transport.emitPresence({
        channels: [
            {
                slug: 'lobby',
                count: 2,
                members: [
                    {
                        socketId: 'local-socket',
                        peerId: 'local-peer',
                        senderName: '<img src=x onerror=alert(1)>',
                        hasMic: true,
                        cameraOn: true,
                        screenSharing: true,
                    },
                    {
                        socketId: 'remote-socket',
                        peerId: 'remote-peer',
                        senderName: 'Remote',
                        hasMic: false,
                        muted: true,
                    },
                ],
            },
        ],
    });

    const rows = getMemberRows(fixture, 'lobby');
    assert.equal(rows.length, 2);
    assert.equal(fixture.refs.get('lobby').count.textContent, '2');
    assert.equal(rows[0].classList.contains('is-local'), true);
    assert.equal(rows[0].classList.contains('is-speaking'), true);
    assert.equal(rows[0].classList.contains('is-screen-sharing'), true);
    const name = rows[0].querySelector('.channel-member-name');
    assert.equal(name.textContent, '<img src=x onerror=alert(1)>（我）');
    assert.equal(name.children.length, 0);
    assert.equal(rows[0].querySelector('.member-status-camera') !== null, true);
    assert.equal(rows[0].querySelector('.member-status-screen') !== null, true);
    assert.equal(
        fixture.refs.get('lobby').channel.classList.contains('has-members'),
        true
    );
});

test('duplicate and reconnect presence snapshots are idempotent without duplicate rows', () => {
    const fixture = createRuntimeFixture();
    const snapshot = {
        channels: [
            {
                slug: 'game',
                count: 1,
                members: [
                    { socketId: 'one', peerId: 'peer-one', senderName: 'One' },
                ],
            },
        ],
    };
    fixture.runtime.init();
    fixture.transport.emitPresence(snapshot);
    const firstRow = getMemberRows(fixture, 'game')[0];
    fixture.transport.emitConnection('reconnecting');
    fixture.transport.emitConnection('connected');
    fixture.transport.emitPresence(snapshot);
    assert.equal(getMemberRows(fixture, 'game').length, 1);
    assert.equal(getMemberRows(fixture, 'game')[0], firstRow);
    assert.equal(fixture.presenceCallbacks.length, 2);
});

test('missing members are removed and member counts return to zero', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.transport.emitPresence({
        channels: [
            {
                slug: 'project',
                count: 1,
                members: [
                    { socketId: 'one', peerId: 'one', senderName: 'One' },
                ],
            },
        ],
    });
    assert.equal(getMemberRows(fixture, 'project').length, 1);
    fixture.transport.emitPresence({ channels: [] });
    assert.equal(getMemberRows(fixture, 'project').length, 0);
    assert.equal(fixture.refs.get('project').count.textContent, '0');
    assert.equal(
        fixture.refs.get('project').channel.classList.contains('has-members'),
        false
    );
});

test('old/new peer ids for one socket produce one current member without ghosts', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.transport.emitPresence({
        channels: [
            {
                slug: 'lobby',
                count: 1,
                members: [
                    { socketId: 'same', peerId: 'old', senderName: 'Old' },
                    { socketId: 'same', peerId: 'new', senderName: 'New' },
                ],
            },
        ],
    });
    const rows = getMemberRows(fixture, 'lobby');
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /New/);
    assert.doesNotMatch(rows[0].textContent, /Old/);
});

test('large member snapshots render through a single fragment batch', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    const members = Array.from({ length: 100 }, (_, index) => ({
        socketId: `socket-${index}`,
        peerId: `peer-${index}`,
        senderName: `Member ${index}`,
        hasMic: index % 2 === 0,
    }));
    fixture.transport.emitPresence({
        channels: [{ slug: 'lobby', count: 100, members }],
    });
    assert.equal(getMemberRows(fixture, 'lobby').length, 100);
    assert.equal(fixture.document.fragmentCount, 1);
});

test('offline/reconnecting/failed state is explicit and connected clears it', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.transport.emitConnection('reconnecting');
    assert.equal(fixture.root.classList.contains('is-reconnecting'), true);
    assert.equal(fixture.root.getAttribute('aria-busy'), 'true');
    fixture.runtime.setConnectionState('offline');
    assert.equal(fixture.root.classList.contains('is-offline'), true);
    fixture.transport.emitConnection('failed');
    assert.equal(fixture.root.classList.contains('is-connection-failed'), true);
    fixture.transport.emitConnection('connected');
    assert.equal(fixture.root.classList.contains('is-reconnecting'), false);
    assert.equal(fixture.root.classList.contains('is-offline'), false);
    assert.equal(fixture.root.getAttribute('aria-busy'), 'false');
});

test('optional copy action uses the fixed room URL and rejects invalid rooms', () => {
    const fixture = createRuntimeFixture({ copyButton: true });
    fixture.runtime.init();
    const copy = fixture.refs.get('lobby:copy');
    fixture.root.dispatchEvent(new FakeEvent('click', { target: copy }));
    assert.equal(fixture.copyRequests.length, 1);
    assert.equal(fixture.copyRequests[0].roomId, 'lobby');
    assert.equal(fixture.copyRequests[0].url, 'https://voice.test/room/lobby');
    assert.equal(fixture.runtime.copyRoomLink('unknown'), false);
});

test('layout move and recovery preserve root, room nodes, listeners, active state, and focus API', async () => {
    const fixture = createRuntimeFixture();
    const originalParent = fixture.document.createElement('aside');
    const layoutTile = fixture.document.createElement('section');
    originalParent.append(fixture.root);
    fixture.runtime.init();
    const lobbyLink = fixture.refs.get('lobby').link;
    const lobbyMembers = fixture.refs.get('lobby').members;
    layoutTile.append(fixture.root);
    clickRoom(fixture, 'project');
    await flush();
    assert.equal(fixture.runtime.getRootElement(), fixture.root);
    assert.equal(fixture.refs.get('lobby').link, lobbyLink);
    assert.equal(fixture.refs.get('lobby').members, lobbyMembers);
    assert.equal(fixture.runtime.focusRoom('project'), true);
    assert.equal(
        fixture.document.activeElement,
        fixture.refs.get('project').link
    );
    originalParent.append(fixture.root);
    assert.equal(fixture.root.listenerCount('click'), 1);
    assert.equal(
        fixture.refs.get('project').channel.classList.contains('is-viewing'),
        true
    );
});

test('destroy unsubscribes, removes dynamic rows, rejects late events, and is idempotent', async () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    fixture.transport.emitPresence({
        channels: [
            {
                slug: 'lobby',
                count: 1,
                members: [
                    { socketId: 'one', peerId: 'one', senderName: 'One' },
                ],
            },
        ],
    });
    assert.equal(fixture.runtime.destroy(), true);
    assert.equal(fixture.runtime.destroy(), false);
    assert.equal(fixture.transport.unsubscribeCount, 2);
    assert.equal(fixture.root.listenerCount('click'), 0);
    assert.equal(getMemberRows(fixture, 'lobby').length, 0);
    clickRoom(fixture, 'game');
    fixture.transport.emitPresence({
        channels: [
            {
                slug: 'game',
                count: 1,
                members: [{ socketId: 'late', senderName: 'Late' }],
            },
        ],
    });
    await flush();
    assert.equal(fixture.viewRequests.length, 0);
    assert.equal(getMemberRows(fixture, 'game').length, 0);
    assert.throws(() => fixture.runtime.init(), /cannot be re-initialized/);
});

test('subscription failure rolls back without a half-initialized Sidebar', () => {
    const transport = createFakeTransport();
    transport.subscribeConnectionState = () => {
        throw new Error('subscribe failed');
    };
    const fixture = createRuntimeFixture({ transport });
    assert.throws(() => fixture.runtime.init(), /subscribe failed/);
    assert.equal(transport.unsubscribeCount, 1);
    assert.equal(fixture.root.listenerCount('click'), 0);
    assert.equal(transport.handlers.presence.size, 0);
});

test('invalid unsubscribe contract rolls back connection DOM and subscriptions', () => {
    const transport = createFakeTransport();
    transport.subscribeConnectionState = (handler) => {
        handler('connected');
        return undefined;
    };
    const fixture = createRuntimeFixture({ transport });
    assert.throws(
        () => fixture.runtime.init(),
        /subscriptions must return unsubscribe functions/
    );
    assert.equal(transport.unsubscribeCount, 1);
    assert.equal(fixture.root.dataset.connectionState, undefined);
    assert.equal(fixture.root.getAttribute('aria-busy'), null);
    assert.equal(fixture.root.listenerCount('click'), 0);
});

test('two Sidebar runtimes keep DOM, rooms, presence, and subscriptions isolated', () => {
    const first = createRuntimeFixture();
    const second = createRuntimeFixture();
    first.runtime.init();
    second.runtime.init();
    first.runtime.setViewingRoom('game');
    second.runtime.setViewingRoom('project');
    first.transport.emitPresence({
        channels: [
            {
                slug: 'game',
                count: 1,
                members: [{ socketId: 'first', senderName: 'First' }],
            },
        ],
    });
    second.transport.emitPresence({
        channels: [
            {
                slug: 'project',
                count: 1,
                members: [{ socketId: 'second', senderName: 'Second' }],
            },
        ],
    });
    assert.match(first.refs.get('game').members.textContent, /First/);
    assert.doesNotMatch(first.refs.get('game').members.textContent, /Second/);
    assert.match(second.refs.get('project').members.textContent, /Second/);
    first.runtime.destroy();
    assert.equal(second.transport.handlers.presence.size, 1);
});

class FakeEmitter {
    constructor() {
        this.connected = false;
        this.events = new Map();
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

test('Sidebar Socket adapter reports presence/connection and removes exact listeners', () => {
    const socket = new FakeEmitter();
    const window = {};
    vm.runInNewContext(
        readSource('../src/views/js/sidebar/sidebar-socket-transport.js'),
        { window }
    );
    const transport =
        window.VoiceSidebarSocketTransport.createSidebarSocketTransport({
            getSocket: () => socket,
        });
    const snapshots = [];
    const states = [];
    const unsubscribePresence = transport.subscribePresence((snapshot) =>
        snapshots.push(snapshot)
    );
    const unsubscribeConnection = transport.subscribeConnectionState((state) =>
        states.push(state)
    );
    socket.receive('presence:state', { channels: [] });
    socket.io.receive('reconnect_attempt', 1);
    socket.io.receive('reconnect_failed');
    assert.equal(snapshots.length, 1);
    assert.deepEqual(states, ['connecting', 'reconnecting', 'failed']);
    unsubscribePresence();
    unsubscribeConnection();
    assert.equal(socket.listenerCount('presence:state'), 0);
    assert.equal(socket.listenerCount('connect'), 0);
    assert.equal(socket.io.listenerCount('reconnect_attempt'), 0);
});

test('mobile integration can use only the high-level Sidebar root API', () => {
    const fixture = createRuntimeFixture();
    fixture.runtime.init();
    const mobileVisibleRoot = fixture.runtime.getRootElement();
    assert.equal(mobileVisibleRoot, fixture.root);
    assert.equal(fixture.runtime.focusRoom('lobby'), true);
    assert.equal(
        fixture.document.activeElement,
        fixture.refs.get('lobby').link
    );
});
