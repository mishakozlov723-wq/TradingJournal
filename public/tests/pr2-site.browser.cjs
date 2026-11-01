// PR2 site fixes in a real browser: break-even result popup, neutral 0% calendar days,
// streaks across days without trades, and the Content Security Policy. No network.
const assert=require('node:assert/strict');
const {server,chromium}=require('./models-full-harness.cjs');
async function init(p){await p.evaluate(async()=>{USERS=[{login:'tester',email:'tester@journal.local',uid:'test-uid',role:'admin'}];currentUser=USERS[0];viewingUser='tester';firebase.auth().currentUser={uid:'test-uid',email:currentUser.email};document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';await loadData();render();});}
const seed=(p,id,extra={})=>p.evaluate(([id,extra])=>db.collection('trades').doc(id).set(Object.assign({uid:'test-uid',asset:'EURUSD',direction:'LONG',r:1,riskPercent:1,openDT:'2026-01-02T09:00',closeDT:'2026-01-02T10:00'},extra)),[id,extra]);
const storedR=(p,id)=>p.evaluate(id=>db.collection('trades').doc(id).get().then(s=>s.data().r),id);
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port,errors=[];
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true});
  async function fixture(name,fn){const c=await browser.newContext();await c.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(name+': '+e.message));try{await p.goto(url);await init(p);await fn(p);console.log('PASS',name);}finally{await c.close();}}
  try{
    await fixture('PR2-15 break-even trade: WIN needs an RR, then saves it; BE stays available',async p=>{
      await seed(p,'pr2be',{r:0});await p.evaluate(async()=>{await loadData();render();});
      await p.evaluate(()=>{const td=document.createElement('td');td.id='pr2Cell';td.style.cssText='position:fixed;top:120px;left:120px;width:80px;height:30px';document.body.appendChild(td);window.scrollTo(0,0);showInlinePopup(td,trades.filter(t=>t.id==='pr2be')[0],'result');});
      const labels=await p.$$eval('.popup-option',els=>els.map(e=>e.textContent.trim()));
      assert.deepEqual(labels,['WIN','LOSS','BE']);
      await p.evaluate(()=>[...document.querySelectorAll('.popup-option')].find(b=>b.textContent.trim()==='WIN').click());
      const input=p.locator('input.popup-input[aria-label="RR"]');
      assert.equal(await input.isVisible(),true,'RR field appears for WIN');
      await p.click('.popup-confirm-btn');
      assert.match(await input.getAttribute('class'),/popup-input-invalid/,'empty RR is rejected visibly');
      assert.equal(await storedR(p,'pr2be'),0,'nothing saved without an RR');
      await input.fill('1.5');
      assert.doesNotMatch(await input.getAttribute('class'),/popup-input-invalid/,'typing clears the error');
      await input.press('Enter');
      await p.waitForFunction(()=>db.collection('trades').doc('pr2be').get().then(s=>s.data().r===1.5));
      assert.equal(await storedR(p,'pr2be'),1.5);
    });
    await fixture('PR2-16 a 0% day is neutral and the streak survives days without trades',async p=>{
      const ym=await p.evaluate(()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-2);return {y:d.getFullYear(),m:d.getMonth()};});
      const day=n=>ym.y+'-'+String(ym.m+1).padStart(2,'0')+'-'+String(n).padStart(2,'0');
      // 10 +, (11, 12 no trades), 13 +, 14 = 0%, 15 +
      for(const [id,n,r] of [['c10',10,1],['c13',13,1],['c14',14,0],['c15',15,1]]) await seed(p,id,{r,openDT:day(n)+'T09:00',closeDT:day(n)+'T10:00'});
      await p.evaluate(async ym=>{await loadData();calendarYear=ym.y;calendarMonth=ym.m;calendarBrowse.level='days';renderCalendar();},ym);
      const cls=n=>p.$eval('.cal-cell[data-day="'+n+'"]',e=>e.className);
      assert.match(await cls(14),/\bflat\b/);assert.doesNotMatch(await cls(14),/\bpos\b/);
      assert.match(await cls(13),/\bpos\b/);
      assert.equal(await p.textContent('#calStreakLabel'),'Current streak: 1 day');
      assert.equal(await p.textContent('#calBestStreakLabel'),'Best streak: 2 days');
    });
    await fixture('PR2-21 the page runs under its CSP and foreign scripts are refused',async p=>{
      const csp=await p.getAttribute('meta[http-equiv="Content-Security-Policy"]','content');
      assert.match(csp,/object-src 'none'/);
      const blocked=await p.evaluate(()=>new Promise(res=>{document.addEventListener('securitypolicyviolation',e=>res(e.violatedDirective),{once:true});const s=document.createElement('script');s.src='https://evil.example/x.js';document.head.appendChild(s);setTimeout(()=>res('no violation'),2000);}));
      assert.match(blocked,/^script-src/);
      assert.equal(await p.evaluate(()=>typeof render),'function','inline app code still runs');
    });
    assert.deepEqual(errors,[]);
    console.log('All PR2 site browser scenarios passed');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
