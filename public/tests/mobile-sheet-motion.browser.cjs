const {server,chromium}=require('./mobile-polish-harness.cjs'),assert=require('node:assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{for(const width of [390,768]){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());await page.goto(url);await page.waitForSelector('#notesPageTitle');await page.waitForTimeout(200);
 for(const control of ['.notes-block-plus','.notes-block-grip']){
  await page.evaluate(selector=>{document.activeElement.blur();const row=document.querySelector('#notesBlocks .notes-block');row.classList.add('notes-tools-pinned');row.querySelector('.notes-editable').focus();},control);
  await page.locator('#notesBlocks '+control).first().tap();
  await page.waitForSelector('.notes-mobile-sheet-handle');
  const frames=await page.locator('.notes-menu').first().evaluate(el=>{const a=el.getAnimations().find(a=>a.animationName==='notesMobileSheetRise');if(!a)throw Error('Missing entry animation');a.pause();const frames=[0,120,300].map(t=>{a.currentTime=t;const s=getComputedStyle(el),m=new DOMMatrixReadOnly(s.transform);return {x:m.m41,y:m.m42,opacity:Number(s.opacity),height:el.offsetHeight};});a.finish();return frames;});
  assert.ok(Math.abs(frames[0].y-frames[0].height)<2);assert.ok(frames[1].y>0&&frames[1].y<frames[0].y);assert.equal(frames[2].y,0);assert.equal(frames[0].x,frames[2].x);assert.ok(frames[1].opacity>frames[0].opacity);
  await page.evaluate(()=>NT.closeMenu());await page.waitForTimeout(180);
 }
 // Start dragging during entry and ensure no jump to the resting position.
 await page.evaluate(()=>NT.menu(document.querySelector('#notesPageSettingsBtn'),[{label:'Action'},{label:'Another action'}]));await page.waitForSelector('.notes-mobile-sheet-handle');
 const start=await page.locator('.notes-menu').evaluate(el=>{const a=el.getAnimations().find(a=>a.animationName==='notesMobileSheetRise');a.pause();a.currentTime=120;return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;});
 const grip=await page.locator('.notes-mobile-sheet-handle').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 const held=await page.locator('.notes-menu').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);assert.ok(Math.abs(start-held)<1,'Entry-to-drag position is continuous');
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2+150,{steps:6});await page.mouse.up();await page.waitForTimeout(450);assert.equal(await page.locator('.notes-menu').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>NT.menu(document.querySelector('#notesPageSettingsBtn'),[{label:'Action'}]));assert.equal(await page.locator('.notes-menu').evaluate(el=>getComputedStyle(el).animationName),'none');assert.deepEqual(errors,[]);
 console.log('PASS '+width+'px: plus/grip rise frames, centered entry, interruption by drag, swipe close, reduced motion');await page.close();
}}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

