'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createLifecycleWindow, publishLifecycleState } = require('../lifecycle/window');
const { verifyPayload, runSilent, installedExecutable } = require('./engine');
const manifest = require('./manifest.json');
// Independent installer profile, never the user's journal profile.
app.setPath('userData', path.join(os.tmpdir(), 'syter-installer-profile'));
let win, busy = false, exe = null;
let state = { mode: 'install', phase: 'welcome', version: manifest.version, percent: null };
function send(patch) { state = {...state, ...patch}; publishLifecycleState(win, state); }
function fail(error) { busy = false; send({phase:'error',percent:null,error:'Installation could not finish. Close SYTER if it is running, then try again.'}); console.error(error); }
async function action(name) {
  if (name === 'close' && !busy) return app.quit();
  if ((name === 'install' || name === 'retry') && !busy && ['welcome','error'].includes(state.phase)) {
    busy = true;
    try {
      const payload = path.join(process.resourcesPath, 'payload', 'setup.exe');
      send({phase:'verifying',percent:0,error:''});
      await verifyPayload(payload, manifest.sha256, percent => send({percent}));
      send({phase:'installing',percent:null});
      await runSilent(payload);
      exe = await installedExecutable(manifest.version);
      busy = false; send({phase:'ready',percent:null});
    } catch (error) { fail(error); }
  } else if (name === 'launch' && exe && !busy && state.phase === 'ready') {
    busy = true; send({phase:'launching',percent:null});
    const child = spawn(exe, [], {detached:true,stdio:'ignore',shell:false,cwd:path.dirname(exe)});
    child.once('error', error => { fail(error); send({retry:'launch'}); });
    child.once('spawn', () => { child.unref(); app.quit(); });
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if(win){win.restore();win.show();win.focus();} });
  app.whenReady().then(() => {
    win = createLifecycleWindow({BrowserWindow,ipcMain,icon:path.join(__dirname,'../build/app-icon.png'),getState:()=>state,onAction:action,onClose:()=>!busy});
  });
  app.on('window-all-closed', () => { if(!busy) app.quit(); });
}
