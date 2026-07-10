import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtimeSource = readFileSync(
    new URL('../src/views/js/layout/page-layout-runtime.js', import.meta.url),
    'utf8'
);
const runtimeWindow = {};
vm.runInNewContext(runtimeSource, { window: runtimeWindow });
const { createOriginalDomOwner, createRuntime } =
    runtimeWindow.PageLayoutRuntime;

class FakeNode extends EventTarget {
    constructor(name, id = '') {
        super();
        this.childNodes = [];
        this.id = id;
        this.nodeName = name.toUpperCase();
        this.parentNode = null;
    }

    get nextSibling() {
        if (!this.parentNode) {
            return null;
        }

        const siblings = this.parentNode.childNodes;
        const index = siblings.indexOf(this);
        return index >= 0 ? siblings[index + 1] || null : null;
    }

    append(...nodes) {
        nodes.forEach((node) => {
            node.remove();
            node.parentNode = this;
            this.childNodes.push(node);
        });
    }

    insertBefore(node, reference) {
        if (node === reference) {
            return node;
        }

        node.remove();
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        node.parentNode = this;
        if (index < 0) {
            this.childNodes.push(node);
        } else {
            this.childNodes.splice(index, 0, node);
        }
        return node;
    }

    replaceChildren(...nodes) {
        this.childNodes.slice().forEach((node) => node.remove());
        this.append(...nodes);
    }

    remove() {
        if (!this.parentNode) {
            return;
        }

        const siblings = this.parentNode.childNodes;
        const index = siblings.indexOf(this);
        if (index >= 0) {
            siblings.splice(index, 1);
        }
        this.parentNode = null;
    }
}

const createFixture = () => {
    const main = new FakeNode('main', 'main');
    const sidebar = new FakeNode('aside', 'sidebar');
    const brand = new FakeNode('div', 'brand');
    const members = new FakeNode('nav', 'members');
    const localCard = new FakeNode('section', 'local-card');
    const media = new FakeNode('div', 'buttons');
    const stage = new FakeNode('main', 'stage');
    const canvas = new FakeNode('section', 'canvas');
    const videoGrid = new FakeNode('div', 'video-grid');
    const dynamicTile = new FakeNode('div', 'remote-peer');
    const video = new FakeNode('video', 'remote-video');
    const chat = new FakeNode('aside', 'chat-panel');
    const input = new FakeNode('textarea', 'chat-input');

    sidebar.append(brand, members, localCard);
    localCard.append(media);
    dynamicTile.append(video);
    videoGrid.append(dynamicTile);
    canvas.append(videoGrid);
    stage.append(canvas);
    chat.append(input);
    main.append(sidebar, stage, chat);

    return {
        brand,
        canvas,
        chat,
        dynamicTile,
        input,
        localCard,
        main,
        media,
        members,
        sidebar,
        stage,
        video,
        videoGrid,
    };
};

const migrateFixture = (fixture, owner, { partial = false } = {}) => {
    const board = owner.trackTransient(
        new FakeNode('div', 'page-layout-board')
    );
    const roomContent = owner.trackTransient(
        new FakeNode('section', 'room-panel-content')
    );
    fixture.sidebar.insertBefore(roomContent, fixture.members);
    roomContent.append(fixture.members);

    const moveToTile = (node, id) => {
        const placeholder = owner.trackTransient(
            new FakeNode('comment', `placeholder-${id}`)
        );
        node.parentNode.insertBefore(placeholder, node);
        const tile = owner.trackTransient(new FakeNode('div', `tile-${id}`));
        tile.append(node);
        board.append(tile);
    };

    const videoPlaceholder = owner.trackTransient(
        new FakeNode('comment', 'placeholder-video-grid')
    );
    fixture.canvas.insertBefore(videoPlaceholder, fixture.videoGrid);
    board.append(fixture.videoGrid);
    moveToTile(fixture.brand, 'brand');

    if (!partial) {
        moveToTile(roomContent, 'members');
        moveToTile(fixture.media, 'media');
        moveToTile(fixture.chat, 'chat');
        fixture.main.replaceChildren(board);
        fixture.main.append(new FakeNode('div', 'layout-toolbar'));
    }

    return board;
};

const createOwner = (fixture, logger = { warn() {} }) =>
    createOriginalDomOwner({
        root: fixture.main,
        nodes: [
            fixture.brand,
            fixture.members,
            fixture.media,
            fixture.chat,
            fixture.videoGrid,
            undefined,
        ],
        logger,
    });

const findById = (root, id) => {
    if (root.id === id) {
        return root;
    }

    for (const child of root.childNodes) {
        const match = findById(child, id);
        if (match) {
            return match;
        }
    }

    return null;
};

