'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createViewLayout } = require('../view-layout');
function fixture() {
  let size = [900,700], fullscreen = false, destroyed = false;
  const calls = [];let view={setBounds:bounds=>calls.push(bounds)};
  const win={getContentSize:()=>size,isFullScreen:()=>fullscreen,isDestroyed:()=>destroyed};
  const api=createViewLayout({getWindow:()=>win,getView:()=>view});
  return {api,calls,set(w,h){size=[w,h]},fullscreen(on){fullscreen=on},destroy(){destroyed=true},
    replaceView(){view={setBounds:bounds=>calls.push(bounds)}}};
}
test('initial layout leaves the original title bar',()=>{
 const f=fixture();f.api.layout();assert.deepEqual(f.calls,[{x:0,y:36,width:900,height:664}]);
});
test('duplicate layout events make no additional native bounds calls',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.api.layout();assert.equal(f.calls.length,1);
});
test('each actual geometry change is applied immediately without a timer',()=>{
 const f=fixture();f.api.layout();f.set(800,600);f.api.layout();
 assert.deepEqual(f.calls.at(-1),{x:0,y:36,width:800,height:564});assert.equal(f.calls.length,2);
});
test('fullscreen and restored geometry remain authoritative',()=>{
 const f=fixture();f.api.layout();f.fullscreen(true);f.api.layout();
 assert.deepEqual(f.calls.at(-1),{x:0,y:0,width:900,height:700});
 f.fullscreen(false);f.api.layout();assert.equal(f.calls.at(-1).y,36);
});
test('destroyed windows are ignored and replacement views receive bounds',()=>{
 const f=fixture();f.api.layout();f.replaceView();f.api.layout();assert.equal(f.calls.length,2);
 f.destroy();f.set(800,600);f.api.layout();assert.equal(f.calls.length,2);
});
test('production removes animation pausing and does not ship speculative native interception',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),config=require('../package.json');
 assert.ok(!source.includes("'resize-performance.js'"));assert.ok(!source.includes("'resize-performance.css'"));
 assert.ok(!config.build.files.some(file=>/^resize-performance\./.test(file)));
 assert.ok(!source.includes("win.on('will-resize'"));assert.ok(config.build.files.includes('view-layout.js'));
});
