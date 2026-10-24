'use strict';
const fs=require('node:fs'),path=require('node:path');
function verifyPackagedPolicy(pkg, expectedMode, updateConfig={}) {
  if (!['github','authenticode'].includes(expectedMode) || pkg.syterUpdatePolicy!==expectedMode) throw Error('Packaged updater policy does not match the approved release mode');
  if (updateConfig.provider!=='github' || updateConfig.owner!=='mishakozlov723-wq' || updateConfig.repo!=='syter-releases') throw Error('Packaged GitHub update repository mismatch');
  if (expectedMode==='authenticode') {
    const publisher=String(process.env.SYTER_PUBLISHER_NAME||'').trim();
    const names=Array.isArray(updateConfig.publisherName)?updateConfig.publisherName:[updateConfig.publisherName];
    if (!publisher || names.length!==1 || names[0]!==publisher) throw Error('Packaged publisher is not the configured trust identity');
  }
}
if (require.main===module) {
  const root=path.join(__dirname,'..'),resources=path.join(root,'dist/win-unpacked/resources');
  const pkg=JSON.parse(require('@electron/asar').extractFile(path.join(resources,'app.asar'),'package.json').toString());
  const signed=process.env.SYTER_SIGNED_RELEASE==='true';
  if (process.env.SYTER_SIGNED_RELEASE && !['true','false'].includes(process.env.SYTER_SIGNED_RELEASE)) throw Error('Invalid release mode');
  const config=require('js-yaml').load(fs.readFileSync(path.join(resources,'app-update.yml'),'utf8'));
  verifyPackagedPolicy(pkg,signed?'authenticode':'github',config);
  require('./verify-update-artifacts').verifyArtifacts(path.join(root,'release'),pkg.version);
  console.log('PASS: actual packaged policy matches '+(signed?'verified publisher mode':'GitHub automatic-update mode (no mandatory Authenticode)'));
}
module.exports={verifyPackagedPolicy};
