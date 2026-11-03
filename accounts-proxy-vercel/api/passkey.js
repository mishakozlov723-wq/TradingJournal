'use strict';
// SYTER Face ID / fingerprint sign-in (WebAuthn passkeys).
// POST ?action=register-options|register|remove  (Firebase ID token required)
// POST ?action=login-options|login                (no session; the passkey is the proof)
// Credentials live in Firestore /passkeyCredentials (server-only, default-deny for browsers).
const security=require('../lib/security'),budget=require('../lib/request-budget');
const connectionState=require('../lib/connection-state'),pk=require('../lib/passkey');

const IDENTITY_LOOKUP='https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const COLLECTION='passkeyCredentials';

function setCors(req,res){Object.entries(security.cors(req.headers)).forEach(([k,v])=>res.setHeader(k,v));}
function send(req,res,status,body){setCors(req,res);return res.status(status).json(body);}
function bearer(headers){const m=String((headers&&(headers.authorization||headers.Authorization))||'').match(/^Bearer\s+(.+)$/i);return m?m[1]:'';}
function body(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body||'{}');}catch(_){return {};}}
  return {};
}
function originOf(req){
  const origin=String(req.headers.origin||req.headers.Origin||'');
  if(!origin||!security.allowedOrigins().includes(origin))throw pk.bad('Origin is not allowed.','ORIGIN_DENIED',403);
  return origin;
}
async function verifyFirebaseUser(idToken){
  const key=String(process.env.FIREBASE_WEB_API_KEY||'').trim();
  if(!key)throw pk.bad('Server configuration is missing FIREBASE_WEB_API_KEY.','CONFIG',500);
  const response=await budget.request(IDENTITY_LOOKUP+'?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})},5000);
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.users||!data.users[0]||!data.users[0].localId)throw pk.bad('Firebase session is not valid.','FIREBASE_AUTH',401);
  return data.users[0];
}

function docUrl(project,id){return 'https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents/'+COLLECTION+(id?'/'+encodeURIComponent(id):'');}
async function store(method,url,payload){
  const token=await connectionState.accessToken();
  const options={method,headers:{Authorization:'Bearer '+token}};
  if(payload){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload);}
  const response=await budget.request(url,options,4000);
  if(response.status===401)connectionState.resetAccess();
  return response;
}
function unavailable(){return pk.bad('Face ID sign-in is temporarily unavailable. Use your password.','PASSKEY_UNAVAILABLE',503);}
function str(v){return {stringValue:String(v)};}
function int(v){return {integerValue:String(v)};}
function readDoc(doc){
  const f=doc&&doc.fields||{},s=k=>f[k]&&typeof f[k].stringValue==='string'?f[k].stringValue:'',n=k=>f[k]&&f[k].integerValue!==undefined?Number(f[k].integerValue):NaN;
  return {uid:s('uid'),rpId:s('rpId'),publicKey:s('publicKey'),alg:n('alg'),signCount:n('signCount'),lastIat:n('lastIat'),updateTime:doc&&doc.updateTime};
}

