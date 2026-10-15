'use strict';
// Actual isolated preload, IPC and rendered windows, with a deterministic updater.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLifecycleWindow, publishLifecycleState } = require('../lifecycle/window');
const { createUpdateController } = require('../lifecycle/controller');
const wait = ms => new Promise(r=>setTimeout(r,ms));
const output = path.resolve(__dirname,'../test-artifacts');fs.mkdirSync(output,{recursive:true});
let win;
async function shot(name){await wait(200);assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth'),false,'No overflow: '+name);fs.writeFileSync(path.join(output,`lifecycle-${name}.png`),(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  const updater=new EventEmitter();let installed,downloads=0,quits=0;
  updater.checkForUpdates=async()=>{};updater.downloadUpdate=async()=>{downloads++;};updater.quitAndInstall=(...args)=>{installed=args;};
  const flow=createUpdateController({updater,currentVersion:'1.3.0',publish:s=>publishLifecycleState(win,s),reveal:()=>{},dismiss:()=>win.hide(),prepareQuit:()=>quits++});
  updater.emit('update-available',{version:'1.3.1',releaseNotes:'Branded desktop installation.\nA new in-app update flow.\nYour journal stays unchanged.'});
  win=createLifecycleWindow({BrowserWindow,ipcMain,getState:()=>flow.snapshot(),onAction:name=>flow.action(name)});
  await new Promise(r=>win.webContents.once('did-finish-load',r));
  assert.equal(await win.webContents.executeJavaScript('typeof require'),'undefined');
  assert.equal(await win.webContents.executeJavaScript('window.syterLifecycle.snapshot().phase'),'available');
  await shot('available');
  await win.webContents.executeJavaScript('document.getElementById("primary").click()');await wait(100);assert.equal(downloads,1);
  updater.emit('download-progress',{percent:37.5,total:104857600,transferred:39321600});await shot('download');
  updater.emit('error',Error('offline'));await shot('error');
  await win.webContents.executeJavaScript('document.getElementById("primary").click()');await wait(100);assert.equal(downloads,2);
  updater.emit('update-downloaded',{version:'1.3.1'});await shot('ready');
  await win.webContents.executeJavaScript('document.getElementById("secondary").click()');await wait(100);assert.equal(win.isVisible(),false);assert.equal(quits,0);
  win.show();await win.webContents.executeJavaScript('document.getElementById("primary").click()');await wait(100);assert.deepEqual(installed,[true,true]);
  flow.stop();win.destroy();
  for(const phase of ['welcome','installing','ready','error']){
    const state={mode:'install',phase,version:'1.3.1',error:'Installation could not finish. Close SYTER if it is running, then try again.'};
    win=createLifecycleWindow({BrowserWindow,ipcMain,getState:()=>state,onAction:()=>{}});
    await new Promise(r=>win.webContents.once('did-finish-load',r));await shot('installer-'+phase);win.destroy();
  }
  console.log('PASS: isolated native lifecycle windows, real IPC, consent, progress, retry and silent restart arguments');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
