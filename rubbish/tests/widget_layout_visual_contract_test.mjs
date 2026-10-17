import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('collapsed panels remain exactly one row after drag snapping', () => {
    const script = readFileSync(new URL('../src/views/script.js', import.meta.url), 'utf8');
    const window = {};
    vm.runInNewContext(readFileSync(new URL('../src/views/js/layout/page-layout-snap-utils.js', import.meta.url), 'utf8'), { window });
    for (const height of [480, 720, 768, 900, 1080]) {
        const context = {
            window, PAGE_GRID_ROWS: 18, PAGE_GRID_COLUMNS: 32,
            PANEL_COLLAPSED_HEIGHT: 42, LAYOUT_MIN_GRID_W: 2, LAYOUT_MIN_GRID_H: 2,
            PAGE_TILE_MIN_WIDTH: 160, PAGE_TILE_MIN_HEIGHT: 80,
            getLayoutBoardForTile: () => ({ getBoundingClientRect: () => ({ width: 1280, height }) }),
            getPanelConfig: () => ({ minWidth: 220, minHeight: 140 }),
            isMobileLayout: () => false,
        };
        for (const name of ['normalizeTileLayoutZIndex', 'findTileForLayoutItem', 'getCurrentTileLayout', 'applyTileLayout', 'applyTileLayoutItemToElement', 'setTileLayoutItem']) context[name] = () => {};
        for (const name of ['getPanelCollapsedHeight', 'getTileMinimumSize', 'getLayoutSnapContext']) {
            const source = script.match(new RegExp(`const ${name} = [\\s\\S]*?\\n};`))[0];
            vm.runInNewContext(`${source}\nthis.${name} = ${name};`, context);
        }
        const tile = { dataset: { pageLayoutType: 'mediaControlsPanel' }, classList: { contains: () => true } };
        const snapContext = context.getLayoutSnapContext(tile);
        assert.equal(context.getPanelCollapsedHeight(), height / 18);
        assert.equal(snapContext.minGridH, 1);
        const snapped = window.PageLayoutSnapUtils.snapTileLayoutToGrid({ x: 100, y: 100, width: 320, height: height / 18 }, snapContext);
        assert.equal(snapped.height, height / 18);
        assert.equal(window.PageLayoutSnapUtils.convertTileLayoutToGrid(snapped, snapContext).h, 1);
    }
});

test('default widgets align, reserve the media workspace and do not overlap', () => {
    const window = {};
    vm.runInNewContext(
        readFileSync(
            new URL(
                '../src/views/js/layout/page-layout-config.js',
                import.meta.url
            ),
            'utf8'
        ),
        { window }
    );
    const panels = window.PageLayoutConfig.getPanelRegistry();
    const [channels, controls, chat] = panels.map(
        (panel) => panel.defaultLayout
    );
    assert.equal(channels.x, controls.x);
    assert.equal(channels.w, controls.w);
    assert.equal(channels.y, chat.y);
    assert.equal(controls.y + controls.h, chat.y + chat.h);
    assert.equal(controls.h, 5);
    assert.ok(chat.x - channels.x - channels.w >= 12);
    for (const panel of panels) {
        const rect = panel.defaultLayout;
        assert.ok(rect.x > 0 && rect.y > 0);
        assert.ok(rect.x + rect.w < 32 && rect.y + rect.h < 18);
        for (const other of panels) {
            if (panel === other) continue;
            const b = other.defaultLayout;
            assert.ok(
                rect.x + rect.w <= b.x ||
                    b.x + b.w <= rect.x ||
                    rect.y + rect.h <= b.y ||
                    b.y + b.h <= rect.y
            );
        }
    }
});
