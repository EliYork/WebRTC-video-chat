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
test('media pin state survives normalization and video layer shares window stack', () => {
    const window = {};
    vm.runInNewContext(read('js/layout/page-layout-config.js'), { window });
    for (const type of ['localPeer', 'remotePeer', 'screen-share']) {
        assert.equal(window.PageLayoutConfig.normalizeComponentConfig(type, { pinned: true }).pinned, true);
    }
    assert.match(read('styles/participants.css'), /#page-layout-board > #video-grid\s*\{[^}]*z-index: auto/);
    assert.match(read('js/layout/page-layout-runtime.js'), /const ensurePanelShellActions[\s\S]*?canPin: true, canCollapse: false, canHide: false/);
});
