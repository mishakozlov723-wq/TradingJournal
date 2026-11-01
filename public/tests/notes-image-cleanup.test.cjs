const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const html=require('./assembled-html.cjs')();

function harness(opts={}){
  const start=html.indexOf('  /* PR2: image documents');
  const end=html.indexOf('  // Upload when possible',start);
  assert.ok(start>0&&end>start,'cleanup block present');
  const store=new Map(),deleted=[],idbDeleted=[];
  const ctx={
    Promise,Date,JSON,Object,Number,console:{warn(){}},
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    notesLoadedFor:'alice',notesLoadedRemote:true,notesShareMode:false,notesCloudIncomplete:false,notesCloudConflict:false,notesMobileLoading:false,
    notesAuthUid:()=>'U1',notesPages:[],notesCloudPageHashes:{},notesHist:{undo:[],redo:[],base:null},notesImgMem:{},
    notesImgDb:()=>Promise.resolve({transaction:()=>({objectStore:()=>({delete:id=>idbDeleted.push(id)})})}),
    db:{collection:name=>({doc:id=>({delete:()=>{deleted.push(name+'/'+id);const e=opts.fail&&opts.fail[id];return e?Promise.reject(Object.assign(new Error(e),{code:e})):Promise.resolve();}})})}
  };
  vm.createContext(ctx);vm.runInContext(html.slice(start,end),ctx);
  return {ctx,store,deleted,idbDeleted};
}
const A='a'.repeat(24),B='b'.repeat(24),C='c'.repeat(24),D='d'.repeat(24);
const page=(id,...refs)=>JSON.stringify({id,blocks:refs.map(r=>({type:'image',src:'tjimg:'+r}))});

test('removed cloud references are queued, kept references are not',()=>{
  const {ctx,store}=harness();
  ctx.notesImgNoteRemoved('alice',{p1:page('p1',A,B),p2:page('p2',C)},{p1:page('p1',A)});
  const q=JSON.parse(store.get('tjNotesImgOrphansV1:alice'));
  assert.deepEqual(Object.keys(q).sort(),[B,C].sort());
});

test('sweep deletes only unreferenced images older than the grace period',async()=>{
  const {ctx,store,deleted,idbDeleted}=harness();
  const old=Date.now()-ctx.NOTES_IMG_ORPHAN_GRACE_MS-1000;
  store.set('tjNotesImgOrphansV1:alice',JSON.stringify({[A]:old,[B]:old,[C]:Date.now(),[D]:old}));
  ctx.notesPages=[JSON.parse(page('p1',B))];                // B is back in the live workspace
  ctx.notesHist.undo=[{pages:JSON.stringify([JSON.parse(page('p9',D))])}]; // D can still be restored by undo
  ctx.notesImgMem[A]='data:image/png;base64,AAAA';
  const n=await ctx.notesImgSweep(true);
  assert.equal(n,1);
  assert.deepEqual(deleted,['notesImages/'+A]);
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(idbDeleted,[A]);
  assert.equal(ctx.notesImgMem[A],undefined);
  const q=JSON.parse(store.get('tjNotesImgOrphansV1:alice'));
  assert.deepEqual(Object.keys(q).sort(),[C,D].sort(),'B dropped (live), C waits, D waits for history');
});

test('sweep never runs while the workspace is not a trustworthy cloud copy',async()=>{
  for(const flag of ['notesCloudIncomplete','notesCloudConflict','notesShareMode','notesMobileLoading']){
    const {ctx,store,deleted}=harness();
    store.set('tjNotesImgOrphansV1:alice',JSON.stringify({[A]:1}));
    ctx[flag]=true;
    assert.equal(await ctx.notesImgSweep(true),0,flag);
    assert.deepEqual(deleted,[],flag);
  }
  const {ctx,store,deleted}=harness();
  store.set('tjNotesImgOrphansV1:alice',JSON.stringify({[A]:1}));
  ctx.notesLoadedRemote=false;
  assert.equal(await ctx.notesImgSweep(true),0);
  assert.deepEqual(deleted,[]);
});

test('transient delete errors stay queued, missing/foreign images are dropped',async()=>{
  const {ctx,store}=harness({fail:{[A]:'unavailable',[B]:'not-found',[C]:'permission-denied'}});
  store.set('tjNotesImgOrphansV1:alice',JSON.stringify({[A]:1,[B]:1,[C]:1}));
  await ctx.notesImgSweep(true);
  assert.deepEqual(Object.keys(JSON.parse(store.get('tjNotesImgOrphansV1:alice'))),[A]);
});

test('a damaged queue is discarded instead of breaking Notes',async()=>{
  const {ctx,store,deleted}=harness();
  store.set('tjNotesImgOrphansV1:alice','{broken');
  assert.equal(await ctx.notesImgSweep(true),0);
  assert.equal(store.has('tjNotesImgOrphansV1:alice'),false);
  assert.deepEqual(deleted,[]);
});

test('save success and fresh uploads feed the cleanup queue',()=>{
  assert.match(html,/try \{ notesImgNoteRemoved\(ownerKey, notesCloudPageHashes, nextHashes\); \} catch \(_\) \{\}[^\n]*\n\s*notesCloudPageHashes = nextHashes;/);
  assert.match(html,/notesImgOrphanAdd\(owner, \[id\]\);/);
});
