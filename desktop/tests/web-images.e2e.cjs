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
document.getElementById('fullscreenImgCloseBtn').onclick=()=>document.getElementById('fullscreenImgOverlay').classList.remove('open');
document.getElementById('screenshotRemoveBtn').onclick=()=>{currentScreenshot=null;document.getElementById('screenshotPreviewWrap').style.display='none';};
`;
fixture = fixture.replace('</body>', '<script>' + stubs + ['tjClone','remoteSaveTrade','compressImage','openModal','closeModal'].map(production).join('\n') + '</script><script src="/trade-media.js"></script></body>');

const {chromium}=require(process.env.SYTER_PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1300,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const start=original.indexOf("  document.getElementById('tradeForm').addEventListener('submit', async function(e) {"),end=original.indexOf("  Array.prototype.forEach.call(document.querySelectorAll('.trade-datetime-input')",start);
fixture=fixture.replace('</body>','<script>var allBacktestTrades=[],backtestTrades=[],activeBacktestId="bt";function maybeShowStreakToast(){}function saveBacktestLocal(){}function renderBacktests(){}function showBacktestSyncError(s){document.getElementById("saveError").textContent=s;}'+original.slice(start,end)+'</script></body>');
await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});const file=path.join(root,'public',u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});});
await page.goto('https://journal.test/');await page.evaluate(()=>openModal(null));
await page.locator('#screenshotInput').setInputFiles([chartPath,path.resolve(process.argv[3]||chartPath)]);await page.waitForFunction(()=>!TJMedia.busy&&TJMedia.snapshot().length>0);
const n=await page.evaluate(()=>TJMedia.snapshot().length);assert.equal(n,2);
await page.locator('#magnitudeInput').fill('3.77');await page.evaluate(()=>failWrite=true);await page.locator('#tradeModalSubmitBtn').click();await page.waitForFunction(()=>!document.getElementById('tradeForm').inert);assert.equal(await page.evaluate(()=>trades.length),0);assert.equal(await page.evaluate(()=>TJMedia.snapshot().length),2);
await page.evaluate(()=>failWrite=false);await page.locator('#tradeModalSubmitBtn').click();await page.waitForFunction(()=>trades.length===1);assert.equal(await page.evaluate(()=>trades[0].images.length),2);assert.equal(await page.evaluate(()=>Object.keys(mediaDocs).length),2);
await page.evaluate(()=>{TJMedia.clearCache();TJMedia.gallery(trades[0]);});await page.waitForFunction(()=>document.querySelector('.tj-gallery-nav span').textContent==='1 / 2');const cover=await page.locator('#fullscreenImg').getAttribute('src');await page.locator('.tj-gallery-nav button').last().click();assert.notEqual(await page.locator('#fullscreenImg').getAttribute('src'),cover);await page.locator('#fullscreenImgCloseBtn').click();
await page.evaluate(()=>TJMedia.edit(trades[0],()=>{}));await page.waitForSelector('dialog');await page.locator('dialog .tj-image-item button').last().click();await page.locator('dialog>button').first().click();await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>trades[0].images.length),1);
await page.evaluate(()=>{backtestTradeMode=true;backtests=[{id:'bt',startDate:'2026-01-01',endDate:'2026-12-31'}];openModal(null);setDateTimeInput(document.getElementById('openInput'),'2026-09-09T20:00');setDateTimeInput(document.getElementById('closeInput'),'2026-09-14T16:00');});await page.locator('#magnitudeInput').fill('2');await page.locator('#screenshotInput').setInputFiles(chartPath);await page.waitForFunction(()=>!TJMedia.busy&&TJMedia.snapshot().length===1);await page.locator('#tradeModalSubmitBtn').click();await page.waitForFunction(()=>backtestTrades.length===1);assert.equal(await page.evaluate(()=>backtestTrades[0].images.length),1);
assert.deepEqual(errors,[]);console.log('PASS web: multi-image submit, failure preservation, retry, private gallery reload/navigation, image edit, backtest attachments.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});



