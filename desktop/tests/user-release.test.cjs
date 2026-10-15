'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
test('1.3.9 has consistent package version and no packaged diagnostic UI', () => {
  assert.equal(pkg.version, '1.3.9');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  for (const file of ['resize-diagnostics.js', 'autumn-motion-probe.js']) {
    assert.equal(pkg.build.files.includes(file), false, file);
  }
  assert.ok(pkg.build.files.includes('autumn-motion.js'));
  assert.ok(pkg.build.files.includes('interface-preview-shortcut.js'));
  assert.doesNotMatch(main, /RESIZE_PROBE|PROBE_NO_COVER|equity-width-v1|diagnostics\.|setAutumnMotionMode/);
  assert.match(main, /win\.setTitle\('SYTER'\)/);
  assert.match(main, /tray\.setToolTip\('SYTER'\)/);
});
test('production keeps acceleration, live view, width floor and updater', () => {
  assert.doesNotMatch(main, /disableHardwareAcceleration|windowMotion\.warm/);
  assert.match(main, /windowMotion\.move\(target, !enabled && animate/);
  assert.match(main, /setupUpdates\(\);/);
  assert.match(main, /createUpdateController/);
  assert.ok(pkg.build.files.includes('lifecycle/**/*')); 
  assert.match(main, /installWidthPolicy\(\)/);
  assert.match(main, /miniShortcut\.register\(\)/);
  assert.equal(pkg.build.appId, 'com.retocker.syter');
  assert.equal(pkg.build.publish[0].repo, 'syter-releases');
});
test('private hook precedes regular Ctrl+0 and has no user-facing hints', () => {
  assert.ok(main.indexOf('handlePreviewInput(e, input') < main.indexOf("ctrl && k === '0'"));
  const tray = main.slice(main.indexOf('function createTray'), main.indexOf('// ── "remember me"'));
  assert.doesNotMatch(tray, /preview|Ctrl.*0|Листья|Диагност|график/i);
});
test('only mini -> full uses the verified return compositor',()=>{
 assert.match(main,/windowMotion\.prepare\(modeTarget\(enabled\), !enabled && animate, true\)/);
 for(const file of ['return-compositor.js','cover-presentation.js','mode-transition.html','mode-transition.css','mode-transition.js'])assert.ok(pkg.build.files.includes(file),file);
});
