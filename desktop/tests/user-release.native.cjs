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

const stages=[];process.env.SYTER_TRANSITION_TEST='1';
const nativeLog=console.log;console.log=(...args)=>{if(args[0]==='TRANSITION:')stages.push(args[1]);nativeLog(...args);};
const journalWindowCount=()=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().endsWith('/mode-transition.html')).length;
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
async function recordDesktop(label){
 const out=path.resolve(__dirname,'../test-artifacts/mode-cycle-'+label);fs.mkdirSync(out,{recursive:true});
 const ready=path.join(out,'ready');
 const script=`
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$clock=[System.Diagnostics.Stopwatch]::StartNew()
$times=@()
for($i=0;$i -lt 45;$i++){
 $bmp=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
 $g=[System.Drawing.Graphics]::FromImage($bmp)
 try{
  $times+=$clock.Elapsed.TotalMilliseconds
  $g.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
  $bmp.Save(('${out.replaceAll("'","''")}\\frame-{0:D3}.png' -f $i),[System.Drawing.Imaging.ImageFormat]::Png)
 }finally{$g.Dispose();$bmp.Dispose()}
 if($i -eq 0){Set-Content -Path '${ready.replaceAll("'","''")}' -Value ready}
 Start-Sleep -Milliseconds 16
}
$times|ConvertTo-Json|Set-Content '${out.replaceAll("'","''")}\\timestamps.json'
`;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
 let error='';child.stderr.on('data',data=>error+=data);
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Desktop capture failed: '+error)));});
 await until(()=>fs.existsSync(ready),'desktop capture ready');await wait(100);
 // Wrap the promise: returning it directly would await the whole recording.
 return {done:completed};
}
function assertAnimated(start,label){
 const cycle=stages.slice(start);
 for(const stage of ['source-frame-verified','cover-presented','playback-completed','destination-presented','live-presented'])assert.ok(cycle.includes(stage),label+' reached '+stage);
 assert.ok(cycle.indexOf('source-frame-verified')<cycle.indexOf('live-concealed'),label+' never hides live source before verified cover');
 return cycle;
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
 assert.equal(journalWindowCount(),1,'no auxiliary animation window');
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
  const before=resizeCalls,inStart=stages.length;
  const inRecording=i===0?await recordDesktop('normal-to-mini'):null;
  api.requestMode(true);await settled(true);assertAnimated(inStart,'normal to mini cycle '+i);
  if(inRecording)await inRecording.done;
  assert.equal(w.getBounds().width,420);assert.equal(w.getMinimumSize()[0],380);
  assert.equal(w.getOpacity(),1);assert.equal(resizeCalls-before,1);
  assert.equal(journalWindowCount(),1);
  const outStart=stages.length;
  const outRecording=i===0?await recordDesktop('mini-to-normal'):null;
  api.requestMode(false);await settled(false);assertAnimated(outStart,'mini to normal cycle '+i);
  if(outRecording)await outRecording.done;
  assert.deepEqual(w.getBounds(),original);
  assert.equal(w.getOpacity(),1);assert.equal(wc.id,originalId);assert.deepEqual(await draft(),expected);
 }
 // Inspect the SOURCE of native maximize, not just the final rectangle.
 const results=[];
 for(const [label,fx,fy] of [['right-top',1,0],['left-bottom',0,1],['middle',.5,.4]]){
  w.maximize();await until(()=>w.isMaximized(),'maximized');await wait(200);
  const inStart=stages.length;
  const incomingRecording=label==='right-top'?await recordDesktop('maximized-to-mini'):null;
  api.requestMode(true);await settled(true);const inboundStages=assertAnimated(inStart,'maximized to mini '+label);
  if(incomingRecording)await incomingRecording.done;
  assert.equal(w.isMaximizable(),false);assert.equal(w.isFullScreenable(),false);
  const small=w.getBounds();small.height=Math.max(480,Math.min(small.height,area.height-160));
  w.setBounds({x:area.x+Math.round((area.width-small.width)*fx),y:area.y+Math.round((area.height-small.height)*fy),width:small.width,height:small.height});
  await wait(200);const source=w.getBounds(),operations=[];
  const nativeMaximize=w.maximize.bind(w),nativeBounds=w.setBounds.bind(w),nativeMinimum=w.setMinimumSize.bind(w);
  w.maximize=()=>{operations.push({kind:'maximize',source:w.getBounds(),normal:w.getNormalBounds()});return nativeMaximize();};
  w.setBounds=(...args)=>{operations.push({kind:'setBounds',source:w.getBounds(),args});return nativeBounds(...args);};
  w.setMinimumSize=(...args)=>{operations.push({kind:'minimum',source:w.getBounds(),args});return nativeMinimum(...args);};
  let recorder=null;
  if(label==='right-top')recorder=await recordDesktop('moved-mini-to-maximized');
  const stageStart=stages.length;
  api.requestMode(false);await settled(false);await until(()=>w.isMaximized(),'maximized from mini');
  const cycleStages=stages.slice(stageStart);
  for(const stage of ['source-frame-verified','playback-completed','live-presented'])assert.ok(cycleStages.includes(stage),'return compositor reached '+stage);
  assert.ok(cycleStages.indexOf('source-frame-verified')<cycleStages.indexOf('live-concealed'),'conceal only after source has really been presented');
  if(recorder)await recorder.done;
  w.maximize=nativeMaximize;w.setBounds=nativeBounds;w.setMinimumSize=nativeMinimum;
  const expansion=operations.find(o=>o.kind==='maximize');
  assert.ok(expansion,'native maximize called');
  assert.deepEqual(expansion.source,source,'maximize must start at the moved MINI rectangle');
  assert.deepEqual(expansion.normal,source,'Windows normal placement must still be the current mini rectangle');
  assert.equal(operations.filter(o=>o.kind==='setBounds').length,0,'no intermediate relocation');
  const maxIndex=operations.indexOf(expansion);
  assert.equal(operations.slice(0,maxIndex).filter(o=>o.kind==='minimum').length,0,'no minimum-size growth before expansion');
  results.push({label,source,operations,inboundStages,cycleStages});
  assert.deepEqual(await draft(),expected);
  w.unmaximize();await wait(150);assert.deepEqual(w.getBounds(),original,'manual normal restore must not return a mini-sized full journal');
 }
 fs.mkdirSync(path.join(__dirname,'../test-artifacts'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'../test-artifacts/mini-expand-origin.json'),JSON.stringify(results,null,2));
 console.log('PASS: both directions use verified source and completed animation; native expansion from three moved mini positions; no preposition/width change; original normal rectangle and draft restored.');
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
 assert.equal(journalWindowCount(),1);
 console.log('PASS: production title/tray, Windows minimum width, 12 verified-animated bidirectional mini cycles, drafts, maximized restore, actual global shortcuts, private UI hook vs Ctrl+0, optimized leaves, links and tray restore.');
}
app.whenReady().then(main).then(()=>app.exit(0)).catch(error=>{console.error(error.stack||error);app.exit(1);});
