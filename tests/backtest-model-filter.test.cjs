'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function fn(name){const start=src.indexOf('  function '+name+'(');assert.ok(start>=0,name);const tail=src.slice(start);return tail.slice(0,tail.search(/^  }\r?$/m)+3);}
function fixture(){
 const noop=()=>{};const c={console,viewingUser:'tester',activeBacktestId:'bt1',tradingModelsUser:'tester',tradingModelsReady:true,tradingModels:[{id:'a',name:'H4FVG'},{id:'b',name:'H4Range'},{id:'c',name:'Empty'}],backtestModelFilterId:'',backtestModelFilterContext:'',document:{getElementById:()=>null},findUser:()=>({uid:'u1'}),pad2:n=>String(n).padStart(2,'0')};
 vm.createContext(c);
 for(const n of ['backtestModelCatalogue','validBacktestModelFilter','filterBacktestTradesByModel','closeBacktestModelMenu','parseRRList','buildBacktestTradesFromRR','normalizeTradeRisk','tradeRiskPercent','tradeGainPercent','tradeStatsDate','sortedAsc','monthsBetween','computeStats'])vm.runInContext(fn(n),c);
 c.backtest={id:'bt1',source:'replay',cleanOnly:false};
 c.allBacktestTrades=[['a',2,.5,false],['b',3,1,false],['a',-1,.5,false],['b',-1,1,true],['',1,1,false]].map(([modelId,r,riskPercent,afterRewind],i)=>({id:'t'+i,backtestId:'bt1',modelId,r,riskPercent,afterRewind,openDT:'2026-01-0'+(i+1)+'T12:00',closeDT:'2026-01-0'+(i+1)+'T13:00'}));
 c.validBacktestModelFilter();return c;
}
test('all models preserves every closed trade; each model isolates chart and risk-weighted stats',()=>{
 const c=fixture(),original=JSON.stringify(c.allBacktestTrades);
 const run=id=>{c.backtestModelFilterId=id;return c.computeStats(c.filterBacktestTradesByModel(c.buildBacktestTradesFromRR(c.backtest)));};
 let s=run('');assert.equal(s.total,5);assert.equal(s.totalPercent,3.5);assert.equal(s.totalRR,4);
 s=run('a');assert.equal(s.total,2);assert.equal(s.totalPercent,.5);assert.equal(s.totalRR,1);assert.equal(s.winRate,50);assert.deepEqual(Array.from(s.chartData,d=>d.equity),[0,2,1]);
 s=run('b');assert.equal(s.total,2);assert.equal(s.totalPercent,2);assert.deepEqual(Array.from(s.chartData,d=>d.equity),[0,3,2]);
 assert.equal(JSON.stringify(c.allBacktestTrades),original,'filter cannot mutate or remove stored trades');
});
test('model and rewind Clean filters compose, never include another backtest',()=>{
 const c=fixture();c.backtestModelFilterId='b';c.backtest.cleanOnly=true;
 c.allBacktestTrades.push({backtestId:'other',modelId:'b',r:99,riskPercent:1});
 const arr=c.filterBacktestTradesByModel(c.buildBacktestTradesFromRR(c.backtest));assert.equal(arr.length,1);assert.equal(c.computeStats(arr).totalRR,3);
});
test('unassigned and empty models have explicit zero results without borrowing all trades',()=>{
 const c=fixture();c.backtestModelFilterId='__NO_MODEL__';assert.equal(c.filterBacktestTradesByModel(c.allBacktestTrades).length,1);
 c.backtestModelFilterId='c';assert.equal(c.computeStats(c.filterBacktestTradesByModel(c.allBacktestTrades)).total,0);
});
test('no models, loading or another account catalogue disables filtering',()=>{
 for(const change of [c=>c.tradingModels=[],c=>c.tradingModelsReady=false,c=>c.tradingModelsUser='other']){
  const c=fixture();c.backtestModelFilterId='a';change(c);assert.equal(c.backtestModelCatalogue().length,0);assert.equal(c.filterBacktestTradesByModel(c.allBacktestTrades).length,5);assert.equal(c.backtestModelFilterId,'');
 }
});
test('account/backtest switch and model deletion reset stale selection; renames keep ID match',()=>{
 for(const change of [c=>c.viewingUser='other',c=>c.activeBacktestId='bt2',c=>c.tradingModels=c.tradingModels.filter(m=>m.id!=='a')]){
  const c=fixture();c.backtestModelFilterId='a';change(c);assert.equal(c.validBacktestModelFilter(),'');
 }
 const c=fixture();c.backtestModelFilterId='a';c.tradingModels[0].name='Renamed';c.tradingModels[1].name='Renamed';assert.equal(c.filterBacktestTradesByModel(c.allBacktestTrades).length,2);
});
test('manual RR data remains unchanged and cannot be falsely assigned to a model',()=>{
 const c=fixture(),bt={id:'manual',rrText:'+2,-1',daysTested:5,endDate:'2026-01-05',source:''};const original=JSON.stringify(bt);
 c.backtestModelFilterId='a';assert.equal(c.filterBacktestTradesByModel(c.buildBacktestTradesFromRR(bt)).length,0);assert.equal(JSON.stringify(bt),original);
 c.backtestModelFilterId='';assert.equal(c.buildBacktestTradesFromRR(bt).length,2);
});
test('all curve entry points filter first and model identity participates in animation/cache keys',()=>{
 assert.match(fn('renderBacktestChart'),/arr = filterBacktestTradesByModel\(arr\)/);
 assert.match(fn('renderBacktestChart'),/viewingUser, backtestModelFilterId/);
 assert.match(fn('renderBacktests'),/computeStats\(filteredBacktestTrades\)/);
 assert.match(fn('renderBacktestChartUncached'),/backtestModelFilterId \+ '\|'/);
 assert.doesNotMatch(src.slice(src.indexOf('// Backtest model filter:'),src.indexOf('// End backtest model filter.')),/db\.collection|localStorage|saveBacktestLocal/);
});
test('Replay bridge persists model ID/name on a closed trade and retains risk and RR',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');const block=html.match(/<script id="replay-bridge">([\s\S]*?)<\/script>/)[1];
 const c=fixture(),saved=[];c.window={};c.currentUser={login:'tester'};c.backtests=[{id:'bt1',startDate:'2026-01-01',endDate:'2026-01-10'}];c.allBacktestTrades=[];c.saveBacktestLocal=()=>{};
 c.db={collection:name=>({doc:id=>({set:obj=>{saved.push({name,id,obj:JSON.parse(JSON.stringify(obj))});return Promise.resolve();}})})};
 c.tjDataGeneration=0;c.tjBacktestWrite=(name,id,data,options)=>Object.assign(c.db.collection(name).doc(id).set(data,options),{queued:true});
 vm.runInContext(fn('findTradingModel')+fn('applyTradeModel')+block,c);
 const rec=c.window.TJReplayBridge.addTrade('bt1',{modelId:'a',r:2,riskPercent:.5,openDT:'2026-01-02T12:00',closeDT:'2026-01-02T13:00'});
 assert.equal(rec.modelId,'a');assert.equal(rec.modelName,'H4FVG');assert.equal(saved[0].obj.modelId,'a');assert.equal(saved[0].obj.riskPercent,.5);assert.equal(c.backtests[0].rrText,'+2');
});
