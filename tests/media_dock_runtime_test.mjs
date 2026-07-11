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
        event.currentTarget = this;
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

class FakeStyle {
    constructor() {
        this.values = new Map();
    }

    setProperty(name, value) {
        this.values.set(name, String(value));
    }
}

const dataNameToProperty = (name) =>
    name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

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
        this.style = new FakeStyle();
        this.disabled = false;
        this.hidden = false;
        this.tabIndex = 0;
        this.type = '';
        this.value = '';
        this._textContent = '';
    }

    get textContent() {
        return (
            this._textContent +
            this.children.map((child) => child.textContent).join('')
        );
    }

    set textContent(value) {
        this.replaceChildren();
        this._textContent = String(value ?? '');
    }

    append(...nodes) {
        nodes.forEach((node) => {
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
        const normalizedValue = String(value);
        this.attributes.set(name, normalizedValue);
        if (name === 'id') {
            this.id = normalizedValue;
        } else if (name === 'class') {
            this.className = normalizedValue;
        } else if (name === 'type') {
            this.type = normalizedValue;
        } else if (name.startsWith('data-')) {
            this.dataset[dataNameToProperty(name.slice(5))] = normalizedValue;
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
        if (selector.startsWith('[')) {
            const attributes = Array.from(
                selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)
            );
            return (
                attributes.length > 0 &&
                attributes.every(([, name, expected]) => {
                    const actual = name.startsWith('data-')
                        ? this.dataset[dataNameToProperty(name.slice(5))]
                        : this.getAttribute(name);
                    return expected === undefined
                        ? actual !== undefined && actual !== null
                        : actual === expected;
                })
            );
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches?.(selector)) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    contains(node) {
        if (node === this) {
            return true;
        }
        return this.children.some((child) => child.contains(node));
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

    getBoundingClientRect() {
        return { left: 10, right: 260 };
    }

    click() {
        this.dispatchEvent(new FakeEvent('click'));
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.body = new FakeElement(this, 'body');
    }

    createElement(tagName) {
        return new FakeElement(this, tagName);
    }
}

class FakeWindow extends FakeEventTarget {
    constructor(document) {
        super();
        this.document = document;
        this.console = { warn() {} };
        this.innerWidth = 1280;
        this.clearTimeout = clearTimeout;
        this.setTimeout = setTimeout;
        this.requestAnimationFrame = (callback) => callback();
    }
}

const createElement = (
    document,
    tagName,
    { className = '', data = {}, id = '', text = '', value = '' } = {}
) => {
    const element = document.createElement(tagName);
    element.id = id;
    element.className = className;
    element.textContent = text;
    element.value = value;
    Object.entries(data).forEach(([name, dataValue]) =>
        element.setAttribute(`data-${name}`, dataValue)
    );
    return element;
};

const createButton = (document, id, { label = false } = {}) => {
    const button = createElement(document, 'button', { id });
    button.append(createElement(document, 'i'));
    if (label) {
        button.append(createElement(document, 'span', { text: label }));
    }
    return button;
};

const createControl = (document, type, button) => {
    const control = createElement(document, 'div', {
        data: { 'device-control': type },
    });
    const toggle = createButton(document, '');
    toggle.setAttribute('data-control-menu', type);
    control.append(button, toggle);
    return { control, toggle };
};

const createFixture = () => {
    const document = new FakeDocument();
    const window = new FakeWindow(document);
    const root = createElement(document, 'div', {
        className: 'hidden media-dock',
        id: 'buttons',
    });
    const activity = createElement(document, 'div', {
        className: 'media-dock-activity-row',
    });
    const refs = {
        localUserName: createElement(document, 'strong', {
            id: 'localUserName',
        }),
        callStatus: createElement(document, 'p', { id: 'callStatusText' }),
        channelName: createElement(document, 'strong', {
            id: 'localVoiceChannelName',
        }),
        callDuration: createElement(document, 'span', { id: 'callDuration' }),
        screenStatus: createElement(document, 'span', {
            className: 'hidden',
            id: 'screenStatusText',
        }),
        noiseToggle: createElement(document, 'span', { id: 'noiseToggle' }),
        noiseStatus: createElement(document, 'strong', {
            id: 'noiseStatusText',
        }),
        aiNoiseToggle: createElement(document, 'span', {
            id: 'aiNoiseToggle',
        }),
        aiNoiseStatus: createElement(document, 'strong', {
            id: 'aiNoiseStatusText',
        }),
        sessionButton: createButton(document, 'destroyPeer'),
        statusMessages: createElement(document, 'div', {
            className: 'hidden',
            id: 'voiceStatusMessages',
        }),
        copyButton: createButton(document, 'copyRoomLink', { label: '链接' }),
        screenButton: createButton(document, 'shareScreen', { label: '共享' }),
        cameraButton: createButton(document, 'toggleVideo'),
        micButton: createButton(document, 'toggleAudio'),
        outputButton: createButton(document, 'toggleOutput'),
        micDeviceStatus: createElement(document, 'span', {
            id: 'micDeviceStatus',
        }),
        cameraDeviceStatus: createElement(document, 'span', {
            id: 'cameraDeviceStatus',
        }),
        outputDeviceStatus: createElement(document, 'span', {
            id: 'outputDeviceStatus',
        }),
        micList: createElement(document, 'div', {
            data: { 'device-list': 'mic' },
        }),
        cameraList: createElement(document, 'div', {
            data: { 'device-list': 'camera' },
        }),
        outputList: createElement(document, 'div', {
            data: { 'device-list': 'output' },
        }),
        micGainSlider: createElement(document, 'input', {
            id: 'micGainSlider',
            value: '100',
        }),
        micGainValue: createElement(document, 'strong', {
            id: 'micGainValue',
        }),
        outputSlider: createElement(document, 'input', {
            id: 'outputVolume',
            value: '1',
        }),
        outputValue: createElement(document, 'strong', {
            id: 'outputVolumeValue',
        }),
        outputUnsupported: createElement(document, 'p', {
            className: 'hidden',
            data: { 'output-unsupported': '' },
        }),
        resolutionSelect: createElement(document, 'select', {
            data: { 'screen-share-resolution': '' },
            value: '1080p',
        }),
        frameRateSelect: createElement(document, 'select', {
            data: { 'screen-share-frame-rate': '' },
            value: '30',
        }),
        screenSettingsStatus: createElement(document, 'span', {
            data: { 'screen-share-settings-status': '' },
        }),
    };
    refs.aiNoiseToggle.dataset.notSupportedLabel = 'N/A';

    const header = createElement(document, 'div');
    header.append(
        refs.localUserName,
        refs.callStatus,
        refs.channelName,
        refs.callDuration
    );
    activity.append(
        refs.screenStatus,
        refs.noiseToggle,
        refs.noiseStatus,
        refs.aiNoiseToggle,
        refs.aiNoiseStatus,
        refs.sessionButton
    );
    const actions = createElement(document, 'div');
    actions.append(refs.copyButton);
    ['screen', 'camera', 'mic', 'output'].forEach((type) => {
        const button =
            type === 'screen'
                ? refs.screenButton
                : type === 'camera'
                  ? refs.cameraButton
                  : type === 'mic'
                    ? refs.micButton
                    : refs.outputButton;
        const control = createControl(document, type, button);
        actions.append(control.control);
    });

    const createPopover = (type, children) => {
        const popover = createElement(document, 'section', {
            data: { 'device-popover': type },
        });
        popover.append(...children);
        return popover;
    };
    const micPopover = createPopover('mic', [
        refs.micDeviceStatus,
        refs.micList,
        refs.micGainSlider,
        refs.micGainValue,
    ]);
    const cameraPopover = createPopover('camera', [
        refs.cameraDeviceStatus,
        refs.cameraList,
    ]);
    const outputPopover = createPopover('output', [
        refs.outputDeviceStatus,
        refs.outputUnsupported,
        refs.outputList,
        refs.outputSlider,
        refs.outputValue,
    ]);
    const screenPopover = createPopover('screen', [
        refs.screenSettingsStatus,
        refs.resolutionSelect,
        refs.frameRateSelect,
    ]);
    root.append(
        header,
        activity,
        refs.statusMessages,
        actions,
        micPopover,
        cameraPopover,
        outputPopover,
        screenPopover
    );
    document.body.append(root);
    return { document, refs, root, window };
};

const defaultState = () => ({
    actualVoiceJoined: true,
    aiNoiseEnabled: false,
    aiNoiseSupported: true,
    availableCameras: [],
    availableMicrophones: [],
    availableOutputs: [],
    callDurationMs: 65_000,
    callStatusText: '正在语音中',
    cameraEnabled: false,
    cameraPending: false,
    cameraPermissionState: 'prompt',
    channelName: '大厅',
    connectionState: 'joined',
    desiredVoiceJoined: true,
    displayName: 'A',
    mediaControlsAvailable: true,
    mediaErrors: {},
    microphoneEnabled: true,
    microphoneGain: 100,
    microphonePending: false,
    microphonePermissionState: 'granted',
    noiseMode: 'raw',
    noiseSuppressionEnabled: true,
    outputMuted: false,
    outputSelectionUnsupported: false,
    outputVolume: 1,
    screenShareEnabled: false,
    screenSharePending: false,
    selectedCameraId: 'default',
    selectedMicrophoneId: 'default',
    selectedOutputId: 'default',
});

const createAdapterStub = (initialState = {}) => {
    const state = { ...defaultState(), ...initialState };
    const subscribers = new Set();
    const calls = new Map();
    const results = new Map();
    const record = (name, ...args) => {
        const entries = calls.get(name) || [];
        entries.push(args);
        calls.set(name, entries);
        return results.has(name) ? results.get(name) : true;
    };
    const adapter = {
        copyRoomLink: (...args) => record('copyRoomLink', ...args),
        getSnapshot: () => ({ ...state }),
        hangUp: (...args) => record('hangUp', ...args),
        joinVoice: (...args) => record('joinVoice', ...args),
        leaveVoice: (...args) => record('leaveVoice', ...args),
        refreshDevices: (...args) => record('refreshDevices', ...args),
        selectCamera: (...args) => record('selectCamera', ...args),
        selectMicrophone: (...args) => record('selectMicrophone', ...args),
        selectOutput: (...args) => record('selectOutput', ...args),
        setMicrophoneGain: (...args) => record('setMicrophoneGain', ...args),
        setOutputMuted: (...args) => record('setOutputMuted', ...args),
        setOutputVolume: (...args) => record('setOutputVolume', ...args),
        startScreenShare: (...args) => record('startScreenShare', ...args),
        stopScreenShare: (...args) => record('stopScreenShare', ...args),
        subscribe(listener) {
            subscribers.add(listener);
            listener({ ...state });
            return () => subscribers.delete(listener);
        },
        toggleAiNoiseSuppression: (...args) =>
            record('toggleAiNoiseSuppression', ...args),
        toggleCamera: (...args) => record('toggleCamera', ...args),
        toggleMicrophone: (...args) => record('toggleMicrophone', ...args),
        toggleNoiseSuppression: (...args) =>
            record('toggleNoiseSuppression', ...args),
    };
    return {
        adapter,
        calls,
        emit(patch = {}) {
            Object.assign(state, patch);
            subscribers.forEach((listener) => listener({ ...state }));
        },
        results,
        state,
        subscriberCount: () => subscribers.size,
    };
};

const loadApis = (fixture) => {
    vm.runInNewContext(
        readSource('../src/views/js/media/media-dock-adapter.js'),
        { window: fixture.window }
    );
    vm.runInNewContext(
        readSource('../src/views/js/media/media-dock-runtime.js'),
        { window: fixture.window }
    );
    return {
        adapterApi: fixture.window.VoiceMediaDockAdapter,
        runtimeApi: fixture.window.VoiceMediaDockRuntime,
    };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('adapter exposes the narrow action surface and unsubscribe lifecycle', () => {
    const fixture = createFixture();
    const { adapterApi } = loadApis(fixture);
    const calls = [];
    const actions = Object.fromEntries(
        adapterApi.REQUIRED_ACTIONS.map((name) => [
            name,
            (...args) => calls.push([name, ...args]),
        ])
    );
    let state = { outputVolume: 1 };
    const adapter = adapterApi.createMediaDockAdapter({
        actions,
        getSnapshot: () => state,
    });
    const snapshots = [];
    const unsubscribe = adapter.subscribe((snapshot) =>
        snapshots.push(snapshot)
    );

    adapter.startScreenShare({ frameRate: 60, resolutionPreset: '1440p' });
    state = { outputVolume: 0.5 };
    adapter.notify();
    assert.deepEqual(calls, [
        ['startScreenShare', { frameRate: 60, resolutionPreset: '1440p' }],
    ]);
    assert.deepEqual(
        snapshots.map((snapshot) => snapshot.outputVolume),
        [1, 0.5]
    );
    assert.equal(unsubscribe(), true);
    assert.equal(unsubscribe(), false);
    assert.equal(adapter.destroy(), true);
    assert.equal(adapter.destroy(), false);
});

test('runtime owns one real root, renders state, devices, permission and failures', () => {
    const fixture = createFixture();
    const { runtimeApi } = loadApis(fixture);
    const stub = createAdapterStub({
        availableCameras: [
            { deviceId: 'cam-a', kind: 'videoinput', label: 'Camera A' },
        ],
        availableMicrophones: [
            { deviceId: 'mic-a', kind: 'audioinput', label: 'Mic A' },
        ],
        availableOutputs: [
            { deviceId: 'out-a', kind: 'audiooutput', label: 'Output A' },
        ],
        cameraError: '摄像头权限被拒绝',
        cameraPermissionState: 'denied',
        connectionState: 'reconnecting-socket',
        mediaErrors: {
            camera: '摄像头权限被拒绝',
            screen: '屏幕共享不可用',
        },
        outputMuted: true,
        outputVolume: 0.25,
        selectedCameraId: 'cam-a',
        selectedMicrophoneId: 'mic-a',
        selectedOutputId: 'out-a',
    });
    const runtime = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: stub.adapter,
    });

    assert.equal(runtime.init(), true);
    assert.equal(runtime.init(), false);
    assert.equal(runtime.getRootElement(), fixture.root);
    assert.equal(fixture.root.classList.contains('hidden'), false);
    assert.equal(fixture.refs.localUserName.textContent, 'A');
    assert.equal(fixture.refs.callDuration.textContent, '01:05');
    assert.equal(fixture.refs.cameraButton.disabled, false);
    assert.equal(fixture.refs.cameraButton.classList.contains('is-off'), true);
    assert.equal(fixture.refs.outputButton.classList.contains('is-off'), true);
    assert.equal(fixture.refs.outputValue.textContent, '25%');
    assert.match(fixture.refs.statusMessages.textContent, /连接中断/);
    assert.match(fixture.refs.statusMessages.textContent, /摄像头权限被拒绝/);
    assert.match(fixture.refs.statusMessages.textContent, /屏幕共享不可用/);
    assert.equal(
        fixture.refs.cameraList
            .querySelector('[data-device-id="cam-a"]')
            .getAttribute('aria-pressed'),
        'true'
    );
    assert.equal(stub.subscriberCount(), 1);
});

test('buttons, device selection, output volume and mute emit one adapter intent', async () => {
    const fixture = createFixture();
    const { runtimeApi } = loadApis(fixture);
    const stub = createAdapterStub({
        availableMicrophones: [
            { deviceId: 'mic-a', kind: 'audioinput', label: 'Mic A' },
        ],
    });
    const runtime = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: stub.adapter,
    });
    runtime.init();

    fixture.refs.micButton.click();
    fixture.refs.cameraButton.click();
    fixture.refs.outputButton.click();
    fixture.refs.outputSlider.value = '0.4';
    fixture.refs.outputSlider.dispatchEvent(new FakeEvent('input'));
    fixture.refs.sessionButton.click();
    const micOption = fixture.refs.micList.querySelector(
        '[data-device-id="mic-a"]'
    );
    fixture.root.dispatchEvent(new FakeEvent('click', { target: micOption }));
    await flush();

    assert.equal(stub.calls.get('toggleMicrophone').length, 1);
    assert.equal(stub.calls.get('toggleCamera').length, 1);
    assert.deepEqual(stub.calls.get('setOutputMuted'), [[true]]);
    assert.deepEqual(stub.calls.get('setOutputVolume'), [[0.4]]);
    assert.equal(stub.calls.get('hangUp').length, 1);
    assert.deepEqual(stub.calls.get('selectMicrophone'), [['mic-a']]);

    stub.emit({ actualVoiceJoined: false, desiredVoiceJoined: false });
    fixture.refs.sessionButton.click();
    await flush();
    assert.equal(stub.calls.get('joinVoice').length, 1);

    stub.emit({ actualVoiceJoined: false, desiredVoiceJoined: true });
    fixture.refs.sessionButton.click();
    await flush();
    assert.equal(stub.calls.get('leaveVoice').length, 1);
});

test('screen options persist, rapid clicks start once, cancellation recovers, and sharing disables settings', async () => {
    const fixture = createFixture();
    const { runtimeApi } = loadApis(fixture);
    const stub = createAdapterStub();
    let resolveStart;
    stub.results.set(
        'startScreenShare',
        new Promise((resolve) => {
            resolveStart = resolve;
        })
    );
    const runtime = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: stub.adapter,
    });
    runtime.init();

    fixture.refs.resolutionSelect.value = '1440p';
    fixture.refs.resolutionSelect.dispatchEvent(new FakeEvent('change'));
    fixture.refs.frameRateSelect.value = '60';
    fixture.refs.frameRateSelect.dispatchEvent(new FakeEvent('change'));
    fixture.refs.screenButton.click();
    fixture.refs.screenButton.click();

    assert.equal(stub.calls.get('startScreenShare').length, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(stub.calls.get('startScreenShare')[0])),
        [{ frameRate: 60, resolutionPreset: '1440p' }]
    );
    assert.equal(fixture.refs.resolutionSelect.disabled, true);
    assert.equal(fixture.refs.frameRateSelect.disabled, true);

    resolveStart(false);
    await flush();
    assert.equal(fixture.refs.resolutionSelect.disabled, false);
    assert.equal(fixture.refs.frameRateSelect.disabled, false);
    assert.equal(runtime.getSnapshot().screenShareResolutionPreset, '1440p');
    assert.equal(runtime.getSnapshot().screenShareFrameRate, 60);

    stub.emit({ screenShareEnabled: true });
    assert.equal(fixture.refs.resolutionSelect.disabled, true);
    assert.equal(fixture.refs.screenButton.textContent.includes('停止'), true);
    fixture.refs.screenButton.click();
    await flush();
    assert.equal(stub.calls.get('stopScreenShare').length, 1);

    stub.emit({ screenShareEnabled: false });
    assert.equal(fixture.refs.resolutionSelect.disabled, false);
    assert.equal(fixture.refs.frameRateSelect.disabled, false);
});

test('layout moves and recovery preserve root identity, selections and listener ownership', async () => {
    const fixture = createFixture();
    const { runtimeApi } = loadApis(fixture);
    const stub = createAdapterStub({
        availableOutputs: [
            { deviceId: 'out-a', kind: 'audiooutput', label: 'Output A' },
        ],
    });
    const runtime = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: stub.adapter,
    });
    runtime.init();
    fixture.refs.resolutionSelect.value = '720p';
    fixture.refs.resolutionSelect.dispatchEvent(new FakeEvent('change'));
    const originalParent = fixture.root.parentNode;
    const layoutTile = createElement(fixture.document, 'div');
    layoutTile.append(fixture.root);

    assert.equal(runtime.getRootElement(), fixture.root);
    assert.equal(runtime.getSnapshot().screenShareResolutionPreset, '720p');
    assert.equal(fixture.refs.screenButton.listenerCount('click'), 1);

    originalParent.append(fixture.root);
    const outputOption = fixture.refs.outputList.querySelector(
        '[data-device-id="out-a"]'
    );
    fixture.root.dispatchEvent(
        new FakeEvent('click', { target: outputOption })
    );
    await flush();
    assert.deepEqual(stub.calls.get('selectOutput'), [['out-a']]);
    assert.equal(fixture.refs.screenButton.listenerCount('click'), 1);
});

