'use strict';
// Run with Electron on the Windows build runner, never against a real account.
const { app, session, BrowserWindow, webContents, shell, globalShortcut, screen, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
process.env.SYTER_TRANSITION_TEST = '1';

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'syter-release-test-')));
const fixture = require('./renderer-fixture.cjs').replace('</body>',
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

const sourcePath = path.resolve(__dirname, '../main.js');
let handoffChecks=0;
let verifiedEntries=0;
let filming=false;
const filmEvents=[];
function desktopShot(rect,output){
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',
    path.join(__dirname,'capture-desktop-region.ps1'),'-X',String(rect.x),'-Y',String(rect.y),
    '-Width',String(rect.width),'-Height',String(rect.height),'-Output',output],
    {timeout:10000,stdio:'pipe',windowsHide:true});
}
function pixelDifference(actual,expected){
  assert.deepEqual(actual.getSize(),expected.getSize());
  const a=actual.toBitmap(),b=expected.toBitmap(),size=actual.getSize();
  let total=0,channels=0;
  for(let y=8;y<size.height-8;y++)for(let x=8;x<size.width-8;x++){
    const i=(y*size.width+x)*4;
    for(let c=0;c<3;c++){total+=Math.abs(a[i+c]-b[i+c]);channels++;}
  }
  return total/channels;
}
async function inspectHandoff(stage,data){
  if(!['cover-presented','destination-presented'].includes(stage)||handoffChecks>=4)return;
  const snapshot=data.source||data.destination;
  const rect=snapshot.rect;
  const actual=await data.overlay.webContents.capturePage({
    x:rect.x-data.union.x,y:rect.y-data.union.y+snapshot.top,
    width:rect.width,height:rect.height-snapshot.top,
  });
  const expected=nativeImage.createFromDataURL(snapshot.body);
  if(JSON.stringify(actual.getSize())!==JSON.stringify(expected.getSize())){
    console.log('HANDOFF GEOMETRY:',JSON.stringify({stage,rect,union:data.union,
      cover:data.overlay.getBounds(),content:data.overlay.getContentBounds(),
      expected:expected.getSize(),actual:actual.getSize()}));
  }
  assert.deepEqual(actual.getSize(),expected.getSize(),'handoff must use native pixel dimensions');
  const a=actual.toBitmap(),b=expected.toBitmap(),size=actual.getSize();
  let difference=0,channels=0;
  for(let y=8;y<size.height-8;y++)for(let x=8;x<size.width-8;x++){
    const i=(y*size.width+x)*4;
    for(let c=0;c<3;c++){difference+=Math.abs(a[i+c]-b[i+c]);channels++;}
  }
  const average=difference/channels;
  console.log(`HANDOFF ${handoffChecks} ${stage}: native-pixel color difference ${average.toFixed(4)}`);
  assert.ok(average<1,'source/destination handoff must not change text contrast or introduce a blank frame');
  const artifacts=path.resolve(__dirname,'../test-artifacts');fs.mkdirSync(artifacts,{recursive:true});
  // A capturePage() match does NOT establish an invisible Windows/DWM handoff.
  // Inspect the actual desktop placement, not another offscreen browser image.
  const desktopPath=path.join(artifacts,`desktop-${handoffChecks}-${stage}.png`);
  desktopShot({x:rect.x,y:rect.y+snapshot.top,width:rect.width,height:rect.height-snapshot.top},desktopPath);
  console.log(`DESKTOP ${handoffChecks} ${stage}: actual-screen color difference ${pixelDifference(nativeImage.createFromPath(desktopPath),expected).toFixed(4)}`);
  fs.writeFileSync(path.join(artifacts,`handoff-${handoffChecks++}-${stage}.png`),actual.toPNG());
}
// Instrument only this isolated test process, without a production test API.
const realLoad=Module._load;
Module._load=function(request,parent,isMain){
  const exported=realLoad.apply(this,arguments);
  if(request==='./window-motion'&&parent?.filename===sourcePath){
    return {createWindowMotion:options=>exported.createWindowMotion({...options,timeout:15000,
      onStage:async(stage,data)=>{
        options.onStage?.(stage,data);
        if(stage==='source-frame-verified')verifiedEntries++;
        if(filming){filmEvents.push({stage,time:Date.now()});return;}
        await inspectHandoff(stage,data);
      }
    })};
  }
  return exported;
};
const production = new Module(sourcePath, module);
production.filename = sourcePath;
production.paths = Module._nodeModulePaths(path.dirname(sourcePath));
production._compile(fs.readFileSync(sourcePath, 'utf8') +
  '\nmodule.exports.testState=()=>({miniMode,miniReady});module.exports.requestMode=requestMode;', sourcePath);
