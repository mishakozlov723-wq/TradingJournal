const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=require('./assembled-html.cjs')();
const helpers=html.slice(html.indexOf('  function notesRecoverOrphanCloudSnapshot('),html.indexOf('  function notesPageCloudHash('))+'\n'+html.slice(html.indexOf('  function notesIsMobile()'),html.indexOf('  function notesReindexSiblings'));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
const tick=()=>new Promise(r=>setTimeout(r,5));
function harness(mobile=true){
 const root=deferred(),reads=[],renders=[],writes=[],pending=new Map();let owner='alice';
 const c={Promise,setTimeout,clearTimeout,Array,Number,String,Date,console:{error(){}},location:{hash:''},
 document:{body:{classList:{contains:()=>mobile}}},notesOwner:()=>owner,
 notesLoadSeq:0,notesLoadedFor:null,notesDirty:false,notesLoadedRemote:false,notesActivePageId:null,
 notesPageCloudHash:JSON.stringify,notesClone:x=>JSON.parse(JSON.stringify(x)),notesNormalizePages:x=>x||[],notesNormalizeGroups:x=>x||[],
 notesEnsurePageGroups(){},notesPickActivePage(){if(!c.notesPages.some(p=>p.id===c.notesActivePageId))c.notesActivePageId=c.notesPages[0]?.id||null;},
 notesHistoryReset(){},notesApplyHashTarget(){},notesToast(){},notesSetState(){},
 notesRender(){renders.push(c.notesPages.map(p=>p.id));},notesSave(){writes.push('cloud');},
 notesSaveLocal(k,s){writes.push({k,s});},notesMobileCacheGet:()=>Promise.resolve(null),
 notesLoadLocal:()=>({pages:[],groups:[],updatedAt:0}),notesEnsureCloudOwner:(o,s)=>Promise.resolve(s),notesRepairKnownOwnerRoots:()=>Promise.resolve(),
 db:{collection(){return {doc(){return {get:()=>root.promise};},where(){return {get:()=>Promise.resolve({forEach(){}})};}};}},
 notesPageCloudRef(o,id){return {get(){const d=deferred();reads.push(id);pending.set(id,d);return d.promise;}};}
 };
 vm.createContext(c);vm.runInContext(helpers,c);
 c.notesMobileBusy=b=>{c.notesMobileLoading=b;};
 return {c,root,reads,renders,writes,pending,setOwner:o=>owner=o};
}
const snap=data=>({exists:!!data,data:()=>data});
const page=id=>snap({notesPage:{id,title:id,blocks:[]}});
test('cold mobile load previews before all requests finish and bounds concurrency to four',async()=>{
 const h=harness();const ids=Array.from({length:13},(_,i)=>'p'+i);h.c.location.hash='#notes/p7';
 const done=h.c.notesLoad(true);assert.equal(h.c.notesMobileLoading,true);assert.deepEqual(h.renders,[[]]);
 h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:ids,groups:[],updatedAt:10}}));await tick();
 assert.equal(h.reads.length,4);assert.equal(h.reads[0],'p7');h.pending.get('p7').resolve(page('p7'));await tick();
 assert.ok(h.renders.some(x=>x[0]==='p7'));assert.equal(h.c.notesLoadedFor,null);assert.equal(h.writes.length,0);
 for(let round=0;round<8;round++){for(const [id,d] of h.pending)d.resolve(page(id));await tick();}
 await done;assert.equal(h.c.notesPages.length,13);assert.equal(h.c.notesMobileLoading,false);assert.equal(h.c.notesLoadedFor,'alice');
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].s.updatedAt,10);
});
test('local and IndexedDB snapshots can appear while root Firebase request is pending',async()=>{
 const h=harness();h.c.notesLoadLocal=()=>({pages:[{id:'local'}],groups:[],updatedAt:2});
 h.c.notesMobileCacheGet=()=>Promise.resolve({data:{pages:[{id:'idb'}],groups:[],updatedAt:3}});
 const done=h.c.notesLoad(true);assert.deepEqual(h.renders,[['local']]);await tick();assert.deepEqual(h.renders,[['local'],['idb']]);
 h.root.reject(Error('offline'));await done;assert.equal(h.c.notesPages[0].id,'idb');assert.equal(h.c.notesCloudIncomplete,true);assert.equal(h.c.notesMobileLoading,false);
});
test('failed page fetch stops late previews and keeps local recovery protected',async()=>{
 const h=harness();const done=h.c.notesLoad(true);h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:['a','b','c','d','e']}}));await tick();
 h.pending.get('a').reject(Error('network'));await done;const count=h.renders.length;
 h.pending.get('b').resolve(page('b'));h.pending.get('c').resolve(page('c'));h.pending.get('d').resolve(page('d'));await tick();
 assert.equal(h.renders.length,count);assert.equal(h.reads.length,4);assert.equal(h.c.notesCloudIncomplete,true);assert.equal(h.writes.length,0);
});
test('owner switch invalidates late results and preview callbacks',async()=>{
 const h=harness();const done=h.c.notesLoad(true);h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:['a','b']}}));await tick();
 h.setOwner('bob');h.c.notesLoadSeq++;const before=h.renders.length;
 for(const [id,d] of h.pending)d.resolve(page(id));await done;
 assert.equal(h.renders.length,before);assert.equal(h.writes.length,0);
});
test('empty mobile workspace unlocks after reconciliation',async()=>{
 const h=harness();const done=h.c.notesLoad(true);h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:[],groups:[],updatedAt:7}}));await done;
 assert.equal(h.c.notesPages.length,0);assert.equal(h.c.notesMobileLoading,false);
});
test('empty root index recovers orphan split-page documents and rebuilds cloud metadata',async()=>{
 const h=harness();
 h.c.db={collection(){return {
   doc(){return {get:()=>h.root.promise};},
   where(field,op,value){assert.equal(field,'notesPageOwner');assert.equal(op,'==');assert.equal(value,'alice');return {get:()=>Promise.resolve({forEach(cb){cb({id:'alice__np__p1',data:()=>({notesPageOwner:'alice',notesPage:{id:'p1',title:'Recovered',blocks:[]}})});}})};}
 };}};
 const done=h.c.notesLoad(true);
 h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:[],groups:[],updatedAt:7}}));
 await done;
 assert.equal(Array.from(h.c.notesPages,p=>p.id).join(','),'p1');
 assert.equal(h.c.notesLoadedFor,'alice');
 assert.equal(h.c.notesCloudIncomplete,false);
 assert.ok(h.writes.includes('cloud'));
});
test('stale local snapshot cannot hide orphan cloud pages during index recovery',async()=>{
 const h=harness();
 h.c.notesLoadLocal=()=>({pages:[{id:'local-only',title:'Local backup',blocks:[]}],groups:[],updatedAt:3});
 h.c.db={collection(){return {
   doc(){return {get:()=>h.root.promise};},
   where(){return {get:()=>Promise.resolve({forEach(cb){cb({id:'alice__np__cloud',data:()=>({notesPageOwner:'alice',updatedAt:6,notesPage:{id:'cloud',title:'Cloud page',blocks:[]}})});}})};}
 };}};
 const done=h.c.notesLoad(true);
 h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:[],groups:[],updatedAt:7}}));
 await done;
 assert.deepEqual(Array.from(h.c.notesPages,p=>p.id).sort(),['cloud','local-only']);
 assert.equal(h.c.notesLoadedRemote,true);
 assert.equal(h.c.notesCloudIncomplete,false);
 assert.ok(h.writes.includes('cloud'));
});
test('failed orphan recovery query is treated as cloud failure, never as an empty workspace',async()=>{
 const h=harness();
 h.c.notesLoadLocal=()=>({pages:[{id:'safe-local',title:'Safe local',blocks:[]}],groups:[],updatedAt:2});
 h.c.db={collection(){return {
   doc(){return {get:()=>h.root.promise};},
   where(){return {get:()=>Promise.reject(Error('offline recovery scan'))};}
 };}};
 const done=h.c.notesLoad(true);
 h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:[],groups:[],updatedAt:7}}));
 await done;
 assert.equal(h.c.notesPages[0].id,'safe-local');
 assert.equal(h.c.notesLoadedRemote,false);
 assert.equal(h.c.notesCloudIncomplete,true);
 assert.equal(h.writes.includes('cloud'),false);
});
test('desktop retains parallel full fetch without mobile preview or cache write',async()=>{
 const h=harness(false);const ids=Array.from({length:12},(_,i)=>'p'+i),done=h.c.notesLoad(true);
 assert.equal(h.renders.length,0);h.root.resolve(snap({notesWorkspaceMeta:{version:3,pageIds:ids}}));await tick();assert.equal(h.reads.length,12);assert.equal(h.renders.length,0);
 for(const [id,d] of h.pending)d.resolve(page(id));await done;assert.equal(h.renders.length,1);assert.equal(h.writes.length,0);
});
function dragHarness(mobile=true){
 const events={},classes=new Set(),marks=new Set(),moves=[],container={},target={dataset:{id:'b'},parentElement:container,classList:{add:x=>marks.add(x),remove:(...xs)=>xs.forEach(x=>marks.delete(x))},getBoundingClientRect:()=>({top:100,height:40})};
 const row={isConnected:true,parentElement:container,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},closest:()=>null};
 const grip={addEventListener(type,fn){(events[type]??=[]).push(fn);},setPointerCapture(){}};
 let hit=target;
 const c={setTimeout,clearTimeout,cancelAnimationFrame(){},requestAnimationFrame:()=>1,Math,
 notesIsMobile:()=>mobile,notesListen:(el,type,fn)=>el.addEventListener(type,fn),notesMoveBlock:(...a)=>moves.push(a),notesFocusBlock(){},
 document:{getElementById:()=>null,elementFromPoint:()=>hit?{closest:()=>hit}:null}};
 vm.createContext(c);vm.runInContext(html.slice(html.indexOf('  function notesEnableMobileBlockDrag('),html.indexOf('  function notesRenderBlocks()')),c);
 c.notesEnableMobileBlockDrag(row,grip,'a');
 function fire(type,extra={}){const e={isPrimary:true,button:0,pointerId:1,clientX:20,clientY:130,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of events[type]||[])fn(e);return e;}
 return {fire,moves,classes,marks,row};
}
test('short grip tap preserves block-menu click',()=>{const h=dragHarness();h.fire('pointerdown');h.fire('pointerup');assert.equal(h.fire('click').stopped,undefined);assert.equal(h.moves.length,0);});
test('long-press drag reorders once and consumes trailing menu click',async()=>{const h=dragHarness();h.fire('pointerdown');await new Promise(r=>setTimeout(r,290));assert.equal(h.classes.has('dragging'),true);h.fire('pointerup');assert.deepEqual(h.moves,[['a','b','after']]);assert.equal(h.fire('click').stopped,true);assert.equal(h.classes.size,0);assert.equal(h.marks.size,0);});
test('pointer cancellation never moves a block',()=>{const h=dragHarness();h.fire('pointerdown');h.fire('pointercancel');h.fire('pointerup');assert.equal(h.moves.length,0);});
test('desktop grip bypasses the touch drag controller',()=>{const h=dragHarness(false);h.fire('pointerdown');h.fire('pointerup');assert.equal(h.moves.length,0);assert.equal(h.fire('dragstart').prevented,undefined);});
function sheetHarness(){
 const events={},classes=new Set(),props={},timers=[],bodyEvents={};let dismissed=0;
 const handle={setAttribute(){},addEventListener(t,fn){events[t]=fn;},setPointerCapture(){}};
 const panel={nodeType:1,inert:false,offsetHeight:400,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},style:{setProperty:(k,v)=>props[k]=v,removeProperty:k=>delete props[k]},querySelector:()=>null,prepend(){},getBoundingClientRect:()=>({height:400}),matches:s=>s==='.notes-menu'};
 const body={nodeType:1,matches:()=>false,querySelectorAll:()=>[panel]};
 const c={document:{body,createElement:()=>handle,addEventListener:(t,fn)=>bodyEvents[t]=fn},MutationObserver:class{observe(){}},DOMMatrixReadOnly:class{constructor(){this.m41=0;}},getComputedStyle:()=>({transform:'none'}),notesIsMobile:()=>true,notesReduceMotion:false,notesCloseMenus:()=>dismissed++,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},notesAlignBlockTools(){}};
 const a=html.indexOf('  (function notesMobileSheets(){'),b=html.indexOf('\n  })();',a)+9;vm.createContext(c);vm.runInContext(html.slice(a,b),c);
 const fire=(type,extra={})=>events[type]({isPrimary:true,button:0,pointerId:1,clientY:0,timeStamp:0,preventDefault(){},stopPropagation(){},...extra});
 return {fire,panel,props,run:()=>{while(timers.length)timers.shift()();},closed:()=>dismissed};
}
test('sheet follows pointer and distance swipe dismisses after animation',()=>{const h=sheetHarness();h.fire('pointerdown');h.fire('pointermove',{clientY:150,timeStamp:300});assert.match(h.props.transform,/150px/);h.fire('pointerup',{timeStamp:310});assert.equal(h.closed(),0);assert.equal(h.panel.inert,true);h.run();assert.equal(h.closed(),1);assert.match(h.props.transform,/440px/);});
test('short slow swipe springs back without closing',()=>{const h=sheetHarness();h.fire('pointerdown');h.fire('pointermove',{clientY:20,timeStamp:100});h.fire('pointerup',{timeStamp:250});h.run();assert.equal(h.closed(),0);assert.equal(h.props.transform,undefined);});
test('fast flick closes below distance threshold',()=>{const h=sheetHarness();h.fire('pointerdown');h.fire('pointermove',{clientY:35,timeStamp:30});h.fire('pointerup',{timeStamp:35});h.run();assert.equal(h.closed(),1);});
test('sheet pointer cancellation returns to resting position',()=>{const h=sheetHarness();h.fire('pointerdown');h.fire('pointermove',{clientY:150,timeStamp:40});h.fire('pointercancel');h.run();assert.equal(h.closed(),0);assert.equal(h.props.transform,undefined);});
