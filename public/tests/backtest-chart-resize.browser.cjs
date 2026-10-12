// 6-dot resize grip on the backtest equity curve (v3.44.5).
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
    el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();hideOverviewSkeleton();})()`);
  const rr=n=>Array.from({length:n},(_,i)=>(Math.sin(i*1.3)*2+0.5).toFixed(2)).join('\n');
  const openBt=(id,n)=>page.evaluate(([id,txt])=>{let bt=backtests.filter(b=>b.id===id)[0];if(!bt){bt={id,name:id,rrText:txt,startDate:'2026-01-01',endDate:'2026-03-01',daysTested:40};backtests.push(bt);}activeBacktestId=id;backtestWorkspaceMode=true;setActiveTab('backtests');renderBacktests();},[id,rr(n)]);
  const db=()=>page.evaluate(()=>{const o=JSON.parse(localStorage.getItem('model-test-db')||'{}');let res;JSON.stringify(o,(k,v)=>{if(v&&typeof v==='object'&&'backtestChartHeight' in v)res=v.backtestChartHeight;return v;});return res;});
  const st=()=>page.evaluate(()=>{const s=document.getElementById('backtestChart');const card=s.closest('.card');const g=card.querySelector('.tj-chart-grip');const p=s.querySelector('path');return {disp:s.style.display,inline:s.style.height,vb:s.getAttribute('viewBox'),h:s.getBoundingClientRect().height,root:document.documentElement.style.getPropertyValue('--tj-bt-chart-h'),main:document.documentElement.style.getPropertyValue('--tj-chart-h'),grip:!!g&&getComputedStyle(g).display!=='none',noAnim:p?p.getAttribute('class'):null,cls:document.documentElement.classList.contains('tj-chart-resizing'),live:tjBtResizeLive};});
  const gripPos=()=>page.evaluate(()=>{const g=document.getElementById('backtestChart').closest('.card').querySelector('.tj-chart-grip');g.scrollIntoView({block:'center'});const r=g.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});

  await openBt('bt-empty',0);await page.waitForTimeout(300);
  let s=await st();ok(s.disp==='none'&&!s.grip,'empty backtest: dots hidden');

  await openBt('bt-a',400);await page.waitForTimeout(3800);
  s=await st();ok(s.disp==='block'&&s.grip&&Math.round(s.h)===300,'dots visible, default 300px ('+s.h+')');
  const mainBefore=s.main;

  await page.evaluate(()=>{const s=document.getElementById('backtestChart');window.__p0=s.querySelector('path');window.__fr=[];let last=performance.now();(function f(t){const vb=s.getAttribute('viewBox').split(' ');window.__fr.push({dt:t-last,H:+vb[3],same:s.querySelector('path')===window.__p0});last=t;if(window.__fr.length<400)requestAnimationFrame(f);})(last);});
  let b=await gripPos();await page.mouse.move(b.x,b.y);await page.mouse.down();
  for(let i=1;i<=30;i++){await page.mouse.move(b.x,b.y+150*i/30);await page.waitForTimeout(16);}
  s=await st();ok(s.live&&s.cls,'during drag: live mode');
  await page.mouse.up();await page.waitForTimeout(1200);
  const fr=await page.evaluate(()=>window.__fr);
  const mid=fr.filter(f=>f.H>300&&f.H<450);let maxStep=0;for(let i=1;i<fr.length;i++)if(fr[i].H&&fr[i-1].H)maxStep=Math.max(maxStep,Math.abs(fr[i].H-fr[i-1].H));
  const lastMid=fr.map(f=>f.H>300&&f.H<450).lastIndexOf(true);
  ok(mid.length>=15,'smooth growth: '+mid.length+' intermediate frames');
  ok(maxStep<25,'no jumps (max '+maxStep.toFixed(1)+'px per frame)');
  ok(fr.slice(0,lastMid+1).every(f=>f.same),'no rebuild during drag (curve does not redraw)');
  const dts=mid.map(f=>f.dt).sort((a,b)=>a-b);
  console.log('frame dt p95 '+(dts[Math.floor(dts.length*0.95)]||0).toFixed(1)+'ms');
  s=await st();
  ok(s.root==='450px'&&!s.inline&&!s.live&&!s.cls&&s.vb.endsWith(' 450')&&Math.round(s.h)===450,'after release: 450px committed, no leftovers ('+JSON.stringify(s)+')');
  ok(/no-redraw-anim/.test(s.noAnim||''),'final redraw does not replay the draw-in animation');
  ok(s.main===mainBefore,'journal Equity Curve height untouched');
  ok((await db())===450,'saved 450 for the user');

  await openBt('bt-new',60);await page.waitForTimeout(800);
  s=await st();ok(Math.round(s.h)===450&&s.vb.endsWith(' 450')&&s.grip,'new backtest opens at 450px with dots');

  await page.setViewportSize({width:1150,height:1000});await page.waitForTimeout(700);
  s=await st();const w=await page.evaluate(()=>document.getElementById('backtestChart').parentElement.clientWidth);
  ok(Math.abs(+s.vb.split(' ')[2]-w)<1,'still follows window width');
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(600);

  b=await gripPos();await page.mouse.click(b.x,b.y);await page.waitForTimeout(700);
  s=await st();ok(s.root==='450px'&&!s.cls&&(await db())===450,'plain click changes nothing');

  b=await gripPos();await page.mouse.move(b.x,b.y);await page.mouse.down();for(let i=1;i<=8;i++){await page.mouse.move(b.x,b.y-60*i/8);await page.waitForTimeout(16);}
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(900);
  s=await st();const hb=s.root;ok(!s.inline&&!s.live&&!s.cls,'blur mid-drag ends cleanly ('+hb+')');
  await page.mouse.move(b.x,b.y+200);await page.waitForTimeout(300);ok((await st()).root===hb,'no resizing after blur');await page.mouse.up();
  await page.waitForTimeout(500);

  b=await gripPos();await page.mouse.dblclick(b.x,b.y);await page.waitForTimeout(1300);
  s=await st();ok(s.root===''&&Math.round(s.h)===300&&!s.inline&&(await db())===null,'double-click resets to 300 and saves it');

  await openBt('bt-big',3000);await page.waitForTimeout(4000);
  await page.evaluate(()=>{window.__fr=[];let last=performance.now();(function f(t){window.__fr.push(t-last);last=t;if(window.__fr.length<120)requestAnimationFrame(f);})(last);});
  b=await gripPos();await page.mouse.move(b.x,b.y);await page.mouse.down();for(let i=1;i<=40;i++){await page.mouse.move(b.x,b.y+200*i/40);await page.waitForTimeout(16);}await page.mouse.up();await page.waitForTimeout(1300);
  const f2=(await page.evaluate(()=>window.__fr)).slice(2).sort((a,b)=>a-b);
  console.log('3000 trades: frame avg '+(f2.reduce((a,b)=>a+b,0)/f2.length).toFixed(1)+'ms p95 '+f2[Math.floor(f2.length*.95)].toFixed(1)+'ms');
  s=await st();ok(s.root==='500px'&&!s.inline&&!s.live,'3000-trade backtest resized to 500 cleanly '+JSON.stringify(s));

  await page.waitForTimeout(500);
  await page.evaluate(()=>{document.documentElement.style.removeProperty('--tj-bt-chart-h');tjBtResize.h=null;});
  await page.evaluate(()=>loadData());await page.waitForTimeout(900);
  s=await st();ok(s.root==='500px','saved height is applied on load ('+s.root+')');

  ok(errors.length===0,'no page errors '+(errors.length?JSON.stringify(errors):''));
  console.log(fails?fails+' FAILED':'ALL PASSED');
  await browser.close();server.close();process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
