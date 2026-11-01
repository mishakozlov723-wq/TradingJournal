'use strict';
// Read-only by default. Never print keys/access tokens or request objects.
const fs=require('fs'),crypto=require('crypto'),{execFileSync}=require('child_process');
const norm=s=>String(s).replace(/\r\n/g,'\n').trim();
const BASELINE='verification/production-rules-baseline.rules';
function gitRunner(args){return execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']});}
// Every version of firestore.rules ever committed is reviewed source. A rules
// publication may replace any of them, but never unknown out-of-band rules.
function committedRules(git=gitRunner){
 let shallow=false,shas=[];
 try{shallow=git(['rev-parse','--is-shallow-repository']).trim()==='true';}catch{shallow=true;}
 try{shas=git(['log','--format=%H','--','firestore.rules']).split('\n').map(x=>x.trim()).filter(Boolean);}catch{shas=[];}
 const versions=[];
 for(const sha of shas){try{versions.push({label:'firestore.rules@'+sha.slice(0,12),content:git(['show',sha+':firestore.rules'])});}catch{/* deleted in that commit */}}
 return {versions,shallow};
}
// Hosting-only releases require the CURRENT source rules to already be live.
// A rules publication accepts the audited pre-migration baseline, the current
// source or any previously committed firestore.rules (the state after a
// previous rules release).
function knownRules({hostingOnly,readFile=p=>fs.readFileSync(p,'utf8'),git=gitRunner}){
 if(hostingOnly)return {candidates:[{label:'firestore.rules',content:readFile('firestore.rules')}],shallow:false};
 const history=committedRules(git);
 return {candidates:[{label:BASELINE,content:readFile(BASELINE)},{label:'firestore.rules',content:readFile('firestore.rules')},...history.versions],shallow:history.shallow};
}
function matchLiveRules(files,candidates){
 if(!Array.isArray(files)||files.length!==1||typeof files[0]?.content!=='string')return null;
 const live=norm(files[0].content);
 return candidates.find(candidate=>norm(candidate.content)===live)||null;
}
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
 const hostingOnly=process.env.HOSTING_ONLY==='true';
 const {candidates,shallow}=knownRules({hostingOnly});
 if(shallow)console.log('::warning::Shallow checkout: only the audited baseline and current firestore.rules can be recognized');
 const files=rules.source?.files||[],matched=matchLiveRules(files,candidates);
 if(!matched)throw Error('Live Firestore rules differ from '+(hostingOnly?'firestore.rules':'every known committed rules version')+'. Backup saved; review actual rules before any rollout.');
 console.log('PASS: read-only production rules/Hosting snapshot; live rules match '+matched.label+'; mode='+(hostingOnly?'Hosting-only (no rules writes)':'rules publication')+'; SHA256='+crypto.createHash('sha256').update(files[0].content).digest('hex'));
}
module.exports={knownRules,matchLiveRules,committedRules};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exit(1);});
