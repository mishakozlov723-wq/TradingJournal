'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../public/notes-workspace.js'),'utf8');
function fn(name){
  const start=src.indexOf('  function '+name+'(');assert.ok(start>=0,name);
  const brace=src.indexOf('{',start);let depth=0,quote='',escape=false;
  for(let i=brace;i<src.length;i++){
    const ch=src[i];
    if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw Error('unterminated '+name);
}

test('cloud preparation is side-effect free and identifies safe repair inputs',()=>{
  const c={notesClone:x=>JSON.parse(JSON.stringify(x)),notesNormalizePages:x=>x,notesNormalizeGroups:x=>x||[],notesPageCloudHash:JSON.stringify};
  vm.createContext(c);vm.runInContext(fn('notesPrepareCloudPages'),c);
  const docs=[{exists:true,data(){return {notesPage:{id:'wrong',title:'Synthetic',blocks:[]}}}},{exists:false,data(){throw Error('must not read missing')}}];
  const local={pages:[{id:'p1'},{id:'p2'}],groups:['local'],updatedAt:10,cloudBase:'same',conflict:false};
  const out=c.notesPrepareCloudPages(docs,['p1','p2'],{updatedAt:20,groups:['cloud']},local,'same');
  assert.deepEqual(Array.from(out.missing),['p2']);assert.equal(out.cloudPages[0].id,'p1');assert.equal(out.localCanRepair,true);assert.equal(out.useLocal,true);assert.equal(out.groups[0],'local');assert.ok(out.payloadChars>0);
  assert.equal(docs[0].data().notesPage.id,'wrong');
});

test('diagnostics expose only phase timings, cache state and aggregate counts',()=>{
  let now=0,detail;const c={Object,Math,Date,notesLoadDiagnostics:[],notesIsMobile:()=>true,notesClone:x=>JSON.parse(JSON.stringify(x)),performance:{now:()=>now},window:{},CustomEvent:function(_,o){this.detail=o.detail},document:{dispatchEvent(e){detail=e.detail}}};
  vm.createContext(c);for(const name of ['notesPerfNow','notesPerfStart','notesPerfPhase','notesPerfFinish'])vm.runInContext(fn(name),c);
  const run=c.notesPerfStart(false,false);now=12.34;c.notesPerfPhase(run,'rootRead',0);run.cache='hit';run.counts.pageRequests=4;run.counts.payloadChars=1234;now=20;c.notesPerfFinish(run,'complete');
  const latest=c.window.TJNotesDiagnostics.latest();assert.equal(latest.totalMs,20);assert.equal(latest.phases.rootRead,12.3);assert.equal(latest.counts.pageRequests,4);assert.equal(detail.cache,'hit');
  const serialized=JSON.stringify(latest);for(const forbidden of ['owner','uid','token','title','text','image'])assert.equal(serialized.includes(forbidden),false,forbidden);
});

test('normal cold path prepares the full set before UI application or recovery save',()=>{
  const load=fn('notesLoad');
  const prepareAt=load.indexOf('notesPrepareCloudPages('),applyAt=load.indexOf('notesPages=prepared.pages'),renderAt=load.indexOf("notesRender();notesPerfPhase(perf,'apply'");
  assert.ok(prepareAt>0&&applyAt>prepareAt&&renderAt>applyAt);assert.match(load,/if\(staleDraft\)/);assert.match(load,/if \(localCanRepair\)/);
});

test('cross-account owner repair is deferred until the current Notes load settles',()=>{
  const load=fn('notesLoad');
  assert.equal(load.includes('notesRepairKnownOwnerRoots()'),false);
  assert.match(load,/notesPerfFinish\(perf[^;]+;if\(typeof notesScheduleKnownOwnerRepair/);
  assert.match(fn('notesScheduleKnownOwnerRepair'),/requestIdleCallback|setTimeout/);
});