test('recovery preserves business node identity, listeners, and runtime state', () => {
    const fixture = createFixture();
    const owner = createOwner(fixture);
    const runtimeMarker = {};
    const fakeStream = {};
    let inputEvents = 0;

    fixture.media.runtimeMarker = runtimeMarker;
    fixture.video.srcObject = fakeStream;
    fixture.input.value = 'unfinished message';
    fixture.input.addEventListener('input', () => {
        inputEvents += 1;
    });

    migrateFixture(fixture, owner);
    const result = owner.restore();

    assert.equal(result.ok, true);
    assert.deepEqual(fixture.main.childNodes, [
        fixture.sidebar,
        fixture.stage,
        fixture.chat,
    ]);
    assert.deepEqual(fixture.sidebar.childNodes, [
        fixture.brand,
        fixture.members,
        fixture.localCard,
    ]);
    assert.deepEqual(fixture.localCard.childNodes, [fixture.media]);
    assert.deepEqual(fixture.canvas.childNodes, [fixture.videoGrid]);
    assert.deepEqual(fixture.videoGrid.childNodes, [fixture.dynamicTile]);
    assert.equal(findById(fixture.main, 'chat-panel'), fixture.chat);
    assert.equal(findById(fixture.main, 'buttons'), fixture.media);
    assert.equal(findById(fixture.main, 'video-grid'), fixture.videoGrid);
    assert.equal(fixture.media.runtimeMarker, runtimeMarker);
    assert.equal(fixture.video.srcObject, fakeStream);
    assert.equal(fixture.input.value, 'unfinished message');

    fixture.input.dispatchEvent(new Event('input'));
    assert.equal(inputEvents, 1);
});

test('recovery is idempotent and removes runtime-only wrappers', () => {
    const fixture = createFixture();
    const owner = createOwner(fixture);
    const board = migrateFixture(fixture, owner);

    assert.equal(owner.restore().ok, true);
    assert.equal(owner.restore().ok, true);
    assert.equal(board.parentNode, null);

    const secondBoard = migrateFixture(fixture, owner);
    assert.equal(owner.restore().ok, true);
    assert.equal(secondBoard.parentNode, null);
    assert.deepEqual(fixture.main.childNodes, [
        fixture.sidebar,
        fixture.stage,
        fixture.chat,
    ]);
});

test('partial bootstrap failure restores moved and untouched nodes together', () => {
    const fixture = createFixture();
    const owner = createOwner(fixture);

    migrateFixture(fixture, owner, { partial: true });
    const result = owner.restore();

    assert.equal(result.ok, true);
    assert.deepEqual(fixture.sidebar.childNodes, [
        fixture.brand,
        fixture.members,
        fixture.localCard,
    ]);
    assert.deepEqual(fixture.canvas.childNodes, [fixture.videoGrid]);
    assert.equal(fixture.chat.parentNode, fixture.main);
});

test('runtime recovery exits edit mode, cancels interactions, and restores focus', () => {
    const fixture = createFixture();
    const classes = new Set(['is-layout-editing', 'is-layout-locked']);
    fixture.main.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
    };
    fixture.main.querySelector = (selector) =>
        ({
            '.sidebar-brand': fixture.brand,
            '.sidebar-channel-tree': fixture.members,
            '#buttons': fixture.media,
            '.chat-panel': fixture.chat,
        })[selector] || null;

    let editMode = true;
    let locked = true;
    let interactionActive = true;
    let focusRestored = false;
    fixture.input.isConnected = true;
    fixture.input.focus = ({ preventScroll }) => {
        focusRestored = preventScroll;
    };

    const runtime = createRuntime({
        document: { activeElement: fixture.input },
        refs: {
            mainLayout: fixture.main,
            videoGrid: fixture.videoGrid,
        },
        cancelLayoutInteractions: () => {
            interactionActive = false;
        },
        setLayoutEditMode: (enabled) => {
            editMode = enabled;
        },
        setLayoutLocked: (enabled) => {
            locked = enabled;
        },
        syncLayoutEditModeUI() {},
        logger: { error() {}, log() {}, warn() {} },
    });

    const board = new FakeNode('div', 'page-layout-board');
    [
        fixture.brand,
        fixture.members,
        fixture.media,
        fixture.chat,
        fixture.videoGrid,
    ].forEach((node) => board.append(node));
    fixture.main.replaceChildren(board);

    const result = runtime.restoreOriginalStaticLayout();

    assert.equal(result.ok, true);
    assert.equal(editMode, false);
    assert.equal(locked, false);
    assert.equal(interactionActive, false);
    assert.equal(focusRestored, true);
    assert.equal(classes.has('is-layout-editing'), false);
    assert.equal(classes.has('is-layout-locked'), false);
    assert.deepEqual(fixture.main.childNodes, [
        fixture.sidebar,
        fixture.stage,
        fixture.chat,
    ]);
});

test('one failed node restore does not stop later recovery steps', () => {
    const fixture = createFixture();
    const owner = createOwner(fixture);
    migrateFixture(fixture, owner);

    const originalInsertBefore = fixture.localCard.insertBefore;
    fixture.localCard.insertBefore = () => {
        throw new Error('optional media slot unavailable');
    };

    const result = owner.restore();
    fixture.localCard.insertBefore = originalInsertBefore;

    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.equal(fixture.brand.parentNode, fixture.sidebar);
    assert.equal(fixture.members.parentNode, fixture.sidebar);
    assert.equal(fixture.chat.parentNode, fixture.main);
    assert.equal(fixture.videoGrid.parentNode, fixture.canvas);
});

test('missing original next sibling falls back safely', () => {
    const root = new FakeNode('main', 'root');
    const parent = new FakeNode('div', 'parent');
    const original = new FakeNode('div', 'original');
    const removedSibling = new FakeNode('div', 'removed-sibling');
    const wrapper = new FakeNode('div', 'wrapper');

    parent.append(original, removedSibling);
    root.append(parent);
    const owner = createOriginalDomOwner({
        root,
        nodes: [original, undefined],
    });
    removedSibling.remove();
    wrapper.append(original);
    owner.trackTransient(wrapper);

    assert.equal(owner.restore().ok, true);
    assert.deepEqual(parent.childNodes, [original]);
});
