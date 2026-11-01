const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron } = require(process.env.SYTER_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const desktop = path.join(root, 'desktop');
const output = path.join(desktop, 'test-output'); fs.mkdirSync(output, { recursive: true });
const chartPath = path.resolve(process.argv[2] || path.join(root, 'public/favicon-48x48.png'));
const original = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
function production(name) {
  const start = original.indexOf('  function ' + name + '('), tail = original.slice(start);
  return tail.slice(0, tail.search(/^  }\r?$/m) + 3);
}
let fixture = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const stubs = `
var currentUser={login:'Limon',uid:'student',role:'user'},viewingUser='Limon';
var tradingModelsReady=true,tradingModelsUser='Limon',backtestTradeMode=false,editingBacktestTradeId=null,selectedTradeModelId='',selectedTradeModelName='';
var currentScreenshot=null,isLong=true,isWin=true,trades=[],tjDataGeneration=1,tjServerTrades={},backtests=[],monthlyYear=2026;
var mediaDocs={},writes=[],failWrite=false,holdWrite=false,releaseWrite=null;
var firebase={auth:()=>({currentUser:{uid:'student'}}),firestore:{FieldValue:{delete:()=>null}}};
var db={collection:c=>({doc:id=>({c,id,get:async()=>({exists:!!mediaDocs[id],data:()=>mediaDocs[id]}),set:async function(data){writes.push(structuredClone(data));if(failWrite)throw Error('permission-denied fixture');}})}),batch:()=>{const ops=[];return {set:(ref,data)=>ops.push({ref,data:structuredClone(data)}),delete:()=>{},commit:async()=>{if(holdWrite)await new Promise(r=>releaseWrite=r);const trade=ops.find(o=>o.ref.c==='trades');if(trade)writes.push(trade.data);if(failWrite)throw Error('permission-denied fixture');ops.forEach(o=>{if(o.ref.c==='tradeImages')mediaDocs[o.ref.id]=o.data;});}}}};
function findUser(){return currentUser;} function applyTradeModel(t,id){if(id)t.modelId=id;}
function invalidateTradeNumbers(){} function render(){} function renderTradeModelControl(){}
function closeTradeModelMenu(){} function closeTradeAssetMenu(){} function updateTradeAssetUI(){}
function closeModelDeletePanel(){} function closeModelCreatePanel(){}
function clearTradeFormError(){document.getElementById('saveError').style.display='none';}
function setDateTimeInput(e,value){e.value=value;e.setAttribute('data-iso',value);}
function getDateTimeInputValue(e){return e.getAttribute('data-iso');}
function currentLocalDateTimeKey(){return '2099-01-01T00:00';}
function validateTradeDateOrder(a,b){return a<=b;} function pad2(x){return String(x).padStart(2,'0');}
document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';
document.getElementById('tradeModelCTA').disabled=false;
document.getElementById('closeModalBtn').onclick=()=>closeModal();
document.getElementById('modalOverlay').onclick=e=>{if(e.target===e.currentTarget)closeModal();};
document.getElementById('fullscreenImgCloseBtn').onclick=()=>document.getElementById('fullscreenImgOverlay').classList.remove('open');
document.getElementById('screenshotRemoveBtn').onclick=()=>{currentScreenshot=null;document.getElementById('screenshotPreviewWrap').style.display='none';};
`;
fixture = fixture.replace('</body>', '<script>' + stubs + ['tjClone','remoteSaveTrade','compressImage','openModal','closeModal'].map(production).join('\n') + '</script><script src="/trade-media.js"></script></body>');
const bootstrap = path.join(output, 'electron-test-main.cjs');
fs.writeFileSync(bootstrap, `const {app,Menu,Tray,clipboard,nativeImage}=require('electron');const trayOn=Tray.prototype.on;Tray.prototype.on=function(name,fn){if(name==='click')global.testTray=this;return trayOn.call(this,name,fn);};global.testClipboardPath=${JSON.stringify(chartPath)};clipboard.readImage=()=>nativeImage.createFromPath(global.testClipboardPath);clipboard.availableFormats=()=>global.testClipboardPath?['image/png']:[];clipboard.readBuffer=()=>Buffer.alloc(0);app.setPath('userData',${JSON.stringify(path.join(output,'profile-' + Date.now()))});const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(t){global.testMenu=t;return build.call(this,t);};require(${JSON.stringify(path.join(desktop,'main.js'))});`);
async function main() {
  const app = await _electron.launch({ executablePath: path.join(desktop,'node_modules/electron/dist/electron.exe'), args:[bootstrap], timeout:30000 }); console.log('Electron launched');
  try {
    await app.context().route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.protocol === 'file:' || u.protocol === 'data:') return route.continue();
      if (u.hostname !== 'retocker.web.app') return route.abort();
      if (u.pathname === '/') return route.fulfill({contentType:'text/html',body:fixture});
      const target=path.join(root,'public',decodeURIComponent(u.pathname));
      if (!target.startsWith(path.join(root,'public')) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.fulfill({status:404,body:''});
      return route.fulfill({path:target});
    });
    console.log('Routes installed'); await app.evaluate(async ({webContents})=>{
      let wc=webContents.getAllWebContents().find(w=>(w.getLastWebPreferences().preload||'').endsWith('preload.js'));
      if(!wc) wc=webContents.getAllWebContents().find(w=>w.getURL().includes('retocker'));
      try { await wc.loadURL('https://retocker.web.app/'); } catch(e) { if(!e.message.includes('(-3)')) throw e; }
    });
    console.log('Page reloaded'); const page=app.context().pages().find(p=>p.url().startsWith('https://retocker.web.app'));
    assert.ok(page,'journal page');
    page.on('pageerror',e=>console.log('PAGEERROR',e.message));
    await page.waitForFunction(()=>window.syterMiniInstalled);
    let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
    await page.evaluate(()=>{currentUser=null;document.getElementById('appRoot').style.display='none';document.getElementById('loginScreen').style.display='flex';});
    await app.evaluate(()=>global.testMenu.find(i=>i.label==='Мини-журнал').click());
    await page.locator('#syterModeNotice').waitFor({state:'visible'});
    assert.equal(dialogs,0,'sign-in request must not use a blocking dialog');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('syter-mini')),false);
    await page.evaluate(()=>{const input=document.querySelector('#loginScreen input');input.focus();input.value='Limon';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.evaluate(()=>document.activeElement.tagName),'INPUT');
    await page.evaluate(()=>{currentUser={login:'Limon',uid:'student',role:'user'};document.getElementById('appRoot').style.display='block';document.getElementById('loginScreen').style.display='none';});
    const fullBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
    await app.evaluate(()=>global.testMenu.find(i=>i.label==='Мини-журнал').click());
    await page.waitForFunction(()=>document.body.classList.contains('syter-mini'));
    await page.locator('#magnitudeInput').fill('2.5');
    await page.locator('#syterTradeNotes').fill('Вход по модели. Подтверждение на графике.');
    // Chromium paste event exercises image clipboard handling without changing the user's OS clipboard.
    const b64=fs.readFileSync(chartPath).toString('base64');
    await page.evaluate(async b=>{const blob=await(await fetch('data:image/png;base64,'+b)).blob();const dt=new DataTransfer();dt.items.add(new File([blob],'TradingView.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},b64);
    await page.waitForFunction(()=>currentScreenshot && !document.getElementById('tradeModalSubmitBtn').disabled);
    if(process.argv[3]){await page.locator('#screenshotInput').setInputFiles(process.argv[3]);await page.waitForFunction(()=>!TJMedia.busy&&TJMedia.snapshot().length===2);}
    const chart=await page.evaluate(()=>currentScreenshot);
    assert.equal(await page.locator('#syterRecognize').count(),0);
    assert.equal(await page.evaluate(()=>typeof syterDesktop.recognizeChart),'undefined');
    assert.equal(await page.locator('#syterTradeNotes').getAttribute('placeholder'),null);
    assert.equal(await page.locator('#syterMiniOwner').textContent(),'');
    const checkboxStyle=await page.locator('#syterCaptureImages').evaluate(e=>({color:getComputedStyle(e).backgroundColor,height:e.getBoundingClientRect().height}));
    assert.ok(Math.abs(checkboxStyle.height-14)<0.2);assert.equal(checkboxStyle.color,'rgb(20, 26, 33)');
    await page.evaluate(()=>document.getElementById('modalOverlay').dispatchEvent(new MouseEvent('click',{bubbles:true})));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('syter-mini')),true);
    assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),process.argv[3]?2:1);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].blur());
    await app.evaluate(()=>global.testMenu.find(i=>i.label==='Мини-журнал').click());
    await app.evaluate(()=>global.testTray.emit('click'));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true,'tray click must not hide a visible window');
    await page.locator('#syterTradeNotes').click();
    assert.equal(await page.locator('#magnitudeInput').inputValue(),'2.5');
    assert.equal(await page.locator('.tj-image-item button svg').count(),process.argv[3]?6:3);
    assert.ok(await page.locator('.tj-image-item button').first().evaluate(e=>e.getBoundingClientRect().height<=20));
    assert.ok(chart.length<800000);
    const miniState=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {b:w.getBounds(),top:w.isAlwaysOnTop()};});
    assert.equal(miniState.b.width,420);assert.equal(miniState.top,true);
    await page.screenshot({path:path.join(output,'mini-preview.png')});
    await page.locator('#syterMiniExpand').click();
    await page.waitForFunction(()=>!document.body.classList.contains('syter-mini'));
    assert.equal(await page.locator('#magnitudeInput').inputValue(),'2.5');
    assert.equal(await page.evaluate(()=>currentScreenshot),chart);
    assert.match(await page.locator('#syterTradeNotes').inputValue(),/Вход/);
    assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()),fullBounds);
    await app.evaluate(()=>global.testMenu.find(i=>i.label==='Мини-журнал').click());
    await page.waitForFunction(()=>document.body.classList.contains('syter-mini'));
    await page.locator('#syterMiniPin').click();
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),false);
    await page.evaluate(()=>failWrite=true);
    await page.locator('#tradeModalSubmitBtn').click();
    await page.waitForFunction(()=>!document.getElementById('tradeForm').inert);
    assert.match(await page.locator('#saveError').textContent(),/Черновик/);
    assert.equal(await page.locator('#magnitudeInput').inputValue(),'2.5');
    await page.evaluate(()=>failWrite=false);
    await page.locator('#tradeModalSubmitBtn').click();
    await page.waitForFunction(()=>document.getElementById('syterMiniStatus').textContent.includes('сохранена'));
    const records=await page.evaluate(()=>writes);
    assert.equal(records.length,2);assert.equal(records[0].id,records[1].id);
    assert.equal(records[1].uid,'student');assert.equal(records[1].r,2.5);assert.ok(records[1].chart);assert.equal(records[1].images.length,process.argv[3]?2:1);assert.match(records[1].notes,/Вход/);
    assert.equal(await page.locator('#magnitudeInput').inputValue(),'');
    assert.equal(await page.evaluate(()=>currentScreenshot),null);
    assert.equal(await page.evaluate(()=>trades.length),1);await page.evaluate(()=>TJMedia.gallery(trades[0],0));await page.waitForFunction(()=>document.getElementById('fullscreenImg').src.startsWith('data:'));await page.locator('#fullscreenImgCloseBtn').click();
    await page.locator('#syterCaptureState').click();
    assert.equal(await page.locator('#syterCaptureImages').isChecked(),false,'status text must not toggle capture');
    assert.equal(await page.locator('.syter-to-mini').textContent(),'Мини-журнал');
    assert.equal(await page.locator('#syterMiniExpand').textContent(),'Развернуть');
    assert.ok(await page.locator('.syter-to-mini').evaluate(e=>getComputedStyle(e).height==='24px'));
    assert.equal(await page.locator('.tj-gallery-nav svg').count(),2);
    await page.locator('#syterCaptureImages').check();
    await page.waitForFunction(()=>document.getElementById('syterCaptureState').dataset.on==='true');
    await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),0,'old clipboard ignored on enable');
    await app.evaluate(()=>global.testClipboardPath='');await page.waitForTimeout(750);
    const second=process.argv[3]||chartPath;
    await app.evaluate((_,p)=>global.testClipboardPath=p,second);
    // Same bitmap as activation is ignored; a different image is captured.
    if(second!==chartPath){await page.waitForFunction(()=>TJMedia.snapshot().length===1);}
    await page.locator('#screenshotInput').setInputFiles(chartPath);
    await page.waitForFunction(()=>!TJMedia.busy);
    assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),second===chartPath?1:2);
    await page.locator('#screenshotInput').setInputFiles(chartPath);await page.waitForFunction(()=>!TJMedia.busy);
    assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),second===chartPath?1:2,'duplicates ignored');
    await page.locator('#syterCaptureImages').uncheck();assert.ok(await page.evaluate(()=>TJMedia.snapshot().length),'disable keeps draft');
    await page.locator('.tj-image-strip .tj-image-item button').last().click();
    assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),second===chartPath?0:1);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await app.evaluate(()=>global.testMenu.find(i=>i.label==='Мини-журнал').click());
    await page.waitForFunction(()=>document.body.classList.contains('syter-mini'));
    // account switch invalidates the form instead of leaking a draft
    await page.evaluate(()=>{closeModal();viewingUser='Other';});
    await page.waitForFunction(()=>!document.body.classList.contains('syter-mini'));
    await page.evaluate(()=>{backtestTradeMode=true;openModal(null);});
    await page.waitForFunction(()=>document.getElementById('tradeForm').classList.contains('syter-backtest-form'));
    assert.equal(await page.locator('.syter-trade-notes').isVisible(),false);
    console.log('PASS: real Electron tray, sizing, pinning, hide/reopen, multi-image paste/upload/remove, nonblocking login, backdrop/focus preservation, compact dark controls, clipboard capture/deduplication, draft preservation, failed save/retry with same ID, successful record, account switch.');
  } finally { await app.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});



