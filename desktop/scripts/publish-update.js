// After a build: puts the 3 files every update needs into desktop/release/.
// Upload them to a new GitHub release in mishakozlov723-wq/syter-releases
// and every installed SYTER picks the update up by itself.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'release');
const version = require(path.join(root, 'package.json')).version;
const exe = 'SYTER-Setup-' + version + '.exe';
const need = ['latest.yml', exe, exe + '.blockmap'];

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
console.log('    Attach all 3 files from desktop/release/ and click "Publish release".');
