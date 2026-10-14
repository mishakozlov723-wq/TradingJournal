'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DEFAULT_CSS_MINIMUM,createWindowWidthPolicy}=require('../window-width-policy');
function fixture({width=1400,frame=16,zoom=1,area={x:0,y:0,width:1920,height:1080},mini=false,maximized=false,fullscreen=false}={}) {
 let bounds={x:50,y:50,width,height:800},limit=[380,500],sets=0,minimumSets=0;
 const win={getBounds:()=>({...bounds}),getContentSize:()=>[bounds.width-frame,764],isDestroyed:()=>false,
  getMinimumSize:()=>limit,setMinimumSize:(w,h)=>{limit=[w,h];minimumSets++;},
  setBounds:b=>{bounds={...b};sets++;},isMaximized:()=>maximized,isFullScreen:()=>fullscreen};
 const contents={isDestroyed:()=>false,getZoomFactor:()=>zoom};
 const policy=createWindowWidthPolicy({getWindow:()=>win,getContents:()=>contents,screen:{getDisplayMatching:()=>({workArea:area})},isMini:()=>mini});
 return {policy,bounds:()=>bounds,limit:()=>limit,sets:()=>sets,minimumSets:()=>minimumSets};
}
test('column floor includes both page gutters',()=>assert.equal(DEFAULT_CSS_MINIMUM,1054));
test('native outer minimum includes window borders',()=>{const f=fixture();f.policy.refresh();assert.deepEqual(f.limit(),[1070,500]);assert.equal(f.sets(),0);});
test('zoom factor scales CSS width, not the native frame',()=>{const f=fixture({zoom:1.25});f.policy.refresh();assert.deepEqual(f.limit(),[1334,500]);});
test('saved narrow windows are widened once and remain within the monitor',()=>{const f=fixture({width:420});f.policy.refresh();assert.equal(f.bounds().width,1070);assert.equal(f.sets(),1);f.policy.refresh();assert.equal(f.sets(),1);assert.equal(f.minimumSets(),1);});
test('grow=false only sets the tracking constraint',()=>{const f=fixture({width:420});f.policy.refresh({grow:false});assert.equal(f.bounds().width,420);assert.equal(f.limit()[0],1070);});
test('mini journal is not widened or assigned desktop minimum',()=>{const f=fixture({width:420,mini:true});f.policy.refresh();assert.equal(f.sets(),0);assert.deepEqual(f.limit(),[380,500]);});
test('small monitor caps the limit instead of hiding controls offscreen',()=>{const f=fixture({width:900,area:{x:-1024,y:0,width:1024,height:768}});f.policy.refresh();assert.equal(f.limit()[0],1024);assert.equal(f.bounds().x,-1024);});
test('restore targets cannot programmatically bypass the full window floor',()=>{const f=fixture();assert.equal(f.policy.constrain({x:1850,y:50,width:420,height:700}).width,1070);assert.equal(f.policy.constrain({x:1850,y:50,width:420,height:700}).x,850);});
for(const key of ['maximized','fullscreen'])test(key+' is not resized under the tracking rule',()=>{const f=fixture({width:900,[key]:true});f.policy.refresh();assert.equal(f.sets(),0);assert.equal(f.limit()[0],1070);});
test('current page CSS may refine the fallback; invalid page readings are ignored',()=>{const f=fixture();f.policy.updateCssMinimum(1100);assert.equal(f.limit()[0],1116);f.policy.updateCssMinimum(null);assert.equal(f.limit()[0],1116);});
