'use strict';
// Real web DOM + production desktop enhancement. All remote traffic blocked.
const {server,chromium}=require('./models-full-harness.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);await page.waitForFunction(()=>typeof openModal==='function');
  await page.evaluate(async()=>{USERS=[{login:'tester',uid:'test-uid'}];currentUser=USERS[0];viewingUser='tester';firebase.auth().currentUser={uid:'test-uid'};appRoot.style.display='block';loginScreen.style.display='none';await loadData();window.syterDesktop={setMiniMode:async on=>({mini:on,pinned:true}),setMiniPinned:async x=>x,miniReady(){},onModeRequest(fn){window.testChangeMode=fn}};});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../desktop/mini-journal.js'),'utf8')});
  const fill=()=>page.evaluate(()=>{openModal();magnitudeInput.value='2';riskPercentInput.value='1';syterTradeNotes.value='original draft';setDateTimeInput(openInput,'2026-01-01T09:00');setDateTimeInput(closeInput,'2026-01-01T10:00');});
  await fill();await page.evaluate(()=>{window.sent=[];window.releaseSave=null;remoteSaveTrade=rec=>{sent.push({...rec});return new Promise(r=>releaseSave=r)};tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(await page.evaluate(()=>tradeForm.dataset.saving),'1');
  await page.evaluate(()=>{closeModal();openModal();tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(await page.evaluate(()=>sent.length),1);assert.equal(await page.locator('#magnitudeInput').inputValue(),'2');assert.equal(await page.locator('#syterTradeNotes').inputValue(),'original draft');assert.equal(await page.evaluate(()=>modalOverlay.classList.contains('open')),true);
  await page.evaluate(()=>releaseSave(true));await page.waitForFunction(()=>!tradeForm.inert);assert.equal(await page.evaluate(()=>modalOverlay.classList.contains('open')),false);assert.equal(await page.evaluate(()=>trades.length),1);
  await fill();assert.notEqual(await page.evaluate(()=>tradeForm.dataset.saving),'1'); // guard released
  console.log('PASS pending desktop save blocks close/open and duplicate submit; success releases guard');
  await page.evaluate(()=>{remoteSaveTrade=rec=>{sent.push({...rec});return Promise.resolve(false)};tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!tradeForm.inert);assert.equal(await page.locator('#syterTradeNotes').inputValue(),'original draft');assert.equal(await page.evaluate(()=>modalOverlay.classList.contains('open')),true);const retryId=await page.evaluate(()=>sent.at(-1).id);
  await page.evaluate(()=>{remoteSaveTrade=rec=>{sent.push({...rec});return Promise.resolve(true)};tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.waitForFunction(()=>!tradeForm.inert);assert.equal(await page.evaluate(()=>sent.at(-1).id),retryId);assert.equal(await page.evaluate(()=>trades.length),2);
  console.log('PASS failed save retains draft and retry reuses ID');
  await fill();await page.evaluate(()=>{remoteSaveTrade=async()=>{throw Error('offline')};tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.waitForFunction(()=>!tradeForm.inert);assert.equal(await page.locator('#magnitudeInput').inputValue(),'2');assert.notEqual(await page.evaluate(()=>tradeForm.dataset.saving),'1');
  console.log('PASS thrown network error preserves draft and unlocks form');
  for(const [r,risk]of [['1000001','1'],['2','101'],['Infinity','1'],['2','-1'],[' ','1']]){
   const before=await page.evaluate(()=>sent.length);await page.evaluate(([r,risk])=>{magnitudeInput.value=r;riskPercentInput.value=risk;tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));},[r,risk]);assert.equal(await page.evaluate(()=>sent.length),before);assert.equal(await page.locator('#saveError').isVisible(),true);
  }
  console.log('PASS desktop rejects unsupported, empty and non-finite numbers before any write');
  await fill();await page.evaluate(async()=>{remoteSaveTrade=rec=>{sent.push({...rec});return Promise.resolve(true)};tradingModelsReady=true;tradingModelsUser=viewingUser;await testChangeMode(true);});assert.equal(await page.evaluate(()=>document.body.classList.contains('syter-mini')),true);
  await page.evaluate(()=>tradeForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.waitForFunction(()=>!tradeForm.inert);assert.equal(await page.evaluate(()=>modalOverlay.classList.contains('open')),true);assert.equal(await page.locator('#magnitudeInput').inputValue(),'');assert.notEqual(await page.evaluate(()=>tradeForm.dataset.saving),'1');
  console.log('PASS successful mini save opens the next editable draft');
  assert.deepEqual(errors,[]);console.log('PASS no page errors / no production requests');
 }finally{await context.close();await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
