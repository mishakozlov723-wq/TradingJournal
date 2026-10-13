'use strict';
// Local DOM regression test with a mocked native bridge; no Firebase or user data.
// SYTER_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SYTER_PLAYWRIGHT_MODULE || 'playwright');

const fixture = require('./renderer-fixture.cjs');

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
        for (const interrupt of ['logout', 'account', 'close']) {
          await page.evaluate(async interrupt => {
            const original = syterDesktop.setMiniMode;
            // The bridge object is mutable in this local fixture only.
            syterDesktop.setMiniMode = async (mini, animate) => {
              const result = await original(mini, animate);
              if (mini) {
                await new Promise(resolve => setTimeout(resolve, 20));
                if (interrupt === 'logout') currentUser = null;
                if (interrupt === 'account') viewingUser = 'other';
                if (interrupt === 'close') modalOverlay.classList.remove('open');
              }
              return result;
            };
            await requestModeForTest(true);
            syterDesktop.setMiniMode = original;
          }, interrupt);
          assert.equal(await page.evaluate(() => document.body.classList.contains('syter-mini')), false);
          assert.equal(await page.evaluate(() => nativeCalls.at(-1).mini), false);
          assert.equal(await page.evaluate(() => document.body.dataset.syterModeTransition), undefined);
          await page.evaluate(() => { currentUser = {}; viewingUser = 'test'; modalOverlay.classList.add('open'); });
        }
        console.log(`${filename}: draft, reduced motion, blocked states and mid-animation logout/account/close passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });