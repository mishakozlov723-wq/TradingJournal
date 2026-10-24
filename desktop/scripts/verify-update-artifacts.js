'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function digest(file,algorithm,encoding='hex'){return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);}
function verifyArtifacts(dir,version,parseYaml){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
  const setup=`SYTER-Setup-${version}.exe`,wrapper=`SYTER-Install-${version}.exe`;
  for(const name of [setup,wrapper,setup+'.blockmap','latest.yml','installer-manifest.json'])if(!fs.existsSync(path.join(dir,name)))throw Error('Missing release asset '+name);
  const feed=(parseYaml||require('js-yaml').load)(fs.readFileSync(path.join(dir,'latest.yml'),'utf8'));
  if(feed.version!==version||feed.path!==setup||!Array.isArray(feed.files)||feed.files.length!==1||feed.files[0].url!==setup)throw Error('Feed version/path/asset set mismatch');
  const exe=path.join(dir,setup),hash=digest(exe,'sha512','base64'),size=fs.statSync(exe).size;
  if(feed.sha512!==hash||feed.files[0].sha512!==hash||feed.files[0].size!==size)throw Error('Updater SHA512/size mismatch');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'installer-manifest.json'),'utf8').replace(/^\uFEFF/,''));
  if(manifest.version!==version||manifest.installer!==wrapper||manifest.sha256!==digest(exe,'sha256')||manifest.payloadSize!==size)throw Error('Native installer manifest mismatch');
  for(const name of [setup,wrapper]){const b=fs.readFileSync(path.join(dir,name));if(b.length<128||b.toString('ascii',0,2)!=='MZ')throw Error('Invalid Windows EXE '+name);const offset=b.readUInt32LE(60);if(offset+4>b.length||b.toString('binary',offset,offset+4)!=='PE\x00\x00')throw Error('Invalid PE header '+name);}
  if(!fs.statSync(path.join(dir,setup+'.blockmap')).size)throw Error('Empty blockmap');
  return {version,assets:[setup,wrapper,setup+'.blockmap','latest.yml','installer-manifest.json'].map(name=>({name,size:fs.statSync(path.join(dir,name)).size,sha256:digest(path.join(dir,name),'sha256')}))};
}
if(require.main===module){const root=path.join(__dirname,'..');const report=verifyArtifacts(path.join(root,'release'),require(path.join(root,'package.json')).version);fs.writeFileSync(path.join(root,'test-artifacts/release-integrity.json'),JSON.stringify(report,null,2));console.log('PASS: actual updater feed, EXE headers, sizes and manifest digests verified');}
module.exports={verifyArtifacts};
