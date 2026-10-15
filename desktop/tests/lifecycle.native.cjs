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
let win; let expectedBounds;
// Keep the isolated test host alive while replacing its windows.
app.on('window-all-closed', () => {});
async function shot(name){await wait(200);assert.deepEqual(win.getBounds(),expectedBounds,'No phase resize: '+name);assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth'),false,'No overflow: '+name);fs.writeFileSync(path.join(output,`lifecycle-${name}.png`),(await win.webContents.capturePage()).toPNG());}

async function checkStartupOverflow(){
  const samples=await win.webContents.executeJavaScript(`(async()=>{
    await document.fonts.ready;
    const main=document.querySelector('main');
    const rule=[...document.styleSheets].flatMap(s=>[...s.cssRules]).find(r=>r.name==='enter');
    if(!rule)throw Error('Missing initial reveal keyframes');
    const frames=[...rule.cssRules].map(r=>({offset:r.keyText==='from'?0:r.keyText==='to'?1:parseFloat(r.keyText)/100,opacity:r.style.opacity,transform:r.style.transform||'none'}));
    main.getAnimations().forEach(a=>a.cancel());
    const animation=main.animate(frames,{duration:400,fill:'both'});animation.pause();
    const result=[0,50,100,200,399,400].map(t=>{
      animation.currentTime=t;
      const root=document.documentElement;
      return {t,width:root.clientWidth,height:root.scrollHeight,overflow:root.scrollHeight>innerHeight||root.scrollWidth>innerWidth};
    });
    animation.cancel();return result;
  })()`);
  for(const sample of samples)assert.equal(sample.overflow,false,'Initial reveal overflow at '+sample.t+'ms');
  assert.equal(new Set(samples.map(s=>s.width)).size,1,'Initial reveal must not change content width');
  console.log('PASS: initial reveal has no scrollbar or content-width jump at 0/50/100/200/399/400ms');
}

app.whenReady().then(async()=>{
  const updater=new EventEmitter();let installed,downloads=0,quits=0;
  updater.checkForUpdates=async()=>{};updater.downloadUpdate=async()=>{downloads++;};updater.quitAndInstall=(...args)=>{installed=args;};
  const flow=createUpdateController({updater,currentVersion:'1.3.0',publish:s=>publishLifecycleState(win,s),reveal:()=>{},dismiss:()=>win.hide(),prepareQuit:()=>quits++});
  updater.emit('update-available',{version:'1.3.1',releaseNotes:'Branded desktop installation.\nA new in-app update flow.\nYour journal stays unchanged.'});
  win=createLifecycleWindow({BrowserWindow,ipcMain,getState:()=>flow.snapshot(),onAction:name=>flow.action(name)});
  await new Promise(r=>win.webContents.once('did-finish-load',r));expectedBounds=win.getBounds();
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
    const state={mode:'install',phase,stage:'copying',percent:phase==='installing'?73:null,processed:300,workTotal:400,version:'1.3.2',error:'Installation could not finish. Close SYTER if it is running, then try again.'};
    win=createLifecycleWindow({BrowserWindow,ipcMain,getState:()=>state,onAction:()=>{}});
    await new Promise(r=>win.webContents.once('did-finish-load',r));expectedBounds=win.getBounds();if(phase==='welcome')await checkStartupOverflow();await shot('installer-'+phase);win.destroy();
  }
  console.log('PASS: isolated native lifecycle windows, real IPC, consent, progress, retry and silent restart arguments');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
