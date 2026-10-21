'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../public/notes-workspace.js'),'utf8');
const a=src.indexOf('  function notesLoadingTransition('),tail=src.slice(a),fn=tail.slice(0,tail.search(/^  }\r?$/m)+3);
function fixture(mobile=false,{missing=false,animated=false}={}){
 let now=0,finish;const classes=new Set(),attributes={},timers=[],cleared=[],body={appendChild(el){el.parentNode=this;}};
 const animation={animationName:'notesLoadingProgress',playState:'running',finished:new Promise(r=>finish=r)};
 const progress={style:{},getAnimations:()=>animated?[animation]:[]};
 const overlay={parentNode:body,classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x))},setAttribute:(k,v)=>attributes[k]=v,querySelector:()=>progress,offsetWidth:1};
 const c={Date:{now:()=>now},Math,notesIsMobile:()=>mobile,notesLoadingRun:5,notesTransitionTimer:123,document:{body,getElementById:()=>missing?null:overlay},clearTimeout:id=>cleared.push(id),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}};
 vm.createContext(c);vm.runInContext(fn,c);return {c,classes,attributes,timers,cleared,progress,finish,setNow:v=>now=v};
}
for(const mobile of [true,false])test((mobile?'mobile':'desktop')+' preserves 900ms hold, 4200ms intro and 220ms exit',()=>{
 const h=fixture(mobile);let starts=0;h.c.notesLoadingTransition(reveal=>{starts++;reveal();});assert.equal(starts,0);assert.equal(h.timers[0].ms,900);assert.equal(h.classes.has('loading'),true);assert.equal(h.attributes['aria-hidden'],'false');
 h.setNow(900);h.timers[0].fn();assert.equal(starts,1);assert.match(h.progress.style.animation,/4\.2s/);assert.equal(h.timers[1].ms,4200);assert.equal(h.classes.has('leaving'),false);
 h.setNow(5100);h.timers[1].fn();assert.equal(h.classes.has('leaving'),true);assert.equal(h.timers[2].ms,220);h.setNow(5320);h.timers[2].fn();assert.equal(h.classes.size,0);assert.equal(h.attributes['aria-hidden'],'true');
});
test('completed data does not shorten the minimum intro; delayed completion only waits its remainder',()=>{
 const h=fixture(true);let reveal;h.c.notesLoadingTransition(r=>reveal=r);h.setNow(900);h.timers[0].fn();h.setNow(1900);reveal();assert.equal(h.timers[1].ms,3200);reveal();assert.equal(h.timers.length,2);
});
test('an unfinished CSS animation still gates leaving in a background-tab-like state',async()=>{
 const h=fixture(true,{animated:true});h.c.notesLoadingTransition(reveal=>reveal());h.setNow(900);h.timers[0].fn();h.setNow(5100);h.timers[1].fn();assert.equal(h.classes.has('leaving'),false);h.finish();await Promise.resolve();assert.equal(h.classes.has('leaving'),true);assert.equal(h.timers[2].ms,220);
});
test('new transition invalidates an older scheduled intro',()=>{
 const h=fixture(true);let starts=0;h.c.notesLoadingTransition(()=>starts++);h.c.notesLoadingTransition(()=>starts++);h.setNow(900);h.timers[0].fn();assert.equal(starts,0);h.timers[1].fn();assert.equal(starts,1);
});
test('animation completion cannot unlock or save a partially loaded Notes workspace',()=>{
 const h=fixture(true);h.c.notesMobileLoading=true;h.c.notesLoadedFor=null;h.c.notesLoadingTransition(reveal=>reveal());h.setNow(900);h.timers[0].fn();h.setNow(5100);h.timers[1].fn();h.timers[2].fn();assert.equal(h.c.notesMobileLoading,true);assert.equal(h.c.notesLoadedFor,null);assert.doesNotMatch(fn,/notesMobileBusy\(false\)|notesLoadedFor\s*=/);
});
test('missing overlay retains original direct-start fallback',()=>{
 const h=fixture(true,{missing:true});let starts=0;h.c.notesLoadingTransition(reveal=>{starts++;reveal();});assert.equal(starts,1);assert.deepEqual(h.timers,[]);
});
