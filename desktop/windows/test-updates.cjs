/* eslint-disable no-await-in-loop -- Update fixtures must run sequentially. */
// Isolated real Electron/electron-updater network + digest checks. No installer runs.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { createUpdates } = require('./updater.cjs');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const work = mkdtempSync(join(tmpdir(), 'voice-update-test-'));
// A GUI Electron process may outlive the launching PowerShell output pipe.
// Fail the test silently and save the error, rather than opening Electron's
// default uncaught-exception dialog on the user's desktop.
const fail = (error) => {
    writeFileSync(
        process.env.ELIYORK_UPDATE_TEST_FAILURE_FILE ||
            join(work, 'failure.json'),
        JSON.stringify({
            code: error.code,
            message: error.message,
            stack: error.stack,
        })
    );
    app.exit(1);
};
process.stdout.on('error', fail);
process.stderr.on('error', fail);
app.setPath('userData', work);
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
const bytes = Buffer.from(
    'Synthetic updater download fixture. Never executable.'
);
let mode = 'new',
    downloads = 0;
const server = createServer((request, response) => {
    if (mode === 'offline') {
        response.writeHead(503);
        response.end();
        return;
    }
    if (request.url.startsWith('/latest.yml')) {
        const info = {
            version: mode === 'same' ? '0.1.1' : '0.1.2',
            files: [
                {
                    url: 'update.exe',
                    size: bytes.length,
                    sha512: createHash('sha512')
                        .update(mode === 'bad' ? 'different' : bytes)
                        .digest('base64'),
                },
            ],
            releaseDate: new Date().toISOString(),
        };
        response.end(JSON.stringify(info));
    } else {
        downloads++;
        response.end(bytes);
    }
});
app.whenReady()
    .then(async () => {
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        const config = join(work, 'update.yml');
        writeFileSync(
            config,
            JSON.stringify({
                provider: 'generic',
                url: `http://127.0.0.1:${server.address().port}/`,
                updaterCacheDirName: 'cache',
            })
        );
        const adapter = {
            version: '0.1.1',
            name: 'voice-update-test',
            isPackaged: true,
            appUpdateConfigPath: config,
            userDataPath: work,
            baseCachePath: work,
            whenReady: () => app.whenReady(),
            onQuit: () => {},
            quit: () => {
                throw Error('must not quit');
            },
        };
        const realUpdater = () => {
            const value = new NsisUpdater(null, adapter);
            value.httpExecutor =
                new (require('electron-updater/out/electronHttpExecutor').ElectronHttpExecutor)(
                    () => {}
                );
            value.disableDifferentialDownload = true;
            return value;
        };
        let labels = [],
            dialogs = [],
            responses = [];
        const order = [];
        const updater = realUpdater();
        const controller = createUpdates({
            updater,
            app: { getVersion: () => '0.1.1' },
            dialog: {
                async showMessageBox(_window, options) {
                    dialogs.push(options);
                    return { response: responses.shift() ?? 0 };
                },
            },
            window: () => null,
            log: () => {},
            changed: (label) => labels.push(label),
            prepareInstall: async () => order.push('native-stopped'),
        });
        updater.quitAndInstall = () => order.push('install-requested');
        try {
            await controller.check(false);
            assert.equal(downloads, 0);
            assert.equal(dialogs.length, 0);
            assert.match(controller.label(), /发现新版 0.1.2/);
            responses = [0, 1]; // Download, then leave installation for later.
            await controller.check();
            assert.equal(downloads, 1);
            assert.equal(order.length, 0);
            assert.equal(updater.autoInstallOnAppQuit, false);
            assert.equal(updater.autoDownload, false);
            assert.match(controller.label(), /安装更新 0.1.2/);
            responses = [0];
            await controller.check();
            assert.deepEqual(order, ['native-stopped', 'install-requested']);
            controller.stop();
            for (const selected of ['same', 'bad', 'offline']) {
                mode = selected;
                labels = [];
                dialogs = [];
                const check = createUpdates({
                    updater: realUpdater(),
                    app: { getVersion: () => '0.1.1' },
                    dialog: {
                        async showMessageBox(_window, options) {
                            dialogs.push(options);
                            return { response: 0 };
                        },
                    },
                    window: () => null,
                    log: () => {},
                    changed: (label) => labels.push(label),
                    prepareInstall: async () => {
                        throw Error('invalid update must not install');
                    },
                });
                await check.check();
                check.stop();
                if (selected === 'same')
                    assert.match(dialogs[0].message, /最新版本/);
                else assert.equal(dialogs.at(-1).message, '客户端更新失败');
            }
            process.stdout.write(
                'PASS real updater: quiet check, explicit download, SHA512, defer, ordered cleanup, no update, checksum rejection and HTTP failure. No installer executed.\n'
            );
        } finally {
            controller.stop();
            server.close();
        }
    })
    .then(() => app.quit())
    .catch(fail);
