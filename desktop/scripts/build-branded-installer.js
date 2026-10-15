
'use strict';
// A small native offline bootstrapper replaces the second Electron runtime.
// The desktop application, original NSIS payload and updater feed stay intact.
const path=require('node:path');
const {execFileSync}=require('node:child_process');
if(process.platform!=='win32')throw Error('Build the native installer on Windows');
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'build-native-installer.ps1')],{stdio:'inherit',windowsHide:true});
