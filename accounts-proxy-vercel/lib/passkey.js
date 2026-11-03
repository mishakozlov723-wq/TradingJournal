'use strict';
// SYTER Face ID / fingerprint sign-in (WebAuthn passkeys) without third-party code.
// Only verification helpers live here; api/passkey.js does storage and HTTP.
const crypto=require('node:crypto');
const STATE_TTL=5*60*1000;
const B64U=/^[A-Za-z0-9_-]+$/;

function b64u(buf){return Buffer.from(buf).toString('base64url');}
function fromB64u(value,max,label){
  if(typeof value!=='string'||!value||value.length>Math.ceil(max*4/3)+4||!B64U.test(value))throw bad('Invalid '+label+'.');
  const out=Buffer.from(value,'base64url');
  if(!out.length||out.length>max)throw bad('Invalid '+label+'.');
  return out;
}
function bad(message,code='PASSKEY_INVALID',status=400){return Object.assign(Error(message),{status,code});}
function sha256(data){return crypto.createHash('sha256').update(data).digest();}

// Minimal strict CBOR reader (major types 0-5 and simple true/false/null) for
// attestationObject and COSE keys. Indefinite lengths, tags and floats are rejected.
function cborDecode(buf,start=0){
  let o=start;
  function need(n){if(o+n>buf.length)throw bad('Invalid passkey data.');}
  function len(ai){
    if(ai<24)return ai;
    if(ai===24){need(1);return buf[o++];}
    if(ai===25){need(2);const v=buf.readUInt16BE(o);o+=2;return v;}
    if(ai===26){need(4);const v=buf.readUInt32BE(o);o+=4;return v;}
    throw bad('Invalid passkey data.');
  }
  function item(depth){
    if(depth>6)throw bad('Invalid passkey data.');
    need(1);const b=buf[o++],mt=b>>5,ai=b&31;
    if(mt===7){if(ai===20)return false;if(ai===21)return true;if(ai===22)return null;throw bad('Invalid passkey data.');}
    const n=len(ai);
    if(mt===0)return n;
    if(mt===1)return -1-n;
    if(mt===2){need(n);const v=Buffer.from(buf.subarray(o,o+n));o+=n;return v;}
    if(mt===3){need(n);const v=buf.subarray(o,o+n).toString('utf8');o+=n;return v;}
    if(mt===4){if(n>64)throw bad('Invalid passkey data.');const a=[];for(let i=0;i<n;i++)a.push(item(depth+1));return a;}
    if(mt===5){if(n>64)throw bad('Invalid passkey data.');const m=new Map();for(let i=0;i<n;i++){const k=item(depth+1);m.set(k,item(depth+1));}return m;}
    throw bad('Invalid passkey data.');
  }
  const value=item(0);
  return {value,end:o};
}

function coseToKey(map){
  if(!(map instanceof Map))throw bad('Unsupported passkey key.');
  const kty=map.get(1),alg=map.get(3);
  let jwk;
  if(kty===2&&alg===-7&&map.get(-1)===1){
    const x=map.get(-2),y=map.get(-3);
    if(!Buffer.isBuffer(x)||!Buffer.isBuffer(y)||x.length!==32||y.length!==32)throw bad('Unsupported passkey key.');
    jwk={kty:'EC',crv:'P-256',x:b64u(x),y:b64u(y)};
  }else if(kty===3&&alg===-257){
    const n=map.get(-1),e=map.get(-2);
    if(!Buffer.isBuffer(n)||!Buffer.isBuffer(e)||n.length<256||n.length>512)throw bad('Unsupported passkey key.');
    jwk={kty:'RSA',n:b64u(n),e:b64u(e)};
  }else throw bad('Unsupported passkey key.');
  const key=crypto.createPublicKey({key:jwk,format:'jwk'});
  return {alg,publicKey:key.export({type:'spki',format:'der'}).toString('base64')};
}

function parseAuthData(ad,withCredential){
  if(!Buffer.isBuffer(ad)||ad.length<37)throw bad('Invalid passkey data.');
  const out={rpIdHash:ad.subarray(0,32),flags:ad[32],signCount:ad.readUInt32BE(33)};
  out.userPresent=!!(out.flags&0x01);out.userVerified=!!(out.flags&0x04);
  if(withCredential){
    if(!(out.flags&0x40)||ad.length<55)throw bad('Invalid passkey data.');
    const idLen=ad.readUInt16BE(53);
    if(idLen<16||idLen>512||55+idLen>ad.length)throw bad('Invalid passkey data.');
    out.credentialId=Buffer.from(ad.subarray(55,55+idLen));
    const cose=cborDecode(ad,55+idLen);
    out.key=coseToKey(cose.value);
  }
  return out;
}

function stateKey(serviceAccount){
  return Buffer.from(crypto.hkdfSync('sha256',serviceAccount.private_key,serviceAccount.project_id,'syter/passkey/state/v1',32));
}
function issueState(key,payload,now=Date.now()){
  const body=b64u(JSON.stringify({...payload,c:b64u(crypto.randomBytes(32)),iat:now,exp:now+STATE_TTL}));
  const mac=b64u(crypto.createHmac('sha256',key).update('syter-passkey|'+body).digest());
  return {state:body+'.'+mac,challenge:JSON.parse(Buffer.from(body,'base64url').toString()).c};
}
function openState(key,token,type,now=Date.now()){
  const parts=String(token||'').split('.');
  if(parts.length!==2||!B64U.test(parts[0])||!B64U.test(parts[1])||parts[0].length>2048)throw bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');
  const expected=crypto.createHmac('sha256',key).update('syter-passkey|'+parts[0]).digest(),got=Buffer.from(parts[1],'base64url');
  if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))throw bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');
  let data;try{data=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch(_){throw bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');}
  if(!data||data.t!==type||!Number.isFinite(data.exp)||!Number.isFinite(data.iat)||now>data.exp||data.iat>now+60000)throw bad('Sign-in request expired. Try again.','PASSKEY_EXPIRED');
  return data;
}

function checkClientData(raw,type,state){
  let data;try{data=JSON.parse(raw.toString('utf8'));}catch(_){throw bad('Invalid passkey data.');}
  if(!data||data.type!==type||data.challenge!==state.c||data.origin!==state.o||data.crossOrigin===true)throw bad('Passkey response does not match this sign-in.','PASSKEY_MISMATCH');
}

function verifySignature(alg,publicKey,data,signature){
  const key=crypto.createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
  if(alg===-7)return crypto.verify('sha256',data,{key,dsaEncoding:'der'},signature);
  if(alg===-257)return crypto.verify('sha256',data,key,signature);
  return false;
}

function customToken(serviceAccount,uid,now=Date.now()){
  const iat=Math.floor(now/1000),enc=v=>b64u(JSON.stringify(v));
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:serviceAccount.client_email,sub:serviceAccount.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat,exp:iat+3600,uid:String(uid)});
  return unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),serviceAccount.private_key).toString('base64url');
}

module.exports={b64u,fromB64u,sha256,cborDecode,coseToKey,parseAuthData,stateKey,issueState,openState,checkClientData,verifySignature,customToken,STATE_TTL,bad};
