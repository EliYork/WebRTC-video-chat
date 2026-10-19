const { contextBridge, ipcRenderer } = require('electron');
// Write-only bridge: diagnostic collection can outlive Chromium's user gesture.
// Main validates the sender/frame/origin and length for every invocation.
contextBridge.exposeInMainWorld(
    'EliYorkDesktop',
    Object.freeze({
        writeClipboardText: (text) =>
            ipcRenderer.invoke('voice:clipboard-write', text),
    })
);
