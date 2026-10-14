'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWindowMotion}=require('../window-motion');
const compact={x:1100,y:60,width:420,height:730};
function setup({failCapture=false,failCover=false,hold=false,holdReveal=false,timeout=3000}={}){
 let bounds={x:0,y:0,width:1440,height:900},opacity=1,visible=true,destroyed=false;
 const moves=[],calls=[],covers=[];
 const image={isEmpty:()=>false,toJPEG:()=>{throw Error('lossy screenshots must never be used');},toDataURL:()=> 'data:image/png;base64,aW1hZ2U='};
 const contents=()=>({isDestroyed:()=>false,setBackgroundThrottling:b=>calls.push(['throttle',b]),
   capturePage:async()=>{if(failCapture)throw Error('capture failed');return image;},executeJavaScript:async()=>true});
 const w={isDestroyed:()=>destroyed,isVisible:()=>visible,getContentBounds:()=>({...bounds}),isFullScreen:()=>false,
   getOpacity:()=>opacity,setOpacity:a=>{opacity=a;calls.push(['opacity',a]);},
   setBounds:b=>{bounds={...b};moves.push({...b});},webContents:contents()};
 let release;
 const motion=createWindowMotion({getWindow:()=>w,getView:()=>({webContents:contents()}),timeout,sleep:async()=>{},
   createOverlay:rect=>{
     if(failCover)throw Error('cover failed');
     const cover={ready:Promise.resolve(),isDestroyed:()=>cover.dead,
       showInactive(){calls.push(['showCover']);},destroy(){cover.dead=true;calls.push(['destroyCover']);},
       webContents:{executeJavaScript:async code=>{
         const stage=code.match(/syterTransition\.(\w+)\(/)[1];calls.push([stage,code]);
         if(holdReveal&&stage==='reveal')return new Promise(r=>{release=r;});
         if(hold&&code.includes('.play('))return new Promise(r=>{release=r;});return true;}}};
     covers.push(cover);return cover;
   }});
 return {motion,w,moves,calls,covers,opacity:()=>opacity,bounds:()=>bounds,hide:()=>{visible=false;},destroy:()=>{destroyed=true;},release:()=>release?.()};
}
test('original picture is prepared before any native resize; cover does not take focus',async()=>{
 const s=setup();assert.equal(await s.motion.prepare(compact),true);
 assert.equal(s.moves.length,0);assert.equal(s.opacity(),0);assert.equal(s.motion.isActive(),true);
 assert.ok(s.calls.findIndex(c=>c[0]==='showCover')<s.calls.findIndex(c=>c[0]==='opacity'));
 s.motion.cancel();assert.equal(s.opacity(),1);assert.equal(s.covers[0].dead,true);
});
test('live native window is resized once, not every animation frame',async()=>{
 const s=setup();await s.motion.prepare(compact);assert.equal(await s.motion.move(compact),true);
 assert.deepEqual(s.moves,[compact]);assert.equal(s.opacity(),1);assert.equal(s.motion.isActive(),false);
 assert.ok(s.calls.some(c=>c[0]==='play'));assert.equal(s.covers[0].dead,true);
});
test('lossless cover is actually presented before the live window is concealed',async()=>{
 const s=setup();await s.motion.prepare(compact);
 const names=s.calls.map(c=>c[0]);
 assert.ok(names.indexOf('prepare')<names.indexOf('showCover'));
 assert.ok(names.indexOf('showCover')<names.indexOf('reveal'));
 assert.ok(names.indexOf('reveal')<names.indexOf('opacity'));
 const payload=JSON.parse(s.calls.find(c=>c[0]==='prepare')[1].match(/\((.*)\)$/)[1]);
 assert.ok(payload.source.body.startsWith('data:image/png;'));
 s.motion.cancel();
});
test('the opaque live destination is ready before the cover releases; no redundant opacity restore',async()=>{
 const s=setup();await s.motion.prepare(compact);await s.motion.move(compact);
 const names=s.calls.map(c=>c[0]),reveal=names.indexOf('release');
 assert.ok(names.indexOf('play')<reveal);assert.ok(reveal<names.indexOf('destroyCover'));
 assert.deepEqual(s.calls.filter(c=>c[0]==='opacity').map(c=>c[1]),[0,1]);
});
test('cancel before cover presentation never hides the live window',async()=>{
 const s=setup({holdReveal:true});const done=s.motion.prepare(compact);
 while(!s.calls.some(c=>c[0]==='reveal'))await new Promise(r=>setImmediate(r));
 assert.equal(s.opacity(),1);s.motion.cancel();assert.equal(await done,false);
 assert.equal(s.opacity(),1);assert.equal(s.covers[0].dead,true);s.release();
});
test('reduced motion uses one immediate resize and never creates a cover',async()=>{
 const s=setup();assert.equal(await s.motion.prepare(compact,false),false);
 assert.equal(await s.motion.move(compact,false),true);assert.deepEqual(s.moves,[compact]);assert.equal(s.covers.length,0);
});
test('native maximize/fullscreen restoration runs underneath the cover',async()=>{
 const s=setup();await s.motion.prepare(compact);let called=false;
 await s.motion.move(compact,true,()=>{called=true;assert.equal(s.opacity(),0);s.w.setBounds(compact);});
 assert.equal(called,true);assert.equal(s.moves.length,1);
});
test('screenshot/cover failures leave the live journal visible and usable',async()=>{
 for(const option of [{failCapture:true},{failCover:true}]){
   const s=setup(option);assert.equal(await s.motion.prepare(compact),false);assert.equal(s.opacity(),1);
   await s.motion.move(compact);assert.deepEqual(s.moves,[compact]);assert.equal(s.motion.isActive(),false);
 }
});
test('cancel during playback resolves IPC, closes the cover and never shows a hidden window',async()=>{
 const s=setup({hold:true});await s.motion.prepare(compact);const done=s.motion.move(compact);
 while(!s.calls.some(c=>c[0]==='play'))await new Promise(r=>setImmediate(r));
 s.hide();s.motion.cancel();assert.equal(await done,false);assert.equal(s.w.isVisible(),false);assert.equal(s.opacity(),1);
 assert.equal(s.covers[0].dead,true);s.release();
});
test('watchdog releases a stalled compositor without leaving an invisible window',async()=>{
 const s=setup({hold:true,timeout:20});await s.motion.prepare(compact);const done=s.motion.move(compact);
 await new Promise(r=>setTimeout(r,35));assert.equal(await done,false);assert.equal(s.opacity(),1);assert.equal(s.motion.isActive(),false);
});
test('a superseded transition cannot reveal or destroy the next cover',async()=>{
 const s=setup({hold:true});await s.motion.prepare(compact);const first=s.motion.move(compact);
 while(!s.calls.some(c=>c[0]==='play'))await new Promise(r=>setImmediate(r));
 await s.motion.prepare({x:20,y:30,width:1200,height:800});assert.equal(await first,false);
 assert.equal(s.covers[0].dead,true);assert.equal(s.covers[1].dead,undefined);assert.equal(s.opacity(),0);s.motion.cancel();
});
test('hidden/destroyed windows and enormous multi-monitor surfaces skip animation',async()=>{
 const s=setup();s.hide();assert.equal(await s.motion.prepare(compact),false);
 s.destroy();assert.equal(await s.motion.move(compact),false);
 const wide=setup();assert.equal(await wide.motion.prepare({x:20000,y:0,width:400,height:700}),false);
});
