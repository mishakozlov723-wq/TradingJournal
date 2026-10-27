'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const acorn=require('acorn');
const root=path.join(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function extract(source,name){
 let result;const tree=acorn.parse(source,{ecmaVersion:'latest'});
 function visit(n){if(!n||typeof n!=='object'||result)return;
  if(n.type==='FunctionDeclaration'&&n.id?.name===name)result=source.slice(n.start,n.end);
  if(n.type==='Property'&&n.key?.name===name&&n.value.type==='FunctionExpression')result=source.slice(n.value.start,n.value.end);
  for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}
 }visit(tree);assert.ok(result,'function exists: '+name);return result;
}
const replay=read('public/replay-space.js');
function replayFixture(mode){
 const S={sess:{closed:[{id:'a',r:2,hid:false},{id:'b',r:-1,hid:true}]}};
 const messages=[],saved=[];const bridge={patchTrade(id){if(mode==='throw')throw Error('quota');return mode==='ok'||mode==='partial'&&id==='a';},deleteTrade(){if(mode==='throw')throw Error('quota');return mode==='ok';}};
 const c={S,bridge:()=>bridge,toast:(text,kind)=>messages.push({text,kind}),saveSession:()=>saved.push(1),renderTrade(){},requestDraw(){},sgnR:String};vm.createContext(c);
 for(const n of ['hideClosed','unhideAll','deleteClosed'])vm.runInContext(extract(replay,n),c);
 return {c,S,messages,saved};
}
for(const mode of ['fail','throw'])test('Replay keeps chart state when durable persistence '+mode+'s',()=>{
 const {c,S,messages,saved}=replayFixture(mode);assert.equal(c.hideClosed('a'),false);assert.equal(S.sess.closed[0].hid,false);
 assert.equal(c.deleteClosed('a'),false);assert.equal(S.sess.closed.length,2);c.unhideAll();assert.equal(S.sess.closed[1].hid,true);
 assert.equal(saved.length,0);assert.ok(messages.every(m=>m.kind==='warn'));assert.ok(messages.every(m=>!/permanently/.test(m.text)));
});
test('Replay applies accepted operations and only unhides accepted records',()=>{
 const f=replayFixture('ok');assert.equal(f.c.hideClosed('a'),true);assert.equal(f.S.sess.closed[0].hid,true);f.c.unhideAll();assert.ok(f.S.sess.closed.every(t=>!t.hid));assert.equal(f.c.deleteClosed('a'),true);assert.equal(f.S.sess.closed.length,1);assert.ok(!f.messages.at(-1).text.includes('permanently'));
 const p=replayFixture('partial');p.S.sess.closed[0].hid=true;p.c.unhideAll();assert.equal(p.S.sess.closed[0].hid,false);assert.equal(p.S.sess.closed[1].hid,true);
});
test('Replay risk rejects malformed and unsupported numbers without silently defaulting',()=>{
 let value='';const c={$:()=>({value})};vm.createContext(c);vm.runInContext(extract(replay,'readRisk'),c);
 for(const v of ['',' ','101','-1','Infinity','1abc','1,2,3']){value=v;assert.equal(c.readRisk(),null,v);}
 for(const [v,want]of [['0',0],['100',100],['1,5',1.5],[' 2 ',2]]){value=v;assert.equal(c.readRisk(),want);}
});
const index=read('public/index.html');const bridgeScript=[...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('window.TJReplayBridge ='))[1];
test('Replay bridge returns an explicit durable queue acknowledgement for deletion',()=>{
 const source=extract(bridgeScript,'deleteTrade');
 for(const queued of [false,true]){
  const c={allBacktestTrades:[{id:'a',backtestId:'bt'}],backtests:[{id:'bt',rrText:'2'}],viewingUser:'alice',tjDataGeneration:1,
   tjDeleteBacktestRecords:()=>Promise.resolve(),tjBacktestOutbox:()=>queued?[{parts:[[{collection:'backtestTrades',id:'a',remove:true}]]}]:[],showBacktestSyncError(){},saveBacktestLocal(){},persist(){return true;}};
  vm.createContext(c);const fn=vm.runInContext('('+source+')',c);assert.equal(fn.call({syncRR(){}},'a'),queued);assert.equal(c.allBacktestTrades.length,queued?0:1);assert.equal(fn.call({syncRR(){}},'missing'),false);
 }
});
test('Replay bridge refuses unsupported numbers before any write',()=>{
 let writes=0;const c={allBacktestTrades:[],backtests:[{id:'bt',startDate:'2026-01-01',endDate:'2026-12-31'}],owner:()=>({uid:'u'}),applyTradeModel(){},persist(){writes++;return true},saveBacktestLocal(){},Number,Date,Math};vm.createContext(c);
 const fn=vm.runInContext('('+extract(bridgeScript,'addTrade')+')',c),self={syncRR(){}};
 for(const t of [{r:1000001,riskPercent:1},{r:1,riskPercent:101},{r:Infinity,riskPercent:1},{r:1,riskPercent:-1}])assert.equal(fn.call(self,'bt',t),null);
 assert.equal(writes,0);assert.ok(fn.call(self,'bt',{r:-2,riskPercent:1,openDT:'2026-01-02T10:00',closeDT:'2026-01-02T11:00'}));assert.equal(writes,1);
});
const {createUpdateController}=require('../../desktop/lifecycle/controller.js');
function updaterFixture(){const updater=new EventEmitter();let reveals=0,dismisses=0;const flow=createUpdateController({updater,currentVersion:'1.3.13',publish(){},reveal(){reveals++},dismiss(){dismisses++},prepareQuit(){}});return {updater,flow,counts:()=>({reveals,dismisses})};}
test('no available update completes quietly and concurrent checks coalesce',async()=>{
 const f=updaterFixture();let calls=0,release;f.updater.checkForUpdates=()=>{calls++;return new Promise(r=>release=r)};
 try{const a=f.flow.check(),b=f.flow.check();await Promise.resolve();assert.equal(calls,1);f.updater.emit('update-not-available',{version:'1.3.13'});release();await Promise.all([a,b]);assert.equal(f.flow.snapshot().phase,'current');assert.equal(f.counts().reveals,0);await f.flow.action('close');assert.equal(f.counts().dismisses,1);
 f.updater.checkForUpdates=async()=>f.updater.emit('update-available',{version:'1.3.14'});await f.flow.check();assert.equal(f.flow.snapshot().phase,'available');assert.equal(f.counts().reveals,1);f.updater.emit('update-not-available',{});assert.equal(f.flow.snapshot().phase,'available');}finally{f.flow.stop();}
});
test('a failed update check can retry to up-to-date; stopped listeners are removed',async()=>{
 const f=updaterFixture();try{f.updater.checkForUpdates=async()=>{throw Error('offline')};await f.flow.check();assert.equal(f.flow.snapshot().phase,'error');f.updater.checkForUpdates=async()=>f.updater.emit('update-not-available',{});await f.flow.action('retry');assert.equal(f.flow.snapshot().phase,'current');assert.equal(f.flow.snapshot().error,'');}finally{f.flow.stop();}assert.equal(f.updater.listenerCount('update-not-available'),0);
});
test('up-to-date renderer is not busy and Done closes the visible window',()=>{
 const elements=new Map(),actions=[];const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(n,fn){this[n]=fn}});return elements.get(id)};
 const c={window:{syterLifecycle:{subscribe(fn){this.render=fn},snapshot:()=>({mode:'update',phase:'current',currentVersion:'1.3.13',version:'1.3.13'}),action:n=>actions.push(n)}},document:{getElementById:get,addEventListener(){}}};vm.createContext(c);vm.runInContext(read('desktop/lifecycle/renderer.js'),c);assert.equal(get('progress-area').hidden,true);assert.equal(get('primary').disabled,false);assert.equal(get('primary').textContent,'Done');assert.equal(get('version').textContent,'1.3.13');get('primary').click();assert.deepEqual(actions,['close']);
});
const budget=require('../../accounts-proxy-vercel/lib/request-budget');
test('request budget preserves caller cancellation and enforces explicit timeout / remaining budget',async()=>{
 const oldFetch=global.fetch,oldTimeout=AbortSignal.timeout,oldNow=Date.now;let times=[],lastSignal,now=100000;
 try{Date.now=()=>now;AbortSignal.timeout=ms=>{times.push(ms);return new AbortController().signal};global.fetch=async(_url,opts)=>{lastSignal=opts.signal;return {ok:true}};
  const caller=new AbortController();await budget.run(()=>budget.request('https://local.invalid',{signal:caller.signal},12000));assert.equal(times.at(-1),12000);assert.equal(lastSignal.aborted,false);caller.abort();assert.equal(lastSignal.aborted,true);
  await budget.run(async()=>{now+=24000;await budget.request('https://local.invalid',{},12000)});assert.equal(times.at(-1),1000);
  await assert.rejects(budget.run(async()=>{now+=25001;await budget.request('https://local.invalid')}),e=>e.status===504&&e.code==='ACCOUNTS_TIMEOUT');
  global.fetch=async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})};await assert.rejects(budget.run(()=>budget.request('https://local.invalid')),e=>e.code==='ACCOUNTS_TIMEOUT');
 }finally{global.fetch=oldFetch;AbortSignal.timeout=oldTimeout;Date.now=oldNow;}
});
test('Myfxbook requests explicitly select a 12-second budget',async()=>{
 const source=read('accounts-proxy-vercel/api/myfxbook.js');let args;const c={URLSearchParams,MYFXBOOK_API:'https://myfxbook.invalid',budget:{request:async(...a)=>{args=a;return {ok:true,status:200,text:async()=>'{"error":false}'}}}};vm.createContext(c);vm.runInContext(extract(source,'mfb'),c);await c.mfb('get-my-accounts',{session:'dummy'});assert.equal(args[2],12000);assert.equal(args[1].signal,undefined);
});

test('runtime asset fingerprints agree with the SHA256 live-release verifier',()=>{
 const crypto=require('node:crypto'),index=read('public/index.html');
 for(const name of ['app.js','app.css','accounts-space.js','notes-workspace.js','replay-space.js','calendar-navigation.js','trade-media.js','trade-media.css','floating-panels.js']){
  const hash=crypto.createHash('sha256').update(read('public/'+name)).digest('hex').slice(0,10);
  assert.ok(index.includes(name+'?v='+hash),name+' SHA256 fingerprint');
 }
});
