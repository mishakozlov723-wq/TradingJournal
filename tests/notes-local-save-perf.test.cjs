'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../public/notes-workspace.js'),'utf8');
function fn(name){const a=src.indexOf('  function '+name+'(');assert.ok(a>=0,name);const tail=src.slice(a);return tail.slice(0,tail.search(/^  }\r?$/m)+3);}
function fixture({mobile=true,cache=true,quota=false}={}){
 let encodes=0,release;const writes=[],cached=[],opened=new Promise(r=>release=r);
 const c={Object,Date,Promise,JSON:{parse:JSON.parse,stringify(...args){encodes++;return JSON.stringify(...args);}},notesLoadedFor:'alice',notesLoadedRemote:true,notesCloudRevision:'[1,"base"]',notesCloudConflict:true,notesMobileCacheEnabled:()=>mobile,notesMobileCacheOpen:()=>opened,notesStorageKey:k=>'notes:'+k,
 localStorage:{setItem(k,v){if(quota)throw Error('quota');writes.push([k,v]);}}};
 vm.createContext(c);for(const n of ['notesMobileCachePut','notesSaveLocal'])vm.runInContext(fn(n),c);
 const flush=async()=>{release(cache?{transaction:()=>({objectStore:()=>({put:(v,k)=>cached.push([k,JSON.parse(JSON.stringify(v))])})})}:null);await Promise.resolve();};
 return {c,writes,cached,flush,encodes:()=>encodes};
}
const snapshot=()=>({version:3,pages:[{id:'synthetic',title:'Тест 📝',blocks:[{text:'Synthetic only',optional:undefined,image:'data:image/png;base64,AAAA'}]}],groups:[],updatedAt:1});
test('mobile local save encodes once, persists immediately, and freezes the pending IDB snapshot',async()=>{
 const h=fixture(),s=snapshot();assert.equal(h.c.notesSaveLocal('alice',s),true);assert.equal(h.encodes(),1);assert.equal(h.writes.length,1);assert.equal(h.cached.length,0);
 const persisted=JSON.parse(h.writes[0][1]);assert.equal(persisted.cloudBase,'[1,"base"]');assert.equal(persisted.conflict,true);assert.equal(persisted.pages[0].title,'Тест 📝');assert.equal('optional' in persisted.pages[0].blocks[0],false);
 assert.equal(s.cloudBase,undefined);s.pages[0].title='newer edit';await h.flush();assert.deepEqual(h.cached[0][1].data,persisted);assert.equal(h.cached[0][0],'alice');
});
test('desktop still saves once without an IDB write',async()=>{
 const h=fixture({mobile:false});assert.equal(h.c.notesSaveLocal('alice',snapshot()),true);assert.equal(h.encodes(),1);await h.flush();assert.equal(h.cached.length,0);
});
test('unavailable IDB does not prevent the synchronous durable local write',async()=>{
 const h=fixture({cache:false});assert.equal(h.c.notesSaveLocal('alice',snapshot()),true);assert.equal(h.writes.length,1);await h.flush();assert.equal(h.cached.length,0);assert.equal(h.encodes(),1);
});
test('localStorage quota failure returns false but retains the independent IDB recovery copy',async()=>{
 const h=fixture({quota:true});assert.equal(h.c.notesSaveLocal('alice',snapshot()),false);await h.flush();assert.equal(h.cached.length,1);assert.equal(h.encodes(),1);
});
test('another owner does not inherit the currently loaded cloud revision',async()=>{
 const h=fixture();assert.equal(h.c.notesSaveLocal('bob',snapshot()),true);assert.equal(JSON.parse(h.writes[0][1]).cloudBase,undefined);await h.flush();assert.equal(h.cached[0][0],'bob');
});
test('ownerless snapshots retain the direct localStorage fallback',async()=>{
 const h=fixture();assert.equal(h.c.notesSaveLocal('',snapshot()),true);assert.equal(h.encodes(),1);await h.flush();assert.equal(h.cached.length,0);
});
