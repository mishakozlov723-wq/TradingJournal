// Runs inside the page before the site loads. Kept minimal on purpose:
// it tells the site it is running inside the desktop app and gives it the
// "remember my login for 6 hours" calls (no password is ever stored or passed).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('syterDesktop', {
  isDesktop: true,
  setClipboardCapture: on => ipcRenderer.invoke('syter:clipboard-capture',!!on),
  onClipboardImage: callback => {const listener=(_e,payload)=>callback(payload);ipcRenderer.on('syter:clipboard-captured',listener);return ()=>ipcRenderer.removeListener('syter:clipboard-captured',listener);},
  miniReady: () => ipcRenderer.invoke('syter:mini-ready'),
  setMiniMode: (enabled) => ipcRenderer.invoke('syter:mini-mode', !!enabled),
  setMiniPinned: (enabled) => ipcRenderer.invoke('syter:mini-pin', !!enabled),
  readClipboardImage: () => ipcRenderer.invoke('syter:clipboard-image'),
  onModeRequest: (callback) => {
    const listener = (_event, mini) => callback(!!mini);
    ipcRenderer.on('syter:mode-request', listener);
    return () => ipcRenderer.removeListener('syter:mode-request', listener);
  },
  // -> { valid: boolean, login: string, remainingMs: number }
  getRemember: () => ipcRenderer.invoke('syter:remember-get'),
  // Call after a successful MANUAL sign-in: starts the 6 hour timer.
  rememberLogin: (login) => ipcRenderer.invoke('syter:remember-set', String(login || '')),
  forgetLogin: () => ipcRenderer.invoke('syter:remember-clear'),
});
