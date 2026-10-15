'use strict';
// The normal NSIS payload and latest.yml remain untouched for electron-updater.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
async function run() {
  const staging = path.join(root, 'branded-stage');
  fs.rmSync(staging, { recursive:true, force:true }); fs.mkdirSync(staging, {recursive:true});
  for (const dir of ['lifecycle', 'installer', 'build']) fs.cpSync(path.join(root,dir),path.join(staging,dir),{recursive:true});
  const payload = path.join(root,'dist',`SYTER-Setup-${pkg.version}.exe`);
  const manifest = {version:pkg.version,sha256:crypto.createHash('sha256').update(fs.readFileSync(payload)).digest('hex')};
  fs.writeFileSync(path.join(staging,'installer','manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify({name:'syter-installer',version:pkg.version,description:'SYTER desktop installer',author:'SYTER',main:'installer/main.js'},null,2));
  await build({projectDir:staging,targets:Platform.WINDOWS.createTarget('portable',Arch.x64),publish:'never',config:{
    appId:'com.retocker.syter.installer',productName:'SYTER Installer',electronVersion:pkg.devDependencies.electron,
    directories:{output:path.join(root,'branded-dist'),buildResources:'build'},
    files:['installer/*.js','installer/manifest.json','lifecycle/*','build/app-icon.png','build/ui/**/*','package.json'],
    extraResources:[{from:payload,to:'payload/setup.exe'}],
    win:{icon:'build/icon.ico',artifactName:`SYTER-Install-${pkg.version}.exe`},portable:{requestExecutionLevel:'user'},
  }});
  const exe = `SYTER-Install-${pkg.version}.exe`;
  fs.copyFileSync(path.join(root,'branded-dist',exe),path.join(root,'release',exe));
  fs.writeFileSync(path.join(root,'release','installer-manifest.json'),JSON.stringify({...manifest,installer:exe},null,2));
  console.log('Branded installer:',exe,'bytes:',fs.statSync(path.join(root,'release',exe)).size);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
