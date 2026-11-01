'use strict';
// PR1 (security & data safety): production functions extracted from app.js and
// run against small in-memory doubles. No network, no credentials.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./audit-source.cjs');
const APP='public/app.js';

function storage(){const map=new Map();return {getItem:k=>map.has(k)?map.get(k):null,setItem(k,v){map.set(k,String(v));},removeItem:k=>map.delete(k),keys:()=>[...map.keys()]};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
const plain=x=>JSON.parse(JSON.stringify(x)); // VM-realm objects have foreign prototypes

test('escapeHtml/escapeAttr escape quotes as well as markup',()=>{
  const c=load(APP,['escapeHtml','escapeAttr']);
  for(const f of [c.escapeHtml,c.escapeAttr]){
    assert.equal(f('<img src="x" onerror=\'y\'>&'),'&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;');
    assert.equal(f(null),'');assert.equal(f(undefined),'');assert.equal(f(42),'42');
  }
});

test('Best Trade card keeps a hostile trade id inside its data attribute',()=>{
  const wrap={innerHTML:''},hostile='x" onclick="window.pwned=1" data-y="';
  const c=load(APP,['renderBestCards','escapeAttr','escapeHtml'],{
    document:{getElementById:id=>id==='mdBestWrap'?wrap:null},
    bestTradeOf:()=>({id:hostile,asset:'EURUSD',closeDT:'2026-01-01T10:00'}),bestAssetOf:()=>null,
    tradeGainPercent:()=>1,assetBadge:()=>'',fmtBacktestDate:()=>'1 Jan',bestPctColor:()=>'#fff',fmtPercent:()=>'+1%',assetStatsGridHtml:()=>''
  });
  c.renderBestCards('mdBestWrap',[]);
  assert.ok(wrap.innerHTML.includes('data-best-trade="x&quot; onclick=&quot;window.pwned=1&quot; data-y=&quot;"'));
  assert.ok(!wrap.innerHTML.includes('" onclick="'));
});

function outboxContext(extra={}){
  const auth={uid:'auth-A'},localStorage=storage(),notices=[],sets=[];
  const c=load(APP,['tjTradeOutboxKey','tjTradeOutboxRead','tjTradeOutboxStore','tjTradeOutboxRecord','tjTradeOutboxPut','tjTradeOutboxUpdate','tjTradeOutboxRemove','tjTradeOutboxForget','tjTradeOutboxHas','tjResendPendingTrades','tjClone','tjLoadIsCurrent'],Object.assign({
    TJ_TRADE_OUTBOX_PREFIX:'syter_trade_outbox_v1_',localStorage,console:{warn(){},error(){},info(){}},JSON,Object,Array,String,Number,Date,
    firebase:{auth:()=>({currentUser:auth})},trades:[],tjServerTrades:{},tjPendingTradeSaves:Object.create(null),tjDataGeneration:1,viewingUser:'A',currentUser:{login:'A'},
    normalizeTradeRisk:t=>t,invalidateTradeNumbers(){},render(){},tjShowPendingTradesNotice(){},tjDescribeTrade:t=>'trade '+(t&&t.id),tjErrorReason:e=>' ('+e.message+')',
    tjNotice:(kind,level,message)=>notices.push({kind,level,message}),
    db:{collection:name=>({doc:id=>({set(value,options){const d=deferred();sets.push({name,id,value,options,d});return d.promise;}})})}
  },extra));
  return {c,auth,localStorage,notices,sets};
}

test('trade outbox keeps new trades per signed-in account without image payloads',()=>{
  const {c,auth}=outboxContext(),key=c.tjTradeOutboxKey();
  assert.equal(key,'syter_trade_outbox_v1_auth-A');
  assert.equal(c.tjTradeOutboxPut({id:'t1',uid:'uid-A',user:'A',r:2,chart:'data:image/png;base64,AAAA',_images:[{a:1},{b:2}]},key),true);
  let [entry]=c.tjTradeOutboxRead(key);
  assert.equal(entry.id,'t1');assert.equal(entry.ownerUid,'uid-A');assert.equal(entry.images,2);
  assert.deepEqual(Object.keys(entry.record).sort(),['id','r','uid','user']);
  c.tjTradeOutboxUpdate({id:'t1',uid:'uid-A',r:5},key);[entry]=c.tjTradeOutboxRead(key);assert.equal(entry.record.r,5);
  c.tjTradeOutboxUpdate({id:'unknown',uid:'uid-A',r:1},key);assert.equal(c.tjTradeOutboxRead(key).length,1);
  assert.equal(c.tjTradeOutboxPut({id:'no-owner'},key),false);
  assert.equal(c.tjTradeOutboxHas('t1'),true);
  auth.uid='auth-B';
  assert.equal(c.tjTradeOutboxHas('t1'),false,'another account sees its own outbox only');
  c.tjTradeOutboxForget('t1',key);assert.equal(c.tjTradeOutboxRead(key).length,1,'a rejection under another account keeps the entry');
  auth.uid='auth-A';c.tjTradeOutboxForget('t1',key);assert.equal(c.tjTradeOutboxRead(key).length,0);
});

test('a damaged outbox is left untouched instead of being overwritten',()=>{
  const {c,localStorage}=outboxContext(),key=c.tjTradeOutboxKey();
  for(const damaged of ['{broken','{"not":"a list"}']){
    localStorage.setItem(key,damaged);
    assert.equal(c.tjTradeOutboxRead(key).length,0);
    assert.equal(c.tjTradeOutboxPut({id:'t1',uid:'uid-A',r:1},key),false);
    c.tjTradeOutboxRemove('t1',key);c.tjTradeOutboxUpdate({id:'t1',uid:'uid-A',r:2},key);
    assert.equal(localStorage.getItem(key),damaged);
  }
});

test('after a server load, unacknowledged trades are re-sent under their id; acknowledged ones are dropped',async()=>{
  const {c,notices,sets}=outboxContext(),key=c.tjTradeOutboxKey(),load={generation:1,user:'A',authUser:c.currentUser};
  c.tjTradeOutboxPut({id:'acked',uid:'uid-A',r:1},key);
  c.tjTradeOutboxPut({id:'lost',uid:'uid-A',r:2,_images:[{x:1}]},key);
  c.tjTradeOutboxPut({id:'rejected',uid:'uid-A',r:3},key);
  c.tjTradeOutboxPut({id:'still-sending',uid:'uid-A',r:4},key);
  c.tjTradeOutboxPut({id:'student-B',uid:'uid-B',r:5},key);
  c.tjPendingTradeSaves['still-sending']={images:0};
  c.trades=[{id:'acked',uid:'uid-A',r:1}];
  const resent=c.tjResendPendingTrades('uid-A',{acked:true},load);
  assert.equal(resent,2);
  assert.deepEqual(sets.map(s=>s.id).sort(),['lost','rejected']);
  assert.ok(sets.every(s=>s.name==='trades'&&s.options&&s.options.merge===true&&s.value.uid==='uid-A'));
  assert.deepEqual(c.trades.map(t=>t.id).sort(),['acked','lost','rejected','still-sending']);
  assert.match(notices.find(n=>n.kind==='outbox').message,/2.*Изображения к ним \(1\)/s);
  sets.find(s=>s.id==='lost').d.resolve();
  sets.find(s=>s.id==='rejected').d.reject(Object.assign(Error('permission-denied'),{code:'permission-denied'}));
  await tick();
  assert.deepEqual(c.tjTradeOutboxRead(key).map(e=>e.id).sort(),['still-sending','student-B']);
  assert.ok(c.tjServerTrades.lost);
  assert.ok(!c.trades.some(t=>t.id==='rejected'),'a rejected trade is not shown as saved');
  assert.equal(notices.find(n=>n.kind==='outbox:rejected').level,'error');
});

test('tjSettleWithin reports value, error or pending without throwing',async()=>{
  const c=load(APP,['tjSettleWithin'],{Promise,setTimeout,clearTimeout,Error});
  assert.deepEqual(plain(await c.tjSettleWithin(Promise.resolve(7),50)),{value:7});
  const failure=Error('nope');assert.equal((await c.tjSettleWithin(Promise.reject(failure),50)).error,failure);
  assert.deepEqual(plain(await c.tjSettleWithin(new Promise(()=>{}),10)),{pending:true});
});

test('a background save failure becomes a notice; the open form keeps its own error',()=>{
  const saveError={style:{},textContent:''},overlay={classList:{contains:()=>true}},form={dataset:{pendingId:'t1'}},notices=[];
  const c=load(APP,['tjReportTradeSaveError'],{document:{getElementById:id=>({saveError,modalOverlay:overlay,tradeForm:form})[id]||null},
    tjNotice:(kind,level,message)=>notices.push({kind,level,message}),tjDescribeTrade:t=>'#1 '+t.asset,tjErrorReason:()=>' (unavailable)'});
  c.tjReportTradeSaveError({id:'t1',asset:'EURUSD'},'in form',Error('x'));
  assert.equal(saveError.textContent,'in form');assert.equal(saveError.style.display,'block');assert.equal(notices.length,0);
  c.tjReportTradeSaveError({id:'t2',asset:'GBPUSD'},'in form',Error('x'));
  assert.equal(notices[0].kind,'save:t2');assert.equal(notices[0].level,'error');assert.match(notices[0].message,/#1 GBPUSD.*\(unavailable\)/);
});

test('duplicate /users logins never flip the settings owner; unique logins are still repaired',async()=>{
  const updates=[],warnings=[],notices=[],titles={dup:{uid:'u1'},Solo:{uid:'stale'}};
  const c=load(APP,['tjRepairSettingsOwners'],{Promise,Object,String,tjAdminUid:'admin',firebase:{auth:()=>({currentUser:{uid:'admin'}})},
    console:{warn:(...a)=>warnings.push(a.join(' '))},tjNotice:(kind,level,message)=>notices.push({kind,level,message}),
    db:{collection:()=>({doc:id=>({id})}),runTransaction:fn=>fn({get:ref=>Promise.resolve({exists:ref.id in titles,data:()=>titles[ref.id]}),update:(ref,data)=>updates.push([ref.id,data])})}});
  await c.tjRepairSettingsOwners({uid:'admin'},[{login:'dup',uid:'u1'},{login:'DUP',uid:'u2'},{login:'Solo',uid:'fresh'},{login:'dup',uid:'u1'}]);
  assert.deepEqual(plain(updates),[['Solo',{uid:'fresh'}]]);
  assert.match(warnings.join('\n'),/dup \(u1, u2\)/);
  assert.equal(notices[0].kind,'keep:duplicate-logins');
});

function assetStore(initial){
  const data=JSON.parse(JSON.stringify(initial));
  const snap=key=>({exists:key in data,data:()=>JSON.parse(JSON.stringify(data[key]))});
  function merge(a,b){const out=Object.assign({},a);for(const k of Object.keys(b))out[k]=b[k];return out;}
  const db={
    collection:name=>({doc:id=>({key:name+'/'+id}),where:(f,op,v)=>({get:()=>Promise.resolve({forEach:cb=>Object.keys(data).filter(k=>k.startsWith(name+'/')&&data[k][f]===v).forEach(k=>cb({id:k.slice(name.length+1),data:()=>data[k]}))})})}),
    async runTransaction(fn){const writes=[];const value=await fn({get:ref=>Promise.resolve(snap(ref.key)),set:(ref,v,o)=>writes.push(['set',ref.key,JSON.parse(JSON.stringify(v)),o]),update:(ref,v)=>writes.push(['update',ref.key,v]),delete:ref=>writes.push(['delete',ref.key])});
      for(const [kind,key,v,o] of writes){if(kind==='delete')delete data[key];else if(kind==='update')data[key]=merge(data[key],v);else data[key]=o&&o.merge?merge(data[key]||{},v):v;}db.commits.push(writes);return value;},
    commits:[]
  };
  return {db,data};
}
function assetClient(store){return load(APP,['tjChangeAssetSettings'],{db:store.db,Promise,Date,Math,Error,Array,Number,normalizeAssetDefinitions:x=>JSON.parse(JSON.stringify(x||[]))});}

test('re-adding a retired asset revives it in the same transaction as the settings write',async()=>{
  const store=assetStore({'titles/A':{uid:'uid-A',assets:[{name:'NEW'}],deletedAssets:[],assetRevision:1},'journalAssetGuards/uid-A':{uid:'uid-A',locked:false,retired:['OLD','GONE']}});
  const settings=await assetClient(store).tjChangeAssetSettings('A','uid-A',s=>{s.assets.push({name:'OLD'});});
  assert.deepEqual(settings.assets.map(a=>a.name),['NEW','OLD']);
  assert.deepEqual(store.data['journalAssetGuards/uid-A'].retired,['GONE']);
  assert.equal(store.data['journalAssetGuards/uid-A'].revivals,1);
  assert.equal(store.data['titles/A'].assetRevision,2);
  assert.equal(store.db.commits.length,1);assert.equal(store.db.commits[0].length,2,'settings and fence commit together');
  await assetClient(store).tjChangeAssetSettings('A','uid-A',s=>{s.assets.push({name:'FRESH'});});
  assert.equal(store.db.commits[1].length,1,'an ordinary add does not touch the fence');
  assert.equal(store.data['journalAssetGuards/uid-A'].revivals,1);
});

test('renaming an asset to a retired name migrates its trades and revives that name',async()=>{
  const store=assetStore({'titles/A':{uid:'uid-A',assets:[{name:'NEW'},{name:'OTHER'}],deletedAssets:[],assetRevision:1},'journalAssetGuards/uid-A':{uid:'uid-A',locked:false,retired:['OLD'],revivals:2},
    'trades/t1':{uid:'uid-A',asset:'OTHER'},'trades/t2':{uid:'uid-A',asset:'NEW'}});
  await assetClient(store).tjChangeAssetSettings('A','uid-A',s=>{s.assets.find(a=>a.name==='OTHER').name='OLD';},'OTHER','OLD');
  const guard=store.data['journalAssetGuards/uid-A'];
  assert.deepEqual(guard.retired,['OTHER']);assert.equal(guard.revivals,3);assert.equal(guard.locked,false);
  assert.equal(store.data['trades/t1'].asset,'OLD');assert.equal(store.data['trades/t2'].asset,'NEW');
});

test('renaming without a revival leaves the revival counter alone',async()=>{
  const store=assetStore({'titles/A':{uid:'uid-A',assets:[{name:'OLD'}],deletedAssets:[]},'trades/t1':{uid:'uid-A',asset:'OLD'}});
  await assetClient(store).tjChangeAssetSettings('A','uid-A',s=>{s.assets[0].name='NEW';},'OLD','NEW');
  const guard=store.data['journalAssetGuards/uid-A'];
  assert.deepEqual(guard.retired,['OLD']);assert.equal(guard.revivals,undefined);
});
