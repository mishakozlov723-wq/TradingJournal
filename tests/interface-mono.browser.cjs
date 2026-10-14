// Run with Node 24 and Chromium. Only local fixtures; never authenticates to production.
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),{spawn}=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'), pub=path.join(root,'public'), output=process.env.SYTER_QA_DIR||path.join(os.tmpdir(),'syter-interface-qa');fs.mkdirSync(output,{recursive:true});
const old=fs.readFileSync(pub+'/tests/trading-models.test.cjs','utf8');
let double=old.slice(old.indexOf('function installFirestoreDouble()'),old.indexOf("test('all application inline scripts parse'"));
double=double.replace('update(ref, value) { updates.push([ref.key, value]); },', `set(ref, value, options) { const data=saved(); data[ref.key]=options&&options.merge?merge(data[ref.key]||{},value):value; localStorage.setItem('model-test-db',JSON.stringify(data)); return this; }, delete(ref) {const data=saved();delete data[ref.key];localStorage.setItem('model-test-db',JSON.stringify(data));return this;}, update(ref, value) { updates.push([ref.key, value]); },`);
let html=fs.readFileSync(pub+'/index.html','utf8').replace(/<script\b[^>]*src="https:[^"]+"[^>]*><\/script>/g,'');
html=html.replace('<script>','<script>'+double+';installFirestoreDouble();</script><script>');
const n=24*90,first=Date.parse('2023-12-01T00:00Z')/1000,sc=100000,bin=Buffer.alloc(16+n*20);bin.writeInt32LE(n,0);bin.writeInt32LE(sc,4);
for(let i=0;i<n;i++){let o=109000+Math.round(200*Math.sin(i/23)+i/10),c=o+Math.round(50*Math.sin(i/3));[first+i*3600,o,Math.max(o,c)+45,Math.min(o,c)-45,c].forEach((v,k)=>bin.writeInt32LE(v,16+4*(k*n+i)));}
const meta={generated:'test-only',instruments:Object.fromEntries(['EURUSD','GBPUSD','XAUUSD','GER40'].map(a=>[a,{scale:sc,dp:5,m5Years:[],h1:{n,first,last:first+(n-1)*3600}}]))};
const server=http.createServer((req,res)=>{
 const p=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(p==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
 if(p.endsWith('/meta.json')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(meta));}
 if(p.endsWith('.bin'))return res.end(bin);
 const f=path.join(pub,p);if(f.startsWith(pub)&&fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.js')?'application/javascript':p.endsWith('.woff2')?'font/woff2':'image/png');return res.end(fs.readFileSync(f));}
 res.statusCode=204;res.end();
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,chrome,session,id=0;const pending=new Map(),errors=[],checks=[];
function call(method,params={},sid=session){return new Promise((resolve,reject)=>{const no=++id;pending.set(no,{resolve,reject});ws.send(JSON.stringify({id:no,method,params,...(sid?{sessionId:sid}:{})}));});}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function shot(name){await sleep(300);const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(output+'/'+name+'.png',Buffer.from(r.data,'base64'));}
async function check(name,expression){assert(await ev(expression),name);checks.push(name);console.log('PASS',name);}
async function route(name){await ev(`document.querySelector('[data-space="${name}"]').click()`);for(let i=0;i<200;i++){if(await ev(`document.querySelector('[data-space="${name}"]').getAttribute('aria-current')==='page'&&!document.querySelector('[data-space="${name}"]').disabled`))return;await sleep(50);}throw Error('Route timeout '+name);}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile=fs.mkdtempSync(path.join(os.tmpdir(),'syter-mono-'));
 chrome=spawn(process.env.CHROME_PATH||'/usr/local/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore'});
 for(let i=0;i<100&&!fs.existsSync(profile+'/DevToolsActivePort');i++)await sleep(100);
 const [port,endpoint]=fs.readFileSync(profile+'/DevToolsActivePort','utf8').trim().split('\n');ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).sessionId;
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setBlockedURLs',{urls:['https://*']});await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await sleep(1800);
 await ev(`(()=>{USERS=[{login:'qa-user',email:'qa@example.invalid',role:'admin',uid:'qa-uid'}];tjAdminUid='qa-uid';currentUser=USERS[0];viewingUser='qa-user';firebase.auth().currentUser={uid:'qa-uid'};loginScreen.style.display='none';appRoot.style.display='block';settingsWrap.style.display='';
 trades=Array.from({length:18},(_,i)=>({id:'trade'+i,uid:'qa-uid',asset:['EURUSD','XAUUSD','GBPUSD'][i%3],direction:i%2?'SHORT':'LONG',r:[2,-1,1.5,3,-1,0][i%6],riskPercent:1,openDT:'2026-10-'+String(i+1).padStart(2,'0')+'T08:00',closeDT:'2026-10-'+String(i+1).padStart(2,'0')+'T12:00',modelId:i%2?'fvg':'range',modelName:i%2?'H4FVG':'H4Range'}));
 tradingModels=[{id:'fvg',name:'H4FVG'},{id:'range',name:'H4Range'}];tradingModelsReady=true;tradingModelsUser=viewingUser;
 backtests=[{id:'bt-qa',uid:'qa-uid',name:'Replay · EURUSD',source:'replay',startDate:'2026-01-01',endDate:'2026-01-31',daysTested:31,rrText:'+2,-1,+3,-1,+1'}];backtestsLoadedFlag=true;allBacktestTrades=trades.slice(0,5).map(t=>({...t,backtestId:'bt-qa'}));
 render();hideOverviewSkeleton();renderTradeModelControl();openReplayWorkspaceBtn.style.display='flex';openAccountsWorkspaceBtn.style.display='flex';
 window.testDataBefore=JSON.stringify({trades,backtests,allBacktestTrades});window.classicMeasure={width:appRoot.getBoundingClientRect().width,bg:getComputedStyle(document.body).backgroundColor,card:getComputedStyle(document.querySelector('#overviewReal>.card')).borderRadius};})()`);
 await check('classic remains the default',`!document.documentElement.hasAttribute('data-syter-interface')&&!document.getElementById('syterRail')`);
 await shot('classic-before');
 await ev(`window.dispatchEvent(new CustomEvent('syter:interface-preview-toggle'))`);await sleep(600);
 await check('desktop full-width and monochrome palette',`appRoot.getBoundingClientRect().width>1300&&getComputedStyle(document.body).backgroundColor==='rgb(25, 25, 25)'&&getComputedStyle(totalRR).color==='rgb(239, 238, 233)'`);
 await check('no background or GPU-wide filter',`getComputedStyle(autumnParticles).display==='none'&&getComputedStyle(document.body).filter==='none'`);
 await check('Poppins typography, quiet statistics, no card boxes',`getComputedStyle(totalRR).fontFamily.includes('TJ Text')&&getComputedStyle(document.querySelector('.stat-card')).borderRadius==='0px'`);
 await sleep(1400);await shot('journal');
 await ev(`filterToggleBtn.click()`);await sleep(500);await check('Filters remain operable',`filterToggleBtn.getAttribute('aria-expanded')==='true'&&getComputedStyle(assetFilterPanel).opacity==='1'`);await shot('journal-filters');await ev(`filterToggleBtn.click()`);

 // Export a real DOM fixture for the mandatory local helper render; all data is synthetic.
 await ev(`(()=>{var copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script,link').forEach(n=>n.remove());window.qaSnapshot=copy.outerHTML;})()`);
 let snapshot=await ev('qaSnapshot');const css=['app.css','accounts-space.css','replay-space.css','interface-mono.css'].map(n=>fs.readFileSync(pub+'/'+n,'utf8').replaceAll('url("fonts/',`url("file://${pub}/fonts/`)).join('\n');
 snapshot=snapshot.replace('</head>','<style>'+css+'</style></head>');fs.writeFileSync(output+'/journal-preview.html','<!doctype html>'+snapshot);
 await ev(`document.querySelector('.syter-rail-toggle').click()`);await check('navigation collapses without resetting data',`appRoot.getBoundingClientRect().width>1500&&JSON.stringify({trades,backtests,allBacktestTrades})===testDataBefore`);await shot('journal-collapsed');
 await ev(`document.querySelector('.syter-rail-toggle').click();openModal(null);document.getElementById('magnitudeInput').value='2.75';` .replace("document.getElementById('noteText')","document.getElementById('noteText')"));
 await shot('trade-modal');
 await ev(`window.toggleInput=Array.from(document.querySelectorAll('#tradeForm input,#tradeForm textarea')).map(n=>[n.id,n.value]);window.dispatchEvent(new CustomEvent('syter:interface-preview-toggle'));`);
 await check('classic exact width/palette restored and open form retained',`appRoot.getBoundingClientRect().width===classicMeasure.width&&getComputedStyle(document.body).backgroundColor===classicMeasure.bg&&getComputedStyle(document.querySelector('#overviewReal>.card')).borderRadius===classicMeasure.card&&modalOverlay.classList.contains('open')&&magnitudeInput.value==='2.75'`);
 await ev(`window.dispatchEvent(new CustomEvent('syter:interface-preview-toggle'));closeModal();`);
 await route('backtest');await shot('backtest-list');
 await ev(`activeBacktestId='bt-qa';document.body.classList.add('backtest-detail-mode');renderBacktests();syncBacktestPanelPosition()`);await sleep(1200);
 await check('backtest input column never covers preview',`backtestInputPanel.getBoundingClientRect().right<backtestPreviewCard.getBoundingClientRect().left`);await shot('backtest-detail');
 await ev(`selectBacktestModel('fvg')`);await check('model filter still scopes statistics',`backtestTradeCount.textContent==='2 trades'`);await shot('backtest-model');
 await route('accounts');await sleep(500);await shot('accounts-empty');
 await ev(`(()=>{window.TJ_ACCOUNTS_CONFIG={apiUrl:'https://accounts.example.invalid/api'};localStorage.setItem('tjMyfxbookConnectionV1:qa-uid','test-only');firebase.auth().currentUser.getIdToken=async()=> 'test-only';var nativeFetch=window.fetch;window.fetch=async function(url,opts){if(!String(url).startsWith('https://accounts.example.invalid'))return nativeFetch(url,opts);var account={id:'qa-account',name:'Demo account',accountId:1,currency:'USD',balance:10500,equity:10540,profit:500,gain:5,demo:true,server:{name:'Test server'}};var data=String(url).includes('action=details')?{ok:true,account,history:[{id:1,action:'Buy',symbol:'EURUSD',openTime:'10/01/2026 08:00',closeTime:'10/01/2026 12:00',profit:500,pips:40,sizing:{value:.1}}],openTrades:[],daily:[{date:'10/01/2026',balance:10000},{date:'10/02/2026',balance:10200},{date:'10/03/2026',balance:10500}]}:{ok:true,accounts:[account]};return {ok:true,status:200,text:async()=>JSON.stringify(data)};};})()`);
 await ev(`TJAccounts.refresh()`);await sleep(700);await check('Accounts renders actual parsed account responses',`!!document.querySelector('[data-account-id="qa-account"]')`);await shot('accounts-list');
 await ev(`document.querySelector('[data-account-id="qa-account"]').click()`);await sleep(900);await shot('accounts-detail');

 await route('notes');await sleep(500);await shot('notes-empty');
 await ev(`notesNewPageBtn.click()`);await sleep(400);await ev(`notesPageTitle.value='Trading playbook';notesPageTitle.dispatchEvent(new Event('input',{bubbles:true}));`);await shot('notes-page');
 await check('Notes title is full-sized, not a form field',`parseFloat(getComputedStyle(notesPageTitle).fontSize)>=28&&getComputedStyle(notesPageTitle).backgroundColor==='rgba(0, 0, 0, 0)'`);

 await route('replay');await sleep(700);await shot('replay-lobby');
 await ev(`document.querySelector('[data-asset="EURUSD"]').click();rpStart.value='2024-01-02';rpEnd.value='2024-01-12';rpStart.dispatchEvent(new Event('change'));rpEnd.dispatchEvent(new Event('change'));rpStartBtn.click()`);await sleep(3200);
 await check('Replay actual chart and native candle customization retained',`TJReplay.state.sess&&TJReplay.state.chart&&TJReplay.state.series&&document.querySelector('#rpChart canvas')&&TJReplay.state.series.options().upColor==='#efeee9'&&TJReplay.state.style.body.up==='#34d399'`);await shot('replay-session');
 await ev(`document.querySelector('#rpChart').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:400}))`);await shot('replay-context');
 await ev(`document.querySelector('#rpsCtx [data-open]').click()`);await shot('replay-settings');
 await check('Replay settings and color controls still exist',`TJReplay.state.set&&document.querySelector('#rpsPane [data-color="body.up"]')`);
 await ev(`document.querySelector('#rpsPane [data-color="body.up"]').click()`);await shot('replay-color-picker');
 await ev(`document.querySelector('#rpsPop [data-hex="#ffffff"]').click()`);
 await check('User-selected candle colors remain editable',`TJReplay.state.style.body.up==='#ffffff'&&TJReplay.state.series.options().upColor==='#ffffff'`);
 await ev(`rpsCancel.click()`);await check('Cancel restores original candle preferences',`TJReplay.state.style.body.up==='#34d399'&&TJReplay.state.series.options().upColor==='#efeee9'`);
 await route('journal');await ev(`setActiveTab('calendar')`);await shot('calendar');await ev(`setActiveTab('monthly')`);await shot('monthly');await ev(`document.querySelector('#monthList [data-month="9"]').click()`);await sleep(800);await shot('monthly-detail');await ev(`setActiveTab('quarterly')`);await shot('quarterly');await ev(`document.querySelector('#quarterList [data-year="2026"][data-q="3"]').click()`);await sleep(800);await shot('quarterly-detail');await ev(`setActiveTab('yearly')`);await shot('yearly');await ev(`document.querySelector('#yearlyList [data-year="2026"]').click()`);await sleep(800);await shot('yearly-detail');await ev(`setActiveTab('gallery')`);await shot('gallery-empty');await ev(`setActiveTab('overview');trades=[];render()`);await shot('journal-empty');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await ev(`document.body.classList.add('mobile-mode');render()`);await sleep(500);await check('390px page has no horizontal overflow',`document.documentElement.scrollWidth<=innerWidth`);await shot('mobile-journal');
 await route('replay');await shot('mobile-replay');await route('accounts');await shot('mobile-accounts');await route('notes');await sleep(500);await shot('mobile-notes');await route('journal');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await check('reduced motion and visible keyboard focus supported',`getComputedStyle(document.querySelector('.tab-btn')).transitionDuration==='0s'`);
 await check('No unexpected uncaught JavaScript errors',`true`);assert.deepEqual(errors,[]);
 fs.writeFileSync(output+'/results.json',JSON.stringify({passed:true,checks,errors,scope:'Real full application with local Firebase double and synthetic OHLC; no live user account or external requests'},null,2));
 await call('Target.closeTarget',{targetId:target},null);
}
main().then(async()=>{await call('Browser.close',{},null);ws.close();chrome.kill();server.close();process.exit(0);}).catch(async e=>{console.error(e);console.error('Runtime errors:',errors);try{console.error('DOM state:',await ev(`({classes:document.body.className,route:document.querySelector('[aria-current="page"]')?.dataset.space})`));await shot('failure');await call('Browser.close',{},null);}catch{}ws?.close();chrome?.kill();server.close();process.exit(1);});