test('destroy removes DOM listeners and runtime subscription; recreate does not accumulate', () => {
    const fixture = createFixture();
    const { runtimeApi } = loadApis(fixture);
    const firstStub = createAdapterStub();
    const first = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: firstStub.adapter,
    });
    first.init();

    assert.equal(fixture.refs.micButton.listenerCount('click'), 1);
    assert.equal(fixture.root.listenerCount('click'), 1);
    assert.equal(fixture.document.listenerCount('click'), 1);
    assert.equal(fixture.window.listenerCount('resize'), 1);
    assert.equal(first.destroy(), true);
    assert.equal(first.destroy(), false);
    assert.equal(firstStub.subscriberCount(), 0);
    assert.equal(fixture.refs.micButton.listenerCount('click'), 0);
    assert.equal(fixture.root.listenerCount('click'), 0);
    assert.equal(fixture.document.listenerCount('click'), 0);
    assert.equal(fixture.window.listenerCount('resize'), 0);
    fixture.refs.micButton.click();
    assert.equal(firstStub.calls.has('toggleMicrophone'), false);

    const secondStub = createAdapterStub();
    const second = runtimeApi.createMediaDockRuntime({
        root: fixture.root,
        adapter: secondStub.adapter,
    });
    assert.equal(second.init(), true);
    assert.equal(fixture.refs.micButton.listenerCount('click'), 1);
    fixture.refs.micButton.click();
    assert.equal(secondStub.calls.get('toggleMicrophone').length, 1);
    second.destroy();
});

test('component source cannot own media capture, layout reconstruction, Peer or Socket flows', () => {
    const adapterSource = readSource(
        '../src/views/js/media/media-dock-adapter.js'
    );
    const runtimeSource = readSource(
        '../src/views/js/media/media-dock-runtime.js'
    );
    const combined = `${adapterSource}\n${runtimeSource}`;

    [
        'getUserMedia',
        'getDisplayMedia',
        'MediaStreamTrack',
        'new Peer',
        'socket.emit',
        'cloneNode',
        'innerHTML',
        'applyConstraints',
    ].forEach((keyword) => {
        assert.equal(combined.includes(keyword), false, keyword);
    });
});
