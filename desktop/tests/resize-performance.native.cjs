'use strict';
// Programmatic Electron integration check. This is NOT a manual-drag FPS test.
const {app,BrowserWindow,WebContentsView}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {createViewLayout}=require('../view-layout');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'syter-resize-')));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('Resize test timed out');app.exit(1);},20000);
app.whenReady().then(async()=>{
 const expectedElectron=require('../package.json').devDependencies.electron;
 assert.equal(process.versions.electron,expectedElectron,'native test uses the pinned Electron runtime');
 const artifactDir=path.join(__dirname,'../test-artifacts');fs.mkdirSync(artifactDir,{recursive:true});
 const runtime={versions:process.versions,gpuFeatures:app.getGPUFeatureStatus(),gpu:await app.getGPUInfo('basic')};
 fs.writeFileSync(path.join(artifactDir,'resize-runtime.json'),JSON.stringify(runtime,null,2));
 console.log('Resize runtime:',JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome,gpuFeatures:runtime.gpuFeatures}));
 const win=new BrowserWindow({width:900,height:700,show:false});
 const view=new WebContentsView({webPreferences:{sandbox:true,backgroundThrottling:false}});
 win.contentView.addChildView(view);
 const layout=createViewLayout({getWindow:()=>win,getView:()=>view});
 let boundsCalls=0;const setBounds=view.setBounds.bind(view);
 view.setBounds=b=>{boundsCalls++;return setBounds(b)};
 win.on('resize',layout.layout);layout.layout();
 const wc=view.webContents;
 await wc.loadURL('data:text/html,'+encodeURIComponent(`<style>
 @keyframes drift{from{transform:translateX(0)}to{transform:translateX(200px)}}
 .particle,.chart{animation:drift 10s linear infinite;width:10px;height:10px;background:red}
 </style><input id="draft" value="unsaved trade"><div id="scroll" style="height:80px;overflow:auto"><div style="height:1000px">Journal</div></div>
 <div id="appParticles"><div class="particle"></div></div><div class="chart"></div>`));
 win.showInactive();await wait(250);
 await wc.executeJavaScript(`document.querySelector('#scroll').scrollTop=140;document.querySelector('#draft').focus();`);
 const snapshot=()=>wc.executeJavaScript(`({resizing:document.documentElement.classList.contains('syter-window-resizing'),particle:getComputedStyle(document.querySelector('.particle')).animationPlayState,chart:getComputedStyle(document.querySelector('.chart')).animationPlayState,draft:document.querySelector('#draft').value,scroll:document.querySelector('#scroll').scrollTop,focus:document.activeElement.id,phase:document.querySelector('.particle').getAnimations()[0].currentTime})`);
 const initial=await snapshot();
 for(let i=0;i<5;i++){
  win.setSize(500+i*80,600+i*10);await wait(35);
  const state=await snapshot();assert.equal(state.resizing,false);assert.equal(state.particle,'running');
  assert.equal(state.chart,'running');assert.equal(state.draft,'unsaved trade');
  assert.equal(state.scroll,140);assert.equal(state.focus,'draft');
 }
 assert.ok((await snapshot()).phase>initial.phase,'animation timeline continues without deliberate pause');
 const before=boundsCalls;for(let i=0;i<100;i++)layout.layout();assert.equal(boundsCalls,before,'identical native updates are skipped');
 assert.equal(view.getBounds().width,win.getContentSize()[0]);
 assert.equal(view.getBounds().height,win.getContentSize()[1]-36);
 console.log('PASS: programmatic resize keeps animation running, preserves draft/focus/scroll, and skips duplicate bounds. Manual drag smoothness is NOT established.');
 clearTimeout(deadline);win.destroy();app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
