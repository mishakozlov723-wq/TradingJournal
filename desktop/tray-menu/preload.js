/* Bridge for the tray menu window only: it can pick an item or close itself. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('syterTrayMenu', {
  pick: id => ipcRenderer.send('syter:tray-menu', 'pick', String(id)),
  close: () => ipcRenderer.send('syter:tray-menu', 'close'),
  closed: () => ipcRenderer.send('syter:tray-menu', 'closed'),
  ready: () => ipcRenderer.send('syter:tray-menu', 'ready'),
  onOpen: cb => ipcRenderer.on('syter:tray-menu-open', (_e, origin) => cb(origin && typeof origin === 'object' ? { x: Number(origin.x) || 0, y: Number(origin.y) || 0 } : { x: 0, y: 0 })),
  onClose: cb => ipcRenderer.on('syter:tray-menu-close', () => cb())
});
