// Actual browser checks for startup paint, modal hit testing and saved windows.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = mkdtempSync(join(tmpdir(), 'webrtc-room-ui-'));
mkdirSync(join(evidence, 'logs'));
const port = '39125';
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [resolve('src/server.js')], {
    cwd: evidence, windowsHide: true,
    env: { ...process.env, PORT: port, USE_HTTPS: 'false', ENV: 'production', SFU_ENABLED: 'false', CHAT_HISTORY_FILE: join(evidence, 'history.json') },
});
let output = '';
app.stdout.on('data', (data) => { output += data; });
app.stderr.on('data', (data) => { output += data; });
let browser;
const errors = [];
const external = [];
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.roomBoot === 'ready');
const tile = '[data-page-layout-type="mediaControlsPanel"]';
const dialog = '[data-device-popover="screen"]';
try {
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(origin)).ok) break; } catch {}
        if (app.exitCode !== null) throw new Error(output);
        await new Promise((done) => setTimeout(done, 100));
    }
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (/^https?:/.test(url) && !url.startsWith(origin)) { external.push(url); await route.abort(); }
        else await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    let releaseModule;
    const moduleGate = new Promise((done) => { releaseModule = done; });
    await page.route('**/script.js', async (route) => { await moduleGate; await route.continue(); });
    await page.goto(`${origin}/room/game`, { waitUntil: 'commit' });
    await page.locator('[data-room-load-message]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#main').evaluate((element) => getComputedStyle(element).visibility), 'hidden');
    await page.screenshot({ path: join(evidence, 'loading.png') });
    releaseModule();
    await ready(page);
    await page.unroute('**/script.js');
    await page.screenshot({ path: join(evidence, 'desktop.png') });
    const mobileIdle = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobileIdle.goto(`${origin}/room/lobby`);
    await ready(mobileIdle);
    for (const id of ['toggleAudio', 'toggleOutput', 'shareScreen', 'toggleVideo']) {
        assert.ok((await mobileIdle.locator('#' + id).boundingBox()).width >= 100, `idle mobile ${id} is full size`);
    }
    await mobileIdle.close();
    // Watchdog must not replace successful boot with fallback later.
    await page.waitForTimeout(8100);
    assert.equal(await page.locator('html').getAttribute('data-room-boot'), 'ready');
    console.log('PASS: no old layout paint; successful boot cancels watchdog');

    await page.evaluate(() => { window.originalDock = document.getElementById('buttons'); });
    const before = await page.locator(tile).boundingBox();
    const header = await page.locator(`${tile} .tile-header`).boundingBox();
    await page.mouse.move(header.x + 65, header.y + 18);
    await page.mouse.down();
    await page.mouse.move(header.x + 425, header.y - 182, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = await page.locator(tile).boundingBox();
    assert.ok(Math.abs(moved.x - before.x) > 100 && Math.abs(moved.y - before.y) > 100, 'real dragging moves window');
    await page.mouse.move(moved.x + moved.width - 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + moved.width + 98, moved.y + moved.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const resized = await page.locator(tile).boundingBox();
    assert.ok(resized.width > moved.width + 50, 'real border resizing changes width');
    assert.equal(await page.evaluate(() => originalDock === document.getElementById('buttons')), true);
    await page.waitForTimeout(800);
    await page.reload();
    await ready(page);
    const restored = await page.locator(tile).boundingBox();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[key] - resized[key]) < 3, `restores ${key}`);
    console.log('PASS: drag, resize, same DOM ownership and saved layout restoration');

    await page.addInitScript(() => {
        window.captureRequests = [];
        navigator.mediaDevices.getDisplayMedia = async (options) => {
            captureRequests.push({ options, active: navigator.userActivation.isActive });
            throw new DOMException('Test selection cancelled', 'NotAllowedError');
        };
    });
    await page.reload();
    await ready(page);
    await page.locator('#destroyPeer').click();
    if (await page.locator('#voiceJoinConfirm').isVisible()) await page.locator('#voiceJoinConfirm').click();
    await page.waitForFunction(() => !document.getElementById('shareScreen').disabled);
    await page.locator('#shareScreen').click();
    assert.equal(await page.locator(dialog).evaluate((element) => element.matches(':modal')), true);
    assert.equal(await page.evaluate(() => captureRequests.length), 0);
    await page.locator('[data-screen-share-resolution]').selectOption('1440p');
    await page.locator('[data-screen-share-frame-rate]').selectOption('60');
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    assert.equal(await page.locator(dialog).isVisible(), true, 'moving pointer out does not close settings');
    await page.evaluate(() => {
        window.underClicks = 0;
        const button = document.createElement('button');
        button.id = 'test-under-modal';
        button.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647';
        button.onclick = () => { underClicks++; };
        document.body.append(button);
    });
    const modalBox = await page.locator(dialog).boundingBox();
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest('[data-device-popover="screen"]') !== null, { x: modalBox.x + 30, y: modalBox.y + 30 }), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(dialog).evaluate((element) => element.contains(document.activeElement)), true);
    await page.mouse.click(10, 10);
    assert.equal(await page.evaluate(() => underClicks), 0, 'backdrop never clicks through');
    assert.equal(await page.locator(dialog).isVisible(), false);
    await page.evaluate(() => document.getElementById('test-under-modal').remove());
    await page.locator('#shareScreen').click();
    await page.screenshot({ path: join(evidence, 'share-dialog.png') });
    await page.locator('[data-screen-share-start]').click();
    await page.waitForFunction(() => captureRequests.length === 1);
    const capture = await page.evaluate(() => captureRequests[0]);
    assert.equal(capture.active, true, 'start keeps transient browser user activation');
    assert.equal(capture.options.video.width.ideal, 2560);
    assert.equal(capture.options.video.frameRate.ideal, 60);
    await page.waitForFunction(() => !document.getElementById('shareScreen').disabled);
    await page.locator('#shareScreen').click();
    await page.locator('[data-screen-share-cancel]').click();
    assert.equal(await page.evaluate(() => captureRequests.length), 1);
    await page.locator('#shareScreen').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(dialog).isVisible(), false);
    console.log('PASS: explicit start/cancel, source settings, modal top layer, backdrop, focus and Escape');

    await page.locator('[data-control-menu="mic"]').click();
    const popup = page.locator('[data-device-popover="mic"]');
    assert.equal(await popup.evaluate((element) => element.matches(':popover-open')), true);
    const popupBox = await popup.boundingBox();
    assert.ok(popupBox.x >= 0 && popupBox.y >= 0 && popupBox.y + popupBox.height <= 900);
    await page.keyboard.press('Escape');
    // Saved tiny windows remain freely resizable and use internal scrolling.
    const wide = await page.locator(tile).boundingBox();
    await page.mouse.move(wide.x + wide.width - 2, wide.y + wide.height / 2);
    await page.mouse.down();
    await page.mouse.move(wide.x + 218, wide.y + wide.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const narrow = await page.locator(tile).boundingBox();
    assert.ok(narrow.width >= 220 && narrow.width <= 225);
    await page.locator('#destroyPeer').scrollIntoViewIfNeeded();
    assert.equal(await page.locator(`${tile} .tile-body`).evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    await page.screenshot({ path: join(evidence, 'narrow-window.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#shareScreen').scrollIntoViewIfNeeded();
    for (const selector of ['#toggleAudio', '#toggleOutput', '#shareScreen', '#toggleVideo']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.width >= 100 && box.height >= 40, `${selector} has a usable touch target`);
        assert.equal(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth), true, `${selector} label fits`);
    }
    await page.screenshot({ path: join(evidence, 'mobile.png') });
    console.log('PASS: local assets, top layer device menu, mobile viewport without horizontal overflow');

    const legacy = await context.newPage();
    await legacy.addInitScript(() => {
        HTMLElement.prototype.showPopover = undefined;
        HTMLElement.prototype.hidePopover = undefined;
        HTMLDialogElement.prototype.showModal = undefined;
        navigator.mediaDevices.enumerateDevices = async () => [
            { kind: 'audioinput', deviceId: 'test-mic', label: 'Test mic' },
        ];
    });
    await legacy.goto(`${origin}/room/game`);
    await ready(legacy);
    await legacy.locator('#destroyPeer').click();
    if (await legacy.locator('#voiceJoinConfirm').isVisible()) await legacy.locator('#voiceJoinConfirm').click();
    await legacy.waitForFunction(() => !document.getElementById('shareScreen').disabled);
    await legacy.locator('#shareScreen').click();
    assert.equal(await legacy.locator(dialog).evaluate((element) => element.parentNode === document.body), true);
    await legacy.evaluate(() => {
        window.underClicks = 0;
        const button = document.createElement('button');
        button.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;z-index:20000';
        button.onclick = () => { underClicks++; };
        document.body.append(button);
    });
    await legacy.keyboard.press('Shift+Tab');
    assert.equal(await legacy.locator(dialog).evaluate((element) => element.contains(document.activeElement)), true);
    await legacy.mouse.click(10, 10);
    assert.equal(await legacy.evaluate(() => underClicks), 0);
    assert.equal(await legacy.locator(dialog).evaluate((element) => document.getElementById('buttons').contains(element)), true);
    await legacy.locator('[data-control-menu="mic"]').click();
    assert.equal(await legacy.locator('[data-device-popover="mic"]').evaluate((element) => element.parentNode === document.body), true);
    await legacy.locator('[data-device-type="mic"][data-device-id="test-mic"]').click();
    await legacy.waitForFunction(() => document.querySelector('[data-device-type="mic"][data-device-id="test-mic"]').getAttribute('aria-pressed') === 'true');
    await legacy.keyboard.press('Escape');
    assert.equal(await legacy.locator('[data-device-popover="mic"]').evaluate((element) => document.getElementById('buttons').contains(element)), true);
    console.log('PASS: browsers without dialog/popover APIs block background clicks and restore popup ownership');

    const failed = await context.newPage();
    await failed.route('**/script.js', (route) => route.abort());
    await failed.goto(`${origin}/room/game`);
    await failed.waitForFunction(() => document.documentElement.dataset.roomBoot === 'fallback');
    assert.equal(await failed.locator('#main').evaluate((element) => getComputedStyle(element).visibility), 'visible');
    assert.equal(await failed.locator('[data-room-reload]').isVisible(), true);
    console.log('PASS: module failure gives visible fallback and retry');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('UI browser evidence:', evidence);
} finally {
    await browser?.close();
    app.kill();
}
