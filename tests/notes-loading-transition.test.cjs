'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../public/notes-workspace.js'),'utf8');
const a=src.indexOf('  function notesLoadingTransition('),tail=src.slice(a),fn=tail.slice(0,tail.search(/^  }\r?$/m)+3);
function fixture(mobile,missing=false){
 const classes=new Set(['open','loading']),attributes={},timers=[],cleared=[],progress={style:{}},body={appendChild(el){el.parentNode=this;}};
 const overlay={parentNode:body,classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x))},setAttribute:(k,v)=>attributes[k]=v,querySelector:()=>progress,offsetWidth:1};
 const c={Date,Math,notesIsMobile:()=>mobile,notesLoadingRun:5,notesTransitionTimer:123,document:{body,getElementById:()=>missing?null:overlay},clearTimeout:id=>cleared.push(id),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}};
 vm.createContext(c);vm.runInContext(fn,c);return {c,classes,attributes,timers,cleared};
}
test('mobile begins immediately with no 900ms hold or 4200ms branded animation',()=>{
 const h=fixture(true);let starts=0;h.c.notesLoadingTransition(reveal=>{starts++;reveal();});assert.equal(starts,1);assert.deepEqual(h.timers,[]);assert.equal(h.classes.size,0);assert.equal(h.attributes['aria-hidden'],'true');assert.deepEqual(h.cleared,[123]);assert.equal(h.c.notesLoadingRun,6);assert.equal(h.c.notesTransitionTimer,null);
});
test('mobile begin does not bypass notesLoad or enable partially loaded editing',()=>{
 const h=fixture(true);h.c.notesMobileLoading=true;h.c.notesLoadedFor=null;h.c.notesLoadingTransition(reveal=>{reveal();});assert.equal(h.c.notesMobileLoading,true);assert.equal(h.c.notesLoadedFor,null);assert.doesNotMatch(fn.slice(fn.indexOf('if(notesIsMobile())'),fn.indexOf('/* Keep')),/notesMobileBusy\(false\)|notesLoadedFor\s*=/);
});
test('desktop keeps its existing branded schedule',()=>{
 const h=fixture(false);let starts=0;h.c.notesLoadingTransition(()=>starts++);assert.equal(starts,0);assert.equal(h.timers[0].ms,900);h.timers[0].fn();assert.equal(starts,1);assert.equal(h.classes.has('loading'),true);
});
test('a later mobile transition invalidates an older desktop intro callback',()=>{
 const h=fixture(false);let starts=0;h.c.notesLoadingTransition(()=>starts++);h.c.notesIsMobile=()=>true;h.c.notesLoadingTransition(()=>starts++);h.timers[0].fn();assert.equal(starts,1);
});
test('missing overlay still starts loading directly',()=>{
 const h=fixture(true,true);let starts=0;h.c.notesLoadingTransition(reveal=>{starts++;reveal();});assert.equal(starts,1);assert.deepEqual(h.timers,[]);
});
