// Measures how smooth the 6-dot chart resize is on every Equity Curve tab.
const {server,chromium}=require('./models-full-harness.cjs');
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+'/';
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(url.slice(0,-1))?r.continue():r.abort());
  await page.goto(url);
  await page.waitForFunction(()=>typeof window.openModal==='function');
  await page.evaluate(async()=>{
    const el=id=>document.getElementById(id);
    USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'}];tjAdminUid='test-admin-uid';currentUser=USERS[0];viewingUser=currentUser.login;
    el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();
    const N=Number(window.TJ_N||90), out=[];
    for(let i=0;i<N;i++){const d=new Date(2026,6,1+Math.floor(i*30/N*3)%88,10,0);const iso=d.toISOString().slice(0,16);out.push({id:'p'+i,openDT:iso,closeDT:iso,asset:'EURUSD',direction:'LONG',r:(Math.sin(i*1.7)*2+0.4),riskPercent:1,chart:null});}
    trades=out; render(); hideOverviewSkeleton();
  });
  const tabs={
    overview:`setActiveTab('overview')`,
    month:`monthlyYear=2026;monthlySelectedMonth=7;setActiveTab('monthly')`,
    quarter:`quarterSel={year:2026,q:2};setActiveTab('quarterly')`,
    year:`yearSel=2026;setActiveTab('yearly')`,
  };
  const svgFor={overview:'chartSvg',month:'monthChartSvg',quarter:'quarterChartSvg',year:'yearChartSvg'};
  for(const [name,open] of Object.entries(tabs)){
    await page.evaluate(open); await page.waitForTimeout(1300);
    const sel='#'+svgFor[name];
    const box=await page.evaluate(s=>{const svg=document.querySelector(s);const card=svg.closest('.tj-chart-resizable');const g=card&&card.querySelector('.tj-chart-grip');if(!g)return null;g.scrollIntoView({block:'center'});const r=g.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disp:svg.style.display};},sel);
    if(!box){console.log(name,'NO GRIP');continue;}
    await page.evaluate(()=>{window.__f=[];window.__lt=0;let last=performance.now();window.__run=true;(function loop(t){if(!window.__run)return;window.__f.push(t-last);last=t;requestAnimationFrame(loop);})(performance.now());
      new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt+=e.duration;}).observe({type:'longtask',buffered:false});});
    await page.mouse.move(box.x,box.y);await page.mouse.down();
    for(let s=1;s<=50;s++){await page.mouse.move(box.x,box.y+s*6);await page.waitForTimeout(16);}
    for(let s=49;s>=0;s--){await page.mouse.move(box.x,box.y+s*6-150);await page.waitForTimeout(16);}
    await page.mouse.up(); await page.waitForTimeout(500);
    const r=await page.evaluate(()=>{window.__run=false;const f=window.__f.slice(2).sort((a,b)=>a-b);const avg=f.reduce((a,b)=>a+b,0)/f.length;return {frames:f.length,avg:+avg.toFixed(1),p95:+f[Math.floor(f.length*.95)].toFixed(1),max:+f[f.length-1].toFixed(1),longTaskMs:Math.round(window.__lt),h:getComputedStyle(document.documentElement).getPropertyValue('--tj-chart-h')};});
    const v=await page.evaluate(s=>{const svg=document.querySelector(s);return {inlineH:svg.style.height,viewBox:svg.getAttribute("viewBox"),relayout:!!svg._tjRelayout,hover:!!svg._hoverModel};},sel);console.log(name.padEnd(9),JSON.stringify(r),JSON.stringify(v));
  }
  console.log('errors:',errors.length?errors:'none');
  await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
