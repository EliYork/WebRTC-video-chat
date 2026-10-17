import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../src/views/' + path, import.meta.url), 'utf8');
test('dismiss media error without suppressing later failures', () => {
    const element = () => ({ children: [], dataset: {}, classList: { toggle() {} }, append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener(type, fn) { this[type] = fn; }, get childElementCount() { return this.children.length; } });
    const window = { document: { createElement: element } };
    vm.runInNewContext(read('js/voice/voice-status-view.js'), { window });
    const container = element();
    const view = window.VoiceStatusView.createStatusView({ container });
    view.setMediaError('output', 'unknown');
    container.children[0].children[0].click();
    assert.equal(container.children.length, 0);
    view.setMediaError('output', 'unknown');
    assert.equal(container.children.length, 1);
});
