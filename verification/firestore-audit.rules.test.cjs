'use strict';
// Requires a local Firestore emulator; refuses all non-loopback endpoints.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,writeBatch}=require('firebase/firestore');
let env;
before(async()=>{
 const address=process.env.FIRESTORE_EMULATOR_HOST||'';assert.match(address,/^(127\.0\.0\.1|localhost):\d+$/,'A local emulator is mandatory; never contact production');
 const [host,port]=address.split(':');
 env=await initializeTestEnvironment({projectId:'demo-tradingjournal-audit',firestore:{host,port:Number(port),rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
});
after(async()=>{if(env)await env.cleanup();});
for(const collection of ['trades','backtestTrades']){
 test(collection+': administrator cannot bypass direction validation',async()=>{
  const db=env.authenticatedContext('DXBgoKHXkAVW9Rclf1juT6JrMhA2').firestore();
  await assertSucceeds(setDoc(doc(db,collection,'admin-valid'),{uid:'owner-a',direction:'LONG'}));
  await assertFails(setDoc(doc(db,collection,'admin-injection'),{uid:'owner-a',direction:'<img onerror=alert(1)>'}));
  await assertFails(updateDoc(doc(db,collection,'admin-valid'),{direction:'BAD'}));
 });

 test(collection+': owner valid direction accepted; stored HTML and arbitrary enum rejected',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  await assertSucceeds(setDoc(doc(db,collection,'ok'),{uid:'owner-a',direction:'LONG',r:1,riskPercent:1}));
  await assertFails(setDoc(doc(db,collection,'bad-html'),{uid:'owner-a',direction:'<img onerror=alert(1)>',r:1}));
  await assertFails(setDoc(doc(db,collection,'bad-enum'),{uid:'owner-a',direction:'UP',r:1}));
  await assertFails(updateDoc(doc(db,collection,'ok'),{direction:'<svg onload=alert(1)>'}));
  await assertSucceeds(updateDoc(doc(db,collection,'ok'),{direction:'SHORT'}));
 });
 test(collection+': users remain isolated; legacy unrelated updates compatible',async()=>{
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),collection,'legacy'),{uid:'owner-a',direction:'legacy',notes:'old'}));
  const own=env.authenticatedContext('owner-a').firestore(),other=env.authenticatedContext('owner-b').firestore();
  await assertSucceeds(updateDoc(doc(own,collection,'legacy'),{notes:'new'}));
  await assertFails(getDoc(doc(other,collection,'legacy')));
  await assertFails(updateDoc(doc(other,collection,'legacy'),{notes:'attack'}));
  await assertFails(updateDoc(doc(own,collection,'legacy'),{uid:'owner-b'}));
  await assertFails(setDoc(doc(other,collection,'forged-owner'),{uid:'owner-a',direction:'LONG'}));
 });
}

test('atomic metadata and multi-trade mutation rejects as a whole when one write is denied',async()=>{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users','owner-a'),{login:'atomic-owner'});await setDoc(doc(db,'titles','atomic-owner'),{uid:'owner-a',assets:[{name:'OLD'}]});for(const id of ['atomic-one','atomic-two'])await setDoc(doc(db,'trades',id),{uid:'owner-a',asset:'OLD',direction:'LONG'});});
 const db=env.authenticatedContext('owner-a').firestore(),batch=writeBatch(db);
 batch.update(doc(db,'titles','atomic-owner'),{assets:[{name:'NEW'}],assetRevision:1});batch.update(doc(db,'trades','atomic-one'),{asset:'NEW'});batch.update(doc(db,'trades','atomic-two'),{asset:'NEW',direction:'INVALID'});await assertFails(batch.commit());
 assert.equal((await getDoc(doc(db,'titles','atomic-owner'))).data().assets[0].name,'OLD');for(const id of ['atomic-one','atomic-two'])assert.equal((await getDoc(doc(db,'trades',id))).data().asset,'OLD');
});
