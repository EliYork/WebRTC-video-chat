const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
    'voiceSettings',
    Object.freeze({
        read: () => ipcRenderer.invoke('voice-panel:read'),
        action: (action, value) =>
            ipcRenderer.invoke('voice-panel:action', action, value),
        onState: (listener) => {
            const receive = (_event, state) => listener(state);
            ipcRenderer.on('voice-panel:state', receive);
            return () =>
                ipcRenderer.removeListener('voice-panel:state', receive);
        },
    })
);
