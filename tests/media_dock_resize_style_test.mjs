import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('compact media controls do not cap the draggable window dimensions', () => {
    const css = readFileSync(
        new URL('../src/views/styles/controls.css', import.meta.url),
        'utf8'
    );
    for (const [, selectors, declarations] of css.matchAll(
        /([^{}]+)\{([^{}]*)\}/g
    )) {
        if (
            selectors.includes('.page-tile-media-controls-panel') &&
            !selectors.includes('#buttons')
        ) {
            assert.doesNotMatch(declarations, /max-(?:height|width)\s*:/);
        }
    }
    // The compact one-row controls remain independent of window geometry.
    assert.match(
        css,
        /grid-template-columns:\s*28px repeat\(4, minmax\(0, 1fr\)\)/
    );
});
