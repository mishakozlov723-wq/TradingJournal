'use strict';
const {server,chromium}=require('./models-full-harness.cjs'),assert=require('node:assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true});
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600}),owner=await context.newPage(),errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));owner.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());await owner.goto(url);
 const state=await owner.evaluate(async mobile=>{
  currentUser=(USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'},{login:'user-test',email:'user-test@journal.local',role:'user',uid:'test-user-uid'}],USERS).find(u=>u.role==='user');viewingUser=currentUser.login;firebase.auth().currentUser={uid:currentUser.uid,email:currentUser.email};document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';document.body.classList.toggle('mobile-mode',mobile);await loadData();await NTM.start();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#57a5ff';ctx.fillRect(0,0,2,2);const data=canvas.toDataURL('image/png'),ref=await NTM.imageUpload(data),id=ref.slice(6);
  if(await NTM.imageResolve(ref)!==data)throw Error('Owner original not readable');
  firebase.auth().currentUser={uid:'other-test-user'};let denied=false;try{await NTM.imageResolve(ref);}catch(_){denied=true;}if(!denied)throw Error('Owner cache leaked after account change');firebase.auth().currentUser={uid:currentUser.uid,email:currentUser.email};
  const page=NTM.page();page.title='Private image share test';page.blocks=[{id:'image-test',type:'image',src:ref,alt:'Test chart'}];if(!await NTM.generate(page,viewingUser))throw Error('Share generation failed');
  const token=page.shareToken,raw=JSON.parse(localStorage.getItem('model-test-db'));
  if(raw['notesShares/'+token].imageIds[0]!==id)throw Error('Image manifest missing');if(raw['notesShares/'+token+'/images/'+id].data!==data)throw Error('Scoped image bytes mismatch');return {token,id,data};
 },width<600);
 const viewer=await context.newPage();await viewer.goto(url+'/?note='+state.token);await viewer.waitForFunction(()=>document.querySelector('#notesBlocks img')?.naturalWidth>0);assert.equal(await viewer.locator('#notesBlocks img').first().getAttribute('src'),state.data);
 const reads=await viewer.evaluate(()=>testImageReads||[]);assert.ok(reads.includes('notesShares/'+state.token+'/images/'+state.id));assert.ok(!reads.some(x=>x.startsWith('notesImages/')),'anonymous viewer must never read the original collection');assert.equal(await viewer.locator('#notesBlocks [contenteditable=true]').count(),0);
 assert.equal(await owner.evaluate(async()=>{NTM.page().blocks=[];return NTM.write(NTM.page(),viewingUser,true);}),true);await viewer.reload();await viewer.waitForFunction(()=>document.querySelector('#notesPageTitle')?.value==='Private image share test'||document.title.includes('Private image share test'));assert.equal(await viewer.locator('#notesBlocks img').count(),0);
 assert.equal(await owner.evaluate(async()=>NTM.disable(NTM.page(),viewingUser)),true);await viewer.reload();await viewer.waitForFunction(()=>document.getElementById('notesEmptyState').innerText.includes('Link unavailable'));
 const original=await owner.evaluate(async id=>(await db.collection('notesImages').doc(id).get()).exists,state.id);assert.equal(original,true,'revocation never deletes private originals');assert.deepEqual(errors,[]);
 console.log('PASS '+width+'px: owner-only original, cross-account cache isolation, scoped public image, removal and link revocation');await context.close();
}}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
