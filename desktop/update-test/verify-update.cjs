'use strict';
// CI only: observes the installed Electron renderer over loopback CDP.
// User START-TEST.cmd does not enable a debug port or run this automation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]);
const out=path.resolve(root,'..','test-artifacts');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=30000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch(e){last=e;}await pause(200);}throw last||Error('Timed out');}
async function connect(){
 const target=await until(async()=>{const list=await(await fetch('http://127.0.0.1:9229/json')).json();return list.find(t=>t.url.includes('/lifecycle/window.html'));});
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 return {ws,call,evaluate,snapshot:()=>evaluate('window.syterLifecycle.snapshot()'),capture:async name=>{const r=await call('Page.captureScreenshot');fs.writeFileSync(path.join(out,`local-update-${name}.png`),Buffer.from(r.data,'base64'));}};
}
function registryVersion(){return execFileSync('powershell.exe',['-NoProfile','-Command',"$r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64');$k=$r.OpenSubKey('Software\\SYTER\\Desktop');$k.GetValue('Version')"],{encoding:'utf8'}).trim();}
function localRequests(){return fs.existsSync(path.join(root,'requests.log'))?fs.readFileSync(path.join(root,'requests.log'),'utf8'):'';}
function stopTestApp(){
 // Disposable runner only; the user-facing launcher never kills the journal.
 execFileSync('powershell.exe',['-NoProfile','-Command',"$r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64');$k=$r.OpenSubKey('Software\\SYTER\\Desktop');$e=Join-Path $k.GetValue('InstallLocation') 'SYTER.exe';Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $e}|Stop-Process -Force;Start-Sleep -Milliseconds 500;Start-Process $e -ArgumentList '--remote-debugging-port=9229'"]);
}
(async()=>{
 let ui=await connect();let state=await until(async()=>{const s=await ui.snapshot();return s.phase==='available'&&s;});
 assert.equal(state.currentVersion,'1.3.6');assert.equal(state.version,'1.3.7');await ui.capture('available');
 assert(!localRequests().includes('GET SYTER-Setup'),'No installer download before consent');
 await ui.evaluate("document.getElementById('secondary').click()");await pause(1000);
 assert.equal(registryVersion(),'1.3.6');assert(!localRequests().includes('GET SYTER-Setup'),'Later did not download or install');console.log('PASS: real available prompt and Later keep 1.3.6 unchanged, no payload request');
 ui.ws.close();stopTestApp();ui=await connect();await until(async()=>(await ui.snapshot()).phase==='available');
 await ui.evaluate("document.getElementById('primary').click()");
 state=await until(async()=>{const s=await ui.snapshot();if(s.phase==='error')throw Error(s.error);return s.phase==='downloading'&&s.percent>0&&s.percent<95&&s;},30000);
 await ui.capture('downloading');console.log('PASS: actual download progress',JSON.stringify({percent:state.percent,transferred:state.transferred,total:state.total}));
 assert(state.transferred>0&&state.total>state.transferred);
 state=await until(async()=>{const s=await ui.snapshot();return s.phase==='ready'&&s;},60000);await ui.capture('ready');
 assert.equal(registryVersion(),'1.3.6','Ready does not install until restart consent');
 assert.equal(await ui.evaluate('document.getElementById("primary").textContent'),'Restart and install →');
 const session=JSON.parse(fs.readFileSync(path.join(root,'test-session.json'),'utf8').replace(/^\ufeff/,''));
 await ui.evaluate("document.getElementById('primary').click()");ui.ws.close();
 await until(()=>registryVersion()==='1.3.7',90000);
 await until(()=>fs.readFileSync(session.config,'utf8').includes('provider: github'),30000);
 console.log('PASS: real electron-updater download -> quitAndInstall -> NSIS installed 1.3.7; normal feed restored');
})().catch(e=>{console.error(e.stack);process.exit(1);});
