'use strict';

const security=require('./lib/security');
const {sealCredentials,openCredentials}=security;

const budget=require('./lib/request-budget'),connectionState=require('./lib/connection-state');

const MYFXBOOK_API='https://www.myfxbook.com/api';
const IDENTITY_LOOKUP='https://identitytoolkit.googleapis.com/v1/accounts:lookup';

function response(status,body,headers){return {statusCode:status,headers:security.cors(headers),body:JSON.stringify(body)};}
function bearer(headers){
  const raw=(headers&&((headers.authorization)||(headers.Authorization)))||'';
  const m=String(raw).match(/^Bearer\s+(.+)$/i); return m?m[1]:'';
}
function connectionHeader(headers){
  return String((headers&&((headers['x-tj-accounts-connection'])||(headers['X-TJ-Accounts-Connection'])))||'').trim();
}
async function verifyFirebaseUser(idToken){
  const key=String(process.env.FIREBASE_WEB_API_KEY||'').trim();
  if(!key){const err=new Error('Server configuration is missing FIREBASE_WEB_API_KEY.');err.status=500;throw err;}
  const res=await budget.request(IDENTITY_LOOKUP+'?key='+encodeURIComponent(key),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.users||!data.users[0]){const err=new Error('Firebase session is not valid.');err.status=401;err.code='FIREBASE_AUTH';throw err;}
  const user=data.users[0];
  if(String(process.env.ACCOUNTS_ENFORCE_ALLOWLIST||'')==='1'){
    const allow=String(process.env.ALLOWED_FIREBASE_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!allow.length){const err=new Error('Server configuration is missing ALLOWED_FIREBASE_UIDS.');err.status=500;throw err;}
    if(!allow.includes(user.localId)){const err=new Error('This Firebase account is not allowed to open trading accounts.');err.status=403;throw err;}
  }
  return user;
}
async function mfb(method,params){
  const qs=new URLSearchParams(); Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null)qs.set(k,String(v));});
  const res=await budget.request(MYFXBOOK_API+'/'+method+'.json?'+qs.toString(),{headers:{'Accept':'application/json','User-Agent':'TradingJournal-Accounts/2.0'},cache:'no-store'});
  const text=await res.text(); let data;
  try{data=JSON.parse(text);}catch(_){throw new Error('Myfxbook returned an invalid response.');}
  if(!res.ok)throw new Error('Myfxbook HTTP '+res.status+'.');
  if(data&&data.error)throw new Error(data.message||('Myfxbook '+method+' failed.'));
  return data||{};
}
async function safeMfb(method,params,label,errors){
  try{return await mfb(method,params);}catch(err){errors.push(label+': '+err.message);return {};}
}
function yyyyMmDd(date){return date.toISOString().slice(0,10);}
function parseMfbDate(value){
  const m=String(value||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m)return null;
  const d=new Date(Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2])));
  return Number.isNaN(d.getTime())?null:d;
}
function publicAccount(a){
  if(!a)return null;
  return {
    id:a.id,name:a.name||'',description:a.description||'',accountId:a.accountId,gain:a.gain,absGain:a.absGain,daily:a.daily,monthly:a.monthly,
    withdrawals:a.withdrawals,deposits:a.deposits,interest:a.interest,profit:a.profit,balance:a.balance,drawdown:a.drawdown,equity:a.equity,
    equityPercent:a.equityPercent,demo:a.demo,lastUpdateDate:a.lastUpdateDate,creationDate:a.creationDate,firstTradeDate:a.firstTradeDate,
    commission:a.commission,currency:a.currency,profitFactor:a.profitFactor,pips:a.pips,server:a.server&&a.server.name?{name:a.server.name}:null
  };
}
async function withCredentialsSession(credentials,run){
  const login=await mfb('login',{email:credentials.email,password:credentials.password});
  if(!login.session)throw new Error('Myfxbook did not create a session.');
  try{return await run(login.session);}finally{try{await mfb('logout',{session:login.session});}catch(_){}}
}
function readBody(event){
  if(!event||!event.body)return {};
  if(typeof event.body==='object')return event.body;
  try{return JSON.parse(event.body);}catch(_){return {};}
}
async function listAccounts(session){
  const accountData=await mfb('get-my-accounts',{session});
  const rawAccounts=Array.isArray(accountData.accounts)?accountData.accounts:[];
  return {rawAccounts,accounts:rawAccounts.map(publicAccount)};
}

async function handler(event){
  const reply=(status,body)=>response(status,body,event.headers);
  if(!security.originAllowed(event.headers))return {statusCode:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({ok:false,error:'Origin is not allowed.',code:'ORIGIN_DENIED'})};
  if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:security.cors(event.headers),body:''};
  if(event.httpMethod!=='GET'&&event.httpMethod!=='POST')return reply(405,{ok:false,error:'Method not allowed.'});
  try{
    const token=bearer(event.headers);
    if(!token)return reply(401,{ok:false,error:'Firebase authorization is required.',code:'FIREBASE_AUTH'});
    const user=await verifyFirebaseUser(token);
    const action=String((event.queryStringParameters&&event.queryStringParameters.action)||'accounts').toLowerCase();

    if(event.httpMethod==='POST'&&action==='connect'){
      const body=readBody(event),email=String(body.email||'').trim(),password=String(body.password||'');
      if(!email||!password)return reply(400,{ok:false,error:'Enter the Myfxbook email and password.',code:'CONNECT_INPUT'});
      const result=await withCredentialsSession({email,password},async session=>{
        const listed=await listAccounts(session);
        return {connectionToken:sealCredentials(user.localId,email,password,await connectionState.generation(user.localId)),accounts:listed.accounts};
      });
      return reply(200,{ok:true,connectionToken:result.connectionToken,accounts:result.accounts});
    }
    if(event.httpMethod==='POST'&&action==='disconnect'){await connectionState.revoke(user.localId);return reply(200,{ok:true,revoked:true});}
    if(event.httpMethod!=='GET')return reply(405,{ok:false,error:'Method not allowed.'});

    const encrypted=connectionHeader(event.headers);
    if(!encrypted)return reply(428,{ok:false,error:'Connect Myfxbook for this Trading Journal user first.',code:'MYFXBOOK_NOT_CONNECTED'});
    const credentials=openCredentials(encrypted,user.localId);
    if(credentials.generation!==await connectionState.generation(user.localId))throw Object.assign(new Error('Myfxbook connection was revoked. Reconnect.'),{status:401,code:'CONNECTION_INVALID'});

    const refreshedConnection=credentials.legacy?sealCredentials(user.localId,credentials.email,credentials.password,credentials.generation,credentials.iat):undefined;

    return await withCredentialsSession(credentials,async session=>{
      const listed=await listAccounts(session),rawAccounts=listed.rawAccounts,accounts=listed.accounts;
      if(action==='accounts')return reply(200,{ok:true,accounts,connectionToken:refreshedConnection});
      if(action!=='details')return reply(400,{ok:false,error:'Unknown action.'});
      const id=String((event.queryStringParameters&&event.queryStringParameters.id)||'').trim();
      if(!/^\d+$/.test(id))return reply(400,{ok:false,error:'Invalid account id.'});
      const rawAccount=rawAccounts.find(a=>String(a.id)===id);
      if(!rawAccount)return reply(404,{ok:false,error:'Account is not available in this Myfxbook profile.'});
      const errors=[];
      let start=parseMfbDate(rawAccount.firstTradeDate)||parseMfbDate(rawAccount.creationDate)||new Date(Date.now()-365*86400000);
      start=new Date(start.getTime()-2*86400000);
      const [historyData,openData,dailyData]=await Promise.all([
        safeMfb('get-history',{session,id},'History',errors),
        safeMfb('get-open-trades',{session,id},'Open trades',errors),
        safeMfb('get-data-daily',{session,id,start:yyyyMmDd(start),end:yyyyMmDd(new Date())},'Daily data',errors)
      ]);
      return reply(200,{ok:true,account:publicAccount(rawAccount),connectionToken:refreshedConnection,history:historyData.history||[],openTrades:openData.openTrades||[],daily:dailyData.dataDaily||[],partialErrors:errors});
    });
  }catch(err){
    console.error('Accounts proxy error:',err&&err.message?err.message:err);
    return reply(err&&err.status?err.status:500,{ok:false,error:err&&err.message?err.message:'Accounts proxy failed.',code:err&&err.code?err.code:undefined});
  }
};

exports.handler=event=>budget.run(async()=>{try{return await handler(event);}catch(_){return {statusCode:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({ok:false,error:'Accounts security configuration is invalid.',code:'SECURITY_CONFIG'})};}});
