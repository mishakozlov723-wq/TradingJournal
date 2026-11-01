'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
test('1.3.14 has consistent package version and no packaged diagnostic UI', () => {
  assert.equal(pkg.version, '1.3.14');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  // Removed diagnostic/probe sources must stay out of both the tree and the package.
  for (const file of ['resize-diagnostics.js', 'autumn-motion-probe.js', 'resize-performance.js', 'installer/main.js']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
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

test('every packaged file exists and every local runtime dependency of main.js is packaged', () => {
  const packaged = file => pkg.build.files.some(entry => entry === file ||
    (entry.endsWith('/**/*') && file.startsWith(entry.slice(0, -'**/*'.length))));
  // build/ is generated on Windows by scripts/prepare-build-assets.ps1 before packaging.
  const generator = fs.readFileSync(path.join(root, 'scripts/prepare-build-assets.ps1'), 'utf8');
  for (const entry of pkg.build.files) {
    if (entry.startsWith('build/')) {
      const generated = entry.endsWith('/**/*') ? entry.slice('build/'.length, -'/**/*'.length) + '/' : path.posix.basename(entry);
      assert.ok(generator.includes("'" + generated), entry + ' is not produced by prepare-build-assets.ps1');
    } else if (entry.endsWith('/**/*')) assert.ok(fs.statSync(path.join(root, entry.slice(0, -'/**/*'.length))).isDirectory(), entry);
    else { assert.doesNotMatch(entry, /[*?]/, entry); assert.ok(fs.statSync(path.join(root, entry)).isFile(), entry); }
  }
  const pending = ['main.js'], seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(packaged(file), file + ' is used at runtime but missing from build.files');
    if (!/\.(c?js)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8'), dir = path.posix.dirname(file);
    for (const [, , spec] of text.matchAll(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g)) {
      let target = path.posix.normalize(path.posix.join(dir, spec));
      if (!path.posix.extname(target)) target += '.js';
      assert.ok(!target.startsWith('..'), file + ' requires outside the app: ' + spec);
      pending.push(target);
    }
    // Assets read next to the script: path.join(__dirname, 'dir', 'file.ext') and quoted file names.
    for (const [, args] of text.matchAll(/path\.join\(__dirname((?:\s*,\s*'[^']+')+)\)/g)) {
      const target = path.posix.join(dir, ...[...args.matchAll(/'([^']+)'/g)].map(m => m[1]));
      if (path.posix.extname(target) && fs.existsSync(path.join(root, target))) pending.push(target);
    }
    for (const [, name] of text.matchAll(/['"]([\w-]+\.(?:js|css|html))['"]/g)) {
      const target = path.posix.join(dir, name);
      if (fs.existsSync(path.join(root, target))) pending.push(target);
    }
  }
  for (const file of ['window-bounds.js', 'offline.html', 'mini-view-state.js', 'mini-journal.js', 'mini-journal-legacy.js', 'lifecycle/update-trust.js'])
    assert.ok(seen.has(file), file + ' should be discovered as a runtime dependency');
});

test('transition pack maps the historical template to the previous release and this build', () => {
  const os = require('node:os'), crypto = require('node:crypto'), cp = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syter-transition-'));
  try {
    fs.mkdirSync(path.join(tmp, 'update-test'));
    fs.mkdirSync(path.join(tmp, 'release'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({version: '1.3.15'}));
    for (const name of ['package-transition.cjs', 'Test-Update.ps1', 'verify-update.ps1', 'Start-TestApp.ps1'])
      fs.copyFileSync(path.join(root, 'update-test', name), path.join(tmp, 'update-test', name));
    const names = ['latest.yml', 'SYTER-Setup-1.3.15.exe', 'SYTER-Setup-1.3.15.exe.blockmap'];
    for (const name of names) fs.writeFileSync(path.join(tmp, 'release', name), 'fixture:'+name);
    const run = (...args) => cp.spawnSync(process.execPath, [path.join(tmp, 'update-test/package-transition.cjs'), ...args], {encoding:'utf8'});
    for (const bad of [[], ['1.3.15'], ['1.3.16'], ['1.3']]) assert.notEqual(run(...bad).status, 0, 'rejects ' + JSON.stringify(bad));
    const result = run('1.3.14');
    assert.equal(result.status, 0, result.stderr);
    const out = path.join(tmp, 'update-test-pack');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'test-manifest.json')));
    assert.equal(manifest.from, '1.3.14'); assert.equal(manifest.to, '1.3.15');
    assert.deepEqual(manifest.files.map(f=>f.name), names);
    for (const f of manifest.files) assert.equal(f.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f.name))).digest('hex').toUpperCase());
    for (const name of ['Test-Update.ps1', 'verify-update.ps1']) {
      const text = fs.readFileSync(path.join(out, name), 'utf8');
      assert.doesNotMatch(text, /1\.3\.[67](?![0-9])|1\\\.3\\\.7/);
      assert.match(text, /1\.3\.14/); assert.match(text, /1\.3\.15/);
      assert.equal(fs.readFileSync(path.join(tmp, 'update-test', name), 'utf8'), fs.readFileSync(path.join(root, 'update-test', name), 'utf8'));
    }
    assert.match(fs.readFileSync(path.join(out, 'verify-update.ps1'), 'utf8'), /'1\.3\.14 → 1\.3\.15'/);
    const launcher = fs.readFileSync(path.join(out, 'Test-Update.ps1'), 'utf8');
    assert.doesNotMatch(launcher, /provider: generic|WriteAllBytes\(\$config/);
    assert.match(launcher, /Start-TestApp \$exe/);
    assert.match(launcher, /version: 1\\\.3\\\.15/);
    const app = fs.readFileSync(path.join(out, 'Start-TestApp.ps1'), 'utf8');
    assert.match(app, /requireUpdatePublisher/);
    assert.doesNotMatch(app, /__SYTER_FROM_VERSION__/);
    assert.equal(app.match(/'1\.3\.14'/g).length, 2);
  } finally { fs.rmSync(tmp, {recursive:true, force:true}); }
});
