'use strict';
// A PRIVATE DRAFT in the source repository is durable software-build storage,
// not a public updater release. No API ever publishes or deletes a release.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function binary(data){if(Buffer.isBuffer(data))return data;if(data instanceof ArrayBuffer||ArrayBuffer.isView(data))return Buffer.from(data.buffer||data,data.byteOffset||0,data.byteLength);throw Error('Asset readback was not binary');}
function forbidCredentials(value){if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if(['private_key','access_token','refresh_token','client_secret'].includes(key))throw Error('Credentials cannot enter backup storage');forbidCredentials(v);}}
function selectFiles(kind,root,sourceSha){
 if(kind==='rollback'){
  const file=path.join(root,'rollout-backup/production.json'),snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
  forbidCredentials(snapshot);
  if(snapshot.candidateSha!==sourceSha||!snapshot.rulesRelease?.rulesetName||!snapshot.ruleset?.source?.files?.length||!snapshot.hostingRelease?.version?.name)throw Error('Incomplete or mismatched-source rollback snapshot');
  return [file];
 }
 if(kind==='windows'){
  const desktop=path.join(root,'desktop'),version=JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8')).version;
  // Revalidate actual packaged updater mode and feed/EXE digests before export.
  const report=require(path.join(desktop,'scripts/verify-update-artifacts.js')).verifyArtifacts(path.join(desktop,'release'),version);
  const files=report.assets.map(a=>path.join(desktop,'release',a.name));
  for(const name of ['release-integrity.json','update-transition.txt','uninstall-cleanup.txt','native-installer-success.txt','native-installer-ui-success.txt']){
   const file=path.join(desktop,'test-artifacts',name);if(fs.existsSync(file))files.push(file);
  }
  return files;
 }
 throw Error('Unknown private export kind');
}
async function persistPrivate({github,context,kind,root=process.cwd(),files,log=console.log}){
 const {owner,repo}=context.repo,sourceSha=context.sha,runAttempt=context.runAttempt??Number(process.env.GITHUB_RUN_ATTEMPT);
 if(!['windows','rollback'].includes(kind))throw Error('Unexpected export kind');
 if(owner!=='mishakozlov723-wq'||repo!=='TradingJournal'||!/^[a-f0-9]{40}$/.test(sourceSha||'')||!Number.isSafeInteger(context.runId)||!Number.isSafeInteger(runAttempt)||runAttempt<1)throw Error('Unexpected private export context');
 const info=(await github.rest.repos.get({owner,repo})).data;
 if(info.private!==true||info.full_name!==owner+'/'+repo)throw Error('Private source repository required; never store backups in public release repo');
 const paths=files||selectFiles(kind,root,sourceSha);
 if(!paths.length)throw Error('No files to persist');
 const inputs=paths.map(file=>({name:path.basename(file),data:fs.readFileSync(file)}));
 if(new Set(inputs.map(a=>a.name)).size!==inputs.length)throw Error('Duplicate export names');
 const receipt={kind,sourceSha,runId:context.runId,runAttempt,assets:inputs.map(a=>({name:a.name,size:a.data.length,sha256:sha(a.data)}))};
 const tag=`ci-${kind}-${context.runId}-${runAttempt}`,title=`Private verified CI ${kind} ${context.runId}/${runAttempt}`;
 const body=`Private CI export for ${sourceSha}. Not an updater/public release.`;
 // Storage is not a source-release tag: anchor its unpublished metadata to the
 // existing default branch. Creating a new ref at a workflow-changing feature
 // SHA may require workflows:write; never broaden CI permissions for storage.
 // Exact build provenance remains bound in body and byte-verified receipt.
 if(info.default_branch!=='main')throw Error('Unexpected storage anchor branch');
 // Draft tags may not have a git ref yet: get-by-tag returns 404 even when
 // listReleases correctly includes that draft. Never create duplicates on retry.
 const matches=(await github.paginate(github.rest.repos.listReleases,{owner,repo,per_page:100})).filter(r=>r.tag_name===tag);
 if(matches.length>1)throw Error('Duplicate private storage drafts require review; refusing mutation');
 let release=matches[0];
 if(!release)release=(await github.rest.repos.createRelease({owner,repo,tag_name:tag,target_commitish:info.default_branch,name:title,body,draft:true,prerelease:true})).data;
 if(release.draft!==true||release.tag_name!==tag||![info.default_branch,sourceSha].includes(release.target_commitish)||release.name!==title||release.body!==body)throw Error('Unrecognized or published storage release; refusing any mutation');
 async function save(name,data){
  const existing=(release.assets||[]).find(a=>a.name===name);
  const asset=existing||(await github.rest.repos.uploadReleaseAsset({owner,repo,release_id:release.id,url:release.upload_url,name,data,headers:{'content-type':'application/octet-stream','content-length':data.length}})).data;
  if(asset.size!==data.length)throw Error('Stored asset size mismatch '+name);
  const stored=binary((await github.rest.repos.getReleaseAsset({owner,repo,asset_id:asset.id,headers:{accept:'application/octet-stream'}})).data);
  if(stored.length!==data.length||sha(stored)!==sha(data))throw Error('Stored asset readback digest mismatch '+name+'; no overwrite or deletion attempted');
 }
 for(const asset of inputs)await save(asset.name,asset.data);
 await save('verified-export.json',Buffer.from(JSON.stringify(receipt,null,2)));
 const final=(await github.rest.repos.getRelease({owner,repo,release_id:release.id})).data;
 if(final.draft!==true)throw Error('Private storage draft unexpectedly published');
 log('PASS: private draft export read back byte-for-byte: '+release.html_url+'; source '+sourceSha+'; '+inputs.length+' files');
 return {url:release.html_url,releaseId:release.id,tag,...receipt};
}
module.exports={persistPrivate,selectFiles,forbidCredentials};
