
'use strict';
// Preserve upstream two-pass uninstaller generation/signing. Adapt only the
// final installer section in memory; no dependency files are modified.
const { build, Platform, Arch } = require('electron-builder');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
NsisTarget.prototype.computeScriptAndSignUninstaller = async function (...args) {
  const result = await original.apply(this,args);
  if(result.isCustomScript || !result.script.includes('!include "installSection.nsh"')) throw Error('Unexpected upstream NSIS script');
  return {...result,script:result.script.replace('!include "installSection.nsh"','!include "${PROJECT_DIR}\\build\\progress-section.nsh"')};
};
build({targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never'})
  .catch(error=>{console.error(error);process.exitCode=1;});
