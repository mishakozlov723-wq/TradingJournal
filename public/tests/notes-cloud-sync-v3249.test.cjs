const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=require('./assembled-html.cjs')();

test('Notes cloud loads are server-authoritative and failed reads cannot masquerade as remote success',()=>{
  assert.match(html,/doc\(owner\)\.get\(\{ source:'server' \}\)/);
  assert.match(html,/notesPageCloudRef\(owner,ids\[index\]\)\.get\(\{ source:'server' \}\)/);
  assert.match(html,/notesPageCloudRef\(owner,id\)\.get\(\{ source:'server' \}\)/);
  const catchBlock=html.slice(html.indexOf("console.error('Notes load failed:'"),html.indexOf('function notesReindexSiblings'));
  assert.match(catchBlock,/notesCloudIncomplete = true/);
  assert.match(catchBlock,/notesLoadedRemote = false/);
});

test('Notes writes stamp owner UID into root and page documents',()=>{
  assert.match(html,/notesPageOwner:ownerKey, uid:notesOwnerUid\(ownerKey\), notesPage:page/);
  assert.match(html,/\{ uid:notesOwnerUid\(ownerKey\), notesWorkspaceMeta:meta/);
});

test('first Notes workspace can pre-create its owner root before page batch',async()=>{
  const start=html.indexOf('  function notesOwnerUid(');
  const end=html.indexOf('  var notesKnownOwnerRepairStarted',start);
  const source=html.slice(start,end);
  const writes=[],reads=[];
  const snap={exists:false,data:()=>({})};
  const ctx={Promise,console:{warn(){}},findUser:()=>({uid:'U1'}),notesAuthUid:()=> 'U1',isRetockerAuth:()=>false,
    db:{collection:()=>({doc:()=>({set:(data,opt)=>{writes.push([data,opt]);return Promise.resolve();},get:opt=>{reads.push(opt);return Promise.resolve({exists:true,data:()=>({uid:'U1'})});}})})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const out=await ctx.notesEnsureCloudOwner('alice',snap);
  assert.equal(writes.length,1);
  assert.equal(writes[0][0].uid,'U1');
  assert.equal(JSON.stringify(reads),JSON.stringify([{source:'server'}]));
  assert.equal(out.data().uid,'U1');
});

test('retocker can repair missing UID metadata for another Notes owner',async()=>{
  const start=html.indexOf('  function notesOwnerUid(');
  const end=html.indexOf('  var notesKnownOwnerRepairStarted',start);
  const source=html.slice(start,end);
  const writes=[];
  const ctx={Promise,console:{warn(){}},findUser:()=>({uid:'OTHER'}),notesAuthUid:()=> 'ADMIN',isRetockerAuth:()=>true,
    db:{collection:()=>({doc:()=>({set:(data)=>{writes.push(data);return Promise.resolve();},get:()=>Promise.resolve({exists:true,data:()=>({uid:'OTHER'})})})})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  await ctx.notesEnsureCloudOwner('bob',{exists:true,data:()=>({})});
  assert.equal(JSON.stringify(writes),JSON.stringify([{uid:'OTHER'}]));
});
