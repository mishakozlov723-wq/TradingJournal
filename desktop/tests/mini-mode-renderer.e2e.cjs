'use strict';
// Local DOM regression test with a mocked native bridge; no Firebase or user data.
// SYTER_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SYTER_PLAYWRIGHT_MODULE || 'playwright');

const fixture = `<!doctype html><html><body>
<div id="appRoot" style="display:block"></div>
<div id="modelCreateOverlay"></div><div id="modelDeleteOverlay"></div>
<div id="modalOverlay" class="open"><div class="modal-box">
<div class="row"><button id="closeModalBtn">Close</button></div>
<form id="tradeForm">
<input id="magnitudeInput"><input id="riskPercentInput">
<div id="tradeScreenshotField"><div class="custom-file-picker"></div>
<input id="screenshotInput" type="file"><button id="screenshotRemoveBtn" type="button"></button>
<img id="screenshotPreview"><div id="screenshotPreviewWrap"></div><span id="screenshotFileName"></span></div>
<button id="tradeModalSubmitBtn" type="submit">Save</button><div id="saveError"></div>
</form></div></div>
<script>
var currentUser={},viewingUser='test',tradingModelsReady=true,tradingModelsUser='test';
var backtestTradeMode=false,currentScreenshot='draft-image',nativeCalls=[],openCount=0;
var firebase={auth:()=>({currentUser:{}})};
function openModal(){openCount++;document.getElementById('modalOverlay').classList.add('open');}
window.syterDesktop={
 setMiniMode:async(mini,animate)=>{nativeCalls.push({mini,animate});return {mini,pinned:true};},
 setMiniPinned:async enabled=>enabled,
 miniReady:()=>{},
 onModeRequest:callback=>{window.requestModeForTest=callback;}
};
</script></body></html>`;

async function main() {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.SYTER_CHROMIUM || undefined,
    args: ['--no-sandbox'],
  });
  try {
    for (const filename of ['mini-journal.js', 'mini-journal-legacy.js']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      try {
        await page.setContent(fixture);
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', filename), 'utf8') });
        await page.evaluate(async () => {
          magnitudeInput.value = '1.75';
          riskPercentInput.value = '0.5';
          syterTradeNotes.value = 'Unsaved draft — preserve exactly';
          await requestModeForTest(true);
          await requestModeForTest(false);
        });
        const draft = await page.evaluate(() => ({
          rr: magnitudeInput.value, risk: riskPercentInput.value, notes: syterTradeNotes.value,
          image: currentScreenshot, openCount, mini: document.body.classList.contains('syter-mini'),
          calls: nativeCalls,
        }));
        assert.deepEqual(draft, {
          rr: '1.75', risk: '0.5', notes: 'Unsaved draft — preserve exactly',
          image: 'draft-image', openCount: 0, mini: false,
          calls: [{ mini: true, animate: true }, { mini: false, animate: true }],
        });

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(async () => { await requestModeForTest(true); await requestModeForTest(false); });
        assert.equal(await page.evaluate(() => nativeCalls.slice(-2).every(call => call.animate === false)), true);

        const before = await page.evaluate(() => nativeCalls.length);
        await page.evaluate(async () => {
          tradeForm.dataset.saving = '1'; await requestModeForTest(true); delete tradeForm.dataset.saving;
          currentUser = null; await requestModeForTest(true); currentUser = {};
          tradingModelsReady = false; await requestModeForTest(true); tradingModelsReady = true;
          backtestTradeMode = true; await requestModeForTest(true); backtestTradeMode = false;
        });
        assert.equal(await page.evaluate(() => nativeCalls.length), before);
        console.log(`${filename}: draft, image, reduced motion and blocked states passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });