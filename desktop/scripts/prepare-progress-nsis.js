'use strict';
// Generate a narrow adapter from the exact locked upstream templates, never
// edit node_modules or silently adopt a changed installer/uninstaller flow.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const lib = path.dirname(require.resolve('app-builder-lib/package.json'));
if(require(path.join(lib,'package.json')).version !== '26.15.3') throw Error('Review progress adapter before upgrading electron-builder');
const templates=path.join(lib,'templates','nsis');
const build=path.join(root,'build');fs.mkdirSync(build,{recursive:true});
let main=fs.readFileSync(path.join(templates,'installer.nsi'),'utf8');
let section=fs.readFileSync(path.join(templates,'installSection.nsh'),'utf8');
let extract=fs.readFileSync(path.join(templates,'include','extractAppPackage.nsh'),'utf8');
const original=extract.match(/!macro extractUsing7za FILE\r?\n[\s\S]*?!macroend/);
if(!original || !main.includes('!include "installSection.nsh"') || !section.startsWith('!include installer.nsh')) throw Error('Unexpected NSIS template');
fs.writeFileSync(path.join(build,'progress-original.nsh'),original[0].replace('!macro extractUsing7za FILE','!macro syterOriginalExtract FILE')+'\n');
section=section.replace('!include installer.nsh','!include installer.nsh\n!include "${PROJECT_DIR}\\installer\\progress-extract.nsh"');
fs.writeFileSync(path.join(build,'progress-section.nsh'),section);
main=main.replace('!include "installSection.nsh"','!include "${PROJECT_DIR}\\build\\progress-section.nsh"');
fs.writeFileSync(path.join(build,'progress-installer.nsi'),main);
console.log('Prepared locked NSIS byte-progress adapter; normal updater extraction unchanged.');
