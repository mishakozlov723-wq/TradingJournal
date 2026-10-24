'use strict';
// Read-only by default. Never print keys/access tokens or request objects.
const fs=require('fs'),crypto=require('crypto');
const norm=s=>s.replace(/\r\n/g,'\n').trim();
async function main(){
 const value=process.env.FIREBASE_SERVICE_ACCOUNT;if(!value)throw Error('Missing FIREBASE_SERVICE_ACCOUNT_RETOCKER repository Actions secret');
 let key;try{key=JSON.parse(value);}catch{throw Error('Invalid service-account JSON');}
 if(key.type!=='service_account'||key.project_id!=='retocker'||!key.client_email||!key.private_key)throw Error('Expected retocker service account');
 console.log('Firebase service-account identity: '+JSON.stringify({client_email:key.client_email,project_id:key.project_id}));
 const {GoogleAuth}=require('google-auth-library'),auth=new GoogleAuth({credentials:key,scopes:['https://www.googleapis.com/auth/cloud-platform']});
 async function get(url){try{return (await auth.request({url})).data;}catch(e){const api=e.response?.data?.error||{};const reasons=(api.details||[]).map(d=>[d.reason,d.metadata?.permission,d.metadata?.service].filter(Boolean).join(':')).filter(Boolean).join(',');throw Error('Production preflight API failed HTTP '+(e.response?.status||e.code||'unknown')+' for '+new URL(url).hostname+'; status='+(api.status||'unknown')+'; reason='+reasons);}}
 const release=await get('https://firebaserules.googleapis.com/v1/projects/retocker/releases/cloud.firestore');
 const rules=await get('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
 const hosting=await get('https://firebasehosting.googleapis.com/v1beta1/projects/-/sites/retocker/channels/live/releases?pageSize=1');
 fs.mkdirSync('rollout-backup',{recursive:true});
 fs.writeFileSync('rollout-backup/production.json',JSON.stringify({rulesRelease:release,ruleset:rules,hostingRelease:hosting.releases?.[0],candidateSha:process.env.GITHUB_SHA},null,2));
 const files=rules.source?.files||[],expected=fs.readFileSync('verification/production-rules-baseline.rules','utf8');
 if(files.length!==1||norm(files[0].content)!==norm(expected))throw Error('Live Firestore rules differ from audited main baseline. Backup saved; review actual rules before any rollout.');
 console.log('PASS: read-only production rules/Hosting snapshot; baseline matches audited source; SHA256='+crypto.createHash('sha256').update(files[0].content).digest('hex'));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exit(1);});
