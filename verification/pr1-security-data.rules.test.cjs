'use strict';
// PR1: journal record ids cannot carry markup, and a retired asset name can be
// used again only through an explicit, counted revival. Loopback emulator only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const F=require('firebase/firestore');const {load}=require('../tests/audit-source.cjs');
let env;before(async()=>{const host=process.env.FIRESTORE_EMULATOR_HOST||'';assert.match(host,/^(127\.0\.0\.1|localhost):\d+$/,'A local emulator is mandatory; never contact production');const [h,p]=host.split(':');env=await initializeTestEnvironment({projectId:'demo-tradingjournal-audit',firestore:{host:h,port:+p,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});after(async()=>{if(env)await env.cleanup();});
const ADMIN='DXBgoKHXkAVW9Rclf1juT6JrMhA2';
function snap(d){return {exists:d.exists(),data:()=>d.data(),id:d.id};}
// VM-extracted functions create cross-realm objects; re-home plain containers only.
function hostPlain(v){if(Array.isArray(v))return Array.from(v,hostPlain);if(v&&typeof v==='object'&&v.constructor&&v.constructor.name==='Object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,hostPlain(x)]));return v;}
function compat(db){return {collection(name){return {doc(id){return {ref:F.doc(db,name,id)};},where(k,op,v){return {get:async()=>{const ds=await F.getDocsFromServer(F.query(F.collection(db,name),F.where(k,op,v)));return {forEach:cb=>ds.forEach(d=>cb(snap(d)))};}};}};},runTransaction(callback){return F.runTransaction(db,tx=>callback({get:async r=>snap(await tx.get(r.ref)),set:(r,v,opt)=>opt?tx.set(r.ref,hostPlain(v),opt):tx.set(r.ref,hostPlain(v)),update:(r,v)=>tx.update(r.ref,hostPlain(v)),delete:r=>tx.delete(r.ref)}));}};}
async function fixture(key){const uid='pr1-'+key,login='pr1-journal-'+key;await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await F.setDoc(F.doc(db,'users',uid),{login});await F.setDoc(F.doc(db,'titles',login),{uid,assets:[{name:'OLD',color:'#123456'},{name:'OTHER',color:'#654321'}],deletedAssets:[]});await F.setDoc(F.doc(db,'trades','pr1'+key+'old'),{uid,asset:'OLD',direction:'LONG'});await F.setDoc(F.doc(db,'trades','pr1'+key+'other'),{uid,asset:'OTHER',direction:'LONG'});});return {uid,login,key,db:env.authenticatedContext(uid).firestore(),other:env.authenticatedContext(uid).firestore()};}
function client(f){return load('public/app.js',['tjChangeAssetSettings'],{db:compat(f.db),Promise,Date,Math,normalizeAssetDefinitions:x=>structuredClone(x||[])});}
const rename=(from,to)=>s=>{s.assets.find(x=>x.name===from).name=to;};
const guardOf=async f=>(await F.getDoc(F.doc(f.db,'journalAssetGuards',f.uid))).data();

for(const collection of ['trades','backtestTrades']){
  test('PR1 '+collection+': ids with quotes or markup are refused at creation for owner and administrator',async()=>{
    const valid={uid:'pr1-owner',direction:'LONG',r:1,riskPercent:1};
    for(const uid of ['pr1-owner',ADMIN]){
      const db=env.authenticatedContext(uid).firestore(),tag=uid===ADMIN?'admin':'owner';
      await assertSucceeds(F.setDoc(F.doc(db,collection,'1730000000000ab12'+tag),valid));
      await assertSucceeds(F.setDoc(F.doc(db,collection,'pr1_Generated-ID-'+tag),valid));
      for(const id of ['x" onclick="alert(1)','x\' onmouseover=\'alert(1)','<img src=x onerror=alert(1)>','with space','dot.ted','x'.repeat(129)]){
        await assertFails(F.setDoc(F.doc(db,collection,id+tag),valid));
      }
    }
  });
  test('PR1 '+collection+': legacy records with unusual ids stay editable and deletable',async()=>{
    const id='pr1 legacy "quoted" '+collection;
    await env.withSecurityRulesDisabled(c=>F.setDoc(F.doc(c.firestore(),collection,id),{uid:'pr1-owner',direction:'LONG',r:1}));
    const db=env.authenticatedContext('pr1-owner').firestore();
    await assertSucceeds(F.updateDoc(F.doc(db,collection,id),{notes:'still editable'}));
    await assertSucceeds(F.deleteDoc(F.doc(db,collection,id)));
  });
}

test('PR1 re-adding a retired asset in settings revives it; trades with that name are accepted again',async()=>{
  const f=await fixture('readd');
  await client(f).tjChangeAssetSettings(f.login,f.uid,rename('OLD','NEW'),'OLD','NEW');
  await assertFails(F.setDoc(F.doc(f.other,'trades','pr1readdbefore'),{uid:f.uid,asset:'OLD',direction:'LONG'}));
  const settings=await client(f).tjChangeAssetSettings(f.login,f.uid,s=>{s.assets.push({name:'OLD',color:'#abcdef'});});
  assert.ok(settings.assets.some(a=>a.name==='OLD'));
  const guard=await guardOf(f);
  assert.deepEqual(guard.retired,[]);assert.equal(guard.revivals,1);assert.equal(guard.locked,false);
  await assertSucceeds(F.setDoc(F.doc(f.other,'trades','pr1readdafter'),{uid:f.uid,asset:'OLD',direction:'LONG'}));
  assert.equal((await F.getDoc(F.doc(f.db,'trades','pr1readdold'))).data().asset,'NEW','migrated trades keep their new name');
});

test('PR1 renaming another asset to a retired name migrates it and revives that name atomically',async()=>{
  const f=await fixture('torenamed');
  await client(f).tjChangeAssetSettings(f.login,f.uid,rename('OLD','NEW'),'OLD','NEW');
  await client(f).tjChangeAssetSettings(f.login,f.uid,rename('OTHER','OLD'),'OTHER','OLD');
  const guard=await guardOf(f);
  assert.deepEqual(guard.retired,['OTHER']);assert.equal(guard.revivals,1);assert.equal(guard.locked,false);
  assert.equal((await F.getDoc(F.doc(f.db,'trades','pr1torenamedother'))).data().asset,'OLD');
  assert.equal((await F.getDoc(F.doc(f.db,'trades','pr1torenamedold'))).data().asset,'NEW');
  await assertFails(F.setDoc(F.doc(f.other,'trades','pr1torenamedlate'),{uid:f.uid,asset:'OTHER',direction:'LONG'}));
  await assertSucceeds(F.setDoc(F.doc(f.other,'trades','pr1torenamednew'),{uid:f.uid,asset:'OLD',direction:'LONG'}));
});

test('PR1 retired names cannot be erased without an unlocked revival counted exactly once',async()=>{
  const f=await fixture('guarded');
  await client(f).tjChangeAssetSettings(f.login,f.uid,rename('OLD','NEW'),'OLD','NEW');
  const ref=F.doc(f.other,'journalAssetGuards',f.uid);
  await assertFails(F.updateDoc(ref,{retired:[]}));
  await assertFails(F.updateDoc(ref,{retired:[],revivals:2}));
  await assertFails(F.updateDoc(ref,{retired:[],revivals:'1'}));
  await assertFails(F.updateDoc(ref,{retired:[],revivals:1,locked:true}));
  await assertFails(F.updateDoc(F.doc(env.authenticatedContext('not-'+f.uid).firestore(),'journalAssetGuards',f.uid),{retired:[],revivals:1}));
  await assertFails(F.deleteDoc(ref));
  assert.deepEqual((await guardOf(f)).retired,['OLD']);
  await assertSucceeds(F.updateDoc(ref,{retired:[],revivals:1}));
  await assertFails(F.updateDoc(ref,{retired:['OLD'],revivals:0}),'the counter never goes back');
});
