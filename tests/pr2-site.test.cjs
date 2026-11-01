'use strict';
// PR2: site, Backtests and Replay fixes (items 9, 11, 13-23).
const {test}=require('node:test'),assert=require('node:assert/strict'),{load,source}=require('./audit-source.cjs');
const app='public/app.js',replay='public/replay-space.js';

test('9 streak popup is shown only to the journal owner',()=>{
  let shown=0;
  const c=load(app,['maybeShowStreakToast'],{computeStreakBreak:()=>({type:'win',tradeId:'t',count:3}),breakAck:{},showStreakBreakCelebration:()=>shown++,trades:[]});
  c.currentUser={login:'admin'};c.viewingUser='student';c.maybeShowStreakToast();
  assert.equal(shown,0);
  c.currentUser={login:'student'};c.maybeShowStreakToast();
  assert.equal(shown,1);
});

test('11 model purge queries only the affected trades in server-side chunks',()=>{
  const s=source(app);
  assert.match(s,/where\('uid', ?'==', ?owner\.uid\)\.where\('modelId', ?'in', ?chunk\)/);
});

test('13 open tabs follow a new month/year unless the user navigated away',()=>{
  const ctx={Date,render(){ctx.renders++;},renders:0,currentUser:{login:'u'},monthlyYear:2025,monthlySelectedMonth:null,weeklyYear:2025,weeklySelected:{month:3,week:1},
    calendarYear:2025,calendarMonth:11,calendarBrowse:{year:2025,month:11,level:'days'},tjPeriodToday:{year:2025,month:11}};
  const c=load(app,['tjFollowTodayPeriods'],ctx);
  c.Date=class extends Date{constructor(...a){super(...(a.length?a:[2026,0,1,0,1]));}};
  assert.equal(c.tjFollowTodayPeriods(),true);
  assert.equal(c.monthlyYear,2026);
  assert.equal(c.weeklyYear,2025,'an explicit week selection is kept');
  assert.equal(c.calendarYear,2026);assert.equal(c.calendarMonth,0);assert.equal(c.calendarBrowse.month,0);
  assert.equal(c.renders,1);
  assert.equal(c.tjFollowTodayPeriods(),false,'nothing changes twice');
});

