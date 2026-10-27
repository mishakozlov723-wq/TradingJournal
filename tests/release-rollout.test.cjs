'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{publishRules}=require('../scripts/firebase-release-control.cjs');
const release='projects/retocker/releases/cloud.firestore',old='projects/retocker/rulesets/old',next='projects/retocker/rulesets/new';
const backup={rulesRelease:{rulesetName:old},ruleset:{source:{files:[{name:'firestore.rules',content:'old'}]}},hostingRelease:{version:{name:'sites/retocker/versions/old'}}};
test('release protocol requires complete backup before every write',async()=>{let calls=0;await assert.rejects(publishRules({backup:{},source:'candidate',request:()=>calls++}),/snapshot/);assert.equal(calls,0);});
test('release protocol leaves concurrent rules changes intact before or during compile',async()=>{for(const changeAt of [1,2]){let reads=0,writes=[];await assert.rejects(publishRules({backup,source:'candidate',request:async(method,url,data)=>{if(method==='GET')return {rulesetName:++reads>=changeAt?next:old};writes.push(method);return {name:next};}}),/changed/);assert.equal(writes.includes('PATCH'),false);}});
test('release protocol publishes compiled source then verifies active ruleset, never touches data APIs',async()=>{const calls=[];let active=old;const result=await publishRules({backup,source:'candidate',request:async(method,url,data)=>{calls.push({method,url,data});if(method==='GET')return {rulesetName:active};if(method==='POST')return {name:next};if(method==='PATCH'){active=data.release.rulesetName;return {};}}});assert.equal(result.ruleset,next);assert.deepEqual(calls.map(x=>x.method),['GET','POST','GET','PATCH','GET']);assert.equal(calls[1].data.source.files[0].content,'candidate');assert.equal(calls[3].data.release.name,release);assert.ok(calls.every(x=>x.url.startsWith('https://firebaserules.googleapis.com/v1/')));});
const {verifyLive}=require('../scripts/firebase-release-control.cjs'),fs=require('fs'),path=require('path'),crypto=require('crypto');
function liveFixture(){const files={};for(const name of ['app.js','accounts-space.js','notes-workspace.js','replay-space.js'])files['public/'+name]=Buffer.from('fixture '+name);files['public/index.html']=Buffer.from(Object.entries(files).map(([name,b])=>name.slice(7)+'?v='+crypto.createHash('sha256').update(b).digest('hex').slice(0,10)).join('\n'));const calls=[];return {files,calls,readFile:n=>files[n],request:async(method,url)=>{calls.push({method,url});assert.equal(method,'GET');return url.endsWith('cloud.firestore')?{rulesetName:next}:{source:{files:[{content:'candidate'}]}};}};}
test('read-only live verification waits for transient CDN bytes then verifies every exact file',async()=>{const f=liveFixture();let reads=0,delays=0;const result=await verifyLive({...f,source:'candidate',attempts:3,sleep:async()=>delays++,fetchFile:async url=>({ok:true,arrayBuffer:async()=>++reads<3?Buffer.from('old CDN'):f.files['public/'+new URL(url).pathname.slice(1).split('?')[0]]})});assert.equal(delays,2);assert.equal(reads,7);assert.equal(result.files.length,5);assert.ok(f.calls.every(x=>x.method==='GET'));});
test('read-only live verification fails after finite bound for persistent mismatch; never redeploys',async()=>{const f=liveFixture();let reads=0,delays=0;await assert.rejects(verifyLive({...f,source:'candidate',attempts:3,sleep:async()=>delays++,fetchFile:async()=>{reads++;return {ok:true,arrayBuffer:async()=>Buffer.from('wrong bytes')};}}),/bytes mismatch/);assert.equal(reads,3);assert.equal(delays,2);assert.ok(f.calls.every(x=>x.method==='GET'));});
test('read-only live verification refuses unknown rules before accessing frontend',async()=>{const f=liveFixture();await assert.rejects(verifyLive({...f,source:'unexpected',fetchFile:async()=>{throw Error('must not fetch');}}),/Live rules do not match/);});
test('verification-only workflow cannot run deployment or private export jobs',()=>{const s=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy-website.yml'),'utf8'),job=s.split('  verify-live:\n')[1].split('  artifact_inventory:')[0];assert.match(s,/inputs.deploy_live && !inputs.artifact_maintenance && !inputs.verify_live_only/);assert.match(s,/!inputs.deploy_live && !inputs.artifact_maintenance && !inputs.verify_live_only/);assert.match(job,/contents: read/);assert.match(job,/firebase-release-control.cjs verify-live/);assert.doesNotMatch(job,/publish-rules|persistPrivate|hosting-deploy|contents: write/);});

const {verifyRulesUnchanged}=require('../scripts/firebase-release-control.cjs');
test('Hosting-only guard performs GET only and requires complete rollback snapshot',async()=>{
 const calls=[];
 assert.equal(await verifyRulesUnchanged({backup,request:async(method,url)=>{calls.push(method);assert.ok(url.endsWith('cloud.firestore'));return {rulesetName:old};}}),old);
 assert.deepEqual(calls,['GET']);
 await assert.rejects(verifyRulesUnchanged({backup:{},request:async()=>{throw Error('must not request');}}),/snapshot/);
 await assert.rejects(verifyRulesUnchanged({backup,request:async method=>{assert.equal(method,'GET');return {rulesetName:next};}}),/changed/);
});
test('Hosting-only readback refuses concurrent rules replacement even with identical rule content',async()=>{
 const f=liveFixture();
 await assert.rejects(verifyLive({...f,source:'candidate',expectedRuleset:old,fetchFile:async()=>{throw Error('must not fetch');}}),/changed during Hosting-only/);
});
test('Hosting-only readback verifies exact frontend bytes with existing ruleset',async()=>{
 const f=liveFixture();const result=await verifyLive({...f,source:'candidate',expectedRuleset:next,fetchFile:async url=>({ok:true,arrayBuffer:async()=>f.files['public/'+new URL(url).pathname.slice(1)]})});
 assert.equal(result.ruleset,next);assert.equal(result.files.length,5);assert.ok(f.calls.every(x=>x.method==='GET'));
});
test('workflow defaults to Hosting-only, keeps durable backup and explicit rules-write gate',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy-website.yml'),'utf8');
 assert.match(s,/deploy_rules:\n[\s\S]*?default: false/);
 assert.match(s,/Activate compatible Firestore rules and verify readback\n\s+if: \$\{\{ inputs.deploy_rules \}\}/);
 assert.match(s,/HOSTING_ONLY: \$\{\{ !inputs.deploy_rules \}\}/);
 assert.ok(s.indexOf('Persist rollback snapshot BEFORE any production write')<s.indexOf('Deploy verified frontend Hosting'));
 assert.match(s,/verify-unchanged-rules/);
 const p=fs.readFileSync(path.join(__dirname,'../scripts/firebase-release-preflight.cjs'),'utf8');
 assert.match(p,/hostingOnly\?'firestore.rules':'verification\/production-rules-baseline.rules'/);
});
