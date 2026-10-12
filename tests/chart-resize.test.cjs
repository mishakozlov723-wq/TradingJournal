const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'../public/app.js'),'utf8');
function fn(name){const start=src.indexOf('  function '+name+'('),tail=src.slice(start);assert.ok(start>=0);return tail.slice(0,tail.search(/^  }\r?$/m)+3);}
function fixture(){
 let next=0;const frames=new Map(),listeners={};
 function element(){return {style:{},classList:{add(){},remove(){}},setAttribute(){},addEventListener(n,cb){this.events[n]=cb;},events:{},querySelector(){return null;},getBoundingClientRect(){return {height:380};},getClientRects(){return [1];},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){}};}
 const card=element();card.appendChild=g=>card.grip=g;const svg=element();svg.closest=()=>card;
 const root=element();root.style={setProperty(){},removeProperty(){}};
 const c={Number,Math,console,currentUser:null,lastChartData:[0,1],chartCssHeight:()=>380,document:{documentElement:root,getElementById:id=>id==='chartSvg'?svg:null,createElement:element},window:{addEventListener(n,cb){listeners[n]=cb;}},requestAnimationFrame:cb=>{frames.set(++next,cb);return next;},cancelAnimationFrame:id=>frames.delete(id),clearTimeout(){},setTimeout:()=>1,tjHoverMotion:()=>true,renderChart(){},tjEndChartResize(){c.tjChartResizing=false;},tjBeginChartResize(){c.tjChartResizing=true;},tjSaveChartHeight(){},tjChartHeight:null,tjChartResizing:false,tjResizeLive:false,tjResizeAnim:{cur:null,target:null,raf:0,last:0,dragging:false},TJ_CHART_H_MIN:240,TJ_CHART_H_MAX:820,TJ_CHART_SVG_IDS:['chartSvg'],TJ_DETAIL_SVG_IDS:[],tjRedrawVisibleCharts:()=>false};
 vm.createContext(c);for(const name of ['tjWriteChartHeight','tjFinishChartResize','tjResizeTick','tjAnimateChartHeight','tjInitChartGrip'])vm.runInContext(fn(name),c);
 c.tjInitChartGrip('chartSvg','.card');return {c,frames,grip:card.grip,listeners};
}
 for(const end of ['pointerup','pointercancel','lostpointercapture','blur'])test('rapid upward drag terminates on '+end,()=>{
 const {c,frames,grip,listeners}=fixture();const event=y=>({pointerType:'mouse',button:0,pointerId:1,clientY:y,preventDefault(){},stopPropagation(){}});
 for(let i=0;i<30;i++){grip.events.pointerdown(event(500));grip.events.pointermove(event(-2000));assert.equal(c.tjResizeAnim.target,240);if(end==='blur')listeners.blur();else grip.events[end](event(-2000));assert.equal(frames.size,0);assert.equal(c.tjResizeLive,false);assert.equal(c.tjResizeAnim.dragging,false);assert.equal(c.tjChartResizing,false);assert.equal(c.tjChartHeight,240);}
});
test('resize rejects invalid heights and clamps large downward moves',()=>{const {c,frames}=fixture();c.tjAnimateChartHeight(NaN,null,false);c.tjAnimateChartHeight(Infinity,null,false);assert.equal(frames.size,0);c.tjAnimateChartHeight(1e9,null,false);assert.equal(c.tjResizeAnim.target,820);c.tjFinishChartResize();assert.equal(frames.size,0);});
