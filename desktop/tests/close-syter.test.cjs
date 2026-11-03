'use strict';
// "Close SYTER" in the site settings fully quits the desktop app (desktop only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('preload exposes quitApp and main quits only for the journal site', () => {
  assert.match(read('preload.js'), /quitApp: \(\) => ipcRenderer\.invoke\('syter:quit'\)/);
  const main = read('main.js');
  assert.match(main, /ipcMain\.handle\('syter:quit', \(e\) => \{ if \(!fromSite\(e\)\) return false; isQuitting = true; setImmediate\(\(\) => app\.quit\(\)\); return true; \}\);/);
});

test('site shows the Close SYTER button only inside the desktop app', () => {
  const html = fs.readFileSync(path.join(root, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, '..', 'public', 'app.js'), 'utf8');
  assert.match(html, /<div class="syter-quit-section" id="syterQuitSection" style="display:none;">/);
  assert.match(html, /id="syterQuitBtn"><span>Close SYTER<\/span>/);
  assert.match(app, /typeof bridge\.quitApp !== 'function'\) return;/);
});

test('leftover tray catcher files from 1.3.18 are not shipped', () => {
  for (const f of ['tray-menu/catcher.html', 'tray-menu/catcher.js']) assert.equal(fs.existsSync(path.join(root, f)), false, f);
});
