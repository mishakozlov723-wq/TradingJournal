// Prepare local artifacts only. Free/manual mode emits no updater feed.
// Actual publication is a separately approved, fully gated workflow action.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'release');
const version = require(path.join(root, 'package.json')).version;
const exe = 'SYTER-Setup-' + version + '.exe';
const policy = require('./signing-policy').signingConfiguration();
const signed = policy.extraMetadata.syterUpdatePolicy === 'authenticode';
const need = signed ? ['latest.yml', exe, exe + '.blockmap'] : [exe];

for (const f of need) {
  if (!fs.existsSync(path.join(dist, f))) {
    console.error('Missing dist/' + f + ' - the build did not finish.');
    process.exit(1);
  }
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of need) fs.copyFileSync(path.join(dist, f), path.join(out, f));

console.log('');
console.log('SYTER ' + version + ' is ready.');
console.log('  Installer: desktop/release/' + exe);
console.log('  To publish the update: https://github.com/mishakozlov723-wq/syter-releases/releases/new');
console.log('    Tag: v' + version + '   Title: SYTER ' + version);
console.log(signed ? '    Signed updater feed prepared; publication requires full release gates.' : '    MANUAL ONLY: no updater feed. Do not upload latest.yml or mark this release latest. Windows may warn about the unknown publisher.');
