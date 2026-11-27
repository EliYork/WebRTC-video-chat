import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the stage dock keeps its actions on one row with shrinkable columns', () => {
    const css = readFileSync(
        new URL('../src/views/styles/controls.css', import.meta.url),
        'utf8'
    );
    const actions = css.match(/\.media-dock-actions\s*\{([^{}]+)\}/)?.[1];
    assert.ok(actions, 'the active stage dock action rule exists');
    assert.match(actions, /display:\s*grid/);
    assert.match(actions, /grid-template-columns:\s*28px repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(actions, /min-width:\s*0\s*;/);
});