async function registerOptions(req,user,key,origin){
  const rpId=new URL(origin).hostname;
  const issued=pk.issueState(key,{t:'reg',o:origin,rp:rpId,u:user.localId});
  const name=String(user.email||'').split('@')[0]||'SYTER';
  return {ok:true,state:issued.state,challenge:issued.challenge,rp:{id:rpId,name:'SYTER'},user:{id:pk.b64u(Buffer.from(user.localId)),name,displayName:name}};
}
async function register(req,user,key,account){
  const b=body(req),state=pk.openState(key,b.state,'reg');
  if(state.u!==user.localId||state.o!==originOf(req))throw pk.bad('Passkey response does not match this sign-in.','PASSKEY_MISMATCH');
  const clientData=pk.fromB64u(b.clientDataJSON,4096,'client data');
  pk.checkClientData(clientData,'webauthn.create',state);
  const att=pk.cborDecode(pk.fromB64u(b.attestationObject,16384,'attestation')).value;
  if(!(att instanceof Map)||!Buffer.isBuffer(att.get('authData')))throw pk.bad('Invalid passkey data.');
  const auth=pk.parseAuthData(att.get('authData'),true);
  if(!auth.rpIdHash.equals(pk.sha256(state.rp)))throw pk.bad('Passkey belongs to another site.','PASSKEY_MISMATCH');
  if(!auth.userPresent||!auth.userVerified)throw pk.bad('Face ID or fingerprint confirmation is required.','PASSKEY_NOT_VERIFIED');
  const id=pk.b64u(auth.credentialId);
  if(b.id!==undefined&&b.id!==id)throw pk.bad('Passkey response does not match this sign-in.','PASSKEY_MISMATCH');
  const label=String(b.label||'').replace(/[^\w .,()-]/g,'').slice(0,60);
  const now=new Date().toISOString();
  // Create-only: an existing credential (any owner) is never overwritten.
  const response=await store('POST',docUrl(account.project_id)+'?documentId='+encodeURIComponent(id),{fields:{
    uid:str(user.localId),rpId:str(state.rp),publicKey:str(auth.key.publicKey),alg:int(auth.key.alg),
    signCount:int(auth.signCount),lastIat:int(0),label:str(label),createdAt:{timestampValue:now},lastUsedAt:{timestampValue:now}
  }});
  if(response.status===409)throw pk.bad('This passkey is already registered.','PASSKEY_EXISTS',409);
  if(!response.ok)throw unavailable();
  return {ok:true,id};
}
async function remove(req,user,account){
  const id=String(body(req).id||'');pk.fromB64u(id,512,'passkey id');
  const got=await store('GET',docUrl(account.project_id,id));
  if(got.status===404)return {ok:true,removed:false};
  if(!got.ok)throw unavailable();
  const cred=readDoc(await got.json());
  if(cred.uid!==user.localId)return {ok:true,removed:false};
  const del=await store('DELETE',docUrl(account.project_id,id)+'?currentDocument.updateTime='+encodeURIComponent(cred.updateTime));
  if(!del.ok&&del.status!==404)throw unavailable();
  return {ok:true,removed:true};
}
async function loginOptions(req,key,origin){
  const rpId=new URL(origin).hostname,issued=pk.issueState(key,{t:'auth',o:origin,rp:rpId});
  return {ok:true,state:issued.state,challenge:issued.challenge,rpId};
}
async function login(req,key,account){
  const b=body(req),state=pk.openState(key,b.state,'auth');
  if(state.o!==originOf(req))throw pk.bad('Passkey response does not match this sign-in.','PASSKEY_MISMATCH');
  const id=String(b.id||'');pk.fromB64u(id,512,'passkey id');
  const clientDataRaw=pk.fromB64u(b.clientDataJSON,4096,'client data'),authRaw=pk.fromB64u(b.authenticatorData,2048,'authenticator data'),sig=pk.fromB64u(b.signature,1024,'signature');
  pk.checkClientData(clientDataRaw,'webauthn.get',state);
  const got=await store('GET',docUrl(account.project_id,id));
  if(got.status===404)throw pk.bad('Face ID sign-in is off for this device. Sign in with your password.','PASSKEY_UNKNOWN',404);
  if(!got.ok)throw unavailable();
  const cred=readDoc(await got.json());
  if(!cred.uid||!cred.publicKey||cred.rpId!==state.rp)throw pk.bad('Face ID sign-in is off for this device. Sign in with your password.','PASSKEY_UNKNOWN',404);
  const auth=pk.parseAuthData(authRaw,false);
  if(!auth.rpIdHash.equals(pk.sha256(cred.rpId)))throw pk.bad('Passkey belongs to another site.','PASSKEY_MISMATCH');
  if(!auth.userPresent||!auth.userVerified)throw pk.bad('Face ID or fingerprint confirmation is required.','PASSKEY_NOT_VERIFIED');
  if(b.userHandle){const handle=pk.fromB64u(String(b.userHandle),256,'user handle');if(handle.toString()!==cred.uid)throw pk.bad('Passkey response does not match this sign-in.','PASSKEY_MISMATCH');}
  if(!pk.verifySignature(cred.alg,cred.publicKey,Buffer.concat([authRaw,pk.sha256(clientDataRaw)]),sig))throw pk.bad('Passkey signature is not valid.','PASSKEY_SIGNATURE',401);
  // One use per issued request: newer than the last accepted one, enforced atomically.
  if(!(state.iat>(Number.isFinite(cred.lastIat)?cred.lastIat:0)))throw pk.bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');
  if(auth.signCount>0&&Number.isFinite(cred.signCount)&&cred.signCount>0&&auth.signCount<=cred.signCount)throw pk.bad('Passkey counter check failed.','PASSKEY_SIGNATURE',401);
  const mask=['lastIat','signCount','lastUsedAt'].map(f=>'updateMask.fieldPaths='+f).join('&');
  const upd=await store('PATCH',docUrl(account.project_id,id)+'?'+mask+'&currentDocument.updateTime='+encodeURIComponent(cred.updateTime),{fields:{lastIat:int(state.iat),signCount:int(auth.signCount),lastUsedAt:{timestampValue:new Date().toISOString()}}});
  if(upd.status===400||upd.status===409||upd.status===412)throw pk.bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');
  if(!upd.ok)throw unavailable();
  return {ok:true,token:pk.customToken(account,cred.uid)};
}

async function handler(req,res){
  if(!security.originAllowed(req.headers))return res.status(403).json({ok:false,error:'Origin is not allowed.',code:'ORIGIN_DENIED'});
  if(req.method==='OPTIONS'){setCors(req,res);return res.status(204).end();}
  if(req.method!=='POST')return send(req,res,405,{ok:false,error:'Method not allowed.'});
  try{
    const origin=originOf(req),action=String((req.query&&req.query.action)||'').toLowerCase();
    let account;try{account=connectionState.configuration();}catch(_){throw unavailable();}
    const key=pk.stateKey(account);
    if(action==='login-options')return send(req,res,200,await loginOptions(req,key,origin));
    if(action==='login')return send(req,res,200,await login(req,key,account));
    if(!['register-options','register','remove'].includes(action))return send(req,res,400,{ok:false,error:'Unknown action.'});
    const token=bearer(req.headers);
    if(!token)return send(req,res,401,{ok:false,error:'Firebase authorization is required.',code:'FIREBASE_AUTH'});
    const user=await verifyFirebaseUser(token);
    if(action==='register-options')return send(req,res,200,await registerOptions(req,user,key,origin));
    if(action==='register')return send(req,res,200,await register(req,user,key,account));
    return send(req,res,200,await remove(req,user,account));
  }catch(err){
    const status=err&&err.status?err.status:500;
    if(status>=500)console.error('Passkey error:',err&&err.message?err.message:err);
    return send(req,res,status,{ok:false,error:status>=500&&!err.code?'Face ID sign-in failed.':err.message,code:err&&err.code?err.code:undefined});
  }
}

module.exports=(req,res)=>budget.run(async()=>{try{return await handler(req,res);}catch(_){return res.status(503).json({ok:false,error:'Face ID sign-in is temporarily unavailable.',code:'PASSKEY_UNAVAILABLE'});}});
module.exports.handler=handler;
