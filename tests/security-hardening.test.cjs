'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),{load}=require('./audit-source.cjs');
const modules=['accounts-proxy-vercel/lib/security.js','accounts-proxy/netlify/functions/lib/security.js'];
const sa={type:'service_account',project_id:'retocker',private_key:'unit-test-only-private-material-'.repeat(4)};
for(const name of modules){const security=require(path.join(root,name));
 test(name+': CORS defaults to journal hosts; arbitrary origins and wildcard configurations denied',()=>{
  for(const origin of ['https://retocker.web.app','https://retocker.firebaseapp.com']){assert.equal(security.originAllowed({origin},{}),true);assert.equal(security.cors({origin},{})['Access-Control-Allow-Origin'],origin);}
  for(const origin of ['https://untrusted.invalid','null','https://retocker.web.app.untrusted.invalid','http://retocker.web.app']){assert.equal(security.originAllowed({origin},{}),false);assert.equal(security.cors({origin},{})['Access-Control-Allow-Origin'],undefined);}
  assert.equal(security.originAllowed({},{}),true);assert.equal(security.cors({},{})['Access-Control-Allow-Origin'],undefined);
  assert.deepEqual(security.allowedOrigins({ALLOWED_ORIGIN:'*'}),security.allowedOrigins({}));assert.equal(security.cors({origin:'https://retocker.web.app'},{}).Vary,'Origin');
  assert.equal(security.originAllowed({origin:'https://custom.invalid'},{ALLOWED_ORIGIN:'https://retocker.web.app, https://custom.invalid'}),true);
 });
 test(name+': new key is stable across Myfxbook password changes; explicit strong secret overrides',()=>{
  const a={FIREBASE_SERVICE_ACCOUNT:JSON.stringify(sa),MYFXBOOK_PASSWORD:'old'},b={...a,MYFXBOOK_PASSWORD:'new'};
  assert.deepEqual(security.activeKey(a),security.activeKey(b));
  assert.notDeepEqual(security.activeKey(a),security.activeKey({...a,ACCOUNTS_CREDENTIAL_SECRET:'explicit-test-only-key-'.repeat(3)}));
  for(const env of [{MYFXBOOK_PASSWORD:'password-only'},{ACCOUNTS_CREDENTIAL_SECRET:'short'},{FIREBASE_SERVICE_ACCOUNT:'{}'}])assert.throws(()=>security.activeKey(env),e=>e.code==='CREDENTIAL_KEY_NOT_CONFIGURED');
 });
 test(name+': v3 round trip, uid binding, expiry, tamper rejection; v2 migration has fixed sunset',()=>{
  const prior={...process.env};try{
   delete process.env.ACCOUNTS_CREDENTIAL_SECRET;process.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify(sa);process.env.MYFXBOOK_PASSWORD='legacy-unit-test-only';
   const token=security.sealCredentials('test-owner','test@example.invalid','fake-password','gen');assert.ok(token.startsWith('v3.'));assert.equal(security.openCredentials(token,'test-owner').password,'fake-password');
   process.env.MYFXBOOK_PASSWORD='changed';assert.equal(security.openCredentials(token,'test-owner').generation,'gen');
   assert.throws(()=>security.openCredentials(token,'other-owner'));const pieces=token.split('.');pieces[3]='A'+pieces[3].slice(1);if(pieces.join('.')!==token)assert.throws(()=>security.openCredentials(pieces.join('.'),'test-owner'));
   assert.throws(()=>security.openCredentials(security.sealCredentials('test-owner','test@example.invalid','fake','gen',Date.now()-31*86400000),'test-owner'));
   process.env.MYFXBOOK_PASSWORD='legacy-unit-test-only';
   const oldTime=Date.parse('2026-10-28T00:00:00Z'),iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update('tj-accounts-v1|'+process.env.MYFXBOOK_PASSWORD).digest(),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
   const body=Buffer.from(JSON.stringify({uid:'test-owner',email:'fake@example.invalid',password:'fake',generation:'gen',iat:oldTime})),encrypted=Buffer.concat([cipher.update(body),cipher.final()]);const old=['v2',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
   const originalNow=Date.now;try{Date.now=()=>oldTime+1000;const data=security.openCredentials(old,'test-owner');assert.equal(data.legacy,true);const fresh=security.sealCredentials('test-owner',data.email,data.password,data.generation,data.iat);assert.equal(security.openCredentials(fresh,'test-owner').iat,oldTime);Date.now=()=>security.LEGACY_END;assert.throws(()=>security.openCredentials(old,'test-owner'));}finally{Date.now=originalNow;}
  }finally{for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);}
 });
}
test('proxy security implementations stay byte-identical',()=>assert.equal(fs.readFileSync(path.join(root,modules[0]),'utf8'),fs.readFileSync(path.join(root,modules[1]),'utf8')));
const notes='public/notes-workspace.js';
test('Notes image references collected from covers, blocks and nested database rows only once',()=>{const c=load(notes,['notesShareImageIds'],{notesIsImageRef:v=>/^tjimg:[A-Za-z0-9]{16,64}$/.test(v)});assert.deepEqual(Array.from(c.notesShareImageIds([{cover:'tjimg:AAAAAAAAAAAAAAAA',blocks:[{src:'tjimg:BBBBBBBBBBBBBBBB',rows:[{image:'tjimg:AAAAAAAAAAAAAAAA'}]}]}])),['AAAAAAAAAAAAAAAA','BBBBBBBBBBBBBBBB']);});
test('private cache keys change with uid, and public keys change with share token',()=>{const c=load(notes,['notesImageCacheKey'],{notesShareMode:false,notesAuthUid:()=>c.uid,uid:'owner-a',notesPublicImageToken:'one'});const a=c.notesImageCacheKey('id');c.uid='owner-b';assert.notEqual(c.notesImageCacheKey('id'),a);c.notesShareMode=true;const share=c.notesImageCacheKey('id');c.notesPublicImageToken='two';assert.notEqual(c.notesImageCacheKey('id'),share);});
test('share staging skips a foreign image without copying it and does not block publication',async()=>{let writes=0;const c=load(notes,['notesStageShareImages'],{notesValidCoverImage:()=>true,db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({uid:'other',data:'fake'})}),collection:()=>({doc:()=>({set:async()=>writes++})})})})}});await c.notesStageShareImages('token',['id'],'owner',()=>true);assert.equal(writes,0);});
test('failed share image staging leaves previously published snapshot unchanged',async()=>{let parentWrites=0;const page={id:'page',shareToken:'token'},c=load(notes,['notesWriteShare'],{notesAuthUid:()=> 'owner',notesLoadedFor:'login',notesShareMode:false,notesShareContextValid:()=>true,notesShareRevoking:{},notesPages:[page],notesShareErrors:{},notesShareCache:{},notesShareOwners:{},notesShareSubtree:()=>[],notesShareImageIds:()=>['image'],notesJsonBytes:()=>100,NOTES_CLOUD_LIMIT:100000,notesShareQueue:(_,task)=>task(),notesStageShareImages:async()=>{throw Error('offline');},notesToast(){},console:{error(){}},db:{collection:()=>({doc:()=>({update:async()=>parentWrites++})})}});assert.equal(await c.notesWriteShare(page,'login',true),false);assert.equal(parentWrites,0);});
const migration=require('../scripts/migrate-shared-note-images.cjs');
test('migration copies only explicitly shared own images, verifies bytes and preserves original documents',async()=>{const data='data:image/png;base64,AAAA',store={'notesShares/token':{uid:'owner',pages:[{src:'tjimg:AAAAAAAAAAAAAAAA'}],title:'unchanged'},'notesImages/AAAAAAAAAAAAAAAA':{uid:'owner',data},'notesImages/BBBBBBBBBBBBBBBB':{uid:'owner',data}},before=JSON.stringify(store['notesImages/AAAAAAAAAAAAAAAA']);const result=await migration.migrate({async *names(){yield 'notesShares/token';},read:async name=>store[name]?{data:structuredClone(store[name]),version:'version'}:null,copy:async(name,data)=>store[name]=data,publish:async(name,ids)=>store[name].imageIds=ids});assert.equal(result.verified,1);assert.equal(store['notesShares/token/images/AAAAAAAAAAAAAAAA'].data,data);assert.equal(store['notesShares/token/images/BBBBBBBBBBBBBBBB'],undefined);assert.equal(JSON.stringify(store['notesImages/AAAAAAAAAAAAAAAA']),before);assert.equal(store['notesShares/token'].title,'unchanged');});
test('migration skips foreign, missing and invalid images without copying or publishing them',async()=>{const good='data:image/png;base64,AAAA',store={'notesShares/token':{uid:'owner',pages:['tjimg:AAAAAAAAAAAAAAAA','tjimg:BBBBBBBBBBBBBBBB','tjimg:CCCCCCCCCCCCCCCC','tjimg:DDDDDDDDDDDDDDDD']},'notesImages/AAAAAAAAAAAAAAAA':{uid:'other',data:good},'notesImages/CCCCCCCCCCCCCCCC':{uid:'owner',data:'data:image/gif;base64,AAAA'},'notesImages/DDDDDDDDDDDDDDDD':{uid:'owner',data:good}},copied=[];const result=await migration.migrate({async *names(){yield 'notesShares/token';},read:async name=>store[name]?{data:structuredClone(store[name]),version:'v'}:null,copy:async(name,data)=>{copied.push(name);store[name]=data;},publish:async(name,ids)=>store[name].imageIds=ids});assert.deepEqual(copied,['notesShares/token/images/DDDDDDDDDDDDDDDD']);assert.deepEqual(store['notesShares/token'].imageIds,['DDDDDDDDDDDDDDDD']);assert.deepEqual(result.skipped,{missing:1,owner:1,content:1});assert.equal(result.shares,1);assert.equal(store['notesShares/token/images/AAAAAAAAAAAAAAAA'],undefined);});
test('MovieTracker rules remain byte-identical to the excluded project',()=>{const source=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');assert.match(source,/match \/movieTrackerApp\/mt_d51e19c9c35f0d8fe46d560e7fc3d1a6 \{\s+allow read, write: if true;\s+\}/);});
for(const [platform,file]of [['vercel','accounts-proxy-vercel/api/myfxbook.js'],['netlify','accounts-proxy/netlify/functions/myfxbook.js']]){
 test(platform+': actual handler keeps auth/revocation, restricts origins and serves v3 credentials',async()=>{
  const security=require(path.join(root,modules[0])),env={ACCOUNTS_CREDENTIAL_SECRET:'test-key-only-never-real-'.repeat(3),FIREBASE_WEB_API_KEY:'dummy'},requests=[];
  const proxySecurity={...security,originAllowed:h=>security.originAllowed(h,env),cors:h=>security.cors(h,env),sealCredentials:()=> 'v3.unit-test-response',openCredentials:()=>({email:'fake@example.invalid',password:'fake',generation:'0',iat:Date.now(),legacy:true})};
  let generation='0';const budget={run:fn=>fn(),request:async url=>{requests.push(url);const data=url.includes('identitytoolkit')?{users:[{localId:'test-owner'}]}:url.includes('/login.json')?{session:'dummy-session'}:url.includes('/get-my-accounts.json')?{accounts:[]}:{};return {ok:true,json:async()=>data,text:async()=>JSON.stringify(data)};}};
  const c={module:{exports:{}},exports:{},require:id=>id.endsWith('/security')?proxySecurity:id.endsWith('/request-budget')?budget:id.endsWith('/connection-state')?{generation:async()=>generation,revoke:async()=>generation='new'}:require(id),process:{env},URLSearchParams,AbortSignal,Date,console:{error(){}}};c.exports=c.module.exports;vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),c);
  async function call(headers,method='GET',query={action:'accounts'}){if(platform==='netlify'){const r=await c.exports.handler({headers,httpMethod:method,queryStringParameters:query});return {status:r.statusCode,headers:r.headers,data:r.body?JSON.parse(r.body):null};}const r={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(v){return {status:this.code,headers:this.headers,data:v};},end(){return {status:this.code,headers:this.headers};}};return c.module.exports({headers,method,query},r);}
  const auth={origin:'https://retocker.web.app',authorization:'Bearer dummy','x-tj-accounts-connection':'v2.unit-test'};
  const blocked=await call({...auth,origin:'https://untrusted.invalid'});assert.equal(blocked.status,403);assert.equal(requests.length,0);
  const preflight=await call({origin:auth.origin},'OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers['Access-Control-Allow-Origin'],auth.origin);
  assert.equal((await call({origin:auth.origin})).status,401);
  const result=await call(auth);assert.equal(result.status,200);assert.equal(result.data.connectionToken,'v3.unit-test-response');assert.ok(requests.some(x=>x.includes('/logout.json')));
  generation='revoked';const revoked=await call(auth);assert.equal(revoked.status,401);assert.equal(revoked.data.code,'CONNECTION_INVALID');
 });
}
test('account switch during private image read rejects and clears inflight state so owner can retry',async()=>{
 let uid='owner-a',release,calls=0;
 const c=load(notes,['notesImageCacheKey','notesImageDocument','notesImageResolve'],{
  notesShareMode:false,notesPublicImageToken:'',notesAuthUid:()=>uid,notesIsImageRef:v=>v.startsWith('tjimg:'),notesValidCoverImage:()=>true,notesImgMem:{},notesImgWait:{},notesImgCacheGet:async()=>null,notesImgCachePut(){},
  db:{collection:()=>({doc:()=>({get:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {exists:true,data:()=>({data:'data:image/png;base64,AAAA'})};}})})}
 });
 const pending=c.notesImageResolve('tjimg:AAAAAAAAAAAAAAAA');while(!release)await new Promise(r=>setImmediate(r));uid='owner-b';release();await assert.rejects(pending,/account changed/);assert.deepEqual(Object.keys(c.notesImgWait),[]);uid='owner-a';assert.equal(await c.notesImageResolve('tjimg:AAAAAAAAAAAAAAAA'),'data:image/png;base64,AAAA');assert.equal(calls,2);
});