test('14 RR/days input is debounced and flushed on blur',()=>{
  const s=source(app);
  assert.match(s,/TJ_BACKTEST_RR_DEBOUNCE_MS = 500/);
  assert.match(s,/function flushBacktestRRDraft\(/);
  assert.match(s,/addEventListener\('blur', ?commitBacktestRRDraft/);
});

test('16 zero result is neutral and the calendar streak skips days without trades',()=>{
  const c=load(app,['tjResultTone','tjCalendarStreaks'],{Date,Number,Math,Object,
    tradeStatsDate:t=>new Date(t.d+'T12:00:00'),tradeGainPercent:t=>t.g});
  assert.equal(c.tjResultTone(0),'flat');assert.equal(c.tjResultTone(-0.0000000001),'flat');
  assert.equal(c.tjResultTone(0.5),'pos');assert.equal(c.tjResultTone(-1),'neg');
  // Fri 30 Jan, (weekend), Mon 2 Feb, Tue 3 Feb profitable; Wed 4 Feb flat breaks; Thu 5 Feb profitable
  const list=[{d:'2026-01-30',g:1},{d:'2026-02-02',g:1},{d:'2026-02-03',g:.5},{d:'2026-02-03',g:.2},{d:'2026-02-04',g:0},{d:'2026-02-05',g:2}];
  assert.deepEqual({...c.tjCalendarStreaks(list,2026,1)},{current:1,best:3});
  assert.deepEqual({...c.tjCalendarStreaks(list.slice(0,4),2026,1)},{current:3,best:3},'streak crosses the month boundary and the weekend');
});

test('18 export file names keep non-Latin letters',()=>{
  const c=load(app,['tjExportFileName'],{String});
  assert.equal(c.tjExportFileName('Мой бэктест: Лондон/NY'),'Мой_бэктест_Лондон_NY');
  assert.equal(c.tjExportFileName('***'),'backtest');
  assert.match(source(app),/tjNotice\('export', ?'error'/);
});

test('19 password change errors are specific; blocked storage does not break sign-in',()=>{
  const c=load(app,['tjPasswordChangeError'],{});
  assert.match(c.tjPasswordChangeError({code:'auth/requires-recent-login'}),/logged in recently/);
  assert.match(c.tjPasswordChangeError({code:'auth/weak-password'}),/too weak/);
  assert.match(c.tjPasswordChangeError({code:'auth/network-request-failed'}),/internet/);
  assert.doesNotMatch(c.tjPasswordChangeError({code:'auth/too-many-requests'}),/internet/);
  const html=source('public/index.html');
  assert.match(html,/tjStorageUnavailable/);
  assert.ok(html.indexOf('tjStorageUnavailable')<html.indexOf('firebase-app-compat.js'),'storage shim runs before any app script');
});

test('17 trade thumbnails are small; full image is used for big views',()=>{
  const s=source('public/trade-media.js');
  assert.match(s,/THUMB_MAX ?= ?420/);
  assert.match(s,/function shrinkLegacy\(/);
  assert.match(s,/function sharpen\(/);
});

test('21 external scripts are pinned with SRI and a CSP is present',()=>{
  const html=source('public/index.html');
  const ext=[...html.matchAll(/<script[^>]*src="https:[^"]*"[^>]*>/g)].map(m=>m[0]);
  assert.equal(ext.length,3);
  ext.forEach(tag=>{assert.match(tag,/integrity="sha384-[A-Za-z0-9+/=]{64}"/,tag);assert.match(tag,/crossorigin="anonymous"/,tag);});
  const csp=(html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)||[])[1];
  assert.ok(csp,'CSP meta tag');
  assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'),'CSP comes before the first script');
  for(const part of ["object-src 'none'","base-uri 'self'","script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com",
    'https://*.googleapis.com','https://trading-journal-accounts-proxy.vercel.app','https://retocker-replay-quotes.web.app','connect-src \'self\' data:'])
    assert.ok(csp.includes(part),part);
  // every external endpoint the code talks to must be allowed by connect-src
  const cfg=source('public/accounts-config.js')+source('public/replay-data-config.js');
  for(const origin of new Set([...cfg.matchAll(/https:\/\/[a-z0-9.-]+/g)].map(m=>m[0]))) assert.ok(csp.includes(origin),origin);
  assert.match(source(app),/sc\.integrity = TJ_HTML2CANVAS_SRI/);
});

function bar(O,H,L){return {T:[0,100],D:[0,100],O:[0,O],H:[0,H],L:[0,L],C:[0,O],dp:2};}
function run(p,b){
  const done=[];const s={pos:[p],d:b};
  const c=load(replay,['gapFill','processBar'],{S:{sess:s},isFinite,Math,rnd:x=>x,fp:String,sgnR:String,
    finishTrade:(pos,exit,reason)=>{done.push({exit,reason,r:pos.dir*(exit-pos.entry)/pos.risk0});s.pos=[];return 0;}});
  c.processBar(1);return {p,done};
}
test('22 gaps: stop entries and stop losses fill at the bar open, levels hit inside the bar fill at the level',()=>{
  // long stop order at 100 (SL 95), bar opens at 104 -> filled at 104, R measured on planned risk (5)
  let h=run({dir:1,kind:'stop',status:'pending',entry:100,sl:95,tp:120},bar(104,106,103));
  assert.equal(h.p.entry,104);assert.equal(h.p.plannedEntry,100);assert.equal(h.p.risk0,5);assert.equal(h.done.length,0);
  // the same order touched inside the bar -> exact level
  h=run({dir:1,kind:'stop',status:'pending',entry:100,sl:95,tp:120},bar(99,101,98));
  assert.equal(h.p.entry,100);assert.equal(h.p.plannedEntry,undefined);
  // open long, price gaps below the stop -> exit at the open, worse than -1R
  h=run({dir:1,status:'open',entry:100,sl:95,tp:120,risk0:5},bar(90,92,88));
  assert.deepEqual(h.done.map(x=>[x.exit,x.reason,x.r]),[[90,'SL',-2]]);
  // open short, price gaps above the stop
  h=run({dir:-1,status:'open',entry:100,sl:105,tp:80,risk0:5},bar(110,111,109));
  assert.deepEqual(h.done.map(x=>[x.exit,x.reason,x.r]),[[110,'SL',-2]]);
  // stop touched inside the bar -> exactly -1R
  h=run({dir:1,status:'open',entry:100,sl:95,tp:120,risk0:5},bar(97,98,94));
  assert.deepEqual(h.done.map(x=>[x.exit,x.r]),[[95,-1]]);
});
test('22 gaps: targets and limit entries get the better open price; both levels inside a bar stay conservative',()=>{
  let h=run({dir:1,status:'open',entry:100,sl:95,tp:110,risk0:5},bar(113,115,112));
  assert.deepEqual(h.done.map(x=>[x.exit,x.reason,x.r]),[[113,'TP',2.6]]);
  h=run({dir:1,kind:'limit',status:'pending',entry:100,sl:95,tp:120},bar(98,99,97));
  assert.equal(h.p.entry,98);
  h=run({dir:-1,kind:'limit',status:'pending',entry:100,sl:105,tp:80},bar(102,103,101));
  assert.equal(h.p.entry,102);
  // limit long gapping below its own stop: filled at the open and stopped at the open (0R, no phantom loss/profit)
  h=run({dir:1,kind:'limit',status:'pending',entry:100,sl:95,tp:120},bar(90,91,89));
  assert.deepEqual(h.done.map(x=>[x.exit,x.reason,x.r]),[[90,'SL',0]]);
  // SL and TP both inside one bar without a gap -> stop first (unchanged behaviour)
  h=run({dir:1,status:'open',entry:100,sl:95,tp:110,risk0:5},bar(100,111,94));
  assert.deepEqual(h.done.map(x=>x.reason),['SL']);
});
test('22 trades sent to Backtests use the chart time zone',()=>{
  const c=load(replay,['pad','tzById','tzParts','dtStr'],{Intl,Date,Math,TZS:[{id:'UTC',zone:'UTC'},{id:'NY',zone:'America/New_York'},{id:'MSK',zone:'Europe/Moscow'}],tzFmt:{},
    S:{tz:'UTC'},clampT:t=>t});
  const ts=Date.UTC(2026,0,15,14,30)/1000;
  assert.equal(c.dtStr(ts),'2026-01-15T14:30');
  c.S.tz='NY';assert.equal(c.dtStr(ts),'2026-01-15T09:30');
  c.S.tz='MSK';assert.equal(c.dtStr(ts),'2026-01-15T17:30');
});

test('23 proxy setup documents every variable the code reads',()=>{
  for(const dir of ['accounts-proxy','accounts-proxy-vercel']){
    const docs=source(dir+'/README.md')+source(dir+'/.env.example');
    for(const name of ['FIREBASE_WEB_API_KEY','ACCOUNTS_CREDENTIAL_SECRET','FIREBASE_SERVICE_ACCOUNT','ALLOWED_ORIGIN','FIREBASE_PROJECT_ID','ACCOUNTS_ENFORCE_ALLOWLIST','ALLOWED_FIREBASE_UIDS'])
      assert.ok(docs.includes(name),dir+': '+name);
  }
  assert.match(source('accounts-proxy-vercel/.gitignore'),/^!\.env\.example$/m);
  assert.match(source('accounts-proxy-vercel/README.md'),/logs in to Myfxbook, does its work and logs out/);
});
