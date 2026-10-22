import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopDownload } from '../src/utils/DesktopDownload.js';

function request(feed, installed = true) {
    const result = {};
    const handler = createDesktopDownload('downloads/windows', {
        read: () => feed,
        stat: () => ({isFile: () => installed}),
    });
    const res = {
        set(key, value) { result[key] = value; return this; },
        redirect(status, location) { Object.assign(result, {status, location}); },
        status(status) { result.status = status; return this; },
        type() { return this; }, send(message) { result.message = message; },
    };
    handler({query: {version:'999.0.0',path:'https://example.com'}}, res);
    return result;
}
test('browser download follows the published feed, stays same-origin and ignores client versions', () => {
    const result=request('version: 0.1.4\npath: EliYork-Voice-Setup-0.1.4-x64.exe\n');
    assert.equal(result.status,302);
    assert.equal(result.location,'/downloads/windows/EliYork-Voice-Setup-0.1.4-x64.exe');
    assert.equal(result['Cache-Control'],'no-store');
    assert.equal(request('version: 0.1.5\npath: EliYork-Voice-Setup-0.1.5-x64.exe\n').location,'/downloads/windows/EliYork-Voice-Setup-0.1.5-x64.exe');
});
test('unpublished or malformed feed cannot redirect to foreign or arbitrary files', () => {
    for(const feed of ['', 'version: 0.1.4\npath: https://example.com/installer.exe\n',
        'version: 0.1.4\npath: ../../.env\n', 'version: 0.1.4\npath: EliYork-Voice-Setup-0.1.3-x64.exe\n']) {
        assert.equal(request(feed).status,503);
    }
    assert.equal(request('version: 0.1.4\npath: EliYork-Voice-Setup-0.1.4-x64.exe\n',false).status,503);
});
