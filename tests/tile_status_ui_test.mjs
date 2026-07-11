import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewUtilsSource = readFileSync(
    new URL('../src/views/js/shared/view-utils.js', import.meta.url),
    'utf8'
);
const tileStatusSource = readFileSync(
    new URL('../src/views/js/room/tile-status-ui.js', import.meta.url),
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

const createElement = (tagName = 'div') => {
    const element = {
        childNodes: [],
        classList: createClassList(),
        style: {},
        tagName: tagName.toUpperCase(),
        textContent: '',
        append(...nodes) {
            this.childNodes.push(...nodes);
        },
        querySelector(selector) {
            const className = selector.startsWith('.')
                ? selector.slice(1)
                : null;
            for (const child of this.childNodes) {
                if (
                    className
                        ? child.classList?.contains(className)
                        : child.tagName?.toLowerCase() === selector
                ) {
                    return child;
                }
                const descendant = child.querySelector?.(selector);
                if (descendant) return descendant;
            }
            return undefined;
        },
        replaceChildren(...nodes) {
            this.childNodes = [...nodes];
        },
    };
    Object.defineProperty(element, 'className', {
        get: () => '',
        set: (value) => {
            element.classList = createClassList();
            String(value)
                .split(/\s+/)
                .filter(Boolean)
                .forEach((name) => element.classList.add(name));
        },
    });
    return element;
};

const createFixture = () => {
    const tile = createElement();
    const header = createElement();
    const avatar = createElement();
    const title = createElement();
    const badges = createElement();
    const overlay = createElement();
    const footer = createElement();

    header.className = 'tile-header';
    avatar.className = 'tile-avatar';
    title.className = 'tile-title';
    badges.className = 'tile-badges';
    overlay.className = 'tile-overlay';
    footer.className = 'tile-footer';
    header.append(avatar, title, badges);
    tile.append(header, overlay, footer);
    return { badges, footer, overlay, tile, title };
};

const window = {
    document: {
        createElement,
        createTextNode: (textContent) => ({ textContent }),
        getElementById() {},
        querySelectorAll: () => [],
    },
};
vm.runInNewContext(viewUtilsSource, { window });
vm.runInNewContext(tileStatusSource, { window });
const tileStatusUI = window.VoiceTileStatusUI;

const statuses = [
    {
        icon: 'fas fa-microphone-slash',
        key: 'no-mic',
        label: '未开麦',
    },
    { icon: 'far fa-newspaper', key: 'screen', label: '共享中' },
];

test('screen-share permanent states stay in the header and leave no footer or video overlay', () => {
    const fixture = createFixture();

    tileStatusUI.renderTileStatus(fixture.tile, {
        hasVideo: true,
        isScreenShare: true,
        statuses,
        statusText: '正在共享屏幕',
        titleText: 'A',
    });

    assert.equal(fixture.title.textContent, 'A');
    assert.equal(fixture.overlay.childNodes.length, 0);
    assert.equal(fixture.badges.childNodes.length, 2);
    assert.equal(
        fixture.badges.childNodes[0].classList.contains('tile-header-status'),
        true
    );
    assert.equal(
        fixture.badges.childNodes[0].childNodes[1].textContent,
        '未开麦'
    );
    assert.equal(
        fixture.badges.childNodes[1].childNodes[1].textContent,
        '共享中'
    );
    assert.equal(fixture.footer.textContent, '');
    assert.equal(fixture.footer.classList.contains('is-hidden'), true);
});

test('camera participant keeps its existing overlay, compact header badges, and footer', () => {
    const fixture = createFixture();

    tileStatusUI.renderTileStatus(fixture.tile, {
        hasVideo: true,
        isScreenShare: false,
        statuses,
        statusText: '未开麦',
        titleText: 'B',
    });

    assert.equal(fixture.overlay.childNodes.length, 2);
    assert.equal(
        fixture.overlay.childNodes[0].classList.contains('tile-status-badge'),
        true
    );
    assert.equal(fixture.badges.childNodes.length, 2);
    assert.equal(
        fixture.badges.childNodes[0].classList.contains('tile-badge'),
        true
    );
    assert.equal(fixture.footer.textContent, '未开麦');
    assert.equal(fixture.footer.classList.contains('is-hidden'), false);
});
