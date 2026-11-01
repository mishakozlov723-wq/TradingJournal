'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function fn(name){
  const start=src.indexOf('  function '+name+'(');assert.ok(start>=0,name);
  const brace=src.indexOf('{',start);let depth=0,quote='',escape=false;
  for(let i=brace;i<src.length;i++){
    const ch=src[i];
    if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw Error('unterminated '+name);
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}

test('Overview core resolves before Backtests while preserving the guarded readiness promise',async()=>{
  const bt=deferred(),calls=[];
  const c={Promise,console,window:{},viewingUser:'alice',currentUser:{login:'alice'},tjDataGeneration:0,trades:[],tjServerTrades:{},tradingModels:[],backtestsLoadedFlag:true,backtestsLoadError:true,
    flushNotePanelSave(){},closeBestTrade(){},flushBacktestRRDraft(){},stopLiveSync(){},closeModelCreatePanel(){},closeModal(){},renderTradeModelControl(){},showOverviewSkeleton(){calls.push('skeleton')},
    findUser(){return {uid:'uid-alice'}},readTradingModelsDocument(){return Promise.resolve({exists:false,data(){return {}}})},normalizeAssetDefinitions(){return []},renderAssetControls(){},updateCurveColorUI(){},tjApplyChartHeight(){},tjApplyBacktestChartHeight(){},
    db:{collection(name){assert.equal(name,'trades');return {where(){return {get(){return Promise.resolve({forEach(){}})}}}}}},normalizeTradeRisk:x=>x,invalidateTradeNumbers(){},migrateFromLocalStorage(){return Promise.resolve()},idbGetAllForUser(){return Promise.resolve([])},
    loadBacktests(uid,load){calls.push(['backtests',uid,load.user]);return bt.promise},tjLoadIsCurrent(load){return load.generation===c.tjDataGeneration&&load.user===c.viewingUser&&load.authUser===c.currentUser},
    remoteSaveTrade(){},tjClone:x=>JSON.parse(JSON.stringify(x)),document:{getElementById(){return {style:{},textContent:''}}},
    tjClearJournalNotices(){},tjNotice(){},tjResendPendingTrades(){calls.push('resend')}
  };
  vm.createContext(c);vm.runInContext(fn('loadData'),c);
  const load=await c.loadData();
  assert.equal(load.user,'alice');assert.equal(c.backtestsLoadedFlag,false);assert.equal(c.backtestsLoadError,false);
  assert.deepEqual(calls.at(-1),['backtests','uid-alice','alice']);
  let backgroundDone=false;load.backtestsReady.then(()=>backgroundDone=true);await Promise.resolve();assert.equal(backgroundDone,false);
  bt.resolve();await load.backtestsReady;assert.equal(backgroundDone,true);
});

test('Overview reveal is immediate, but live listeners wait for Backtests and recheck identity',async()=>{
  const bt=deferred(),events=[],button={classList:{remove:x=>events.push('button:'+x)}};
  const c={Promise,activeTab:'overview',current:true,tjLoadIsCurrent(){return c.current},render(){events.push('render')},hideOverviewSkeleton(){events.push('hide')},maybeShowStreakToast(){events.push('toast')},renderBacktests(){events.push('backtests-ui')},startLiveSync(){events.push('live')},setTimeout(){},TJ_THUMB_SHRINK_DELAY_MS:0};
  vm.createContext(c);vm.runInContext(fn('finishJournalCoreLoad'),c);
  c.finishJournalCoreLoad({backtestsReady:bt.promise},button);
  assert.deepEqual(events,['render','hide','toast','button:is-loading']);
  bt.resolve();await bt.promise;await Promise.resolve();assert.equal(events.at(-1),'live');
  const stale=deferred();c.finishJournalCoreLoad({backtestsReady:stale.promise});c.current=false;stale.resolve();await stale.promise;await Promise.resolve();assert.equal(events.filter(x=>x==='live').length,1);
});

test('Backtests have an explicit non-interactive loading state',()=>{
  const title={textContent:''},subtitle={textContent:''},empty={style:{},querySelector(){return title}};title.nextElementSibling=subtitle;
  const elements={backtestsList:{innerHTML:'old'},backtestsEmpty:empty,backtestDetailView:{style:{}},backtestsListView:{style:{}},addBacktestBtn:{style:{},disabled:false}};
  const c={backtestsLoadedFlag:false,backtestsLoadError:false,activeBacktestId:'old',backtestWorkspaceMode:true,document:{body:{classList:{toggle(){}}},getElementById:id=>elements[id]}};
  vm.createContext(c);vm.runInContext(fn('renderBacktests'),c);c.renderBacktests();
  assert.equal(elements.addBacktestBtn.disabled,true);assert.equal(c.activeBacktestId,null);assert.equal(title.textContent,'Loading backtests…');assert.match(subtitle.textContent,/journal is ready/i);assert.equal(elements.backtestsList.innerHTML,'');
});

test('source keeps outbox overlay and owner/generation guards in the background loader',()=>{
  const loadBacktests=fn('loadBacktests');
  assert.match(loadBacktests,/tjLoadIsCurrent\(load\)/);assert.match(loadBacktests,/generation === tjBacktestLoadGeneration/);
  assert.match(loadBacktests,/tjBacktestOutbox\(loadOwner\)/);assert.match(loadBacktests,/tjOverlayBacktestOutbox\(results\[0\]/);assert.match(loadBacktests,/tjOverlayBacktestOutbox\(results\[1\]/);
});
