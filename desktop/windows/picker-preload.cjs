const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('screenPicker', {
    onSources: (callback) =>
        ipcRenderer.on('sources', (_event, sources) => callback(sources)),
    select: (id, audio) => ipcRenderer.send('pick-source', { id, audio }),
});
