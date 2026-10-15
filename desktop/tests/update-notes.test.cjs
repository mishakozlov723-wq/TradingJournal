'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('release summary is short and in Russian',()=>{
 const notes=require('../release-notes.json');assert.ok(notes.length>=1&&notes.length<=3);
 for(const note of notes){assert.equal(typeof note,'string');assert.ok(note.length<=110);assert.match(note,/[А-Яа-яЁё]/);assert.doesNotMatch(note,/[\r\n]/);}
 const workflow=fs.readFileSync(path.join(root,'../.github/workflows/desktop-release.yml'),'utf8');
 assert.match(workflow,/Get-Content release-notes\.json/);assert.doesNotMatch(workflow,/- SYTER \$version production desktop release/);
});
test('notes hide scrollbar chrome without disabling overflow scrolling',()=>{
 const css=fs.readFileSync(path.join(root,'lifecycle/window.css'),'utf8');
 assert.match(css,/html,body,#notes-text\{scrollbar-width:none\}/);
 assert.match(css,/#notes-text::-webkit-scrollbar\{display:none;width:0;height:0\}/);
 assert.match(css,/#notes-text\{[^}]*overflow:auto/);
 assert.match(fs.readFileSync(path.join(root,'lifecycle/window.html'),'utf8'),/<h2 lang="ru">Что нового<\/h2>/);
});
test('release versions match',()=>{const pkg=require('../package.json'),lock=require('../package-lock.json');assert.equal(pkg.version,'1.3.12');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);});
