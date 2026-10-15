'use strict';
// Trusted server-only revocation state. Firestore's existing default-deny rule
// intentionally prevents browsers (including the owner) from resetting this state.
const crypto=require('node:crypto'),budget=require('./request-budget');
let cachedAccess=null,accessInFlight=null;
function configuration(){
  try{
    const key=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'');
    if(key.type!=='service_account'||key.project_id!==(process.env.FIREBASE_PROJECT_ID||'retocker')||!key.private_key||!key.client_email)throw Error('invalid');
    return key;
  }catch(_){throw Object.assign(Error('Server configuration requires a Firebase service account for Accounts token revocation.'),{status:503,code:'REVOCATION_NOT_CONFIGURED'});}
}
async function accessToken(){
  const key=configuration();
  if(cachedAccess&&cachedAccess.email===key.client_email&&cachedAccess.expires>Date.now()+60000)return cachedAccess.token;
  if(accessInFlight)return accessInFlight;
  accessInFlight=(async()=>{
    const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:key.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.private_key).toString('base64url');
    const response=await budget.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()},3000);
    const data=await response.json();
    if(!response.ok||!data.access_token)throw Object.assign(Error('Accounts revocation service authentication failed.'),{status:503,code:'REVOCATION_UNAVAILABLE'});
    cachedAccess={email:key.client_email,token:data.access_token,expires:Date.now()+Math.min(Number(data.expires_in)||3600,3600)*1000};return cachedAccess.token;
  })();
  try{return await accessInFlight;}finally{accessInFlight=null;}
}
async function state(uid,generation){
  const key=configuration(),token=await accessToken();
  const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(key.project_id)+'/databases/(default)/documents/accountConnectionRevocations/'+encodeURIComponent(uid);
  const options={headers:{Authorization:'Bearer '+token}};
  if(generation!==undefined){options.method='PATCH';options.headers['Content-Type']='application/json';options.body=JSON.stringify({fields:{generation:{stringValue:generation}}});}
  const response=await budget.request(url,options,3000);
  if(generation===undefined&&response.status===404)return '0';
  if(!response.ok){if(response.status===401)cachedAccess=null;throw Object.assign(Error('Accounts revocation state is unavailable. Retry later.'),{status:503,code:'REVOCATION_UNAVAILABLE'});}
  const data=await response.json();
  const value=data.fields?.generation?.stringValue;
  if(typeof value!=='string'||!value)throw Object.assign(Error('Accounts revocation state is invalid.'),{status:503,code:'REVOCATION_UNAVAILABLE'});
  return value;
}
module.exports={generation:uid=>state(uid),revoke:uid=>state(uid,crypto.randomBytes(16).toString('hex'))};
