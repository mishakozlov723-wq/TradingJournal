const {server,chromium}=require('./mobile-polish-harness.cjs'),fs=require('node:fs'),assert=require('node:assert/strict');
const html=require('./assembled-html.cjs')();
const authSource="var tjAdminUid = 'test-admin-uid';\n"+html.match(/function isRetockerAuth\(\) \{[\s\S]*?\n  \}/)[0];
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());await page.goto(url);await page.waitForSelector('#notesPageTitle');await page.addScriptTag({content:authSource});
 await page.evaluate(mobile=>{document.body.classList.toggle('mobile-mode',mobile);window.testAuth={currentUser:{uid:'ordinary-user'}};firebase.auth=()=>testAuth;currentUser={login:'retocker',role:'admin'};viewingUser='retocker';NT.render();NT.setState('Saved');},width<600);
 assert.equal(await page.locator('#notesSaveControls').isVisible(),false);assert.equal(await page.locator('#notesSaveState').isVisible(),false);assert.equal(await page.locator('#notesPageSettingsBtn').isVisible(),true);
 await page.evaluate(()=>{testAuth.currentUser={uid:'test-admin-uid'};viewingUser='alice';NT.render();});assert.equal(await page.locator('#notesSaveToggle').isVisible(),true);assert.equal(await page.locator('#notesSaveState').isVisible(),false);
 await page.locator('#notesSaveToggle').click();assert.equal(await page.locator('#notesSaveState').isVisible(),true);await page.evaluate(()=>NT.setState('Saving…','saving'));assert.equal(await page.locator('#notesSaveState').innerText(),'Saving…');
 const bounds=await page.evaluate(()=>{const r=id=>document.getElementById(id).getBoundingClientRect();return {gear:r('notesPageSettingsBtn').left,toggleRight:r('notesSaveToggle').right,stateRight:r('notesSaveState').right,toggleLeft:r('notesSaveToggle').left,scroll:document.documentElement.scrollWidth,width:innerWidth,last:document.querySelector('.notes-topbar-right').lastElementChild.id};});assert.equal(bounds.last,'notesPageSettingsBtn');assert.ok(bounds.toggleRight<=bounds.gear);assert.ok(bounds.stateRight<=bounds.toggleLeft);assert.equal(bounds.scroll,bounds.width);
 await page.evaluate(()=>NT.setState('Cloud recovery needed · saved locally','error'));assert.equal(await page.locator('#notesSaveState').isVisible(),true);assert.ok(await page.locator('#notesSaveState').evaluate(el=>el.getBoundingClientRect().height<=40));
 await page.waitForTimeout(900);
 if(width===390)await page.screenshot({path:process.env.STATUS_SCREENSHOT||__dirname+'/../../verification/admin-status-mobile.png'});
 await page.locator('#notesSaveToggle').click();assert.equal(await page.locator('#notesSaveState').isVisible(),false);await page.locator('#notesSaveToggle').click();await page.evaluate(()=>NT.enter());assert.equal(await page.locator('#notesSaveState').isVisible(),false);
 await page.evaluate(()=>{NT.readonly();});assert.equal(await page.locator('#notesSaveControls').isVisible(),false);await page.evaluate(()=>NT.writeable());assert.equal(await page.locator('#notesSaveState').isVisible(),false);
 await page.evaluate(()=>{testAuth.currentUser={uid:'ordinary-user'};NT.syncStatus();});assert.equal(await page.locator('#notesSaveControls').isVisible(),false);
 await page.reload();await page.waitForSelector('#notesPageTitle');assert.equal(await page.locator('#notesSaveState').isVisible(),false);assert.deepEqual(errors,[]);
 console.log('PASS '+width+'px: ordinary user, authenticated retocker, viewed-account independence, toggle, live status, gear ordering, long status, reopen, share, auth switch, reload');await page.close();
}}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

