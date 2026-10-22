/* eslint-disable no-await-in-loop -- Poll one isolated hidden window until its IPC settles. */
// Isolated, hidden and muted. Fake Tray avoids touching the user's notification area.
const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    nativeImage,
} = require('electron');
const { EventEmitter } = require('node:events');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { createPanels } = require('./panels.cjs');
const { createWindowLifecycle } = require('./window-lifecycle.cjs');
const { createWindowPreferences } = require('./window-preferences.cjs');
const work = mkdtempSync(join(tmpdir(), 'voice-tray-ui-'));
const artifacts = join(__dirname, '../../integrations/piik/artifacts/tray');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', work);
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
const result = { work };
const fail = (error) => {
    writeFileSync(
        join(artifacts, 'result.json'),
        JSON.stringify(
            { ...result, passed: false, error: error.stack },
            null,
            2
        )
    );
    app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
async function until(condition) {
    const deadline = Date.now() + 6000;
    while (!(await condition())) {
        if (Date.now() > deadline) throw Error('UI timeout');
        await pause();
    }
}
class FakeTray extends EventEmitter {
    constructor(icon) {
        super();
        assert.equal(icon.isEmpty(), false);
    }
    setToolTip() {}
    setContextMenu(menu) {
        this.menu = menu;
    }
    destroy() {
        result.trayDisposed = true;
    }
}
app.whenReady()
    .then(async () => {
        const timer = setTimeout(() => fail(Error('Tray UI deadline')), 25000);
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                sandbox: true,
                offscreen: true,
                backgroundThrottling: false,
            },
        });
        win.webContents.setAudioMuted(true);
        await win.loadURL('data:text/html,<h1>Isolated synthetic media</h1>');
        await win.webContents.executeJavaScript(
            `window.marker='same-window'; window.context=new AudioContext(); window.testStream=context.createMediaStreamDestination().stream;`
        );
        const preferences = createWindowPreferences(
            join(work, 'window-preferences.json')
        );
        let lifecycle;
        const panels = createPanels({
            BrowserWindow,
            ipcMain,
            screen,
            window: () => win,
            hidden: true,
            log: () => {},
            preferences,
            trayAvailable: () => lifecycle.trayAvailable(),
        });
        let quitting = false;
        lifecycle = createWindowLifecycle({
            window: win,
            Tray: FakeTray,
            Menu: { buildFromTemplate: (x) => x },
            icon: nativeImage.createFromPath(
                join(__dirname, 'assets/tray.png')
            ),
            preferences,
            panels,
            showSettings: () => {},
            quit: () => {
                quitting = true;
            },
            isQuitting: () => quitting,
        });
        const prompt = () =>
            BrowserWindow.getAllWindows().find(
                (w) => w !== win && w.getTitle() === '关闭窗口'
            );
        // Real BrowserWindow close -> owned local prompt -> actual preload/IPC.
        win.close();
        await until(() =>
            prompt()?.webContents.executeJavaScript(
                `!document.querySelector('#close-choice').hidden`
            )
        );
        let choice = prompt();
        assert.equal(choice.webContents.isAudioMuted(), true);
        assert.equal(
            await choice.webContents.executeJavaScript(
                `document.activeElement.id==='close-choice-cancel'&&document.querySelector('#choose-tray').checked`
            ),
            true
        );
        writeFileSync(
            join(artifacts, 'close-choice.png'),
            (await choice.webContents.capturePage()).toPNG()
        );
        // Dismissal never quits, hides or persists the checkbox.
        await choice.webContents.executeJavaScript(
            `document.querySelector('#remember-close').checked=true;document.querySelector('#close-choice-cancel').click()`
        );
        await until(() => choice.isDestroyed());
        assert.equal(preferences.snapshot().closeBehavior, 'ask');
        assert.equal(quitting, false);
        win.close();
        await until(() =>
            prompt()?.webContents.executeJavaScript(
                `!document.querySelector('#close-choice').hidden`
            )
        );
        choice = prompt();
        await choice.webContents.executeJavaScript(
            `document.querySelector('#remember-close').click();document.querySelector('#close-choice-accept').click()`
        );
        await until(() => preferences.snapshot().closeBehavior === 'tray');
        assert.equal(win.isDestroyed(), false);
        result.mediaPreserved = await win.webContents.executeJavaScript(
            `window.marker==='same-window'&&testStream.getAudioTracks()[0].readyState==='live'`
        );
        assert.equal(result.mediaPreserved, true);
        assert.equal(
            createWindowPreferences(
                join(work, 'window-preferences.json')
            ).snapshot().closeBehavior,
            'tray'
        );
        const settings = await panels.about(
            {
                clientVersion: '0.1.3',
                webVersion: 'test',
                origin: 'https://voice.eliyork.com',
                packaged: false,
            },
            null
        );
        await until(() =>
            settings.webContents.executeJavaScript(
                `document.querySelector('#close-behavior').value==='tray'`
            )
        );
        await settings.webContents.executeJavaScript(
            `document.querySelector('#close-behavior').value='ask';document.querySelector('#close-behavior').dispatchEvent(new Event('change'))`
        );
        await until(() => preferences.snapshot().closeBehavior === 'ask');
        await until(() =>
            settings.webContents.executeJavaScript(
                `document.querySelector('#preference-feedback').textContent.includes('已保存')`
            )
        );
        writeFileSync(
            join(artifacts, 'settings.png'),
            (await settings.webContents.capturePage()).toPNG()
        );
        result.settingsCanReset = true;
        settings.close();
        // Esc via the renderer's real key handler has the same cancel semantics.
        const cancelled = panels.chooseClose({ trayAvailable: true });
        await until(() =>
            prompt()?.webContents.executeJavaScript(
                `!document.querySelector('#close-choice').hidden`
            )
        );
        await prompt().webContents.executeJavaScript(
            `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`
        );
        assert.deepEqual(await cancelled, {
            action: 'cancel',
            remember: false,
        });
        const exitChoice = panels.chooseClose({ trayAvailable: true });
        await until(() =>
            prompt()?.webContents.executeJavaScript(
                `!document.querySelector('#close-choice').hidden`
            )
        );
        await prompt().webContents.executeJavaScript(
            `document.querySelector('#choose-quit').click();document.querySelector('#close-choice-accept').click()`
        );
        assert.deepEqual(await exitChoice, { action: 'quit', remember: false });
        // Close from a remembered preference bypasses prompt and delegates real cleanup to app.quit.
        preferences.setCloseBehavior('quit');
        win.close();
        await until(() => quitting);
        lifecycle.dispose();
        panels.close();
        await win.webContents.executeJavaScript(
            `testStream.getTracks().forEach(t=>t.stop());context.close()`
        );
        win.destroy();
        clearTimeout(timer);
        Object.assign(result, {
            passed: true,
            hiddenAndMuted: true,
            noRealTray: true,
            realCloseAndIPC: true,
        });
        writeFileSync(
            join(artifacts, 'result.json'),
            JSON.stringify(result, null, 2)
        );
        app.quit();
    })
    .catch(fail);
