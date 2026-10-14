'use strict';
// Isolated Electron integration test: no hosted page or real journal account.
const {app,BrowserWindow,WebContentsView}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'syter-resize-')));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('Resize test timed out');app.exit(1);},20000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:900,height:700,show:false});
 const view=new WebContentsView({webPreferences:{sandbox:true,backgroundThrottling:false}});
 win.contentView.addChildView(view);
 const layout=()=>{const [width,height]=win.getContentSize();view.setBounds({x:0,y:36,width,height:height-36});};
 win.on('resize',layout);layout();
 const wc=view.webContents;
 await wc.loadURL('data:text/html,'+encodeURIComponent(`<style>
 @keyframes drift{from{transform:translateX(0)}to{transform:translateX(200px)}}
 .particle,.chart{animation:drift 10s linear infinite;width:10px;height:10px;background:red}
 </style><input id="draft" value="unsaved trade"><div id="scroll" style="height:80px;overflow:auto"><div style="height:1000px">Journal</div></div>
 <div id="appParticles"><div class="particle"></div></div><div class="chart"></div>`));
 await wc.insertCSS(fs.readFileSync(path.join(__dirname,'../resize-performance.css'),'utf8'));
 const script=fs.readFileSync(path.join(__dirname,'../resize-performance.js'),'utf8');
 await wc.executeJavaScript(script);await wc.executeJavaScript(script);
 win.showInactive();await wait(250);
 await wc.executeJavaScript(`document.querySelector('#scroll').scrollTop=140;document.querySelector('#draft').focus();`);
 for(let i=0;i<5;i++){win.setSize(500+i*80,600+i*10);await wait(35);}
 const snapshot=()=>wc.executeJavaScript(`({resizing:document.documentElement.classList.contains('syter-window-resizing'),particle:getComputedStyle(document.querySelector('.particle')).animationPlayState,chart:getComputedStyle(document.querySelector('.chart')).animationPlayState,draft:document.querySelector('#draft').value,scroll:document.querySelector('#scroll').scrollTop,focus:document.activeElement.id})`);
 let state=await snapshot();
 assert.equal(state.resizing,true);assert.equal(state.particle,'paused');assert.equal(state.chart,'running');
 assert.equal(state.draft,'unsaved trade');assert.equal(state.scroll,140);assert.equal(state.focus,'draft');
 const phase=await wc.executeJavaScript(`document.querySelector('.particle').getAnimations()[0].currentTime`);
 await wait(240);state=await snapshot();assert.equal(state.resizing,false);assert.equal(state.particle,'running');
 assert.ok(await wc.executeJavaScript(`document.querySelector('.particle').getAnimations()[0].currentTime>=${phase}`),'animation resumes its phase');
 await wc.executeJavaScript(`window.dispatchEvent(new Event('resize'))`);
 assert.equal((await snapshot()).resizing,false,'unchanged dimensions must not pause');
 win.setSize(850,640);await wait(40);assert.equal((await snapshot()).resizing,true);
 await wc.executeJavaScript(`window.syterResizePerformance.dispose()`);
 assert.equal((await snapshot()).resizing,false);
 win.setSize(700,640);await wait(40);assert.equal((await snapshot()).resizing,false);
 assert.equal(view.getBounds().height,win.getContentSize()[1]-36);
 console.log('PASS: native resize pauses decoration only, resumes its phase, preserves draft/focus/scroll, and cleans up.');
 clearTimeout(deadline);win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
