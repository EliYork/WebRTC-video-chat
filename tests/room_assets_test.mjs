import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script, runInNewContext } from 'node:vm';
import { createRoomAssets, getRoomAssetVersions } from '../src/utils/RoomAssets.js';
import ejs from 'ejs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'voice-room-assets-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const put = (name, value) => {
        const path = join(root, name);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, value);
    };
    put('js/room/boot-scripts.json', JSON.stringify(['/js/first.js', '/js/second.js']));
    put('js/first.js', '(function(){window.events=["first"]})()');
    put('js/second.js', '(function(){window.events.push("second")})()');
    put('style.css', '@import url("./styles/index.css");');
    put('script.js', 'export {};');
    put('styles/index.css', '@import url("./a.css");\n@import url("./b.css");');
    put('styles/a.css', '.x { color: red; }');
    put('styles/b.css', '.x { color: blue; }');
    return { root, put };
}

test('startup bundle preserves dependent script order and statement boundaries', t => {
    const f = fixture(t);
    const assets = createRoomAssets(f.root);
    const window = {};
    runInNewContext(assets.runtime, { window });
    assert.equal(Array.from(window.events).join(','), 'first,second');
    assert.doesNotMatch(assets.stylesheet, /@import/);
    assert.ok(assets.stylesheet.indexOf('red') < assets.stylesheet.indexOf('blue'));
});

test('startup asset assembly fails closed for missing dependencies and duplicate entries', t => {
    const f = fixture(t);
    f.put('js/room/boot-scripts.json', JSON.stringify(['/js/missing.js']));
    assert.throws(() => createRoomAssets(f.root), /ENOENT/);
    f.put('js/room/boot-scripts.json', JSON.stringify(['/js/first.js', '/js/first.js']));
    assert.throws(() => createRoomAssets(f.root), /Invalid room script list/);
});

test('stylesheet assembly detects cycles and refuses paths outside the public root', t => {
    const f = fixture(t);
    f.put('styles/a.css', '@import url("./index.css");');
    assert.throws(() => createRoomAssets(f.root), /Circular/);
    f.put('styles/a.css', '@import url("../../outside.css");');
    assert.throws(() => createRoomAssets(f.root), /outside views root/);
    f.put('js/room/boot-scripts.json', JSON.stringify(['/js/../../secret.js']));
    assert.throws(() => createRoomAssets(f.root), /Invalid room script path/);
});

test('actual ordered application bundle parses and stylesheet has no extra request chain', () => {
    const root = new URL('../src/views/', import.meta.url);
    const assets = createRoomAssets(fileURLToPath(root));
    assert.doesNotThrow(() => new Script(assets.runtime));
    assert.doesNotMatch(assets.stylesheet, /@import/);
    assert.match(assets.stylesheet, /data-mobile-panel=['"]?chat/);
    const paths = JSON.parse(readFileSync(new URL('js/room/boot-scripts.json', root), 'utf8'));
    assert.ok(paths.indexOf('/js/shared/view-utils.js') < paths.indexOf('/js/media/media-dock-runtime.js'));
});

test('optimized startup is discarded after a source edit or output corruption', t => {
    const f = fixture(t);
    const source = createRoomAssets(f.root, { optimized: false }).runtime;
    const sha = value => createHash('sha256').update(value).digest('hex');
    const optimized = 'window.events=["optimized"];';
    f.put('js/room/startup-assets.json', JSON.stringify({ runtime: { sourceSha256: sha(source), sha256: sha(optimized) } }));
    f.put('js/room/startup.runtime.min.js', optimized);
    assert.equal(createRoomAssets(f.root).runtime, optimized);
    assert.equal(getRoomAssetVersions(createRoomAssets(f.root)).runtime, sha(optimized));
    f.put('js/room/startup.runtime.min.js', 'corrupted');
    assert.equal(createRoomAssets(f.root).runtime, source);
    assert.equal(getRoomAssetVersions(createRoomAssets(f.root)).runtime, sha(source));
    f.put('js/room/startup.runtime.min.js', optimized);
    f.put('js/first.js', '(function(){window.events=["edited"]})()');
    const window = {};
    runInNewContext(createRoomAssets(f.root).runtime, { window });
    assert.equal(Array.from(window.events).join(','), 'edited,second');
});

test('rendered room embeds CSP protected recovery before downloads and loads only the active media SDK', async () => {
    const template = fileURLToPath(new URL('../src/views/room/index.ejs', import.meta.url));
    const roomAssets = createRoomAssets(fileURLToPath(new URL('../src/views/', import.meta.url)));
    const roomAssetVersions = getRoomAssetVersions({ ...roomAssets, piikClient: Buffer.from('Piik fixture') });
    await Promise.all([true, false].map(async (piikEnabled) => {
        const html = await ejs.renderFile(template, {
            piikEnabled, channels: [], roomId: 'lobby', channelName: '大厅', cspNonce: 'test-nonce', roomBootstrap: '{}', roomAssetVersions,
        });
        assert.match(html, /<script nonce="test-nonce">\(function exposeRoomBoot/);
        assert.doesNotMatch(html, /src="\/js\/shared\/room-boot\.js/);
        assert.ok(html.indexOf('exposeRoomBoot') < html.indexOf('src="/socket.io/socket.io.js"'));
        assert.equal(html.includes(`src="/vendor/piik-client.js?v=${roomAssetVersions.piikClient}"`), piikEnabled);
        assert.equal(html.includes('src="/vendor/screen-sfu-client.js"'), !piikEnabled);
        assert.ok(html.includes(`href="/style.css?v=${roomAssetVersions.stylesheet}"`));
        assert.ok(html.indexOf('const roomBootstrap') < html.indexOf('data-room-startup-style href='));
        assert.ok(html.includes(`src="/js/room/boot-runtime.js?v=${roomAssetVersions.runtime}"`));
        assert.ok(html.includes(`src="/script.js?v=${roomAssetVersions.mainScript}"`));
    }));
});
