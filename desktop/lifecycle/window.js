'use strict';
const path = require('node:path');
function lifecycleHeight(state) {
  if (state.phase === 'available' && state.notes) return 680;
  if (['verifying','installing','downloading','restarting','launching','checking'].includes(state.phase)) return 660;
  return state.phase === 'error' ? 610 : 540;
}
function publishLifecycleState(win, state) {
  if (!win || win.isDestroyed()) return;
  win.setContentSize(620, lifecycleHeight(state));
  win.webContents.send('syter-lifecycle:changed', state);
}
function createLifecycleWindow({ BrowserWindow, ipcMain, icon, getState, onAction, onClose, parent }) {
  const win = new BrowserWindow({ width: 620, height: lifecycleHeight(getState()), minWidth: 390, minHeight: 540, resizable: false,
    show: false, frame: false, backgroundColor: '#050608', title: 'SYTER', icon, parent,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  const valid = event => !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  const state = event => { if (valid(event)) event.returnValue = getState(); };
  const action = (event, name) => {
    if (valid(event) && ['install', 'launch', 'download', 'restart', 'retry', 'later', 'close'].includes(name))
      Promise.resolve(onAction(name)).catch(error => console.error('Lifecycle action:', error.message));
  };
  ipcMain.on('syter-lifecycle:state', state);
  ipcMain.on('syter-lifecycle:action', action);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('close', event => { if (onClose && onClose() === false) event.preventDefault(); });
  win.once('closed', () => { ipcMain.removeListener('syter-lifecycle:state', state); ipcMain.removeListener('syter-lifecycle:action', action); });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'window.html'));
  return win;
}
module.exports = { createLifecycleWindow, publishLifecycleState };
