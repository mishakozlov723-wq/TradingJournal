const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=require('./assembled-html.cjs')();
const source=html.slice(html.indexOf('  var notesLoadingRun = 0;'),html.indexOf('  function enterNotesWorkspace()'));
function setup(mobile=true,animated=false){
 let now=0,id=0,resolve;const jobs=new Map(),classes=new Set(),body={},progress={style:{},offsetWidth:1};
 const animation={animationName:'notesLoadingProgress',playState:'running',finished:new Promise(r=>resolve=r)};
 if(animated)progress.getAnimations=()=>[animation];
 const overlay={parentNode:body,offsetWidth:1,classList:{add:(...x)=>x.forEach(v=>classes.add(v)),remove:(...x)=>x.forEach(v=>classes.delete(v))},setAttribute(){},querySelector:()=>progress};
 const ctx={notesTransitionTimer:null,document:{body,getElementById:()=>overlay},Date:{now:()=>now},notesIsMobile:()=>mobile,setTimeout(fn,ms){jobs.set(++id,{at:now+ms,fn});return id;},clearTimeout:i=>jobs.delete(i),requestAnimationFrame:fn=>fn()};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 function advance(ms){const end=now+ms;while(true){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;jobs.delete(next[0]);next[1].fn();}now=end;}
 return {ctx,classes,advance,finish(){animation.playState='finished';resolve();}};
}
for(const mobile of [true,false])test((mobile?'mobile':'desktop')+' fast load keeps the full 900 + 4200ms intro',()=>{const h=setup(mobile);let began=false;h.ctx.notesLoadingTransition(done=>{began=true;done();done();});h.advance(899);assert.equal(began,false);h.advance(1);assert.equal(began,true);h.advance(4199);assert.equal(h.classes.has('leaving'),false);h.advance(1);assert.equal(h.classes.has('leaving'),true);h.advance(220);assert.equal(h.classes.has('open'),false);});
test('slow readiness keeps cover after animation until ready',()=>{const h=setup(false);let ready;h.ctx.notesLoadingTransition(done=>ready=done);h.advance(7000);assert.equal(h.classes.has('open'),true);assert.equal(h.classes.has('leaving'),false);ready();h.advance(0);assert.equal(h.classes.has('leaving'),true);});
test('paused animation cannot be bypassed by elapsed wall time',async()=>{const h=setup(true,true);h.ctx.notesLoadingTransition(done=>done());h.advance(10000);assert.equal(h.classes.has('leaving'),false);h.finish();await Promise.resolve();assert.equal(h.classes.has('leaving'),true);});
test('stale completion cannot hide a new intro',async()=>{const h=setup(true,true);h.ctx.notesLoadingTransition(done=>done());h.advance(5100);h.ctx.notesLoadingTransition(()=>{});h.finish();await Promise.resolve();assert.equal(h.classes.has('leaving'),false);assert.equal(h.classes.has('open'),true);});
test('reopening restarts the full schedule',()=>{const h=setup();h.ctx.notesLoadingTransition(done=>done());h.advance(4000);h.ctx.notesLoadingTransition(done=>done());h.advance(5099);assert.equal(h.classes.has('leaving'),false);h.advance(1);assert.equal(h.classes.has('leaving'),true);});
