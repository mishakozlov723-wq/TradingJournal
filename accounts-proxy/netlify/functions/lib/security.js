'use strict';
const crypto=require('node:crypto');
const DEFAULT_ORIGINS=['https://retocker.web.app','https://retocker.firebaseapp.com'];
function allowedOrigins(env=process.env){
  const configured=String(env.ALLOWED_ORIGIN||'').trim();
  const values=configured&&configured!=='*'?configured.split(',').map(x=>x.trim()).filter(Boolean):DEFAULT_ORIGINS;
  if(!values.length)throw Object.assign(Error('Accounts allowed origins are not configured.'),{status:503});
  return values.map(value=>{
    let url;try{url=new URL(value);}catch(_){throw Object.assign(Error('Accounts allowed origin must be an explicit HTTPS origin.'),{status:503});}
    if(url.protocol!=='https:'||url.origin!==value)throw Object.assign(Error('Accounts allowed origin must be an explicit HTTPS origin.'),{status:503});
    return value;
  });
}
function requestOrigin(headers={}){return String(headers.origin||headers.Origin||'');}
function originAllowed(headers,env){const origin=requestOrigin(headers);return !origin||allowedOrigins(env).includes(origin);}
function cors(headers,env){
  const origin=requestOrigin(headers),out={
    Vary:'Origin',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, X-TJ-Accounts-Connection',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, max-age=0'
  };
  if(origin&&allowedOrigins(env).includes(origin))out['Access-Control-Allow-Origin']=origin;
  return out;
}
function configError(){return Object.assign(Error('Configure ACCOUNTS_CREDENTIAL_SECRET (at least 32 bytes) or the protected Firebase service account.'),{status:503,code:'CREDENTIAL_KEY_NOT_CONFIGURED'});}
function activeKey(env=process.env){
  // Password-independent, domain-separated key. The already-required protected
  // service account gives existing installs a stable key without another setup.
  // A separate random secret is preferred; changing either active source is a rotation.
  const explicit=env.ACCOUNTS_CREDENTIAL_SECRET;
  if(explicit){if(Buffer.byteLength(explicit)<32)throw configError();return crypto.createHash('sha256').update('tj-accounts-v3|'+explicit).digest();}
  let account;try{account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT||'');}catch(_){throw configError();}
  if(account.type!=='service_account'||account.project_id!==(env.FIREBASE_PROJECT_ID||'retocker')||typeof account.private_key!=='string'||account.private_key.length<32)throw configError();
  return Buffer.from(crypto.hkdfSync('sha256',account.private_key,account.project_id,'syter/accounts/credentials/v3',32));
}
function legacyKey(env=process.env){
  // Read-only compatibility for tokens issued BEFORE this release. Never seal
  // new data with a login password. Remove this adapter after the fixed sunset.
  const raw=env.ACCOUNTS_CREDENTIAL_SECRET||env.MYFXBOOK_PASSWORD;
  if(!raw)throw Error('legacy key unavailable');
  return crypto.createHash('sha256').update('tj-accounts-v1|'+raw).digest();
}
const LEGACY_ISSUED_BEFORE=Date.parse('2026-10-29T00:00:00Z');
const LEGACY_END=LEGACY_ISSUED_BEFORE+30*86400000;
function sealCredentials(uid,email,password,generation,issuedAt=Date.now()){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',activeKey(),iv);
  const data=Buffer.from(JSON.stringify({uid:String(uid),email:String(email),password:String(password),generation:String(generation),iat:issuedAt}));
  return ['v3',iv.toString('base64url'),Buffer.concat([cipher.update(data),cipher.final()]).toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
function openCredentials(token,uid){
  let data,legacy=false;
  try{
    const parts=String(token||'').split('.');
    if(parts.length!==4||!['v2','v3'].includes(parts[0])||parts.slice(1).some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))throw Error('format');
    legacy=parts[0]==='v2';
    if(legacy&&Date.now()>=LEGACY_END)throw Error('legacy sunset');
    const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[3],'base64url');
    if(iv.length!==12||tag.length!==16)throw Error('format');
    const decipher=crypto.createDecipheriv('aes-256-gcm',legacy?legacyKey():activeKey(),iv);decipher.setAuthTag(tag);
    data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString());
    if(!data||data.uid!==String(uid)||typeof data.email!=='string'||!data.email||typeof data.password!=='string'||!data.password||typeof data.generation!=='string'||!data.generation)throw Error('binding');
    if(!Number.isFinite(data.iat)||data.iat>Date.now()+60000||Date.now()-data.iat>30*86400000||(legacy&&data.iat>=LEGACY_ISSUED_BEFORE))throw Error('expired');
  }catch(error){
    if(error.code==='CREDENTIAL_KEY_NOT_CONFIGURED')throw error;
    throw Object.assign(Error('Myfxbook connection is invalid. Reconnect this Trading Journal user.'),{status:401,code:'CONNECTION_INVALID'});
  }
  return {email:data.email,password:data.password,generation:data.generation,iat:data.iat,legacy};
}
module.exports={allowedOrigins,originAllowed,cors,activeKey,sealCredentials,openCredentials,LEGACY_END};
