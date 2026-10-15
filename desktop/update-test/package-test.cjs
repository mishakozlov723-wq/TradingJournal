'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'update-test-pack');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const files=['latest.yml','SYTER-Setup-1.3.7.exe','SYTER-Setup-1.3.7.exe.blockmap'];
for(const name of files)fs.copyFileSync(path.join(root,'release',name),path.join(out,name));
// Only release notes change; builder's payload SHA512, size and URLs remain authoritative.
fs.appendFileSync(path.join(out,'latest.yml'),'\nreleaseNotes: |\n  Local test of the branded SYTER update flow.\n  Real download progress and restart after your confirmation.\n  The website and public release are unchanged.\n');
for(const name of ['Test-Update.ps1','START-TEST.cmd','RESTORE-NORMAL-UPDATES.cmd','README.txt','verify-update.cjs']){
 let content=fs.readFileSync(path.join(__dirname,name),'utf8');
 if(name.endsWith('.ps1'))content='\ufeff'+content.replace(/^\ufeff/,'');
 fs.writeFileSync(path.join(out,name),content);
}
const digest=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex').toUpperCase();
fs.writeFileSync(path.join(out,'test-manifest.json'),JSON.stringify({from:'1.3.6',to:'1.3.7',files:files.map(name=>({name,sha256:digest(name)}))},null,2));
console.log('Packaged local-only update test; no publish step.');