Module._load=realLoad;
const api = production.exports;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await check()) return; await wait(30); }
  throw Error('Timed out: ' + label);
}
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
async function main() {
  assert.equal(process.platform, 'win32', 'native release test must run on Windows');
  await until(() => api.testState().miniReady, 'journal native bridge ready');
  assert.equal(registered, true, 'global shortcut must register on the Windows runner');
  const w = BrowserWindow.getAllWindows()[0];
  const wc = webContents.getAllWebContents().find(c => c.getURL().startsWith('https://retocker.web.app'));
  assert.ok(w && wc);
  const originalId = wc.id;
  const area = screen.getPrimaryDisplay().workArea;
  w.setBounds({ x: area.x + 20, y: area.y + 20,
    width: Math.min(900, area.width - 40), height: Math.min(760, area.height - 40) });
  await wc.executeJavaScript("magnitudeInput.value='2.25';riskPercentInput.value='0.5';syterTradeNotes.value='native draft';currentScreenshot='draft-image';");
  const original = w.getBounds();
  const artifacts = path.resolve(__dirname, '../test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  let nativeResizeCalls = 0;
  const setBounds = w.setBounds.bind(w);
  w.setBounds = (...args) => { nativeResizeCalls++; return setBounds(...args); };
  async function settled(mini) {
    await until(async () => api.testState().miniMode === mini &&
      await wc.executeJavaScript(`document.body.classList.contains('syter-mini') === ${mini} && !document.body.dataset.syterModeTransition`), 'mode settled');
  }

  // Bright desktop behind the app exposes even a short transparency gap.
  // The previous black desktop and slow stage-by-stage screenshots hid it.
  const backdrop=new BrowserWindow({...area,show:false,frame:false,skipTaskbar:true,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await backdrop.loadURL('data:text/html,'+encodeURIComponent(
    '<body style="margin:0;background:repeating-conic-gradient(#ff00d4 0% 25%,#fff 0% 50%) 0/80px 80px"></body>'));
  backdrop.showInactive(); w.moveTop(); w.focus(); await wait(400);
  const filmDirectory=path.join(artifacts,'temporal');fs.mkdirSync(filmDirectory,{recursive:true});
  const recorder=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',
    path.join(__dirname,'record-desktop.ps1'),'-X',String(area.x),'-Y',String(area.y),
    '-Width',String(area.width),'-Height',String(area.height),'-Directory',filmDirectory],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
  let recorderError='';recorder.stderr.on('data',data=>{recorderError+=data;});
  const recorded=new Promise((resolve,reject)=>{
    recorder.on('error',reject);
    recorder.on('exit',code=>code===0?resolve():reject(Error('Desktop recording failed: '+recorderError)));
  });
  await until(()=>fs.existsSync(path.join(filmDirectory,'ready')),'continuous desktop recorder');
  filming=true;
  let miniFilmBounds;
  try{
    await wait(100);
    filmEvents.push({stage:'request-mini',time:Date.now()});
    api.requestMode(true);await settled(true);miniFilmBounds=w.getContentBounds();await wait(180);
    filmEvents.push({stage:'request-full',time:Date.now()});
    api.requestMode(false);await settled(false);await wait(180);
    filmEvents.push({stage:'native-maximize-start',time:Date.now()});
    w.maximize();await until(()=>w.isMaximized(),'maximize for continuous recording');await wait(300);
    filmEvents.push({stage:'native-maximize-end',time:Date.now()});
    filmEvents.push({stage:'request-mini-from-maximized',time:Date.now()});
    api.requestMode(true);await settled(true);await wait(180);
    filmEvents.push({stage:'request-full-maximized',time:Date.now()});
    api.requestMode(false);await settled(false);await wait(180);
  } finally {
    filming=false;fs.writeFileSync(path.join(filmDirectory,'stop'),'stop');await recorded;
    fs.writeFileSync(path.join(filmDirectory,'events.json'),JSON.stringify({area,original,mini:miniFilmBounds,events:filmEvents},null,2));
    backdrop.destroy();
  }
  // This bottom interior rectangle stays INSIDE both window sizes throughout
  // the monotonic morph. A magenta checkerboard there means real transparency,
  // not the intended desktop reveal outside the moving pane or ClearType text.
  const roi={
    left:Math.max(original.x,miniFilmBounds.x)-area.x+24,
    right:Math.min(original.x+original.width,miniFilmBounds.x+miniFilmBounds.width)-area.x-24,
    bottom:Math.min(original.y+original.height,miniFilmBounds.y+miniFilmBounds.height)-area.y-32,
  };roi.top=roi.bottom-64;
  assert.ok(roi.right>roi.left&&roi.top>0);
  const filmTimes=JSON.parse(fs.readFileSync(path.join(filmDirectory,'times.json'),'utf8'));
  assert.ok(filmTimes.length>=15,'continuous test must include actual desktop frames');
  let maxLeak=0;
  const maximizeStart=filmEvents.find(e=>e.stage==='native-maximize-start').time;
  const maximizeEnd=filmEvents.find(e=>e.stage==='native-maximize-end').time;
  for(let frame=0;frame<filmTimes.length;frame++){
    // The test's separate native maximize command has its own OS animation;
    // it is not a journal mode switch. Check every captured mode-switch frame.
    if(filmTimes[frame]>=maximizeStart-50&&filmTimes[frame]<=maximizeEnd+50)continue;
    const image=nativeImage.createFromPath(path.join(filmDirectory,`frame-${String(frame).padStart(3,'0')}.png`));
    const pixels=image.toBitmap(),width=image.getSize().width;
    let leaking=0;
    for(let y=roi.top;y<roi.bottom;y++)for(let x=roi.left;x<roi.right;x++){
      const i=(y*width+x)*4,b=pixels[i],g=pixels[i+1],r=pixels[i+2];
      if(r>24&&b>24&&g<Math.min(r,b)*.3)leaking++;
    }
    maxLeak=Math.max(maxLeak,leaking);
    assert.ok(leaking<=32,`desktop checkerboard leaked inside the pane in frame ${frame}: ${leaking} pixels`);
  }
  console.log(`TEMPORAL: ${filmTimes.length} actual-screen frames, maximum background leak ${maxLeak} pixels.`);
  nativeResizeCalls=0;
  w.unmaximize();w.setBounds(original);await wait(150);nativeResizeCalls=0;
  console.log('TEMPORAL: normal AND maximized continuous real-desktop film saved, without per-stage capture delays.');
  await wait(150);
  const liveRect=w.getContentBounds();
  const desktopBaseline=path.join(artifacts,'desktop-before.png');
  desktopShot({x:liveRect.x,y:liveRect.y+36,width:liveRect.width,height:liveRect.height-36},desktopBaseline);
  const liveReference=await wc.capturePage();
  fs.writeFileSync(path.join(artifacts,'desktop-before-reference.png'),liveReference.toPNG());
  console.log('DESKTOP baseline: actual-screen color difference '+pixelDifference(nativeImage.createFromPath(desktopBaseline),liveReference).toFixed(4));
  api.requestMode(true);
  let cover;
  await until(() => {
    cover = BrowserWindow.getAllWindows().find(c => c !== w &&
      c.webContents.getURL().endsWith('mode-transition.html'));
    return cover && w.getOpacity() === 0;
  }, 'frozen compositor cover, not live resize');
  await until(async () => !cover.isDestroyed() &&
    await cover.webContents.executeJavaScript("document.getAnimations().some(a=>a.playState==='running')"),
  'GPU transform animation running');
  for (let i = 0; i < 3; i++) {
    if (cover.isDestroyed()) break;
    const shot = await cover.webContents.capturePage();
    fs.writeFileSync(path.join(artifacts, `mini-transition-${i}.png`), shot.toPNG());
    await wait(45);
  }
  await settled(true);
  assert.equal(nativeResizeCalls, 1, 'exactly one native resize, no frame-by-frame bounds loop');
  assert.equal(w.getOpacity(), 1, 'live window revealed after transition');
  assert.equal(w.getBounds().width, 420);
  api.requestMode(false); await settled(false);
  assert.deepEqual(w.getBounds(), original);
  const draft = await wc.executeJavaScript('({rr:magnitudeInput.value,risk:riskPercentInput.value,notes:syterTradeNotes.value,image:currentScreenshot})');
  assert.deepEqual(draft, { rr: '2.25', risk: '0.5', notes: 'native draft', image: 'draft-image' });
  assert.equal(wc.id, originalId); assert.equal(BrowserWindow.getAllWindows().length, 2);
  const idleCover=BrowserWindow.getAllWindows().find(c=>c!==w);
  assert.equal(await idleCover.webContents.executeJavaScript("document.getElementById('stage').childElementCount"),0,
    'persistent cover holds no screenshots while idle');
  assert.equal(handoffChecks,4,'verify both handoffs in both transition directions');
  await wc.executeJavaScript("window.forceReducedForTest=true;");
  api.requestMode(true); await settled(true);
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'reduced motion creates no additional window');
  api.requestMode(false); await settled(false);
  await wc.executeJavaScript("window.forceReducedForTest=false;");

  const verifiedBeforeStress=verifiedEntries;
  for(let cycle=0;cycle<12;cycle++){
    api.requestMode(true);await settled(true);
    api.requestMode(false);await settled(false);
    await wait(15*(cycle%3));
  }
  assert.equal(verifiedEntries-verifiedBeforeStress,12,
    'every full-to-mini stress switch must receive its matching opaque compositor frame');
  console.log('PASS: 12 consecutive full-to-mini frame receipts; no unverified conceal or fallback.');

  w.maximize(); await until(() => w.isMaximized(), 'maximize');
  api.requestMode(true); await settled(true);
  api.requestMode(false); await settled(false);
  assert.equal(w.isMaximized(), true, 'maximized state restored');
  api.requestMode(true); await settled(true);
  api.requestMode(false);
  await until(() => wc.executeJavaScript("!!document.body.dataset.syterModeTransition"), 'exit transition started');
  w.close();
  await settled(false);
  assert.equal(w.isVisible(), false, 'closing during transition must not reopen the journal');
  w.show();
  w.unmaximize(); await wait(100);

  for (const layout of ['00000419', '00000409']) {
    w.hide(); await wait(450);
    const before = shortcutCalls;
    pressShortcut(layout);
    await until(() => shortcutCalls === before + 1, 'real global OEM_3 event ' + layout);
    await settled(true);
    assert.equal(w.isVisible(), true);
    await wait(450); pressShortcut(layout); await settled(false);
  }

  await wc.executeJavaScript("modalOverlay.classList.remove('open');activeTab='calendar';");
  await wait(40);
  api.requestMode(true); await settled(true);
  await wc.executeJavaScript("syterTradeNotes.value='parked native draft';");
  api.requestMode(false); await settled(false);
  assert.deepEqual(await wc.executeJavaScript("({open:modalOverlay.classList.contains('open'),tab:activeTab,notes:syterTradeNotes.value,parked:syterJournalView.isParked()})"),
    {open:false,tab:'calendar',notes:'parked native draft',parked:true});
  api.requestMode(true); await settled(true);
  assert.equal(await wc.executeJavaScript("syterTradeNotes.value"), 'parked native draft');
  api.requestMode(false); await settled(false);

  const url = 'https://retocker.web.app/?note=AbCd0123456789Ef';
  await wc.executeJavaScript(`window.open(${JSON.stringify(url)},'_blank')`);
  await until(() => opened.length === 1, 'new-tab model description');
  await wc.executeJavaScript(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(url)};document.body.append(a);a.click();a.remove();})()`);
  await until(() => opened.length === 2, 'same-tab model description');
  assert.deepEqual(opened, [url, url]);
  assert.equal(wc.getURL(), 'https://retocker.web.app/');
  assert.equal(await wc.executeJavaScript('magnitudeInput.value'), '2.25');
  assert.equal(BrowserWindow.getAllWindows().filter(c=>
    !c.webContents.getURL().endsWith('mode-transition.html')).length, 1,
    'model links must not create an application window; a cancelled navigation may dispose the empty compositor');
  console.log('PASS: actual Windows/Electron resize, maximized restore, same-page draft, global OEM_3 from tray, and both model-link paths.');
}
app.whenReady().then(() => main()).then(() => app.exit(0)).catch(err => {
  console.error(err.stack || err);
  const wc=webContents.getAllWebContents().find(c=>c.getURL().startsWith('https://retocker.web.app'));
  if(wc)wc.executeJavaScript("JSON.stringify({error:saveError.textContent,mini:document.body.className,switching:document.body.dataset.syterModeTransition,prepare:typeof syterDesktop.prepareMiniMode})")
    .then(info=>{console.error('RENDERER:',info);app.exit(1);}).catch(()=>app.exit(1));
  else app.exit(1);
});