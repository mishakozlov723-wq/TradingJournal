'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdateController, notesText } = require('../lifecycle/controller');
const { verifyPayload, runSilent, parseInstallProgress } = require('../installer/engine');
function fixture() {
  const updater = new EventEmitter(); let download = 0, checks = 0, shown = 0, dismissed = 0, quits = 0, installed;
  updater.downloadUpdate = async () => { download++; };
  updater.checkForUpdates = async () => { checks++; };
  updater.quitAndInstall = (...args) => { installed = args; };
  const flow = createUpdateController({updater,currentVersion:'1.3.0',publish:()=>{},reveal:()=>shown++,dismiss:()=>dismissed++,prepareQuit:()=>quits++});
  return {updater,flow,counts:()=>({download,checks,shown,dismissed,quits,installed})};
}
test('updates require consent, never use native prompt or auto-install on quit', async t => {
  const f=fixture();t.after(()=>f.flow.stop());
  assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
  f.updater.emit('update-available',{version:'1.3.1',releaseNotes:'<p>Brand update</p>'});
  assert.equal(f.flow.snapshot().phase,'available');assert.equal(f.flow.snapshot().notes,'Brand update');
  await f.flow.action('later');assert.equal(f.counts().download,0);assert.equal(f.counts().quits,0);
  await f.flow.action('download');assert.equal(f.counts().download,1);
  f.updater.emit('download-progress',{percent:37.5,total:1000,transferred:375});
  assert.equal(f.flow.snapshot().percent,37.5);
  await f.flow.action('restart');assert.equal(f.counts().quits,0);
  f.updater.emit('update-downloaded',{version:'1.3.1'});await f.flow.action('restart');
  assert.deepEqual(f.counts().installed,[true,true]);assert.equal(f.counts().quits,1);
  await f.flow.action('restart');assert.equal(f.counts().quits,1);
});
test('concurrent download clicks coalesce and errors can retry',async t=>{
  const f=fixture();t.after(()=>f.flow.stop());let reject;
  f.updater.downloadUpdate=()=>new Promise((_r,j)=>{reject=j;});
  f.updater.emit('update-available',{version:'1.3.1'});
  const pending=f.flow.action('download');await Promise.resolve();
  await f.flow.action('download');reject(Error('offline'));await pending;
  assert.equal(f.flow.snapshot().phase,'error');assert.equal(f.flow.snapshot().retry,'download');
  f.updater.downloadUpdate=async()=>f.updater.emit('update-downloaded',{version:'1.3.1'});
  await f.flow.action('retry');assert.equal(f.flow.snapshot().phase,'ready');
});
test('release notes stay plain text and bounded',()=>{
  assert.equal(notesText([{note:'<b>One</b>'},{note:'Two &amp; three'}]),'One\nTwo & three');
  assert.equal(notesText('x'.repeat(9999)).length,6000);
  const html=fs.readFileSync(path.join(__dirname,'../lifecycle/renderer.js'),'utf8');assert.doesNotMatch(html,/innerHTML|eval\(/);
});
test('payload hash mismatch prevents installation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'syter-payload-'));const file=path.join(dir,'setup.exe');fs.writeFileSync(file,'test');let progress=0;
  try {await verifyPayload(file,crypto.createHash('sha256').update('test').digest('hex'),p=>progress=p);assert.equal(progress,100);await assert.rejects(verifyPayload(file,'0'.repeat(64)),/verification/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('installer uses only silent fixed arguments and reports child failure',async()=>{
  let args,opts;const fake=(file,a,o)=>{args=a;opts=o;const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;};
  await runSilent('setup.exe',fake);assert.deepEqual(args,['/S']);assert.equal(opts.shell,false);
  await assert.rejects(runSilent('setup.exe',()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',2));return child;}),/did not finish/);
});
test('renderer privilege boundary is isolated, allowlisted and origin-bound',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../lifecycle/window.js'),'utf8');assert.match(src,/sandbox: true/);assert.match(src,/contextIsolation: true/);assert.match(src,/nodeIntegration: false/);assert.match(src,/event\.senderFrame === win\.webContents\.mainFrame/);assert.match(src,/will-navigate/);
  const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const section=main.slice(main.indexOf('function setupUpdates()'),main.indexOf('// the window only hides'));assert.doesNotMatch(section,/showMessageBox/);
});

test('successful launch releases the installer close guard before quitting',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../installer/main.js'),'utf8');
  assert.match(src,/child\.once\('spawn', \(\) => \{ child\.unref\(\); busy = false; app\.quit\(\); \}\)/);
  assert.match(src,/onClose:\(\)=>!busy/);
});

test('install progress is extracted + successfully copied bytes, never elapsed time',()=>{
  const status=(session,extracted,copied,stage='copying')=>`    Session    REG_SZ    ${session}\n    Stage    REG_SZ    ${stage}\n    Total    REG_SZ    1000\n    Extracted    REG_SZ    ${extracted}\n    Copied    REG_SZ    ${copied}\n`;
  assert.equal(parseInstallProgress(status('current',500,0),'current').percent,25);
  assert.equal(parseInstallProgress(status('current',1000,800),'current').percent,90);
  assert.equal(parseInstallProgress(status('current',1000,1000,'finalizing'),'current').phase,'finalizing');
  assert.equal(parseInstallProgress(status('old',1000,1000),'current'),null);
  assert.equal(parseInstallProgress(status('current',1001,0),'current'),null);
});
test('compact lifecycle has no footer, card or resizing during launch',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../lifecycle/window.html'),'utf8');
  assert.doesNotMatch(html,/<footer|brand-dot|class="detail"/);
  const win=fs.readFileSync(path.join(__dirname,'../lifecycle/window.js'),'utf8');
  assert.doesNotMatch(win,/setContentSize|setSize|setBounds/);
});

test('initial reveal only fades, without overflowing translated content',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../lifecycle/window.css'),'utf8');
  assert.match(css,/@keyframes enter\{from\{opacity:0\}to\{opacity:1\}\}/);
  assert.doesNotMatch(css,/translateY\(6px\)/);
});

test('optimized native installer does not unpack a second Electron before showing UI',()=>{
 const build=fs.readFileSync(path.join(__dirname,'../scripts/build-branded-installer.js'),'utf8');
 assert.doesNotMatch(build,/require\('electron-builder'\)|createTarget\('portable'/);
 const native=fs.readFileSync(path.join(__dirname,'../installer/native/Installer.cs'),'utf8');
 const ctor=native.slice(native.indexOf('public InstallerWindow()'),native.indexOf('Label Label('));
 assert.doesNotMatch(ctor,/PreparePayload|GetManifestResourceStream\("Payload"\)/);
 assert.match(native,/await Task.Run\(\(Action\)PreparePayload\)/);
 assert.match(native,/digest!=BuildInfo.Sha256/);
 assert.match(native,/totalWork=total\*2/);
});
