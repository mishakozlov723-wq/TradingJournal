'use strict';
// Run with Electron on the Windows build runner, never against a real account.
const { app, session, BrowserWindow, webContents, shell, globalShortcut, screen, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');


app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'syter-release-test-')));
let fixture = require('./renderer-fixture.cjs').replace('</body>',
  `<script>
window.TJMedia={busy:false,clearCache(){},snapshot(){return []},reset(){},async addData(){}};
// Hosted Windows/RDP runners often request reduced motion. Exercise both
// preferences explicitly in this LOCAL fixture, never in production.
window.forceReducedForTest=false;
const realMatchMedia=window.matchMedia.bind(window);
window.matchMedia=query=>{
  const media=realMatchMedia(query);
  if(query==='(prefers-reduced-motion: reduce)')
    Object.defineProperty(media,'matches',{get:()=>window.forceReducedForTest});
  return media;
};
</script></body>`);
fixture=fixture.replace('</body>',`<div id="loginParticles"></div><div id="appParticles"></div><div id="autumnParticles"></div>
<script>
document.documentElement.classList.add('season-autumn');
for(let i=0;i<3;i++){const leaf=document.createElement('div');leaf.className='autumn-leaf';
leaf.style.cssText='position:fixed;--leaf-start-rotation:10;--leaf-duration:20;--leaf-delay:-2;--leaf-sway:8;--leaf-sway-duration:3;--leaf-sway-delay:-1;--leaf-flutter:2';
leaf.innerHTML='<span class="autumn-leaf-shape">🍂</span>';autumnParticles.append(leaf);}
</script></body>`);
let trayItems=[],trayTip='';
const {Menu,Tray}=require('electron');
const realBuildMenu=Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate=items=>{trayItems=items;return realBuildMenu(items);};
const realTip=Tray.prototype.setToolTip;
Tray.prototype.setToolTip=function(value){trayTip=value;return realTip.call(this,value);};
const opened = [];
shell.openExternal = async url => { opened.push(url); };
let registered = false, shortcutCalls = 0;
const register = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => {
  registered = register(key, () => { shortcutCalls++; callback(); });
  return registered;
};
app.whenReady().then(() => {
  session.defaultSession.protocol.handle('https', request => {
    const u = new URL(request.url);
    return new Response(u.hostname === 'retocker.web.app' ? fixture : 'blocked', {
      status: u.hostname === 'retocker.web.app' ? 200 : 403,
      headers: { 'content-type': 'text/html' },
    });
  });
});

const sourcePath=path.resolve(__dirname,'../main.js');
const production=new Module(sourcePath,module);
production.filename=sourcePath;production.paths=Module._nodeModulePaths(path.dirname(sourcePath));
production._compile(fs.readFileSync(sourcePath,'utf8')+
 '\nmodule.exports.testState=()=>({miniMode,miniReady});module.exports.requestMode=requestMode;',sourcePath);
