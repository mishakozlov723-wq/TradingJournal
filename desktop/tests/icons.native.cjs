'use strict';
// Run after the Windows build. Check real decoded pixels, including ASAR and PE.
const {app,nativeImage}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-artifacts');
fs.mkdirSync(out,{recursive:true});
function visible(image,label){
 assert.ok(!image.isEmpty(),label+': decoded image must exist');
 const bits=image.getBitmap();let pixels=0;
 for(let i=3;i<bits.length;i+=4)if(bits[i]>32)pixels++;
 assert.ok(pixels>bits.length/4/10,label+': at least 10% of pixels must be visible, not an all-transparent mask');
 return image;
}
function load(file,label){assert.ok(fs.existsSync(file)||file.includes('app.asar'),label+': file exists');return visible(nativeImage.createFromPath(file),label);}
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
   const frame=visible(nativeImage.createFromBuffer(ico.subarray(offset,offset+length)),'ICO frame '+size);
   assert.equal(frame.getSize().width,size);
 }
 const tray=load(path.join(root,'build','tray-icon.png'),'tray');
 fs.writeFileSync(path.join(out,'tray-icon-16.png'),tray.resize({width:16,height:16,quality:'best'}).toPNG());
 const window=load(path.join(root,'build','app-icon.png'),'window');
 fs.writeFileSync(path.join(out,'window-icon-32.png'),window.resize({width:32,height:32,quality:'best'}).toPNG());
 const exe=path.join(root,'dist','win-unpacked','SYTER.exe');assert.ok(fs.existsSync(exe));
 const shell=visible(await app.getFileIcon(exe,{size:'large'}),'Windows EXE icon');
 fs.writeFileSync(path.join(out,'packaged-exe-icon.png'),shell.toPNG());
 console.log('PASS: visible RGBA pixels in every icon size, runtime PNGs, packaged ASAR assets and Windows executable icon.');
 app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
