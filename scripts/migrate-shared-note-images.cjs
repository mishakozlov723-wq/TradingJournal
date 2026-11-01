'use strict';
// Additive migration of ALREADY-PUBLIC snapshots only. Originals and private
// pages are never modified. All cloud document access is through the injected
// adapter, so tests run without any production credentials.
const crypto=require('node:crypto');
function imageIds(value){
 const ids=new Set();function walk(v){if(typeof v==='string'){if(/^tjimg:[A-Za-z0-9]{16,64}$/.test(v))ids.add(v.slice(6));}else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);}walk(value);return [...ids].sort();
}
function decode(v){
 if('stringValue'in v)return v.stringValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;if('nullValue'in v)return null;
 if('arrayValue'in v)return(v.arrayValue.values||[]).map(decode);if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return undefined;
}
async function migrate(adapter){
 const report={shares:0,copies:0,verified:0};
 for await(const name of adapter.names()){
  let done=false;
  for(let attempt=0;attempt<4&&!done;attempt++){
   const snap=await adapter.read(name);if(!snap)break;
   const uid=snap.data.uid,ids=imageIds(snap.data.pages||[]);
   if(typeof uid!=='string'||!uid)throw Error('Public snapshot missing owner; rollout stopped');
   for(const id of ids){
    const source=await adapter.read('notesImages/'+id),data=source?.data;
    if(!data||data.uid!==uid||typeof data.data!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.data)||data.data.length>650000)throw Error('Public snapshot image failed ownership/content checks; rollout stopped');
    const copy=name+'/images/'+id;
    await adapter.copy(copy,{uid,data:data.data});
    const readback=await adapter.read(copy);
    if(readback?.data.uid!==uid||readback?.data.data!==data.data)throw Error('Share image byte verification failed');
    report.copies++;report.verified++;
   }
   try{await adapter.publish(name,ids,snap.version);done=true;report.shares++;}
   catch(e){if(e.status!==409&&e.status!==412)throw e;}
  }
  if(!done&&(await adapter.read(name)))throw Error('Public snapshot changed repeatedly; retry rollout');
 }
 return report;
}
async function cli(){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.CONFIRM_LIVE!=='true')throw Error('Migration requires main and confirmed release');
 const fs=require('node:fs');if(!fs.existsSync('rollout-backup/production.json'))throw Error('Preflight backup required');
 const key=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'null');if(key?.type!=='service_account'||key.project_id!=='retocker')throw Error('Expected retocker service account');
 const {GoogleAuth}=require('google-auth-library'),auth=new GoogleAuth({credentials:key,scopes:['https://www.googleapis.com/auth/datastore']});
 const base='https://firestore.googleapis.com/v1/projects/retocker/databases/(default)/documents/';
 async function request(method,path,data){try{return(await auth.request({method,url:base+path,data})).data;}catch(e){if(e.response?.status===404)return null;throw Object.assign(Error('Shared-image migration API failure; document contents hidden'),{status:e.response?.status});}}
 const adapter={
  async *names(){let pageToken='';do{const result=await request('GET','notesShares?pageSize=100'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));for(const d of result?.documents||[])yield d.name.split('/documents/')[1];pageToken=result?.nextPageToken||'';}while(pageToken);},
  async read(name){const d=await request('GET',name);return d?{data:decode({mapValue:{fields:d.fields||{}}}),version:d.updateTime}:null;},
  copy:(name,data)=>request('PATCH',name,{fields:{uid:{stringValue:data.uid},data:{stringValue:data.data}}}),
  publish:(name,ids,version)=>request('PATCH',name+'?updateMask.fieldPaths=imageIds&currentDocument.updateTime='+encodeURIComponent(version),{fields:{imageIds:{arrayValue:{values:ids.map(x=>({stringValue:x}))}}}})
 };
 const report=await migrate(adapter);fs.writeFileSync('rollout-backup/shared-image-migration.json',JSON.stringify({sourceSha:process.env.GITHUB_SHA,...report},null,2));
 console.log('PASS: existing public note image copies verified; '+JSON.stringify(report)+'; no original/private documents changed');
}
if(require.main===module)cli().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={imageIds,decode,migrate};