const api=production.exports;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=15000){const begin=Date.now();while(Date.now()-begin<timeout){if(await check())return;await wait(30);}throw Error('Timed out: '+label);}
function pressShortcut(layout) {
  // Use the actual Windows OEM_3 virtual key (Ё / `), not a typed character.
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SyterKeys {
 [DllImport("user32.dll")] public static extern IntPtr LoadKeyboardLayout(string id, uint flags);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
[void][SyterKeys]::LoadKeyboardLayout("${layout}", 1)
[SyterKeys]::keybd_event(0x11,0,0,[UIntPtr]::Zero)
[SyterKeys]::keybd_event(0x10,0,0,[UIntPtr]::Zero)
[SyterKeys]::keybd_event(0xC0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[SyterKeys]::keybd_event(0xC0,0,2,[UIntPtr]::Zero)
[SyterKeys]::keybd_event(0x10,0,2,[UIntPtr]::Zero)
[SyterKeys]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
`], { timeout: 10000, stdio: 'pipe' });
}
async function main(){
 assert.equal(process.platform,'win32');
 await until(()=>api.testState().miniReady,'journal native bridge ready');
 assert.equal(registered,true,'existing global mini shortcut must remain available');
 const w=BrowserWindow.getAllWindows().find(c=>c.webContents.getURL().endsWith('/titlebar.html'));
 const wc=webContents.getAllWebContents().find(c=>c.getURL().startsWith('https://retocker.web.app'));
 assert.ok(w&&wc);const originalId=wc.id;
 assert.equal(w.getTitle(),'SYTER');
 assert.equal(await w.webContents.executeJavaScript("document.querySelector('.bar span').textContent"),'SYTER');
 assert.equal(trayTip,'SYTER');
 assert.deepEqual(trayItems.filter(i=>i.label).map(i=>i.label),['Открыть журнал','Мини-журнал · Ctrl + Shift + Ё','Выход']);
 assert.equal(BrowserWindow.getAllWindows().length,1,'no auxiliary animation window');
 assert.equal(w.getOpacity(),1);
 const area=screen.getPrimaryDisplay().workArea;
 const frame=w.getBounds().width-w.getContentSize()[0];
 assert.equal(w.getMinimumSize()[0],Math.min(area.width,Math.ceil(1054*wc.getZoomFactor()+frame)));
 const width=Math.min(area.width,Math.max(w.getMinimumSize()[0],Math.min(1200,area.width-40)));
 w.setBounds({x:area.x,y:area.y+20,width,height:Math.min(760,area.height-40)});
 await wait(150);const original=w.getBounds();
 await wc.executeJavaScript("magnitudeInput.value='2.25';riskPercentInput.value='0.5';syterTradeNotes.value='native draft';currentScreenshot='draft-image';window.previewCount=0;window.addEventListener('syter:interface-preview-toggle',()=>window.previewCount++);");
 async function settled(mini){await until(async()=>api.testState().miniMode===mini&&await wc.executeJavaScript(`document.body.classList.contains('syter-mini')===${mini}&&!document.body.dataset.syterModeTransition`),'mode settled');}
 async function draft(){return wc.executeJavaScript('({rr:magnitudeInput.value,risk:riskPercentInput.value,notes:syterTradeNotes.value,image:currentScreenshot})');}
 const expected={rr:'2.25',risk:'0.5',notes:'native draft',image:'draft-image'};
 let resizeCalls=0;const setBounds=w.setBounds.bind(w);w.setBounds=(...args)=>{resizeCalls++;return setBounds(...args);};
 for(let i=0;i<12;i++){
  const before=resizeCalls;api.requestMode(true);await settled(true);
  assert.equal(w.getBounds().width,420);assert.equal(w.getMinimumSize()[0],380);
  assert.equal(w.getOpacity(),1);assert.equal(resizeCalls-before,1);
  assert.equal(BrowserWindow.getAllWindows().length,1);
  api.requestMode(false);await settled(false);assert.deepEqual(w.getBounds(),original);
  assert.equal(w.getOpacity(),1);assert.equal(wc.id,originalId);assert.deepEqual(await draft(),expected);
 }
 w.maximize();await until(()=>w.isMaximized(),'maximized');
 api.requestMode(true);await settled(true);api.requestMode(false);await settled(false);assert.equal(w.isMaximized(),true);
 w.unmaximize();await wait(100);
 for(const layout of ['00000419','00000409']){
  w.hide();await wait(450);const before=shortcutCalls;pressShortcut(layout);
  await until(()=>shortcutCalls===before+1,'actual global OEM_3 '+layout);await settled(true);assert.equal(w.isVisible(),true);
  await wait(450);pressShortcut(layout);await settled(false);
 }
 w.show();w.focus();wc.focus();await wait(100);
 const zoom=wc.getZoomLevel();
 wc.sendInputEvent({type:'keyDown',keyCode:'0',modifiers:['control','shift']});
 wc.sendInputEvent({type:'keyUp',keyCode:'0',modifiers:['control','shift']});
 await until(()=>wc.executeJavaScript('window.previewCount===1'),'private shortcut event');
 assert.equal(wc.getZoomLevel(),zoom);assert.deepEqual(await draft(),expected);assert.equal(wc.id,originalId);
 wc.setZoomLevel(-.5);
 wc.sendInputEvent({type:'keyDown',keyCode:'0',modifiers:['control']});wc.sendInputEvent({type:'keyUp',keyCode:'0',modifiers:['control']});
 await until(()=>wc.getZoomLevel()===0,'ordinary Ctrl+0 resets zoom');
 assert.equal(await wc.executeJavaScript('window.previewCount'),1);
 const seasonal=await wc.executeJavaScript(`({stars:[getComputedStyle(loginParticles).display,getComputedStyle(appParticles).display],
 animations:document.querySelectorAll('#autumnParticles .autumn-leaf').length,
 mode:document.documentElement.getAttribute('data-syter-autumn-motion'),
 running:[...document.querySelectorAll('#autumnParticles .autumn-leaf,#autumnParticles .autumn-leaf-shape')].flatMap(e=>e.getAnimations()).filter(a=>a.playState==='running').length,
 oldApi:typeof window.__syterAutumnMotion})`);
 assert.deepEqual(seasonal,{stars:['none','none'],animations:3,mode:'numeric',running:9,oldApi:'undefined'});
 const url='https://retocker.web.app/?note=AbCd0123456789Ef';
 await wc.executeJavaScript(`window.open(${JSON.stringify(url)},'_blank')`);await until(()=>opened.length===1,'new-tab model link');
 await wc.executeJavaScript(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(url)};document.body.append(a);a.click();a.remove();})()`);
 await until(()=>opened.length===2,'same-tab model link');assert.deepEqual(opened,[url,url]);
 assert.equal(wc.getURL(),'https://retocker.web.app/');assert.deepEqual(await draft(),expected);
 w.close();assert.equal(w.isVisible(),false);assert.equal(wc.id,originalId);
 api.requestMode(false);await until(()=>w.isVisible(),'restore from tray');
 assert.equal(BrowserWindow.getAllWindows().length,1);
 console.log('PASS: production title/tray, Windows minimum width, 12 no-overlay mini cycles, drafts, maximized restore, actual global shortcuts, private UI hook vs Ctrl+0, optimized leaves, links and tray restore.');
}
app.whenReady().then(main).then(()=>app.exit(0)).catch(error=>{console.error(error.stack||error);app.exit(1);});
