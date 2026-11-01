/* Bridge for the tray menu window only: it can pick an item or close itself. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('syterTrayMenu', {
  pick: id => ipcRenderer.send('syter:tray-menu', 'pick', String(id)),
  close: () => ipcRenderer.send('syter:tray-menu', 'close'),
  ready: () => ipcRenderer.send('syter:tray-menu', 'ready'),
  onOpen: cb => ipcRenderer.on('syter:tray-menu-open', () => cb()),
  onClose: cb => ipcRenderer.on('syter:tray-menu-closed', () => cb())
});
