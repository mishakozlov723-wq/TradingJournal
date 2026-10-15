'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('syterLifecycle', {
  snapshot: () => ipcRenderer.sendSync('syter-lifecycle:state'),
  action: name => { if (['install','launch','download','restart','retry','later','close'].includes(name)) ipcRenderer.send('syter-lifecycle:action', name); },
  subscribe: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('syter-lifecycle:changed', listener); return () => ipcRenderer.removeListener('syter-lifecycle:changed', listener); }
});
