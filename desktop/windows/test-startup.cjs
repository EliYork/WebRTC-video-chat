/* eslint-disable no-await-in-loop -- Each isolated navigation owns one window. */
// Real Electron first-paint and network-failure checks. All windows stay hidden,
// no native capture starts, and no user browser/profile/notification area is used.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { createWindowStartup } = require('./window-startup.cjs');
const { createPanels } = require('./panels.cjs');
const { openRoom } = require('./startup-recovery.cjs');
const work = mkdtempSync(join(tmpdir(), 'voice-first-paint-'));
app.setPath('userData', join(work, 'profile'));
app.commandLine.appendSwitch('mute-audio');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let server, win, startup, panels, restored = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = error => {
    writeFileSync(join(work, 'failure.json'), JSON.stringify({error:error.stack}));
    panels?.close();startup?.dispose();win?.destroy();server?.closeAllConnections();server?.close();app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.whenReady().then(async () => {
    server = createServer((req, res) => {
        if (req.url === '/offline' && !restored) { req.socket.destroy(); return; }
        if (req.url === '/hang' && !restored) return;
        const send = () => {
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end(`<!doctype html><html data-room-boot="ready"><head><style>body{margin:0;background:#fbf7f9}#main{display:grid;padding-top:40px;min-height:500px}</style></head><body><main id="main" class="stage-layout">Isolated startup fixture</main></body></html>`);
        };
        if (req.url === '/slow') setTimeout(send, 500); else send();
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const results = [];
    panels = createPanels({BrowserWindow,ipcMain,screen,window:()=>win,hidden:true});
    for (const mode of ['fast','slow','offline','hang']) {
        restored = false;
        let shows = 0;
        win = new BrowserWindow({show:false,backgroundColor:'#fbf7f9',titleBarStyle:'hidden',
            titleBarOverlay:{color:'#f4ebf0',symbolColor:'#49333f',height:40},
            webPreferences:{preload:join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
        win.webContents.setAudioMuted(true);
        // Exercise the production reveal branch without exposing a test window.
        win.show = () => { shows++; };
        startup = createWindowStartup({window:win,css:readFileSync(join(__dirname,'titlebar.css'),'utf8'),trusted:url=>url.startsWith(origin+'/'),timeoutMs:mode==='hang'?200:5000});
        const started = Date.now();
        const loading = startup.load(origin+'/'+mode);
        if (mode === 'slow') {await delay(150);assert.equal(shows,0);assert.equal(win.isVisible(),false);}
        if (['offline','hang'].includes(mode)) {
            await assert.rejects(loading);
            assert.equal(shows,0);
            startup.dispose();
            let retries = 0;
            const retried = await openRoom({url:origin+'/'+mode,cancelled:()=>false,log:()=>{},
                createStartup:()=>{
                    retries++;
                    startup=createWindowStartup({window:win,css:readFileSync(join(__dirname,'titlebar.css'),'utf8'),trusted:url=>url.startsWith(origin+'/'),timeoutMs:mode==='hang' && !restored?200:5000});
                    return startup;
                },confirm:async options=>{
                    const answer=panels.confirm(options);
                    let dialog;
                    for(let i=0;i<100;i++) {
                        dialog=BrowserWindow.getAllWindows().find(candidate=>candidate!==win);
                        if(dialog && !dialog.webContents.isLoading())break;
                        await delay(25);
                    }
                    assert.ok(dialog);assert.equal(dialog.getParentWindow(),null,'offline UI cannot reveal the hidden room');
                    assert.equal(dialog.webContents.isAudioMuted(),true);assert.equal(shows,0);
                    await dialog.webContents.executeJavaScript(`new Promise(resolve=>{const poll=()=>{if(document.querySelector('#accept').textContent==='重试连接')resolve();else setTimeout(poll,20)};poll()})`);
                    restored=true;
                    await dialog.webContents.executeJavaScript(`document.querySelector('#accept').click()`);
                    return answer;
                }});
            assert.equal(retried,true);assert.equal(retries,2);assert.equal(shows,1);
            assert.equal(startup.isReady(),true);
        } else {
            await loading;assert.equal(shows,1);assert.equal(startup.isReady(),true);
            const view=await win.webContents.executeJavaScript(`({titles:document.querySelectorAll('.workspace-brand strong').length,background:getComputedStyle(document.body).backgroundColor,header:getComputedStyle(document.querySelector('.workspace-topbar')).position,refresh:!!document.querySelector('.desktop-refresh')})`);
            assert.equal(view.titles,1);assert.equal(view.header,'fixed');assert.equal(view.refresh,true);assert.equal(view.background,'rgb(251, 247, 249)');
            writeFileSync(join(work,mode+'.png'),(await win.webContents.capturePage()).toPNG());
        }
        results.push({mode,shows,milliseconds:Date.now()-started});
        startup.dispose();startup=null;win.destroy();win=null;
    }
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    writeFileSync(join(work,'report.json'),JSON.stringify({results,hidden:true,muted:true},null,2));
    process.stdout.write('PASS startup: painted title bar before reveal, delayed response stays hidden, offline/deadline retry uses local IPC and the same room window. '+work+'\n');
    app.quit();
}).catch(fail);
