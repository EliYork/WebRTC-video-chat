/* eslint-disable no-await-in-loop -- Isolated startup sessions exercise persisted choices sequentially. */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { createUpdates } = require('./updater.cjs');
const { createUpdatePreferences } = require('./update-preferences.cjs');
const { createPanels } = require('./panels.cjs');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-update-prompt-'));
const artifacts = resolve(__dirname, '../../integrations/piik/artifacts/update-prompt');
mkdirSync(artifacts, { recursive: true });
app.setPath('userData', join(work, 'profile')); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio'); app.on('window-all-closed', () => {});
let parent, panels, active, timer, offered, version = '0.1.7', downloads = 0, installs = 0, confirmations = 0;
const fixture = Buffer.from('Synthetic updater bytes. This is not an executable.');
const results = {};
const server = createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) res.end(JSON.stringify({ version,
        files: [{ url: 'fixture.exe', size: fixture.length, sha512: createHash('sha512').update(fixture).digest('base64') }],
        releaseDate: new Date().toISOString() }));
    else { downloads++; res.end(fixture); }
});
const finish = () => { clearTimeout(timer); active?.stop(); panels?.close(); parent?.destroy(); server.close(); };
const fail = error => {
    writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: false, error: error.stack, results, work }, null, 2));
    finish(); process.stderr.write(error.stack + '\n'); app.exit(1);
};
process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
const wait = async check => {
    for (let i = 0; i < 250; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve,25)); }
    throw Error('Update prompt condition timed out');
};
app.whenReady().then(async () => {
    timer = setTimeout(() => fail(Error('Update prompt deadline')), 40000);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = join(work, 'update.yml');
    writeFileSync(config, JSON.stringify({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, updaterCacheDirName: 'cache' }));
    parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    panels = createPanels({ BrowserWindow, ipcMain, screen, window: () => parent, hidden: true, log: () => {} });
    const info = { clientVersion: '0.1.6', webVersion: '1.0.5', origin: 'https://voice.eliyork.com', packaged: true };
    const launch = () => {
        offered = null;
        const updater = new NsisUpdater(null, { version: '0.1.6', name: 'voice-prompt-test', isPackaged: true,
            appUpdateConfigPath: config, userDataPath: work, baseCachePath: work, whenReady: () => app.whenReady(), onQuit() {} });
        updater.httpExecutor = new ElectronHttpExecutor(() => {}); updater.disableDifferentialDownload = true;
        updater.quitAndInstall = () => { installs++; };
        active = createUpdates({ updater, app: { getVersion: () => '0.1.6' }, window: () => null,
            preferences: createUpdatePreferences(join(work, 'ignore.json')), log: () => {},
            onStartupUpdate: async () => { offered = await panels.updatePrompt(info, active); },
            prepareInstall: async () => { throw Error('Media must not be stopped'); },
            confirmInstall: async () => { confirmations++; return false; } });
    };
    launch(); await wait(() => offered);
    const first = offered;
    await wait(() => first.webContents.executeJavaScript(`document.querySelector('#primary').textContent==='更新'`));
    assert.equal(first.isVisible(),false); assert.equal(first.webContents.isAudioMuted(),true); assert.equal(downloads,0);
    results.buttons = await first.webContents.executeJavaScript(`['#primary','#ignore-update','#dismiss-update'].map(s=>document.querySelector(s).textContent)`);
    assert.deepEqual(results.buttons,['更新','忽略本次','关闭']);
    results.layout = await first.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,bodyHeight:document.body.scrollHeight,height:innerHeight})`);
    assert.equal(results.layout.overflow,false);
    await new Promise(resolve => setTimeout(resolve,120)); first.webContents.invalidate();
    writeFileSync(join(artifacts,'available.png'),(await first.webContents.capturePage()).toPNG());
    await first.webContents.executeJavaScript(`document.querySelector('#dismiss-update').click()`);
    await wait(() => first.isDestroyed()); active.stop();
    launch(); await wait(() => offered);
    const second = offered;
    await second.webContents.executeJavaScript(`document.querySelector('#ignore-update').click()`);
    await wait(() => second.isDestroyed());
    assert.equal(createUpdatePreferences(join(work,'ignore.json')).getIgnoredVersion(),'0.1.7'); active.stop();
    launch(); await wait(() => active.snapshot().lastChecked);
    assert.equal(offered,null); assert.equal(active.snapshot().status,'available');
    const manual = await panels.about(info,active);
    assert.equal(await manual.webContents.executeJavaScript(`document.querySelector('#primary').dataset.action`),'download');
    manual.close(); active.stop();
    version = '0.1.8'; launch(); await wait(() => offered);
    const newer = offered;
    await newer.webContents.executeJavaScript(`document.querySelector('#primary').click()`);
    await wait(() => active.snapshot().status==='downloaded' && !active.snapshot().busy);
    assert.equal(downloads,1); assert.equal(installs,0);
    await newer.webContents.executeJavaScript(`document.querySelector('#primary').click()`);
    await wait(() => confirmations===1);
    assert.equal(installs,0); assert.equal(active.snapshot().status,'downloaded');
    results.closeRemindsNextLaunch = true; results.ignorePersists = true; results.manualStillAvailable = true;
    results.newVersionReminds = true; results.downloads = downloads; results.installs = installs;
    writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:true,hidden:true,muted:true,syntheticDownloadOnly:true,results,work},null,2));
    finish(); process.stdout.write('PASS startup update prompts, close, persisted ignore, newer version, explicit download and declined install.\n'); app.quit();
}).catch(fail);
