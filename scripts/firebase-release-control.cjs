'use strict';
const fs=require('fs'),crypto=require('crypto');
const rulesBase='https://firebaserules.googleapis.com/v1/';
const releaseName='projects/retocker/releases/cloud.firestore';
const normalize=s=>String(s).replace(/\r\n/g,'\n').trim();
async function publishRules({backup,source,request}){
 if(!backup?.rulesRelease?.rulesetName||!backup.ruleset?.source?.files?.length||!backup.hostingRelease?.version?.name)throw Error('Complete preflight rollback snapshot required');
 const before=await request('GET',rulesBase+releaseName);
 if(before.rulesetName!==backup.rulesRelease.rulesetName)throw Error('Live rules changed after backup; refusing to overwrite');
 const created=await request('POST',rulesBase+'projects/retocker/rulesets',{source:{files:[{name:'firestore.rules',content:source}]}});
 if(!/^projects\/retocker\/rulesets\/[a-zA-Z0-9-]+$/.test(created.name||''))throw Error('Unexpected created ruleset identity');
 const check=await request('GET',rulesBase+releaseName);
 if(check.rulesetName!==before.rulesetName)throw Error('Live rules changed during compilation; candidate left inactive');
 await request('PATCH',rulesBase+releaseName,{release:{name:releaseName,rulesetName:created.name}});
 const after=await request('GET',rulesBase+releaseName);
 if(after.rulesetName!==created.name)throw Error('Published ruleset readback mismatch');
 return {ruleset:created.name,previousRuleset:before.rulesetName,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
}
async function authenticatedRequest(){
 let key;try{key=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'null');}catch{throw Error('Invalid service account');}
 if(key?.project_id!=='retocker'||key.type!=='service_account')throw Error('Expected protected retocker service account');
 const {GoogleAuth}=require('google-auth-library'),auth=new GoogleAuth({credentials:key,scopes:['https://www.googleapis.com/auth/cloud-platform']});
 return async(method,url,data)=>{try{return (await auth.request({method,url,data})).data;}catch(e){const error=e.response?.data?.error||{};throw Error('Firebase '+method+' failed HTTP '+(e.response?.status||'unknown')+'; '+(error.status||'unknown'));}};
}
async function verifyLive({request,source,readFile=fs.readFileSync,fetchFile=fetch}){
 const active=await request('GET',rulesBase+releaseName),rules=await request('GET',rulesBase+active.rulesetName);
 if(rules.source?.files?.length!==1||normalize(rules.source.files[0].content)!==normalize(source))throw Error('Live rules do not match this source');
 const index=readFile('public/index.html'),checks=['index.html'];
 for(const name of ['app.js','accounts-space.js','notes-workspace.js','replay-space.js']){
  const expected=readFile('public/'+name),hash=crypto.createHash('sha256').update(expected).digest('hex').slice(0,10);
  if(!index.toString().includes(name+'?v='+hash))throw Error('Source asset hash mismatch '+name);
  checks.push(name+'?v='+hash);
 }
 for(const name of checks){const response=await fetchFile('https://retocker.web.app/'+name,{redirect:'error',headers:{'Cache-Control':'no-cache'}});if(!response.ok)throw Error('Live Hosting status '+response.status);const actual=Buffer.from(await response.arrayBuffer()),expected=readFile('public/'+name.split('?')[0]);if(!actual.equals(expected))throw Error('Live Hosting bytes mismatch '+name);}
 return {ruleset:active.rulesetName,files:checks,sourceSha:process.env.GITHUB_SHA};
}
async function cli(){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.CONFIRM_LIVE!=='true')throw Error('Production writes require main and explicit live confirmation');
 const request=await authenticatedRequest(),source=fs.readFileSync('firestore.rules','utf8');
 if(process.argv[2]==='publish-rules'){const backup=JSON.parse(fs.readFileSync('rollout-backup/production.json'));if(!process.env.GITHUB_SHA||backup.candidateSha!==process.env.GITHUB_SHA)throw Error('Rollback snapshot source SHA mismatch');const result=await publishRules({backup,source,request});fs.writeFileSync('rollout-backup/activated.json',JSON.stringify(result,null,2));console.log('PASS: compatible Firestore rules activated and read back; no user data touched');}
 else if(process.argv[2]==='verify-live'){const result=await verifyLive({request,source});fs.writeFileSync('rollout-backup/smoke.json',JSON.stringify(result,null,2));console.log('PASS: live rules and all five public frontend files match source SHA '+process.env.GITHUB_SHA);}
 else throw Error('Unknown production release operation');
}
if(require.main===module)cli().catch(e=>{console.error(e.message);process.exit(1);});
module.exports={publishRules,verifyLive};
