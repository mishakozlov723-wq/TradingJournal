'use strict';
// Disposable CI only: real installed 1.3.13 updater, private 1.3.14 payload.
// Historical source test stays unchanged; no temporary feed is published.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'update-test-pack');
if(require(path.join(root,'package.json')).version!=='1.3.14')throw Error('Transition test pinned to 1.3.14');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const files=['latest.yml','SYTER-Setup-1.3.14.exe','SYTER-Setup-1.3.14.exe.blockmap'];
for(const name of files)fs.copyFileSync(path.join(root,'release',name),path.join(out,name));
for(const name of ['Test-Update.ps1','verify-update.ps1']){
 let text=fs.readFileSync(path.join(__dirname,name),'utf8');
 if(!text.includes('1.3.6')||!text.includes('1.3.7'))throw Error('Historical native test changed; review adaptation');
 text=text.replaceAll('1.3.6','1.3.13').replaceAll('1.3.7','1.3.14').replaceAll('1\\.3\\.7','1\\.3\\.14');
 fs.writeFileSync(path.join(out,name),'\uFEFF'+text.replace(/^\uFEFF/,''));
}
const sha=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex').toUpperCase();
fs.writeFileSync(path.join(out,'test-manifest.json'),JSON.stringify({from:'1.3.13',to:'1.3.14',files:files.map(name=>({name,sha256:sha(name)}))},null,2));
