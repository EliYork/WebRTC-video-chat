// Run with desktop/windows/node_modules/electron/dist/electron.exe.
// One SVG is the source for browser, Windows and tray assets. No external fonts.
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdtempSync}=require('node:fs');
const root=resolve(__dirname,'..'),brand=join(root,'src/views/assets/brand'),desktop=join(root,'desktop/windows/assets');
const artifacts=join(root,'integrations/piik/artifacts/brand');
app.setPath('userData',mkdtempSync(join(tmpdir(),'voice-icons-')));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed',()=>{});
let win;
const fail=error=>{process.stderr.write(error.stack+'\n');win?.destroy();app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
app.whenReady().then(async()=>{
    mkdirSync(desktop,{recursive:true});mkdirSync(artifacts,{recursive:true});
    win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
    win.webContents.setAudioMuted(true);
    const source=readFileSync(join(brand,'voice.svg'),'utf8');
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'));
    const rendered=await win.webContents.executeJavaScript(`(async()=>{
        const source=${JSON.stringify(source)},sizes=[16,20,24,32,40,48,64,128,180,256,512];
        const icon=new Image();icon.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);await icon.decode();
        const result={};
        for(const size of sizes){const c=document.createElement('canvas');c.width=c.height=size;c.getContext('2d').drawImage(icon,0,0,size,size);result[size]=c.toDataURL('image/png');}
        const c=document.createElement('canvas');c.width=760;c.height=300;const x=c.getContext('2d');
        x.fillStyle='#fbf7f9';x.fillRect(0,0,c.width,c.height);x.fillStyle='#30252e';x.fillRect(376,0,384,300);
        x.drawImage(icon,40,36,148,148);x.drawImage(icon,416,36,148,148);
        x.font='600 15px "Segoe UI",sans-serif';x.fillStyle='#785b6c';x.fillText('EliYork Voice',44,218);x.fillStyle='#f7e9ef';x.fillText('EliYork Voice',420,218);
        for(const base of [42,418]){let px=base;for(const size of [16,24,32,48]){x.drawImage(icon,px,244-(size-24)/2,size,size);px+=size+20;}}
        result.preview=c.toDataURL('image/png');return result;
    })()`);
    const png=size=>Buffer.from(rendered[size].split(',')[1],'base64');
    const sizes=[16,20,24,32,40,48,64,128,256],header=Buffer.alloc(6+16*sizes.length);
    header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
    let offset=header.length;
    sizes.forEach((size,i)=>{const at=6+16*i,data=png(size);header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(data.length,at+8);header.writeUInt32LE(offset,at+12);offset+=data.length;});
    const ico=Buffer.concat([header,...sizes.map(png)]);
    writeFileSync(join(brand,'favicon.ico'),ico);writeFileSync(join(desktop,'app.ico'),ico);
    writeFileSync(join(brand,'apple-touch-icon.png'),png(180));writeFileSync(join(desktop,'app.png'),png(256));
    writeFileSync(join(desktop,'tray.png'),png(64));writeFileSync(join(brand,'voice-512.png'),png(512));
    writeFileSync(join(artifacts,'icon-preview.png'),Buffer.from(rendered.preview.split(',')[1],'base64'));
    process.stdout.write('Generated SVG-derived favicon, Apple touch, Windows multi-size ICO, window and tray PNGs.\n');win.destroy();app.quit();
}).catch(fail);
