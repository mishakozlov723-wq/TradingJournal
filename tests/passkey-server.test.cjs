'use strict';
// End-to-end check of the passkey server with a software "authenticator" (same
// WebAuthn formats an iPhone/Android produces) and an in-memory Firestore.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'accounts-proxy-vercel');
const ORIGIN='https://retocker.web.app',RP='retocker.web.app';
const sa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
process.env.FIREBASE_SERVICE_ACCOUNT=JSON.stringify({type:'service_account',project_id:'retocker',client_email:'svc@retocker.iam.gserviceaccount.com',private_key:sa.privateKey.export({type:'pkcs8',format:'pem'})});
process.env.FIREBASE_WEB_API_KEY='dummy';
delete process.env.ALLOWED_ORIGIN;
const budget=require(path.join(dir,'lib/request-budget')),conn=require(path.join(dir,'lib/connection-state'));
const docs=new Map();let tick=0;
const users={'token-owner':'owner-uid','token-other':'other-uid'};
function reply(status,data){return {ok:status>=200&&status<300,status,json:async()=>data,text:async()=>JSON.stringify(data)};}
budget.request=async(url,opt={})=>{
  if(url.includes('identitytoolkit')){const uid=users[JSON.parse(opt.body).idToken];return uid?reply(200,{users:[{localId:uid,email:uid.split('-')[0]+'@journal.local'}]}):reply(400,{});}
  const u=new URL(url),m=u.pathname.match(/passkeyCredentials(?:\/(.+))?$/);assert.ok(m,url);
  const id=m[1]?decodeURIComponent(m[1]):u.searchParams.get('documentId');const cur=docs.get(id);
  if(opt.method==='POST'){if(cur)return reply(409,{});docs.set(id,{fields:JSON.parse(opt.body).fields,updateTime:'t'+(++tick)});return reply(200,{});}
  if(!opt.method||opt.method==='GET')return cur?reply(200,cur):reply(404,{});
  const pre=u.searchParams.get('currentDocument.updateTime');
  if(!cur)return reply(404,{});
  if(pre&&pre!==cur.updateTime)return reply(400,{});
  if(opt.method==='DELETE'){docs.delete(id);return reply(200,{});}
  if(opt.method==='PATCH'){Object.assign(cur.fields,JSON.parse(opt.body).fields);cur.updateTime='t'+(++tick);return reply(200,{});}
  throw Error('unexpected '+opt.method);
};
conn.accessToken=async()=>'access';
const handler=require(path.join(dir,'api/passkey.js'));
async function call(action,payload,{token,origin=ORIGIN}={}){
  const headers={origin};if(token)headers.authorization='Bearer '+token;
  const res={h:{},setHeader(k,v){this.h[k]=v;},status(s){this.code=s;return this;},json(v){this.body=v;return this;},end(){return this;}};
  await handler({method:'POST',headers,query:{action},body:payload||{}},res);
  return {status:res.code,body:res.body,headers:res.h};
}
// --- minimal CBOR encoder for the fake authenticator
function head(mt,n){return n<24?Buffer.from([mt<<5|n]):n<256?Buffer.from([mt<<5|24,n]):Buffer.from([mt<<5|25,n>>8,n&255]);}
function cbor(v){
  if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
  if(typeof v==='string'){const b=Buffer.from(v);return Buffer.concat([head(3,b.length),b]);}
  if(typeof v==='number')return v>=0?head(0,v):head(1,-1-v);
  if(v instanceof Map)return Buffer.concat([head(5,v.size),...[...v].flatMap(([k,x])=>[cbor(k),cbor(x)])]);
  throw Error('cbor type');
}
const sha=d=>crypto.createHash('sha256').update(d).digest(),b64u=b=>Buffer.from(b).toString('base64url');
function device(){
  const kp=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk=kp.publicKey.export({format:'jwk'});
  const id=crypto.randomBytes(20),cose=new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]);
  return {id,kp,cose,count:0};
}
function create(dev,opts,{flags=0x45,origin=ORIGIN,type='webauthn.create'}={}){
  const cd=Buffer.from(JSON.stringify({type,challenge:opts.challenge,origin,crossOrigin:false}));
  const len=Buffer.alloc(2);len.writeUInt16BE(dev.id.length);
  const ad=Buffer.concat([sha(RP),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),len,dev.id,cbor(dev.cose)]);
  return {state:opts.state,id:b64u(dev.id),clientDataJSON:b64u(cd),attestationObject:b64u(cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',ad]])))};
}
function get(dev,opts,uid,{flags=0x05,origin=ORIGIN,key=dev.kp.privateKey}={}){
  const cd=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:opts.challenge,origin})),cnt=Buffer.alloc(4);
  const ad=Buffer.concat([sha(RP),Buffer.from([flags]),cnt]);
  const sig=crypto.sign('sha256',Buffer.concat([ad,sha(cd)]),key);
  return {state:opts.state,id:b64u(dev.id),clientDataJSON:b64u(cd),authenticatorData:b64u(ad),signature:b64u(sig),userHandle:b64u(Buffer.from(uid))};
}
async function enroll(dev,token='token-owner'){
  const o=await call('register-options',{},{token});assert.equal(o.status,200);assert.equal(o.body.rp.id,RP);
  return call('register',create(dev,o.body),{token});
}
async function signIn(dev,uid='owner-uid',extra){const o=await call('login-options');assert.equal(o.status,200);return {o,r:await call('login',get(dev,o.body,uid,extra))};}

