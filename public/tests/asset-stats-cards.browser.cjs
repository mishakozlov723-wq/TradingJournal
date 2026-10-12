// Per-asset stat cards under Best Trade / Best Asset (month, quarter, year) v3.44.6.
const {server,chromium}=require('./models-full-harness.cjs');
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+'/';
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(url.slice(0,-1))?r.continue():r.abort());
  await page.goto(url);
  await page.waitForFunction(()=>typeof window.openModal==='function');
  await page.evaluate(`(async()=>{const el=id=>document.getElementById(id);
    USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'}];tjAdminUid='test-admin-uid';currentUser=USERS[0];viewingUser=currentUser.login;
    el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();
    const A=['EURUSD','GBPUSD','XAUUSD','NAS100','BTCUSD'];const rs=[2,-1,1.5,-1,3,-1,0.5,2,-1,1];const out=[];window.__x=1;
    for(let i=0;i<40;i++){const d=new Date(2026,6,1+(i%28),10,0);const iso=d.toISOString().slice(0,16);out.push({id:'p'+i,openDT:iso,closeDT:iso,asset:A[i%5],direction:'LONG',r:rs[i%10]*(i%5===4?-1:1),riskPercent:1,chart:null});}
    trades=out;monthlyYear=2026;monthlySelectedMonth=6;render();hideOverviewSkeleton();})()`);
  for (const [tab,wrap] of [['monthly','mdBestWrap'],['quarterly','qdBestWrap'],['yearly','ydBestWrap']]) {
    await page.evaluate(t=>setActiveTab(t),tab);await page.waitForTimeout(1200);
    if(tab==='quarterly'){await page.evaluate(()=>{quarterSel={year:2026,q:2};render();});await page.waitForTimeout(1200);}
    if(tab==='yearly'){await page.evaluate(()=>{const r=document.querySelector('#yearlyTab .period-row');if(r)r.click();});await page.waitForTimeout(1200);}
    const info=await page.evaluate(w=>{const el=document.getElementById(w);const g=el&&el.querySelector('.asset-stats-grid');if(!g||!g.offsetParent)return null;const cards=[...g.querySelectorAll('.asset-stat-card')];const r=cards.map(c=>c.getBoundingClientRect());const gw=g.getBoundingClientRect().width;
      const over=cards.some(c=>c.scrollWidth>c.clientWidth+1);
      return {n:cards.length,w0:r[0].width,gw,sameRow:Math.abs(r[0].top-r[1].top)<1,names:cards.map(c=>c.querySelector('.asset-stat-name').textContent.trim()),vals:cards.map(c=>[...c.querySelectorAll('.asset-stat-value')].map(v=>v.textContent)),over};},wrap);
    if(!info){ok(false,tab+': cards visible');continue;}
    console.log(tab,JSON.stringify(info.names),JSON.stringify(info.vals[0]));
    ok(info.n===5,tab+': one card per asset ('+info.n+')');
    ok(info.sameRow&&Math.abs(info.w0*2+12-info.gw)<2,tab+': two per row filling the width');
    ok(!info.over,tab+': nothing overflows');
    if(tab==='monthly'){
      const e=info.names.indexOf('EURUSD');ok(e>=0&&info.vals[e][1]==='8','EURUSD trade count 8 ('+(info.vals[e]||[]).join(' ')+')');
      await page.evaluate(w=>document.getElementById(w).scrollIntoView({block:'start'}),wrap);await page.waitForTimeout(200);
      await page.screenshot({path:'/data/asset_desktop.png'});
    }
  }
  // mobile
  await page.setViewportSize({width:390,height:900});await page.evaluate(()=>{document.body.classList.add('mobile-mode');setActiveTab('monthly');render();});await page.waitForTimeout(1300);
  const m=await page.evaluate(()=>{const g=document.querySelector('#mdBestWrap .asset-stats-grid');const c=[...g.querySelectorAll('.asset-stat-card')];const r=c.map(x=>x.getBoundingClientRect());return {sameRow:Math.abs(r[0].top-r[1].top)<1,over:c.filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.scrollWidth+'/'+x.clientWidth),w:r[0].width,tops:r.map(q=>Math.round(q.top))};});
  ok(m.sameRow&&!m.over.length,'mobile: still two per row, nothing overflows '+JSON.stringify(m));
  await page.evaluate(()=>document.getElementById('mdBestWrap').scrollIntoView({block:'start'}));await page.waitForTimeout(200);
  await page.screenshot({path:'/data/asset_mobile.png'});
  // empty month: no grid
  await page.evaluate(()=>{trades=[];render();});await page.waitForTimeout(500);
  ok(await page.evaluate(()=>!document.querySelector('#mdBestWrap .asset-stats-grid')),'empty period: no asset cards');
  ok(errors.length===0,'no page errors '+(errors.length?JSON.stringify(errors):''));
  console.log(fails?fails+' FAILED':'ALL PASSED');
  await browser.close();server.close();process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
