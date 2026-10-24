
'use strict';
// Preserve upstream two-pass uninstaller generation/signing. Adapt only the
// final installer section in memory; no dependency files are modified.
const signing=require('./signing-policy').signingConfiguration();
if (signing.extraMetadata.syterUpdatePolicy !== 'authenticode') {
  delete process.env.CSC_LINK; delete process.env.CSC_KEY_PASSWORD;
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}
const { build, Platform, Arch } = require('electron-builder');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
NsisTarget.prototype.computeScriptAndSignUninstaller = async function (...args) {
  const result = await original.apply(this,args);
  if(result.isCustomScript || !result.script.includes('!include "installSection.nsh"')) throw Error('Unexpected upstream NSIS script');
  return {...result,script:result.script.replace('!include "installSection.nsh"','!include "${PROJECT_DIR}\\build\\progress-section.nsh"')};
};
build({config:signing,targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never'})
  .catch(error=>{console.error(error);process.exitCode=1;});
