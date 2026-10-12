const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.SYTER_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../public'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function fn(name){let start=source.indexOf('  function '+name+'('),tail=source.slice(start);return tail.slice(0,tail.search(/^  }\r?$/m)+3);}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));if(u.hostname!=='journal.test'||!fs.existsSync(f))return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(f,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});return route.fulfill({path:f});});
 await page.goto('https://journal.test/');await page.addStyleTag({path:path.join(root,'trade-media.css')});
 await page.evaluate(()=>{
 const wrap=document.getElementById('settingsWrap');document.body.append(wrap);wrap.style.cssText='display:flex;position:fixed;top:30px;right:20px;width:40px;height:30px;overflow:hidden;transform:translateZ(0)';
 const thumb=document.createElement('button');thumb.id='testAnchor';thumb.style.cssText='position:fixed;left:430px;top:460px;width:30px;height:24px';document.body.append(thumb);
 document.getElementById('notePanelText').value='Test notes';
 });
 await page.addScriptTag({path:path.join(root,'floating-panels.js')});
 await page.evaluate(()=>document.getElementById('settingsWrap').classList.add('open'));
 await page.waitForFunction(()=>document.getElementById('versionPanel').matches(':popover-open'));
 assert.equal(await page.locator('#versionPanel').evaluate(e=>e.offsetWidth),226,'original compact settings width');
 assert.ok(await page.locator('#versionPanel').evaluate(e=>e.getAnimations().length)>0,'settings entrance animates');
 await page.waitForTimeout(250);
 assert.equal(await page.locator('#settingsBtn svg').count(),1);
 assert.equal(await page.locator('.notes-workspace-open-arrow svg').count(),3);
 assert.equal(await page.locator('#versionPanel').evaluate(e=>e.parentElement===document.body),true);
 const bounds=()=>page.locator('#versionPanel').boundingBox();let box=await bounds();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1200&&box.y+box.height<=800);
 await page.setViewportSize({width:380,height:400});await page.waitForTimeout(100);box=await bounds();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=380&&box.y+box.height<=400);
 await page.evaluate(()=>document.getElementById('settingsWrap').classList.remove('open'));await page.waitForFunction(()=>!document.getElementById('versionPanel').matches(':popover-open'));
 await page.setViewportSize({width:1200,height:800});
 await page.evaluate(()=>{TJPanels.anchorNote(document.getElementById('testAnchor'));document.getElementById('notePanel').classList.add('open');});await page.waitForTimeout(300);
 box=await page.locator('#notePanel').boundingBox();assert.ok(box.x+box.width<=430);assert.ok(Math.abs(box.y+box.height/2-472)<2,'preview vertically centered on thumbnail');
 await page.evaluate(()=>document.getElementById('testAnchor').style.left='10px');await page.setViewportSize({width:1190,height:800});await page.waitForTimeout(100);box=await page.locator('#notePanel').boundingBox();assert.ok(box.x>=40,'preview flips right when left has no space');
 const beforeScroll=await page.locator('#notePanel').boundingBox();
 await page.evaluate(()=>{document.body.style.minHeight='3000px';window.scrollTo(0,450);});await page.waitForTimeout(100);
 const afterScroll=await page.locator('#notePanel').boundingBox();assert.equal(afterScroll.y,beforeScroll.y,'scroll leaves preview stationary');assert.equal(afterScroll.x,beforeScroll.x);
 await page.evaluate(()=>document.getElementById('fullscreenImgOverlay').classList.add('open'));await page.waitForTimeout(300);
 assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x+30,y+30).closest('#fullscreenImgOverlay'),afterScroll),true,'fullscreen covers the preview');
 await page.evaluate(()=>document.getElementById('fullscreenImgOverlay').classList.remove('open'));
 await page.addScriptTag({content:'var opened=null;function closeChartTradeCard(){}function hideChartTooltip(){}function openBestTrade(id){opened=id;}'+fn('openChartTradeCard')});await page.evaluate(()=>openChartTradeCard({trade:{id:'trade-9'}}));assert.equal(await page.evaluate(()=>opened),'trade-9');assert.equal(await page.locator('#chartTradeCard').count(),0);
 console.log('PASS compact animated settings, pack icons, stationary preview on scroll, fullscreen above preview; settings escape clipping and fit small viewport; anchored preview flips sides and centers; Overview uses shared trade dialog; old card removed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
