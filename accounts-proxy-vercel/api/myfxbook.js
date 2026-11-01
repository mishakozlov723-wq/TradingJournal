'use strict';

const security = require('../lib/security');
const {sealCredentials,openCredentials}=security;

const budget=require('../lib/request-budget'),connectionState=require('../lib/connection-state');

const MYFXBOOK_API = 'https://www.myfxbook.com/api';
const IDENTITY_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

function setCors(req,res){ Object.entries(security.cors(req.headers)).forEach(([key,value])=>res.setHeader(key,value)); }
function send(req,res,status,body){ setCors(req,res); return res.status(status).json(body); }
function bearer(headers){
  const raw=(headers && (headers.authorization || headers.Authorization)) || '';
  const m=String(raw).match(/^Bearer\s+(.+)$/i); return m ? m[1] : '';
}
function connectionHeader(headers){
  return String((headers && (headers['x-tj-accounts-connection'] || headers['X-TJ-Accounts-Connection'])) || '').trim();
}
async function verifyFirebaseUser(idToken){
  const key=String(process.env.FIREBASE_WEB_API_KEY||'').trim();
  if(!key) throw Object.assign(new Error('Server configuration is missing FIREBASE_WEB_API_KEY.'),{status:500});
  let response;
  try {
    response=await budget.request(IDENTITY_LOOKUP+'?key='+encodeURIComponent(key),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken}),
      signal:AbortSignal.timeout(5000)
    });
  } catch(err){
    throw Object.assign(new Error('Firebase did not answer in 5 s while checking your session.'),{status:504,code:'FIREBASE_TIMEOUT'});
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.users || !data.users[0]) throw Object.assign(new Error('Firebase session is not valid.'),{status:401,code:'FIREBASE_AUTH'});
  const user=data.users[0];

  // v3.24+ is multi-user by default. Set ACCOUNTS_ENFORCE_ALLOWLIST=1 only if you
  // intentionally want to restrict Accounts to ALLOWED_FIREBASE_UIDS.
  if(String(process.env.ACCOUNTS_ENFORCE_ALLOWLIST||'')==='1'){
    const allow=String(process.env.ALLOWED_FIREBASE_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!allow.length) throw Object.assign(new Error('Server configuration is missing ALLOWED_FIREBASE_UIDS.'),{status:500});
    if(!allow.includes(user.localId)) throw Object.assign(new Error('This Firebase account is not allowed to open trading accounts.'),{status:403});
  }
  return user;
}
async function mfb(method,params){
  const qs=new URLSearchParams();
  Object.entries(params||{}).forEach(([k,v])=>{ if(v!==undefined && v!==null) qs.set(k,String(v)); });
  let response;
  try {
    response=await budget.request(MYFXBOOK_API+'/'+method+'.json?'+qs.toString(),{
      headers:{'Accept':'application/json','User-Agent':'TradingJournal-Accounts/2.0'},cache:'no-store'
    },12000);
  } catch(err){
    // Fail fast with a readable message instead of hanging until the browser gives up.
    throw Object.assign(new Error('Myfxbook did not answer within its time budget ('+method+'). Try again in a minute.'),{status:504,code:'MYFXBOOK_TIMEOUT'});
  }
  const text=await response.text(); let data;
  try { data=JSON.parse(text); } catch(_) { throw new Error('Myfxbook returned an invalid response.'); }
  if(!response.ok) throw new Error('Myfxbook HTTP '+response.status+'.');
  if(data && data.error) throw new Error(data.message || ('Myfxbook '+method+' failed.'));
  return data || {};
}
async function safeMfb(method,params,label,errors){
  try { return await mfb(method,params); } catch(err){ errors.push(label+': '+err.message); return {}; }
}
function yyyyMmDd(date){ return date.toISOString().slice(0,10); }
function parseMfbDate(value){
  const m=String(value||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return null;
  const d=new Date(Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}
function publicAccount(a){
  if(!a) return null;
  return {
    id:a.id,name:a.name||'',description:a.description||'',accountId:a.accountId,gain:a.gain,absGain:a.absGain,daily:a.daily,monthly:a.monthly,
    withdrawals:a.withdrawals,deposits:a.deposits,interest:a.interest,profit:a.profit,balance:a.balance,drawdown:a.drawdown,equity:a.equity,
    equityPercent:a.equityPercent,demo:a.demo,lastUpdateDate:a.lastUpdateDate,creationDate:a.creationDate,firstTradeDate:a.firstTradeDate,
    commission:a.commission,currency:a.currency,profitFactor:a.profitFactor,pips:a.pips,server:a.server&&a.server.name?{name:a.server.name}:null
  };
}
async function withCredentialsSession(credentials,run){
  const login=await mfb('login',{email:credentials.email,password:credentials.password});
  if(!login.session) throw new Error('Myfxbook did not create a session.');
  try { return await run(login.session); }
  finally { try { await mfb('logout',{session:login.session}); } catch(_){} }
}
async function readJsonBody(req){
  if(req.body && typeof req.body==='object') return req.body;
  if(typeof req.body==='string'){
    try { return JSON.parse(req.body||'{}'); } catch(_) { return {}; }
  }
  return {};
}
async function listAccounts(session){
  const accountData=await mfb('get-my-accounts',{session});
  const rawAccounts=Array.isArray(accountData.accounts)?accountData.accounts:[];
  return {rawAccounts,accounts:rawAccounts.map(publicAccount)};
}

async function handler(req,res){
  if(!security.originAllowed(req.headers))return res.status(403).json({ok:false,error:'Origin is not allowed.',code:'ORIGIN_DENIED'});
  if(req.method==='OPTIONS'){ setCors(req,res); return res.status(204).end(); }
  if(req.method!=='GET' && req.method!=='POST') return send(req,res,405,{ok:false,error:'Method not allowed.'});
  try {
    const token=bearer(req.headers);
    if(!token) return send(req,res,401,{ok:false,error:'Firebase authorization is required.',code:'FIREBASE_AUTH'});
    const user=await verifyFirebaseUser(token);
    const action=String((req.query&&req.query.action)||'accounts').toLowerCase();

    if(req.method==='POST' && action==='connect'){
      const body=await readJsonBody(req);
      const email=String(body.email||'').trim();
      const password=String(body.password||'');
      if(!email || !password) return send(req,res,400,{ok:false,error:'Enter the Myfxbook email and password.',code:'CONNECT_INPUT'});
      const result=await withCredentialsSession({email,password},async session=>{
        const listed=await listAccounts(session);
        return {connectionToken:sealCredentials(user.localId,email,password,await connectionState.generation(user.localId)),accounts:listed.accounts};
      });
      return send(req,res,200,{ok:true,connectionToken:result.connectionToken,accounts:result.accounts});
    }

    if(req.method==='POST' && action==='disconnect'){
      await connectionState.revoke(user.localId);
      return send(req,res,200,{ok:true,revoked:true});
    }

    if(req.method!=='GET') return send(req,res,405,{ok:false,error:'Method not allowed.'});

    const encryptedConnection=connectionHeader(req.headers);
    if(!encryptedConnection) return send(req,res,428,{ok:false,error:'Connect Myfxbook for this Trading Journal user first.',code:'MYFXBOOK_NOT_CONNECTED'});
    const credentials=openCredentials(encryptedConnection,user.localId);
    if(credentials.generation!==await connectionState.generation(user.localId))throw Object.assign(new Error('Myfxbook connection was revoked. Reconnect.'),{status:401,code:'CONNECTION_INVALID'});

    const refreshedConnection=credentials.legacy?sealCredentials(user.localId,credentials.email,credentials.password,credentials.generation,credentials.iat):undefined;

    return await withCredentialsSession(credentials,async session=>{
      const listed=await listAccounts(session);
      const rawAccounts=listed.rawAccounts, accounts=listed.accounts;
      if(action==='accounts') return send(req,res,200,{ok:true,accounts,connectionToken:refreshedConnection});
      if(action!=='details') return send(req,res,400,{ok:false,error:'Unknown action.'});
      const id=String((req.query&&req.query.id)||'').trim();
      if(!/^\d+$/.test(id)) return send(req,res,400,{ok:false,error:'Invalid account id.'});
      const rawAccount=rawAccounts.find(a=>String(a.id)===id);
      if(!rawAccount) return send(req,res,404,{ok:false,error:'Account is not available in this Myfxbook profile.'});
      const errors=[];
      let start=parseMfbDate(rawAccount.firstTradeDate)||parseMfbDate(rawAccount.creationDate)||new Date(Date.now()-365*86400000);
      start=new Date(start.getTime()-2*86400000);
      const [historyData,openData,dailyData]=await Promise.all([
        safeMfb('get-history',{session,id},'History',errors),
        safeMfb('get-open-trades',{session,id},'Open trades',errors),
        safeMfb('get-data-daily',{session,id,start:yyyyMmDd(start),end:yyyyMmDd(new Date())},'Daily data',errors)
      ]);
      return send(req,res,200,{ok:true,account:publicAccount(rawAccount),connectionToken:refreshedConnection,history:historyData.history||[],openTrades:openData.openTrades||[],daily:dailyData.dataDaily||[],partialErrors:errors});
    });
  } catch(err){
    console.error('Accounts proxy error:',err&&err.message?err.message:err);
    return send(req,res,err&&err.status?err.status:500,{ok:false,error:err&&err.message?err.message:'Accounts proxy failed.',code:err&&err.code?err.code:undefined});
  }
};

module.exports=(req,res)=>budget.run(async()=>{try{return await handler(req,res);}catch(_){return res.status(503).json({ok:false,error:'Accounts security configuration is invalid.',code:'SECURITY_CONFIG'});}});
