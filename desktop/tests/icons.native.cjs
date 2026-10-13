'use strict';
// Run after the Windows build. Check real decoded pixels, including ASAR and PE.
const {app,nativeImage}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-artifacts');
fs.mkdirSync(out,{recursive:true});
function visible(image,label){
 assert.ok(!image.isEmpty(),label+': decoded image must exist');
 const bits=image.toBitmap();let pixels=0;
 for(let i=3;i<bits.length;i+=4)if(bits[i]>32)pixels++;
 assert.ok(pixels>bits.length/4/10,label+': at least 10% of pixels must be visible, not an all-transparent mask');
 return image;
}
function load(file,label){assert.ok(fs.existsSync(file)||file.includes('app.asar'),label+': file exists');return visible(nativeImage.createFromPath(file),label);}
function matchesLogo(image,expected,label){
 const size=image.getSize(),actual=image.toBitmap();
 const reference=expected.resize({...size,quality:'best'}).toBitmap();
 assert.equal(actual.length,reference.length,label+': matching pixel dimensions');
 let difference=0;
 // Compare premultiplied BGRA: transparent background RGB is immaterial.
 for(let i=0;i<actual.length;i+=4){
   for(let c=0;c<3;c++)difference+=Math.abs(actual[i+c]*actual[i+3]/255-reference[i+c]*reference[i+3]/255);
   difference+=Math.abs(actual[i+3]-reference[i+3]);
 }
 const average=difference/actual.length;
 console.log(label+': logo pixel difference '+average.toFixed(2));
 assert.ok(average<12,label+': must show the SYTER logo, not a generic Windows icon');
}
app.whenReady().then(async()=>{
 assert.equal(process.platform,'win32');
 for(const name of ['tray-icon.png','app-icon.png','titlebar-icon.png','icon.ico']){
   load(path.join(root,'build',name),'generated '+name);
   load(path.join(root,'dist','win-unpacked','resources','app.asar','build',name),'packaged '+name);
 }
 const ico=fs.readFileSync(path.join(root,'build','icon.ico'));
 assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
 for(let i=0;i<7;i++){
   const size=ico[6+i*16]||256,offset=ico.readUInt32LE(6+i*16+12),length=ico.readUInt32LE(6+i*16+8);
   const dib=ico.subarray(offset,offset+length);
   assert.equal(dib.readUInt32LE(0),40);assert.equal(dib.readInt32LE(4),size);
   assert.equal(dib.readInt32LE(8),size*2);assert.equal(dib.readUInt16LE(14),32);
   const pixels=Buffer.alloc(size*size*4);
   const maskStride=Math.ceil(size/32)*4;
   assert.equal(length,40+size*size*4+maskStride*size);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
     const source=40+((size-1-y)*size+x)*4,destination=(y*size+x)*4;
     const maskByte=dib[40+size*size*4+(size-1-y)*maskStride+Math.floor(x/8)];
     assert.equal(Boolean(maskByte&(128>>(x%8))),dib[source+3]===0,'ICO alpha/mask agreement '+size);
     for(let c=0;c<3;c++)pixels[destination+c]=Math.round(dib[source+c]*dib[source+3]/255);
     pixels[destination+3]=dib[source+3];
   }
   const frame=visible(nativeImage.createFromBitmap(pixels,{width:size,height:size}),'ICO frame '+size);
   assert.equal(frame.getSize().width,size);
   matchesLogo(frame,load(path.join(root,'build','tray-icon.png'),'reference'), 'ICO frame '+size);
 }
 const tray=load(path.join(root,'build','tray-icon.png'),'tray');
 fs.writeFileSync(path.join(out,'tray-icon-16.png'),tray.resize({width:16,height:16,quality:'best'}).toPNG());
 const window=load(path.join(root,'build','app-icon.png'),'window');
 fs.writeFileSync(path.join(out,'window-icon-32.png'),window.resize({width:32,height:32,quality:'best'}).toPNG());
 const exe=path.join(root,'dist','win-unpacked','SYTER.exe');assert.ok(fs.existsSync(exe));
 const shell=visible(await app.getFileIcon(exe,{size:'large'}),'Windows EXE icon');
 fs.writeFileSync(path.join(out,'packaged-exe-icon.png'),shell.toPNG());
 matchesLogo(shell,tray,'Windows EXE icon');
 const installer=path.join(root,'dist','SYTER-Setup-'+require('../package.json').version+'.exe');
 const setupIcon=visible(await app.getFileIcon(installer,{size:'large'}),'Windows installer icon');
 fs.writeFileSync(path.join(out,'installer-icon.png'),setupIcon.toPNG());
 matchesLogo(setupIcon,tray,'Windows installer icon');
 console.log('PASS: visible RGBA icons at every size, packaged assets, and actual SYTER logos for EXE and installer.');
 app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
