'use strict';
// Windows-only end-to-end test of the DELIVERED EXE, no production testing hooks.
const { app } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { installedExecutable } = require('../installer/engine');
const version = require('../package.json').version;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const artifacts=path.resolve(__dirname,'../test-artifacts');fs.mkdirSync(artifacts,{recursive:true});
async function connect(port){
  for(let n=0;n<120;n++){
    try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=pages.find(p=>p.type==='page'&&p.url.includes('window.html'));
      if(page){const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});let id=0;const pending=new Map();
        socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}});
        return {call:(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));}),close:()=>socket.close()};}
    }catch(_){}await wait(500);
  }throw Error('Branded installer window did not appear');
}
app.whenReady().then(async()=>{
  assert.equal(process.platform,'win32');
  // Runner profile only. A sentinel must survive initial install and reinstall.
  const sentinels=['SYTER','syter-desktop'].map(name=>path.join(app.getPath('appData'),name,'syter-preservation-test.txt'));
  for(const file of sentinels){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'preserve-settings');}
  const exe=path.resolve(__dirname,`../release/SYTER-Install-${version}.exe`);
  let installedPath;
  for (let pass = 0; pass < 2; pass++) {
    const port = 9227 + pass;
    const child=spawn(exe,[`--remote-debugging-port=${port}`],{stdio:'ignore',windowsHide:false});
    const spawnError=new Promise((_r,reject)=>child.once('error',reject));
    const c=await Promise.race([connect(port),spawnError]);
    const evaluate=async expression=>{const r=await c.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const screenshot=async name=>{const r=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,`branded-exe-${name}.png`),Buffer.from(r.data,'base64'));};
    assert.equal(await evaluate('window.syterLifecycle.snapshot().phase'),'welcome');if(!pass)await screenshot('welcome');
    await evaluate('document.getElementById("primary").click()');
    let phase;
    for(let n=0;n<360;n++){
      phase=await evaluate('window.syterLifecycle.snapshot().phase');if(phase==='ready')break;
      if(phase==='error')throw Error(await evaluate('window.syterLifecycle.snapshot().error'));
      if(n===3 && !pass)await screenshot('progress');await wait(500);
    }
    assert.equal(phase,'ready','actual silent installation must succeed');if(!pass)await screenshot('installed');
    installedPath=await installedExecutable(version);
    assert.ok(fs.existsSync(installedPath));for(const file of sentinels)assert.equal(fs.readFileSync(file,'utf8'),'preserve-settings');
    // Exercise the actual Launch button after reinstall, not a mocked spawn.
    if (pass) await evaluate('document.getElementById("primary").click()');
    else await evaluate('window.syterLifecycle.action("close")');
    c.close();
    await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();child.once('exit',code=>code===0?resolve():reject(Error(`Installer exit ${code}`)));setTimeout(()=>reject(Error('Installer did not exit')),20000).unref();});
    await wait(500);
  }
  const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=path.join(artifacts,'verify-installed-launch.ps1');
  fs.writeFileSync(script,`param([string]$AppPath)
$ErrorActionPreference='Stop'
$found=$null
for($i=0;$i -lt 40;$i++){
  $found=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $AppPath })
  if($found.Count -gt 0){break}
  Start-Sleep -Milliseconds 250
}
if($found.Count -eq 0){throw 'Installed SYTER did not launch'}
$found | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'PASS: Launch SYTER starts the installed executable'
`);
  const launched=await promisify(execFile)(ps,['-NoProfile','-NonInteractive','-File',script,'-AppPath',installedPath],{windowsHide:true});
  console.log(launched.stdout.trim());
  for(const file of sentinels)assert.equal(fs.readFileSync(file,'utf8'),'preserve-settings');
  console.log('PASS: actual branded EXE launches, hashes payload, installs silently, verifies installed version, preserves existing data on reinstall, launches installed app and exits');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
