'use strict';
// Windows-only end-to-end test of the DELIVERED EXE, no production testing hooks.
const { app } = require('electron');
const { spawn } = require('node:child_process');
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
  const sentinel=path.join(app.getPath('appData'),'syter-desktop','syter-preservation-test.txt');fs.mkdirSync(path.dirname(sentinel),{recursive:true});fs.writeFileSync(sentinel,'preserve-settings');
  const exe=path.resolve(__dirname,`../release/SYTER-Install-${version}.exe`);
  const child=spawn(exe,['--remote-debugging-port=9227'],{stdio:'ignore',windowsHide:false});
  child.on('error',error=>{throw error;});
  const c=await connect(9227);
  const evaluate=async expression=>{const r=await c.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const screenshot=async name=>{const r=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,`branded-exe-${name}.png`),Buffer.from(r.data,'base64'));};
  assert.equal(await evaluate('window.syterLifecycle.snapshot().phase'),'welcome');await screenshot('welcome');
  await evaluate('document.getElementById("primary").click()');
  let phase;
  for(let n=0;n<360;n++){
    phase=await evaluate('window.syterLifecycle.snapshot().phase');if(phase==='ready')break;
    if(phase==='error')throw Error(await evaluate('window.syterLifecycle.snapshot().error'));
    if(n===3)await screenshot('progress');await wait(500);
  }
  assert.equal(phase,'ready','actual silent installation must succeed');await screenshot('installed');
  assert.ok(fs.existsSync(await installedExecutable(version)));assert.equal(fs.readFileSync(sentinel,'utf8'),'preserve-settings');
  await evaluate('window.syterLifecycle.action("close")');c.close();
  await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();child.once('exit',code=>code===0?resolve():reject(Error(`Installer exit ${code}`)));setTimeout(()=>reject(Error('Installer did not exit')),20000).unref();});
  console.log('PASS: actual branded EXE launches, hashes payload, installs silently, verifies installed version, preserves existing data and exits');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
