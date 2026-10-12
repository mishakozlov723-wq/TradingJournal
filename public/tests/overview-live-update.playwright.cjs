const {server,chromium}=require('./models-full-harness.cjs'),assert=require('assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],opened=[];page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>{p.close();});await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const cdp=await page.context().newCDPSession(page);cdp.on('Page.windowOpen',e=>opened.push(e.url));await cdp.send('Page.enable');
const cmd=(method,args)=>cdp.send(method,args),sleep=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=expression=>page.evaluate(expression),ready=()=>page.waitForFunction(()=>typeof window.openModal==='function'),audit=async()=>{};
async function check(name,body){await evaluate('(async()=>{const assert=(v,m)=>{if(!v)throw Error(m||"assertion failed");};const el=id=>document.getElementById(id);const tick=()=>new Promise(r=>setTimeout(r,50));'+body+'})()');console.log('PASS '+name);}
    const login = `USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'},{login:'user-test',email:'user-test@journal.local',role:'user',uid:'test-user-uid'}];tjAdminUid='test-admin-uid';currentUser=USERS[0];viewingUser=currentUser.login;el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();render();hideOverviewSkeleton();`;
    await cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    await ready();
    await check('seed trades, first paint draws the curve in', login + `
      const mk=(i,r)=>({id:'lt'+i,openDT:'2026-0'+(1+Math.floor(i/5))+'-'+String(10+i%5).padStart(2,'0')+'T10:00',closeDT:'2026-0'+(1+Math.floor(i/5))+'-'+String(10+i%5).padStart(2,'0')+'T12:00',asset:'EURUSD',direction:'LONG',r:r,riskPercent:1,chart:null});
      trades=[mk(0,2),mk(1,-1),mk(2,3),mk(3,-1),mk(4,1.5)];
      setActiveTab('overview'); render(); await new Promise(r=>setTimeout(r,1100));
      assert(el('chartSvg').style.display==='block','chart visible');
      assert(el('allTradesBody').children.length===5,'5 rows');
      assert(el('chartSvg').querySelectorAll('.chart-hit-area').length===5,'5 hit areas');
      window.__line=el('chartLinePath'); window.__d=__line.getAttribute('d');
      window.__rows=[...el('allTradesBody').children]; window.__assetRows=[...el('assetsStatsBody').children];
    `);
    await check('non-curve edit via UI (direction): chart untouched, only one cell replaced, stats skipped', `
      let calls=0; const orig=computeStats; computeStats=function(a){calls++;return orig(a);};
      const t=trades.find(x=>x.id==='lt2'); const row=[...el('allTradesBody').children].find(tr=>tr.querySelector('[data-id="lt2"]'));
      const otherCells=[...row.children].filter(td=>td.getAttribute('data-col')!=='direction');
      setActiveEditCol('direction'); await tick();
      row.querySelector('td[data-col="direction"]').click(); await tick();
      const pop=document.querySelector('.inline-edit-popup'); assert(pop,'popup open');
      [...pop.querySelectorAll('.popup-option')].find(b=>b.textContent==='SHORT').click();
      pop.querySelector('.popup-confirm-btn').click(); await tick();
      computeStats=orig;
      assert(t.direction==='SHORT','saved');
      assert(calls===0,'computeStats not called, got '+calls);
      assert(el('chartLinePath')===__line && __line.getAttribute('d')===__d,'chart path untouched');
      assert([...el('allTradesBody').children].every((tr,i)=>tr===__rows[i]),'rows kept');
      assert(otherCells.every(td=>td.parentNode===row),'other cells kept');
      assert(row.querySelector('td[data-col="direction"]').textContent.includes('SHORT'),'cell updated');
      assert(row.querySelector('td[data-col="direction"]').classList.contains('col-editing'),'edit mode kept');
      setActiveEditCol('direction');
    `);
    await check('model-like field via render(): nothing on chart replays', `
      trades.find(x=>x.id==='lt1').modelName='X'; render(); await tick();
      assert(el('chartLinePath')===__line && __line.getAttribute('d')===__d,'chart path untouched');
      assert([...el('assetsStatsBody').children].every((tr,i)=>tr===__assetRows[i]),'asset rows kept');
    `);
    await check('colour change recolours in place without redraw', `
      const before=curveColor; setCurveColor('#8fa3b8'); await tick();
      assert(el('chartLinePath')===__line,'same path');
      assert(__line.getAttribute('stroke')==='#8fa3b8','stroke recoloured');
      assert(el('chartSvg').querySelector('#grad stop').getAttribute('stop-color')==='#8fa3b8','gradient recoloured');
      setCurveColor(before); await tick();
    `);
    await check('add trade: same path element morphs, new row inserted, old rows kept', `
      trades.push({id:'lt9',openDT:'2026-03-20T10:00',closeDT:'2026-03-20T11:00',asset:'EURUSD',direction:'LONG',r:4,riskPercent:1,chart:null});
      render();
      await new Promise(r=>requestAnimationFrame(r));
      assert(__line.getAttribute('d')===__d,'first morph frame == previous curve (no jump)');
      await new Promise(r=>requestAnimationFrame(r));
      await new Promise(r=>setTimeout(r,200));
      const mid=__line.getAttribute('d');
      assert(el('chartLinePath')===__line,'path element reused (no redraw)');
      assert(mid!==__d,'animating');
      assert(overviewChartState.anim,'animation in progress');
      await new Promise(r=>setTimeout(r,700));
      assert(!overviewChartState.anim,'animation finished');
      const fin=__line.getAttribute('d');
      assert(fin!==mid,'moved to final');
      assert(el('chartSvg').querySelectorAll('.chart-hit-area').length===6,'6 hit areas');
      const rows=[...el('allTradesBody').children]; assert(rows.length===6,'6 rows');
      assert(rows[0].querySelector('[data-id="lt9"]') && rows[0].classList.contains('row-live-enter'),'new row on top');
      assert(__rows.every(r=>rows.includes(r)),'old rows kept');
      assert(el('tradeCountLabel').textContent==='6 trades','stats updated');
      // final geometry equals a from-scratch render
      renderChartUncached(lastChartData,{drawIn:false});
      assert(el('chartLinePath').getAttribute('d')===fin,'morph end == fresh render');
      window.__line=el('chartLinePath'); window.__d=fin; window.__rows=rows;
    `);
    await check('edit gain via render(): morph, rows kept', `
      trades.find(x=>x.id==='lt0').r=5; render(); await new Promise(r=>setTimeout(r,120));
      assert(el('chartLinePath')===__line && overviewChartState.anim,'morphing');
      await new Promise(r=>setTimeout(r,700));
      assert([...el('allTradesBody').children].every((tr,i)=>tr===__rows[i]),'rows kept');
    `);
    await check('delete via table button + interrupting animation', `
      el('allTradesBody').querySelector('.del-btn[data-id="lt2"]').click();
      await new Promise(r=>setTimeout(r,150));
      el('allTradesBody').querySelector('.del-btn[data-id="lt3"]').click();
      await new Promise(r=>setTimeout(r,900));
      assert(!overviewChartState.anim,'done');
      assert(el('allTradesBody').children.length===4,'4 rows');
      assert(el('chartSvg').querySelectorAll('.chart-hit-area').length===4,'4 hits');
      const fin=el('chartLinePath').getAttribute('d');
      renderChartUncached(lastChartData,{drawIn:false});
      assert(el('chartLinePath').getAttribute('d')===fin,'end state correct after interruption');
    `);
    await check('delete everything -> empty state, add again -> draws', `
      trades=[]; render(); await tick();
      assert(el('chartSvg').style.display==='none' && el('emptyChart').style.display==='flex','empty chart');
      assert(el('allTradesBody').children.length===0,'no rows');
      trades=[{id:'z1',openDT:'2026-01-05T10:00',closeDT:'2026-01-05T11:00',asset:'EURUSD',direction:'LONG',r:1,riskPercent:1,chart:null}];
      render(); await new Promise(r=>setTimeout(r,1000));
      assert(el('chartSvg').style.display==='block','drawn again');
      assert(el('allTradesBody').children.length===1,'1 row');
    `);
    await check('pagination still remounts pages', `
      trades=[]; for(let i=0;i<45;i++) trades.push({id:'p'+i,openDT:new Date(Date.UTC(2026,0,1+i,10)).toISOString().slice(0,16),closeDT:new Date(Date.UTC(2026,0,1+i,11)).toISOString().slice(0,16),asset:'EURUSD',direction:'LONG',r:i%3?1:-1,riskPercent:1,chart:null});
      currentTradesPage=1; render(); await tick();
      assert(el('allTradesBody').children.length===20,'20 rows');
      el('tradesPagination').querySelector('.page-next').click(); await tick();
      assert(currentTradesPage===2 && el('allTradesBody').children.length===20,'page 2');
      assert(el('showingLabel').textContent.startsWith('Showing 21-40'),'label');
      el('tradesPagination').querySelector('.page-next').click(); await tick();
      assert(el('allTradesBody').children.length===5,'page 3 has 5');
    `);
    await check('other tabs still render', `
      ['calendar','monthly','quarterly','yearly','gallery','overview'].forEach(t=>{setActiveTab(t);}); await tick();
      assert(el('overviewTab').style.display==='block');
    `);
    assert.deepEqual(errors, []);console.log('All overview regression scenarios passed.');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});