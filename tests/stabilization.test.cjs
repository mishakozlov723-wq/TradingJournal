'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const notes=fs.readFileSync(require('node:path').join(__dirname,'../public/notes-workspace.js'),'utf8');
function fn(name,src=source){const a=src.indexOf('  function '+name+'(');assert.ok(a>=0,name);const tail=src.slice(a),b=tail.search(/^  }\r?$/m);assert.ok(b>=0,name+' end');return tail.slice(0,b+3);}
function storage(){const map=new Map();return {get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem(k,v){if(this.full)throw Error('quota');map.set(k,String(v));},removeItem:k=>map.delete(k)};}
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(store=storage()){
 const remote={},commits=[],auth={uid:'auth-A'};let failAt=0,attempt=0,hold;
 const c={Promise,Date,Math,JSON,Object,Array,String,Number,encodeURIComponent,localStorage:store,console:{warn(){},error(){}},window:{addEventListener(){}},viewingUser:'A',tjDataGeneration:1,activeBacktestId:null,
 findUser:o=>({uid:'uid-'+o}),firebase:{auth:()=>({currentUser:auth})},navigator:{},tjBacktestFlushes:Object.create(null),tjBacktestActiveLoads:Object.create(null),tjBacktestSequence:0,
 document:{body:{classList:{remove(){}}}},saveBacktestLocal(){c.saved=(c.saved||0)+1;},renderBacktests(){},showBacktestSyncError:m=>c.error=m,
 db:{collection:collection=>({doc:id=>({key:collection+'/'+id})}),batch(){const writes=[];return {set(r,v,o){writes.push({key:r.key,data:clone(v),merge:o.merge});},delete:r=>writes.push({key:r.key,remove:true}),async commit(){attempt++;if(hold)await hold;if(attempt===failAt)throw Error('offline');commits.push(clone(writes));for(const w of writes){if(w.remove)delete remote[w.key];else remote[w.key]=Object.assign({},w.merge?remote[w.key]:{},w.data);}}};}}};
 vm.createContext(c);for(const n of ['tjBacktestOpPrefix','tjBacktestOutbox','tjStoreBacktestOp','tjQueueBacktestOps','tjBacktestWrite','tjFlushBacktestOutbox','tjOverlayBacktestOutbox','tjDeleteBacktestRecords','deleteBacktest','deleteBacktestTrade','loadBacktestTrades'])vm.runInContext(fn(n),c);
 return {c,store,remote,commits,auth,fail:n=>failAt=n,hold:p=>hold=p};
}
test('unsafe image protocols are rejected; quoted image URLs and IDs cannot break attributes',()=>{
 const c={};vm.createContext(c);vm.runInContext(fn('escapeAttr')+fn('safeTradeImage'),c);
 for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg onload=alert(1)>','https://x\nonerror=alert(1)'])assert.equal(c.safeTradeImage(url),'');
 assert.equal(c.safeTradeImage('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
 assert.equal(c.escapeAttr('x" onerror="evil<&'), 'x&quot; onerror=&quot;evil&lt;&amp;');
 for(const name of ['tradeRowCells','renderGallery','openCalDayModal'])assert.match(fn(name),/escapeAttr\(safeTradeImage\(t.chart\)\)/);
});
test('failed creation survives a fresh process and overlays an empty server query',async()=>{
 const h=fixture();h.fail(1);await assert.rejects(h.c.tjBacktestWrite('backtestTrades','t',{r:2,uid:'uid-A'}));
 const reboot=fixture(h.store);assert.equal(reboot.c.tjOverlayBacktestOutbox([],'backtestTrades','A')[0].r,2);
 await reboot.c.tjFlushBacktestOutbox('A');assert.equal(reboot.remote['backtestTrades/t'].r,2);assert.equal(reboot.c.tjBacktestOutbox('A').length,0);
});
test('queued patches preserve write order and existing record object identity',async()=>{
 const h=fixture();h.fail(1);await assert.rejects(h.c.tjBacktestWrite('backtestTrades','t',{r:1,asset:'EURUSD'}));h.fail(2);await assert.rejects(h.c.tjBacktestWrite('backtestTrades','t',{r:4},{merge:true}));
 const t={id:'t',r:0,stale:true},out=h.c.tjOverlayBacktestOutbox([t],'backtestTrades','A');assert.equal(out[0],t);assert.equal(t.r,4);assert.equal(t.asset,'EURUSD');assert.equal(t.stale,undefined);
 h.fail(0);await h.c.tjFlushBacktestOutbox('A');assert.equal(h.remote['backtestTrades/t'].r,4);
});
test('an acknowledged write during an older query remains in that query overlay',async()=>{
 const h=fixture();const intents=[];h.c.tjBacktestActiveLoads.A=intents;const rec={r:3};await h.c.tjBacktestWrite('backtestTrades','t',rec);rec.r=99;
 assert.equal(h.c.tjBacktestOutbox('A').length,0);assert.equal(h.c.tjOverlayBacktestOutbox([],'backtestTrades','A',intents)[0].r,3);
});
test('another authenticated account cannot drain the original user outbox',async()=>{
 const h=fixture();h.fail(1);await assert.rejects(h.c.tjBacktestWrite('backtests','bt',{uid:'uid-A'}));h.auth.uid='auth-B';h.fail(0);await assert.rejects(h.c.tjFlushBacktestOutbox('A'),/original account/);assert.equal(h.commits.length,0);assert.equal(h.c.tjBacktestOutbox('A').length,1);
});
test('large deletion resumes after the acknowledged chunk and atomically removes trade images',async()=>{
 const h=fixture(),records=Array.from({length:500},(_,i)=>({id:'t'+i,backtestId:'bt',images:[{id:'im'+i}]}));
 records.forEach(t=>{h.remote['backtestTrades/'+t.id]=t;h.remote['tradeImages/'+t.images[0].id]={uid:'uid-A'};});h.remote['backtests/bt']={};h.fail(2);
 await assert.rejects(h.c.tjDeleteBacktestRecords(records,'bt','A'));
 assert.equal(h.c.tjBacktestOutbox('A')[0].index,1);assert.equal(h.commits[0].length,450);assert.ok(h.remote['backtests/bt']);assert.equal(h.remote['backtestTrades/t0'],undefined);assert.equal(h.remote['tradeImages/im0'],undefined);
 assert.equal(h.c.tjOverlayBacktestOutbox(records,'backtestTrades','A').length,0);
 h.fail(0);await h.c.tjFlushBacktestOutbox('A');assert.equal(Object.keys(h.remote).length,0);assert.deepEqual(h.commits.map(x=>x.length),[450,450,100,1]);
});
test('quota failure cannot remove a backtest or its trades from the UI/cache',async()=>{
 const h=fixture();h.c.backtests=[{id:'bt'}];h.c.allBacktestTrades=[{id:'t',backtestId:'bt'}];h.c.activeBacktestId='bt';h.c.backtestTrades=h.c.allBacktestTrades;h.store.full=true;
 await h.c.deleteBacktest('bt');assert.equal(h.c.backtests.length,1);assert.equal(h.c.allBacktestTrades.length,1);assert.equal(h.c.saved,undefined);assert.match(h.c.error,/not saved/);
});
test('late failed deletion never restores A records into the newly selected B journal',async()=>{
 const h=fixture();let release;h.hold(new Promise(r=>release=r));h.fail(1);h.c.backtests=[{id:'bt'}];h.c.allBacktestTrades=[{id:'t',backtestId:'bt'}];h.c.backtestTrades=[];const pending=h.c.deleteBacktest('bt');
 h.c.viewingUser='B';h.c.tjDataGeneration++;h.c.backtests=[{id:'B-only'}];h.c.allBacktestTrades=[];const before=h.c.saved;release();await pending;
 assert.equal(h.c.backtests[0].id,'B-only');assert.equal(h.c.allBacktestTrades.length,0);assert.equal(h.c.saved,before);assert.equal(h.c.tjBacktestOutbox('A').length,1);
});
test('loadBacktestTrades returns the array expected by chart callers',async()=>{
 const h=fixture();h.c.allBacktestTrades=[{id:'one',backtestId:'bt'},{id:'two',backtestId:'other'}];assert.equal((await h.c.loadBacktestTrades({id:'bt'}))[0].id,'one');assert.equal((await h.c.loadBacktestTrades(null)).length,0);
});
test('a failed acknowledgement persistence can safely retry the same idempotent write',async()=>{
 const h=fixture(),set=h.store.setItem.bind(h.store);let writes=0;h.store.setItem=(...a)=>{if(++writes===2)throw Error('quota on ack');set(...a);};
 await assert.rejects(h.c.tjBacktestWrite('backtestTrades','t',{r:7}));assert.equal(h.remote['backtestTrades/t'].r,7);assert.equal(h.c.tjBacktestOutbox('A')[0].index,0);
 await h.c.tjFlushBacktestOutbox('A');assert.equal(h.remote['backtestTrades/t'].r,7);assert.equal(h.c.tjBacktestOutbox('A').length,0);
});
test('curve debounce captures value/owner and cancels both save and render after account switch',async()=>{
 const timers=[],writes=[],c={Promise,curveColor:'#34d399',pendingCurveColor:null,savedCustomCurveColor:null,currentUser:{},viewingUser:'A',tjDataGeneration:1,activeBacktestId:null,activeBacktestId:'bt',backtests:[{id:'bt'}],trades:[],curveColorSaveTimer:null,updateCurveColorUI(){},computeStats:()=>({percentChartData:[]}),assetFiltered:x=>x,clearTimeout(){},setTimeout:fn=>timers.push(fn),loadBacktestTrades:()=>Promise.resolve([]),renderBacktestChart:()=>c.rendered=true,db:{collection:()=>({doc:id=>({set:p=>{writes.push({id,p});return Promise.resolve();}})})}};
 vm.createContext(c);vm.runInContext(fn('setCurveColor'),c);c.setCurveColor('#123456');c.viewingUser='B';c.tjDataGeneration++;c.curveColor='#ffffff';timers[0]();await Promise.resolve();assert.equal(writes.length,0);assert.equal(c.rendered,undefined);
 c.setCurveColor('#abcdef');c.curveColor='#000000';timers[1]();assert.equal(writes[0].id,'B');assert.equal(writes[0].p.curveColor,'#abcdef');
});
test('empty cloud journal never triggers a legacy batch upload',()=>{
 const f=fn('loadData');assert.match(f,/tjOfferLegacyRecovery/);assert.doesNotMatch(f.slice(f.indexOf('// Empty is authoritative')),/batch\.set|remoteSaveTrade/);
 const recovery=fn('tjOfferLegacyRecovery');assert.match(recovery,/application\/json/);assert.doesNotMatch(recovery,/db\.|remoteSaveTrade/);
});
function notesFixture(liveRevision){
 const writes=[],root={exists:true,data:()=>({notesWorkspaceMeta:liveRevision})};
 const c={Promise,Date,Math,JSON,Object,Array,Number,String,setTimeout,clearTimeout,console:{error(){}},notesSaveTimer:null,notesMobileLoading:false,notesDirty:true,notesLoadedFor:'A',notesLoadedRemote:true,notesPages:[{id:'p',title:'draft'}],notesGroups:[],notesClone:clone,notesSaveLocal:()=>true,notesCloudIncomplete:false,notesRemoteSaveInFlight:false,notesRemoteSavePending:false,notesCloudRevision:'[1,"old"]',notesCloudPageHashes:{},notesCloudPageIds:['p'],NOTES_CLOUD_LIMIT:1000000,notesJsonBytes:x=>JSON.stringify(x).length,notesOffloadWanted:()=>false,notesOffloadCan:()=>false,notesPageCloudHash:JSON.stringify,notesPageCloudRef:(o,id)=>({key:o+'/'+id}),notesOwnerUid:()=> 'uid-A',notesSetState(){},notesToast(){},notesSyncShares:()=>c.shared=true,notesShowConflict:()=>{c.conflict=true;},firebase:{firestore:{FieldValue:{delete:()=>null}}},db:{collection:()=>({doc:id=>({key:id})}),async runTransaction(fn){const pending=[];await fn({get:()=>Promise.resolve(root),set:(...a)=>pending.push(a),delete:r=>pending.push([r,null])});writes.push(...pending);}}};
 vm.createContext(c);vm.runInContext(fn('notesRevision',notes)+fn('notesSave',notes),c);return {c,writes};
}
test('stale Notes root aborts every page/index write and preserves the local draft',async()=>{const h=notesFixture({updatedAt:2,revision:'new-device'});await h.c.notesSave();assert.equal(h.writes.length,0);assert.equal(h.c.conflict,true);assert.equal(h.c.notesDirty,true);assert.equal(h.c.shared,undefined);assert.equal(h.c.notesPages[0].title,'draft');});
test('unchanged Notes revision commits page and new root atomically before publishing shares',async()=>{const h=notesFixture({updatedAt:1,revision:'old'});await h.c.notesSave();assert.equal(h.writes.length,2);assert.equal(h.writes[0][0].key,'A/p');assert.ok(h.writes[1][1].notesWorkspaceMeta.revision);assert.equal(h.c.notesDirty,false);assert.equal(h.c.shared,true);});
test('private screenshot deletes and asset metadata share one atomic transaction',async()=>{
 const writes=[],records=[{id:'t1',uid:'u',asset:'EURUSD',images:[{id:'i1'},{id:'i2'}]},{id:'t2',uid:'u',asset:'GBPUSD',images:[{id:'keep'}]}];
 const c={Promise,normalizeAssetDefinitions:x=>x||[],db:{collection:name=>({doc:id=>({key:name+'/'+id}),where:()=>({get:()=>Promise.resolve({forEach:fn=>records.forEach(r=>fn({id:r.id,data:()=>r}))})})}),async runTransaction(fn){let wrote=false;const part=[];const result=await fn({get:r=>{assert.equal(wrote,false);return Promise.resolve({exists:true,data:()=>r.key==='titles/tester'?{assets:[],deletedAssets:[]}:records.find(t=>'trades/'+t.id===r.key)});},delete:r=>{wrote=true;part.push(r.key);},set:r=>{wrote=true;part.push(r.key);}});writes.push(part);return result;}}};
 vm.createContext(c);vm.runInContext(fn('tjChangeAssetSettings'),c);await c.tjChangeAssetSettings('tester','u',()=>{},'EURUSD',null);
 assert.deepEqual(writes,[['tradeImages/i1','tradeImages/i2','trades/t1','titles/tester']]);
});
test('backtest editor resolves persisted identity, never a synthetic/filtered chart row',()=>{assert.match(fn('openBacktestTradeEditor'),/allBacktestTrades\.filter/);assert.match(source,/editingBacktestTradeId \? allBacktestTrades\.filter/);assert.match(source,/editingBacktestTradeId&&!btTrade/);});

test('Notes conflict persists edits typed after the transaction started, not its older snapshot',async()=>{
 const h=notesFixture({updatedAt:2,revision:'other-device'}),saved=[];
 h.c.notesSaveLocal=(owner,snapshot)=>{saved.push(clone(snapshot));return true;};
 let read;h.c.db.runTransaction=fn=>fn({get:()=>new Promise(resolve=>{read=resolve;}),set:()=>assert.fail('conflict must not write'),delete:()=>assert.fail('conflict must not delete')});
 const saving=h.c.notesSave();h.c.notesPages[0].title='new lines typed while saving';h.c.notesDirty=true;
 read({exists:true,data:()=>({notesWorkspaceMeta:{updatedAt:2,revision:'other-device'}})});await saving;
 assert.equal(saved.at(-1).pages[0].title,'new lines typed while saving');assert.equal(h.c.notesCloudConflict,true);assert.equal(h.c.notesDirty,true);
});
