'use strict';
// Disposable CI: the original installed <from> binary + process-local transport
// to this build. Usage: node update-test/package-transition.cjs <from-version>
// Do not replace app-update.yml: that correctly fails the publisher guard.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'update-test-pack');
const VERSION = /^\d+\.\d+\.\d+$/;
const from = process.argv[2], to = require(path.join(root, 'package.json')).version;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
if (!VERSION.test(from || '') || !VERSION.test(to)) throw Error('Usage: package-transition.cjs <from-version>; versions must be X.Y.Z');
if (!newer(to, from)) throw Error('Transition must go from an older release: ' + from + ' -> ' + to);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const files = ['latest.yml', 'SYTER-Setup-' + to + '.exe', 'SYTER-Setup-' + to + '.exe.blockmap'];
for (const name of files) fs.copyFileSync(path.join(root, 'release', name), path.join(out, name));
function replace(text, old, value) { if (!text.includes(old)) throw Error('Historical native test changed; review adaptation: ' + old.slice(0, 60)); return text.replace(old, value); }
// The templates are the historical 1.3.6 -> 1.3.7 test; map every version in one pass.
const escaped = value => value.replace(/\./g, '\\.');
const versions = text => text.replace(/1\\\.3\\\.7|1\.3\.6|1\.3\.7/g, match => match === '1.3.6' ? from : match === '1.3.7' ? to : escaped(to));
for (const name of ['Test-Update.ps1', 'verify-update.ps1']) {
  let text = fs.readFileSync(path.join(__dirname, name), 'utf8');
  if (!text.includes('1.3.6') || !text.includes('1.3.7')) throw Error('Historical native test changed; review adaptation');
  text = versions(text);
  if (name === 'Test-Update.ps1') {
    text = replace(text, '$root=$PSScriptRoot', "$root=$PSScriptRoot\n. (Join-Path $root 'Start-TestApp.ps1')");
    const a = text.indexOf('# Preserve publisherName/signature requirements and other security settings.'), b = text.indexOf("$log=Join-Path $root 'requests.log'", a);
    if (a < 0 || b < 0) throw Error('Historical transport preparation changed');
    text = text.slice(0, a) + '# Keep the installed GitHub configuration byte-for-byte unchanged.\n$port=51873\n' + text.slice(b);
    const c = text.indexOf(' [IO.File]::WriteAllBytes($backup,$original)'), d = text.indexOf(" Write-Host 'LOCAL TEST:", c);
    if (c < 0 || d < 0) throw Error('Historical configuration write changed');
    text = text.slice(0, c) + text.slice(d);
    text = replace(text, " if($Automation){Start-Process $exe -ArgumentList '--force-renderer-accessibility'}else{Start-Process $exe}", " if(!$Automation){throw 'This pack is for disposable CI automation only'}\n Start-TestApp $exe\n if((Get-FileHash $config -Algorithm SHA256).Hash -ne [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($original)).Replace('-','')){throw 'Test transport changed installed GitHub configuration'}");
  } else text = replace(text, "Start-Process $exe -ArgumentList '--force-renderer-accessibility'", 'Start-TestApp $exe');
  fs.writeFileSync(path.join(out, name), '\uFEFF' + text.replace(/^\uFEFF/, ''));
}
const launcher = fs.readFileSync(path.join(__dirname, 'Start-TestApp.ps1'), 'utf8');
if (!launcher.includes('__SYTER_FROM_VERSION__')) throw Error('Start-TestApp.ps1 lost its installed-version placeholder');
fs.writeFileSync(path.join(out, 'Start-TestApp.ps1'), launcher.split('__SYTER_FROM_VERSION__').join(from));
const sha = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex').toUpperCase();
fs.writeFileSync(path.join(out, 'test-manifest.json'), JSON.stringify({ from, to, files: files.map(name => ({ name, sha256: sha(name) })) }, null, 2));
console.log('Transition pack: ' + from + ' -> ' + to);
