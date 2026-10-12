// Edge cases of the 6-dot chart resize + click-to-pin (v3.44.3).
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
  const seed=`const el=id=>document.getElementById(id);
    USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'},{login:'user-test',email:'user-test@journal.local',role:'user',uid:'test-user-uid'}];tjAdminUid='test-admin-uid';currentUser=USERS[0];viewingUser=currentUser.login;
    el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();
    const out=[];for(let i=0;i<90;i++){const d=new Date(2026,6,1+i%88,10,0);const iso=d.toISOString().slice(0,16);out.push({id:'p'+i,openDT:iso,closeDT:iso,asset:'EURUSD',direction:'LONG',r:(Math.sin(i*1.7)*2+0.4+(i>40?0.8:0)),riskPercent:1,chart:null});}
    trades=out; window.__seedTrades=out; render(); hideOverviewSkeleton();`;
  await page.evaluate('(async()=>{'+seed+'})()');
  const db=()=>page.evaluate(()=>{const s=localStorage.getItem('model-test-db')||'{}';const o=JSON.parse(s);const res={};JSON.stringify(o,(k,v)=>{if(v&&typeof v==='object'&&'chartHeight' in v)res[String(k).split('/').pop()]=v.chartHeight;return v;});return res;});
  const state=sel=>page.evaluate(s=>{const svg=document.querySelector(s);const w=svg.parentElement;return {inline:svg.style.height,vb:svg.getAttribute('viewBox'),wrapW:w.clientWidth-40,relayout:!!svg._tjRelayout,hover:!!svg._hoverModel,root:document.documentElement.style.getPropertyValue('--tj-chart-h'),cls:document.documentElement.classList.contains('tj-chart-resizing'),labels:[...svg.querySelectorAll('text[data-tj-ylabel]')].map(t=>parseFloat(t.textContent))};},sel);
  async function grip(sel){return page.evaluate(s=>{const g=document.querySelector(s).closest('.tj-chart-resizable').querySelector('.tj-chart-grip');g.scrollIntoView({block:'center'});const r=g.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},sel);}
  async function drag(sel,dy,steps=20,release=true){const b=await grip(sel);await page.mouse.move(b.x,b.y);await page.mouse.down();for(let i=1;i<=steps;i++){await page.mouse.move(b.x,b.y+dy*i/steps);await page.waitForTimeout(16);}if(release)await page.mouse.up();return b;}
  const M='#monthChartSvg';
  await page.evaluate(`monthlyYear=2026;monthlySelectedMonth=7;setActiveTab('monthly')`);await page.waitForTimeout(1300);

  // #5 plain click / double click on the dots: no pointless saves
  const before=await db();
  let b=await grip(M);await page.mouse.click(b.x,b.y);await page.waitForTimeout(700);
  ok(JSON.stringify(await db())===JSON.stringify(before),'#5 a plain click on the dots saves nothing');
  let s=await state(M);ok(!s.cls&&!s.inline&&!s.relayout&&s.hover,'#5 a plain click leaves the chart fully working');

  // normal drag saves exactly the signed-in user's value
  await drag(M,120);await page.waitForTimeout(900);
  s=await state(M);let d=await db();
  ok(s.root==='510px'&&d['admin-test']===510,'drag 390->510 saved for the signed-in user ('+s.root+', '+JSON.stringify(d)+')');
  ok(!s.inline&&!s.relayout&&s.hover&&s.vb.endsWith(' 510'),'after drag: hover back, viewBox 510, no leftovers');

  // #1 settings load arrives right after release, while the chart is still gliding
  await drag(M,-100,6);await page.evaluate(()=>loadData());await page.waitForTimeout(1200);
  await page.evaluate(()=>{trades=window.__seedTrades.slice();monthlyYear=2026;monthlySelectedMonth=7;render();});await page.waitForTimeout(900);
  s=await state(M);
  ok(!s.inline&&!s.relayout&&s.hover&&!s.cls,'#1 settings load during glide: no frozen state');
  ok(s.root==='410px','#1 user drag wins over the loaded value ('+s.root+')');
  await page.waitForTimeout(500);d=await db();ok(d['admin-test']===410,'#1 final value saved ('+d['admin-test']+')');
  await page.setViewportSize({width:1200,height:1000});await page.waitForTimeout(500);
  s=await state(M);ok(Math.abs(Number(s.vb.split(' ')[2])-s.wrapW)<1,'#1 chart still follows window width afterwards');
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(500);

  // #2 the window loses focus mid-drag (no pointerup)
  b=await drag(M,80,10,false);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(800);
  s=await state(M);ok(!s.inline&&!s.relayout&&s.hover&&!s.cls,'#2 blur mid-drag ends the drag cleanly');
  const hAfterBlur=s.root;await page.mouse.move(b.x,b.y+300);await page.waitForTimeout(400);
  ok((await state(M)).root===hAfterBlur,'#2 moving the mouse after that no longer resizes');
  await page.mouse.up();

  // #4 width changes mid-drag (scrollbar appears)
  b=await drag(M,40,8,false);
  await page.evaluate(()=>{document.querySelector('#monthChartSvg').closest('.month-detail-chart-card').style.marginRight='60px';});
  for(let i=1;i<=6;i++){await page.mouse.move(b.x,b.y+40+i*5);await page.waitForTimeout(20);}
  s=await state(M);ok(Math.abs(Number(s.vb.split(' ')[2])-s.wrapW)<1,'#4 mid-drag chart matches the new width ('+s.vb+' / '+s.wrapW+')');
  await page.mouse.up();await page.waitForTimeout(800);
  await page.evaluate(()=>{document.querySelector('#monthChartSvg').closest('.month-detail-chart-card').style.marginRight='';});await page.waitForTimeout(400);

  // #6 start resizing while a month switch is animating: % labels must not jump.
  // Sample the labels every frame and compare the worst per-frame step with a
  // plain month switch (no resize) as the baseline.
  const startSampler=()=>page.evaluate(()=>{const s=document.getElementById('monthChartSvg');window.__lab=[];const f=()=>{const l=[...s.querySelectorAll('text[data-tj-ylabel]')].map(t=>parseFloat(t.textContent));window.__lab.push(l);if(window.__lab.length<90)requestAnimationFrame(f);};requestAnimationFrame(f);});
  const maxStep=()=>page.evaluate(()=>{const L=window.__lab;let m=0;const r=Math.max(...L.map(l=>Math.abs(l[4]-l[0])))||1;for(let i=1;i<L.length;i++)for(let k=0;k<5;k++)m=Math.max(m,Math.abs(L[i][k]-L[i-1][k])/r);return m;});
  await page.evaluate(()=>document.getElementById('monthDetailPrev').click());await page.waitForTimeout(1200);
  await startSampler();await page.evaluate(()=>document.getElementById('monthDetailNext').click());await page.waitForTimeout(1600);
  const base=await maxStep();
  await page.evaluate(()=>document.getElementById('monthDetailPrev').click());await page.waitForTimeout(1200);
  await startSampler();await page.evaluate(()=>document.getElementById('monthDetailNext').click());await page.waitForTimeout(250);
  ok(await page.evaluate(()=>{const s=document.getElementById('monthChartSvg');return s.style.display!=='none'&&!!s._tjMorphRaf;}),'#6 precondition: month chart visible and animating');
  b=await grip(M);await page.mouse.move(b.x,b.y);await page.mouse.down();
  for(let i=1;i<=20;i++){await page.mouse.move(b.x,b.y+i*3);await page.waitForTimeout(25);}
  await page.mouse.up();await page.waitForTimeout(1000);
  const withDrag=await maxStep();
  ok(withDrag<=base*1.35+0.01,'#6 labels stay smooth: worst frame step '+(withDrag*100).toFixed(1)+'% vs plain switch '+(base*100).toFixed(1)+'%');
  const lEnd=(await state(M)).labels;
  await page.evaluate(`(()=>{const s=document.getElementById('monthChartSvg');s._chartRenderState.key=null;s._chartRenderState.retry();})()`);await page.waitForTimeout(50);
  const lFresh=(await state(M)).labels;
  ok(JSON.stringify(lEnd)===JSON.stringify(lFresh),'#6 final labels equal a fresh render');

  // double click resets to default and saves null once
  b=await grip(M);await page.mouse.dblclick(b.x,b.y);await page.waitForTimeout(1300);
  s=await state(M);d=await db();ok(s.root===''&&d['admin-test']===null&&s.vb.endsWith(' 390'),'double-click resets to default and saves it ('+JSON.stringify(d)+' '+JSON.stringify(s)+')');

  // #3 admin viewing another user: own setting only
  await page.evaluate(async()=>{viewingUser='user-test';await loadData();render();});await page.waitForTimeout(400);
  await page.evaluate(`monthlyYear=2026;monthlySelectedMonth=7;setActiveTab('monthly')`);await page.waitForTimeout(1200);
  const tr=await page.evaluate(()=>trades.length);
  if(tr<2){await page.evaluate('(async()=>{const out=[];for(let i=0;i<30;i++){const d=new Date(2026,7,1+i,10,0);const iso=d.toISOString().slice(0,16);out.push({id:"u"+i,openDT:iso,closeDT:iso,asset:"EURUSD",direction:"LONG",r:Math.sin(i),riskPercent:1,chart:null});}trades=out;render();})()');await page.waitForTimeout(1200);}
  await drag(M,60);await page.waitForTimeout(900);d=await db();
  ok(d['admin-test']===450&&!('user-test' in d),'#3 admin resizing someone else\'s journal saves only to the admin ('+JSON.stringify(d)+')');

  // v3.44.3 small fixes
  await page.evaluate(()=>{viewingUser='admin-test';trades=window.__seedTrades.slice();monthlyYear=2026;monthlySelectedMonth=7;render();});await page.waitForTimeout(1200);
  b=await drag(M,40,8,false);
  await page.evaluate(()=>render());
  for(let i=1;i<=4;i++){await page.mouse.move(b.x,b.y+40+i*4);await page.waitForTimeout(20);}
  ok(await page.evaluate(()=>!document.getElementById('monthChartSvg')._hoverModel),'data update mid-drag keeps hover off');
  await page.mouse.up();
  await page.waitForFunction(()=>!document.documentElement.classList.contains('tj-chart-resizing'),null,{timeout:4000});
  ok(await page.evaluate(()=>!!document.getElementById('monthChartSvg')._hoverModel),'hover back after that drag');
  await page.waitForTimeout(80);
  await page.evaluate(()=>document.getElementById('monthDetailNext').click());await page.waitForTimeout(60);
  ok(await page.evaluate(()=>!!document.getElementById('monthChartSvg')._tjMorphRaf),'month switch right after a resize animates');
  await page.waitForTimeout(1200);
  const inl=await page.evaluate(()=>document.getElementById('monthChartSvg').style.height);ok(inl==='','no inline height left ('+inl+')');
  const hintAt=async()=>{const r=await page.evaluate(()=>{const s=document.getElementById('monthChartSvg');s.scrollIntoView({block:'center'});const q=s.getBoundingClientRect();return {x:q.left+q.width*0.55,y:q.top+q.height/2};});await page.mouse.move(r.x-30,r.y);await page.mouse.move(r.x,r.y);await page.waitForTimeout(250);return page.evaluate(()=>{const t=[...document.querySelectorAll('.chart-tooltip-hint')].find(e=>e.offsetParent);return t?t.textContent:'(none)';});};
  await page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})));
  const tTouch=await hintAt();
  await page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})));
  await page.mouse.move(5,5);await page.waitForTimeout(200);
  const tMouse=await hintAt();
  ok(tTouch==='Tap to pin'&&tMouse==='Click to pin','pin hint: touch "'+tTouch+'", mouse "'+tMouse+'"');

  // #7 backtest chart does not use the shared hover/pin
  const bt=await page.evaluate(()=>{const s=document.getElementById('backtestChart');return !s||!s._tjHover;});
  ok(bt,'#7 backtest chart is not wired to click-to-pin');

  ok(errors.length===0,'no page errors '+(errors.length?JSON.stringify(errors):''));
  console.log(fails?fails+' FAILED':'ALL PASSED');
  await browser.close();server.close();process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
