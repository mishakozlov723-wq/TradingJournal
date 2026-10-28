'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
test('1.3.15 has consistent package version and no packaged diagnostic UI', () => {
  assert.equal(pkg.version, '1.3.15');
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
  assert.match(main, /windowMotion\.move\(target, animate/);
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
test('both directions use the same verified compositor',()=>{
 assert.match(main,/windowMotion\.prepare\(modeTarget\(enabled\), animate, true\)/);
 for(const file of ['return-compositor.js','cover-presentation.js','mode-transition.html','mode-transition.css','mode-transition.js'])assert.ok(pkg.build.files.includes(file),file);
});

test('1.3.15 transition pack pins versions, hashes bytes and preserves the production feed', () => {
  const os = require('node:os'), crypto = require('node:crypto'), cp = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syter-transition-'));
  try {
    fs.mkdirSync(path.join(tmp, 'update-test'));
    fs.mkdirSync(path.join(tmp, 'release'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({version: '1.3.15'}));
    for (const name of ['package-1315.cjs', 'Test-Update.ps1', 'verify-update.ps1', 'Start-TestApp.ps1'])
      fs.copyFileSync(path.join(root, 'update-test', name), path.join(tmp, 'update-test', name));
    const names = ['latest.yml', 'SYTER-Setup-1.3.15.exe', 'SYTER-Setup-1.3.15.exe.blockmap'];
    for (const name of names) fs.writeFileSync(path.join(tmp, 'release', name), 'fixture:'+name);
    const result = cp.spawnSync(process.execPath, [path.join(tmp, 'update-test/package-1315.cjs')], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const out = path.join(tmp, 'update-test-pack');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'test-manifest.json')));
    assert.equal(manifest.from, '1.3.14'); assert.equal(manifest.to, '1.3.15');
    assert.deepEqual(manifest.files.map(f=>f.name), names);
    for (const f of manifest.files) assert.equal(f.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f.name))).digest('hex').toUpperCase());
    for (const name of ['Test-Update.ps1', 'verify-update.ps1']) {
      const text = fs.readFileSync(path.join(out, name), 'utf8');
      assert.doesNotMatch(text, /1\.3\.[67](?![0-9])/);
      assert.match(text, /1\.3\.14/); assert.match(text, /1\.3\.15/);
      assert.equal(fs.readFileSync(path.join(tmp, 'update-test', name), 'utf8'), fs.readFileSync(path.join(root, 'update-test', name), 'utf8'));
    }
    const launcher = fs.readFileSync(path.join(out, 'Test-Update.ps1'), 'utf8');
    assert.doesNotMatch(launcher, /provider: generic|WriteAllBytes\(\$config/);
    assert.match(launcher, /Start-TestApp \$exe/);
    assert.match(fs.readFileSync(path.join(out, 'Start-TestApp.ps1'), 'utf8'), /requireUpdatePublisher/);
    assert.match(fs.readFileSync(path.join(out, 'Test-Update.ps1'), 'utf8'), /1\\\.3\\\.15/);
  } finally { fs.rmSync(tmp, {recursive:true, force:true}); }
});
