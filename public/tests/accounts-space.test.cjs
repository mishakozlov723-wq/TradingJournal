const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const html = require('./assembled-html.cjs')();
const front = fs.readFileSync(path.join(root, 'public', 'accounts-space.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'public', 'accounts-config.js'), 'utf8');
const proxyPath = path.join(root, 'accounts-proxy', 'netlify', 'functions', 'myfxbook.js');

function jsonResponse(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json(){ return obj; }, async text(){ return JSON.stringify(obj); } };
}

function installEnv() {
  process.env.MYFXBOOK_EMAIL = 'legacy-owner@example.test';
  process.env.MYFXBOOK_PASSWORD = 'server-encryption-root';
  process.env.FIREBASE_WEB_API_KEY = 'firebase-public-key';
  process.env.ALLOWED_FIREBASE_UIDS = 'owner-uid';
  delete process.env.ACCOUNTS_ENFORCE_ALLOWLIST;
  delete process.env.ACCOUNTS_CREDENTIAL_SECRET;
  process.env.ALLOWED_ORIGIN = 'https://journal.example.test';
}

function freshProxy() {
  delete require.cache[require.resolve(proxyPath)];
  return require(proxyPath);
}

function event(method, action, token='firebase-user-1', extra={}) {
  return {
    httpMethod: method,
    headers: Object.assign({authorization:'Bearer '+token}, extra.headers||{}),
    queryStringParameters: Object.assign({action}, extra.query||{}),
    body: extra.body === undefined ? undefined : JSON.stringify(extra.body)
  };
}

test('Accounts workspace is multi-user and contains no public Myfxbook credentials', () => {
  assert.match(html, /id="openAccountsWorkspaceBtn"/);
  assert.match(html, /id="accountsWorkspace"/);
  assert.match(html, /id="accountsMyfxEmailInput"/);
  assert.match(html, /id="accountsMyfxPasswordInput"/);
  assert.match(front, /accCanUseAccounts/);
  assert.doesNotMatch(front, /accIsOwner/);
  assert.doesNotMatch(front, /MYFXBOOK_PASSWORD\s*=/i);
  assert.doesNotMatch(config, /password\s*:\s*['"][^'"]+/i);
  assert.doesNotMatch(html, /legacy-owner@example\.test/);
  assert.doesNotMatch(html, /server-encryption-root/);
  new Function(front);
});

test('Proxy rejects calls without Firebase authorization', async () => {
  installEnv();
  global.fetch = async () => { throw new Error('fetch must not run'); };
  const {handler} = freshProxy();
  const res = await handler({httpMethod:'GET',headers:{},queryStringParameters:{action:'accounts'}});
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('Connect creates an encrypted UID-bound token and returns sanitized accounts', async () => {
  installEnv();
  const calls=[];
  global.fetch = async (url) => {
    calls.push(String(url));
    const u=String(url);
    if(u.startsWith('https://identitytoolkit.googleapis.com/')) return jsonResponse({users:[{localId:'user-1',email:'journal@example.test'}]});
    if(u.includes('/login.json')) {
      assert.match(u, /email=user1%40example\.test/);
      assert.match(u, /password=user-one-password/);
      return jsonResponse({error:false,session:'session-1'});
    }
    if(u.includes('/get-my-accounts.json')) return jsonResponse({error:false,accounts:[{
      id:123,name:'FundedNext 1',accountId:555,gain:-2.1,profit:-209.8,balance:9790.2,equity:9790.2,currency:'USD',
      invitationUrl:'must-not-leak',server:{name:'FundedNext-Server'},lastUpdateDate:'09/28/2026 17:00',demo:true
    }]});
    if(u.includes('/logout.json')) return jsonResponse({error:false});
    throw new Error('Unexpected URL '+u);
  };
  const {handler} = freshProxy();
  const res = await handler(event('POST','connect','firebase-user-1',{body:{email:'user1@example.test',password:'user-one-password'}}));
  assert.equal(res.statusCode, 200);
  const body=JSON.parse(res.body);
  assert.equal(body.ok,true);
  assert.equal(body.accounts[0].name,'FundedNext 1');
  assert.equal(body.accounts[0].invitationUrl,undefined);
  assert.match(body.connectionToken,/^v1\./);
  assert.doesNotMatch(body.connectionToken,/user1@example\.test|user-one-password/);
  assert.ok(calls.some(u=>u.includes('/logout.json')));
});

test('Connection token cannot be replayed by another Firebase user', async () => {
  installEnv();
  let identityUid='user-1';
  global.fetch = async (url) => {
    const u=String(url);
    if(u.startsWith('https://identitytoolkit.googleapis.com/')) return jsonResponse({users:[{localId:identityUid}]});
    if(u.includes('/login.json')) return jsonResponse({error:false,session:'s'});
    if(u.includes('/get-my-accounts.json')) return jsonResponse({error:false,accounts:[]});
    if(u.includes('/logout.json')) return jsonResponse({error:false});
    throw new Error('Unexpected URL '+u);
  };
  const {handler}=freshProxy();
  const connected=await handler(event('POST','connect','token-1',{body:{email:'a@b.test',password:'secret'}}));
  const connectionToken=JSON.parse(connected.body).connectionToken;
  identityUid='user-2';
  const res=await handler(event('GET','accounts','token-2',{headers:{'x-tj-accounts-connection':connectionToken}}));
  assert.equal(res.statusCode,401);
  assert.equal(JSON.parse(res.body).code,'CONNECTION_INVALID');
});

test('Authenticated users no longer require the old owner UID allowlist', async () => {
  installEnv();
  process.env.ALLOWED_FIREBASE_UIDS='owner-uid-only';
  global.fetch = async (url) => {
    const u=String(url);
    if(u.startsWith('https://identitytoolkit.googleapis.com/')) return jsonResponse({users:[{localId:'different-user'}]});
    if(u.includes('/login.json')) return jsonResponse({error:false,session:'s'});
    if(u.includes('/get-my-accounts.json')) return jsonResponse({error:false,accounts:[]});
    if(u.includes('/logout.json')) return jsonResponse({error:false});
    throw new Error('Unexpected URL '+u);
  };
  const {handler}=freshProxy();
  const res=await handler(event('POST','connect','token-x',{body:{email:'x@y.test',password:'pw'}}));
  assert.equal(res.statusCode,200);
});

test('Details endpoint uses the encrypted connection and returns history/open trades/daily data', async () => {
  installEnv();
  let stage='connect';
  global.fetch = async (url) => {
    const u=String(url);
    if(u.startsWith('https://identitytoolkit.googleapis.com/')) return jsonResponse({users:[{localId:'user-1'}]});
    if(u.includes('/login.json')) return jsonResponse({error:false,session:'s'});
    if(u.includes('/get-my-accounts.json')) return jsonResponse({error:false,accounts:[{id:123,name:'FundedNext 1',accountId:555,balance:9790.2,equity:9790.2,currency:'USD',firstTradeDate:'07/20/2026 08:00',server:{name:'FundedNext-Server'}}]});
    if(u.includes('/get-history.json')) return jsonResponse({error:false,history:[{openTime:'09/01/2026 10:00',closeTime:'09/02/2026 10:00',symbol:'EURUSD',action:'Buy',profit:50,pips:20,sizing:{type:'lots',value:.5}}]});
    if(u.includes('/get-open-trades.json')) return jsonResponse({error:false,openTrades:[{openTime:'09/28/2026 10:00',symbol:'GBPUSD',action:'Buy',profit:4,pips:2,sizing:{type:'lots',value:.2}}]});
    if(u.includes('/get-data-daily.json')) return jsonResponse({error:false,dataDaily:[[{date:'09/27/2026',balance:9786.2,floatingPL:0},{date:'09/28/2026',balance:9790.2,floatingPL:4}]]});
    if(u.includes('/logout.json')) return jsonResponse({error:false});
    throw new Error('Unexpected URL '+u);
  };
  const {handler}=freshProxy();
  const connected=await handler(event('POST','connect','token',{body:{email:'x@y.test',password:'pw'}}));
  const ct=JSON.parse(connected.body).connectionToken;
  const res=await handler(event('GET','details','token',{query:{id:'123'},headers:{'x-tj-accounts-connection':ct}}));
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.history.length,1);
  assert.equal(body.openTrades.length,1);
  assert.ok(Array.isArray(body.daily));
});

test('Frontend stores an opaque connection token per Firebase UID, not Myfxbook email/password', () => {
  assert.match(front,/tjMyfxbookConnectionV1:/);
  assert.match(front,/X-TJ-Accounts-Connection/);
  assert.doesNotMatch(front,/localStorage\.(?:setItem|getItem)\([^\n]*(?:MyfxEmail|MyfxPassword|password|email)/i);
});


test('Account statistic tiles open a Russian explanatory dialog with the current metric value', () => {
  assert.match(html, /id="accountsStatInfoOverlay"/);
  assert.match(html, /id="accountsStatInfoValue"/);
  assert.match(front, /ACCOUNTS_STAT_INFO/);
  assert.match(front, /data-stat-key=/);
  assert.match(front, /accOpenStatInfo/);
  assert.match(front, /\+12 000 pips не означает \+\$12 000/);
  assert.match(front, /Средний чистый результат одной прибыльной закрытой сделки/);
});


test('Switching accounts never renders stale detail data from the previous account', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'accounts-space.css'), 'utf8');
  assert.match(front, /detailRequestSeq/);
  assert.match(front, /requestSeq!==accountsState\.detailRequestSeq/);
  assert.match(front, /accountsState\.selectedId!==id/);
  assert.match(front, /accPrepareDetailSwitch/);
  assert.match(front, /is-account-switch/);
  assert.match(css, /\.accounts-detail-content\.is-account-switch\s*\{\s*display:none;/);
});