test('enrol then sign in returns a Firebase custom token for the owner only',async()=>{
  const dev=device(),reg=await enroll(dev);
  assert.equal(reg.status,200,JSON.stringify(reg.body));assert.equal(reg.body.id,b64u(dev.id));
  assert.equal(docs.get(b64u(dev.id)).fields.uid.stringValue,'owner-uid');
  const {r}=await signIn(dev);
  assert.equal(r.status,200,JSON.stringify(r.body));
  const [h,p,s]=r.body.token.split('.'),payload=JSON.parse(Buffer.from(p,'base64url'));
  assert.ok(crypto.verify('RSA-SHA256',Buffer.from(h+'.'+p),sa.publicKey,Buffer.from(s,'base64url')));
  assert.equal(payload.uid,'owner-uid');assert.equal(payload.iss,'svc@retocker.iam.gserviceaccount.com');
  assert.equal(payload.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.ok(payload.exp-payload.iat<=3600);
  assert.equal(r.headers['Access-Control-Allow-Origin'],ORIGIN);
});
test('a captured sign-in cannot be replayed',async()=>{
  const dev=device();await enroll(dev);
  const o=await call('login-options'),a=get(dev,o.body,'owner-uid');
  assert.equal((await call('login',a)).status,200);
  const again=await call('login',a);assert.equal(again.status,400);assert.equal(again.body.code,'PASSKEY_EXPIRED');assert.equal(again.body.token,undefined);
});
test('wrong key, missing Face ID, wrong site or foreign origin are refused',async()=>{
  const dev=device();await enroll(dev);
  const other=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
  assert.equal((await signIn(dev,'owner-uid',{key:other.privateKey})).r.body.code,'PASSKEY_SIGNATURE');
  assert.equal((await signIn(dev,'owner-uid',{flags:0x01})).r.body.code,'PASSKEY_NOT_VERIFIED');
  assert.equal((await signIn(dev,'owner-uid',{origin:'https://evil.example'})).r.body.code,'PASSKEY_MISMATCH');
  assert.equal((await signIn(dev,'other-uid')).r.body.code,'PASSKEY_MISMATCH');
  assert.equal((await call('login-options',{}, {origin:'https://evil.example'})).status,403);
  const tampered=await call('login-options');tampered.body.state=tampered.body.state.slice(0,-2)+'AA';
  assert.equal((await call('login',get(dev,tampered.body,'owner-uid'))).body.code,'PASSKEY_EXPIRED');
});
test('registration needs a session, Face ID and cannot take over an existing passkey',async()=>{
  const dev=device();
  assert.equal((await call('register-options',{})).status,401);
  const o=await call('register-options',{},{token:'token-owner'});
  assert.equal((await call('register',create(dev,o.body,{flags:0x41}),{token:'token-owner'})).body.code,'PASSKEY_NOT_VERIFIED');
  const o2=await call('register-options',{},{token:'token-owner'});
  assert.equal((await call('register',create(dev,o2.body),{token:'token-other'})).body.code,'PASSKEY_MISMATCH');
  assert.equal((await enroll(dev)).status,200);
  const taken=await enroll(dev,'token-other');assert.equal(taken.status,409);
  assert.equal(docs.get(b64u(dev.id)).fields.uid.stringValue,'owner-uid');
});
test('only the owner can remove a passkey; removed passkeys stop working',async()=>{
  const dev=device();await enroll(dev);const id=b64u(dev.id);
  assert.equal((await call('remove',{id},{token:'token-other'})).body.removed,false);
  assert.ok(docs.has(id));
  assert.equal((await call('remove',{id},{token:'token-owner'})).body.removed,true);
  const {r}=await signIn(dev);assert.equal(r.status,404);assert.equal(r.body.code,'PASSKEY_UNKNOWN');
});
test('firestore keeps passkeys server-only behind the default deny rule',()=>{
  const rules=require('node:fs').readFileSync(path.join(root,'firestore.rules'),'utf8');
  assert.doesNotMatch(rules,/passkey/i);
  assert.match(rules,/match \/\{document=\*\*\} \{\s+allow read, write: if false;\s+\}/);
});
