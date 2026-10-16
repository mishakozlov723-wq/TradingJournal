// Local DOM integration; all non-local requests are blocked. No Firebase credentials.
const {server,chromium}=require('./models-full-harness.cjs'),assert=require('node:assert/strict');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());await page.goto(url);
   await page.evaluate(async mobile=>{
    USERS=[{login:'tester',email:'tester@journal.local',uid:'test-uid'}];currentUser=USERS[0];viewingUser='tester';firebase.auth().currentUser={uid:'test-uid',email:currentUser.email};document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';document.body.classList.toggle('mobile-mode',mobile);await loadData();
    window.xssExecuted=false;
    const t={id:'x" onclick="window.xssExecuted=true',uid:'test-uid',asset:'EURUSD',direction:'LONG',openDT:'2026-01-01T09:00',closeDT:'2026-01-01T10:00',r:1,chart:'https://invalid.invalid/x" onerror="window.xssExecuted=true'};
    trades=[t];render();renderGallery();openCalDayModal(1,trades);
   },width<600);
   await page.waitForTimeout(150);
   assert.equal(await page.evaluate(()=>xssExecuted),false);
   assert.equal(await page.locator('#allTradesBody [onerror],#allTradesBody [onclick],#galleryGrid [onerror],#calDayTradesList [onclick]').count(),0);
   assert.equal(await page.locator('#allTradesBody .del-btn').getAttribute('data-id'),'x" onclick="window.xssExecuted=true');
   console.log('PASS '+width+': persisted malicious chart/id remain inert in table, gallery and calendar');
   await page.evaluate(async()=>{closeCalDayModal();await NTM.start();});
   await page.locator('#notesPageTitle').fill('Original page');await page.evaluate(()=>NTM.save());
   await page.waitForFunction(()=>{const d=JSON.parse(localStorage.getItem('model-test-db')||'{}');return !!d['titles/tester']?.notesWorkspaceMeta?.revision;});
   await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('model-test-db')),root=d['titles/tester'];root.notesWorkspaceMeta.updatedAt+=1000;root.notesWorkspaceMeta.revision='another-device';const id=root.notesWorkspaceMeta.pageIds[0];d['titles/tester__np__'+id].notesPage.title='Other device';localStorage.setItem('model-test-db',JSON.stringify(d));});
   await page.locator('#notesPageTitle').fill('My unsynced draft');await page.evaluate(()=>NTM.save());await page.waitForSelector('#notesConflictPanel');
   assert.equal(await page.locator('#notesPageTitle').inputValue(),'My unsynced draft');
   assert.equal(await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('model-test-db')),id=d['titles/tester'].notesWorkspaceMeta.pageIds[0];return d['titles/tester__np__'+id].notesPage.title;}),'Other device');
   await page.evaluate(()=>history.replaceState(null,'',location.pathname));await page.reload();await page.evaluate(async mobile=>{document.body.classList.toggle('mobile-mode',mobile);USERS=[{login:'tester',email:'tester@journal.local',uid:'test-uid'}];currentUser=USERS[0];viewingUser='tester';firebase.auth().currentUser={uid:'test-uid'};document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';await loadData();await NTM.start();},width<600);
   await page.waitForSelector('#notesConflictPanel');assert.equal(await page.locator('#notesPageTitle').inputValue(),'My unsynced draft');assert.deepEqual(errors,[]);
   console.log('PASS '+width+': concurrent Notes write blocked atomically; cloud and local draft survive reload');
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
