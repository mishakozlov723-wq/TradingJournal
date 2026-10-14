'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {armPresentation,opaqueSnapshotMatcher}=require('../cover-presentation');
function setup(){
 let callback,ended=0;
 const contents={isDestroyed:()=>false,beginFrameSubscription(onlyDirty,cb){assert.equal(onlyDirty,false);callback=cb;},
   endFrameSubscription(){ended++;}};
 return {contents,frame:value=>callback(value),ended:()=>ended};
}
test('presentation receipt ignores transparent/stale frames and accepts only the matching frame',async()=>{
 const s=setup(),receipt=armPresentation(s.contents,image=>image==='opaque expected frame');
 s.frame('empty old surface');s.frame('wrong snapshot');assert.equal(s.ended(),0);
 s.frame('opaque expected frame');assert.equal(await receipt.promise,true);assert.equal(s.ended(),1);
 receipt.cancel();assert.equal(s.ended(),1);
});
test('presentation timeout fails closed and detaches its subscription',async()=>{
 const s=setup(),receipt=armPresentation(s.contents,()=>false,{timeout:15});
 assert.equal(await receipt.promise,false);assert.equal(s.ended(),1);
});
test('cancellation and unsupported presentation API never grant permission to hide the app',async()=>{
 const s=setup(),receipt=armPresentation(s.contents,()=>true);receipt.cancel();
 assert.equal(await receipt.promise,false);assert.equal(s.ended(),1);
 assert.equal(await armPresentation({isDestroyed:()=>false},()=>true).promise,false);
});
function image(color,alpha=255,width=900,height=760){
 const buffer=Buffer.alloc(64*64*4);
 for(let i=0;i<buffer.length;i+=4){buffer[i]=color;buffer[i+1]=color;buffer[i+2]=color;buffer[i+3]=alpha;}
 return {isEmpty:()=>false,getSize:()=>({width,height}),
   crop:()=>image(color,alpha),resize:()=>image(color,alpha,64,64),toBitmap:()=>buffer};
}
test('snapshot matcher rejects an empty/transparent/partially opaque or wrong-color source surface',()=>{
 const source={rect:{x:0,y:0,width:900,height:760},top:36,body:'expected'};
 const match=opaqueSnapshotMatcher(source,{x:0,y:0,width:900,height:760},()=>image(70));
 assert.equal(match(image(70)),true);
 assert.equal(match(image(70,0)),false);assert.equal(match(image(70,128)),false);
 assert.equal(match(image(1)),false);assert.equal(match({isEmpty:()=>true}),false);
});