// PR1 journal safety: delete confirmation, visible notices and saves that wait
// for the server. Real DOM/event handlers, local Firestore double, no network.
const assert=require('node:assert/strict');
const {server,chromium}=require('./models-full-harness.cjs');
const OUTBOX='syter_trade_outbox_v1_test-uid';
async function init(p){await p.evaluate(async()=>{USERS=[{login:'tester',email:'tester@journal.local',uid:'test-uid',role:'admin'}];currentUser=USERS[0];viewingUser='tester';firebase.auth().currentUser={uid:'test-uid',email:currentUser.email};document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';await loadData();render();});}
const seed=(p,id,extra={})=>p.evaluate(([id,extra])=>db.collection('trades').doc(id).set(Object.assign({uid:'test-uid',asset:'EURUSD',direction:'LONG',r:1,riskPercent:1,openDT:'2026-01-02T09:00',closeDT:'2026-01-02T10:00'},extra)),[id,extra]);
const stored=p=>p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('model-test-db')||'{}')).filter(k=>k.startsWith('trades/')).map(k=>k.slice(7)).sort());
const noticeText=(p,kind)=>p.evaluate(kind=>{const n=document.querySelector('#journalNotice .tj-notice[data-kind="'+kind+'"]');return n?n.className+' | '+n.textContent:'';},kind);
// Holds every batch commit (trade + images are one batch) until released.
const holdCommits=p=>p.evaluate(()=>{if(!window.pr1Batch){const batch=db.batch.bind(db);window.pr1Batch=batch;db.batch=()=>{const b=batch(),commit=b.commit;b.commit=()=>window.pr1Hold?window.pr1Hold.then(()=>commit.call(b)):commit.call(b);return b;};}let release;window.pr1Hold=new Promise(r=>release=r);window.pr1Release=()=>{window.pr1Hold=null;release();};});
const submitTrade=p=>p.evaluate(()=>{const el=id=>document.getElementById(id);TJ_SAVE_WAIT_MS=200;TJ_OFFLINE_SAVE_WAIT_MS=200;openModal(null);el('magnitudeInput').value='2';el('riskPercentInput').value='1';setDateTimeInput(el('openInput'),'2026-01-03T09:00');setDateTimeInput(el('closeInput'),'2026-01-03T10:00');el('tradeForm').requestSubmit();});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port,errors=[];
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true});
  async function fixture(name,fn){const c=await browser.newContext();await c.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(name+': '+e.message));try{await p.goto(url);await init(p);await fn(p);console.log('PASS',name);}finally{await c.close();}}
  try{
    await fixture('PR1-05 deleting a journal trade needs confirmation; Escape and Cancel keep it',async p=>{
      await seed(p,'pr1del');await p.evaluate(async()=>{await loadData();render();});
      const ask=()=>p.evaluate(()=>document.querySelector('#allTradesBody .del-btn[data-id="pr1del"]').click());
      await ask();await p.waitForSelector('#tjConfirmOverlay.open');
      assert.match(await p.locator('#tjConfirmMessage').textContent(),/EURUSD.*нельзя отменить/s);
      await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>document.activeElement&&document.activeElement.id),'tjConfirmCancel');
      await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.getElementById('tjConfirmOverlay').classList.contains('open'));
      await ask();await p.waitForSelector('#tjConfirmOverlay.open');await p.locator('#tjConfirmCancel').click();
      await p.waitForTimeout(80);assert.deepEqual(await p.evaluate(()=>trades.map(t=>t.id)),['pr1del']);assert.deepEqual(await stored(p),['pr1del']);
      await ask();await p.waitForSelector('#tjConfirmOverlay.open');await p.locator('#tjConfirmOk').click();
      await p.waitForFunction(()=>trades.length===0);await p.waitForTimeout(80);assert.deepEqual(await stored(p),[]);
    });
    await fixture('PR1-02 failed server deletion and failed background edit stay visible as notices',async p=>{
      await seed(p,'pr1bg');await p.evaluate(async()=>{await loadData();render();});
      await p.evaluate(()=>{testFailWrite=true;const t=trades[0];t.r=3;remoteSaveTrade(t,['r']);});
      await p.waitForFunction(()=>document.querySelector('#journalNotice [data-kind="save:pr1bg"]'));
      assert.match(await noticeText(p,'save:pr1bg'),/tj-notice-error.*EURUSD.*изменения не сохранены на сервере/s);
      await p.evaluate(()=>{testFailWrite=false;remoteSaveTrade(trades[0],['r']);});
      await p.waitForFunction(()=>!document.querySelector('#journalNotice [data-kind="save:pr1bg"]'));
      await p.evaluate(()=>{testFailWrite=true;document.querySelector('#allTradesBody .del-btn[data-id="pr1bg"]').click();});
      await p.waitForSelector('#tjConfirmOverlay.open');await p.locator('#tjConfirmOk').click();
      await p.waitForFunction(()=>document.querySelector('#journalNotice [data-kind="delete:pr1bg"]'));
      assert.match(await noticeText(p,'delete:pr1bg'),/сервер не подтвердил удаление/);
      await p.locator('#journalNotice [data-kind="delete:pr1bg"] .tj-notice-close').click();
      assert.equal(await noticeText(p,'delete:pr1bg'),'');
    });
    await fixture('PR1-03 a failed server read is an error with Retry, never an empty journal',async p=>{
      await seed(p,'pr1load');
      await p.evaluate(async()=>{window.pr1FailTrades=true;const collection=db.collection.bind(db);db.collection=n=>{const c=collection(n),where=c.where;c.where=(...a)=>{const q=where(...a),get=q.get;if(n==='trades')q.get=o=>window.pr1FailTrades?Promise.reject(Object.assign(Error('offline'),{code:'unavailable'})):get.call(q,o);q.onSnapshot=q.onSnapshot||(()=>()=>{});return q;};return c;};await loadData();render();});
      assert.match(await noticeText(p,'load'),/tj-notice-error.*Не удалось загрузить сделки с сервера \(unavailable\)/s);
      assert.equal(await p.evaluate(()=>trades.length),0);assert.deepEqual(await stored(p),['pr1load'],'nothing on the server was touched');
      await p.evaluate(()=>{window.pr1FailTrades=false;});
      await p.locator('#journalNotice [data-kind="load"] .tj-notice-btn').click();
      await p.waitForFunction(()=>trades.length===1&&!document.querySelector('#journalNotice [data-kind="load"]'));
      await p.waitForTimeout(100); // Retry also restarts live sync (a no-op subscription in this double)
    });
    await fixture('PR1-03 a later live server snapshot also recovers and re-sends this device queue',async p=>{
      await seed(p,'pr1live');
      await p.evaluate(async key=>{
        window.pr1FailTrades=true;window.pr1Live=null;
        const collection=db.collection.bind(db);db.collection=n=>{const c=collection(n),where=c.where;c.where=(...a)=>{const q=where(...a),get=q.get;if(n==='trades'){q.get=o=>window.pr1FailTrades?Promise.reject(Object.assign(Error('offline'),{code:'unavailable'})):get.call(q,o);q.onSnapshot=cb=>{window.pr1Live=cb;return()=>{};};}q.onSnapshot=q.onSnapshot||(()=>()=>{});return q;};return c;};
        localStorage.setItem(key,JSON.stringify([{id:'pr1queued',ownerUid:'test-uid',owner:'tester',images:0,savedAt:1,record:{id:'pr1queued',uid:'test-uid',user:'tester',asset:'EURUSD',direction:'SHORT',r:-1,riskPercent:1,openDT:'2026-01-04T09:00',closeDT:'2026-01-04T10:00'}}]));
        const load=await loadData();finishJournalCoreLoad(load);
      },OUTBOX);
      assert.match(await noticeText(p,'load'),/tj-notice-error/);
      assert.equal(await p.evaluate(()=>trades.length),0);assert.deepEqual(await stored(p),['pr1live'],'the queue waits for a successful server read');
      await p.waitForFunction(()=>typeof window.pr1Live==='function');
      await p.evaluate(()=>{const data=JSON.parse(localStorage.getItem('model-test-db'));const docs=Object.keys(data).filter(k=>k.startsWith('trades/')).map(k=>({id:k.slice(7),data:()=>data[k],metadata:{hasPendingWrites:false}}));pr1Live({metadata:{fromCache:false},forEach:cb=>docs.forEach(cb),docChanges:()=>docs.map(doc=>({type:'added',doc}))});});
      await p.waitForFunction(key=>!document.querySelector('#journalNotice [data-kind="load"]')&&trades.length===2&&!localStorage.getItem(key),OUTBOX);
      assert.deepEqual(await stored(p),['pr1live','pr1queued']);
      assert.match(await noticeText(p,'outbox'),/: 1\./);
    });
    await fixture('PR1-04 an unacknowledged new trade releases the form, is listed and survives a reload',async p=>{
      await holdCommits(p);await submitTrade(p);
      await p.waitForFunction(()=>!document.getElementById('modalOverlay').classList.contains('open'),null,{timeout:3000});
      const pending=await p.evaluate(key=>({ids:trades.map(t=>t.id),outbox:JSON.parse(localStorage.getItem(key)||'[]')}),OUTBOX);
      assert.equal(pending.ids.length,1);assert.equal(pending.outbox.length,1);assert.equal(pending.outbox[0].id,pending.ids[0]);
      assert.match(await noticeText(p,'keep:pending'),/tj-notice-warn.*Сервер ещё не подтвердил сохранение сделки/s);
      assert.deepEqual(await stored(p),[]);
      // The tab dies before the server answers: the queued write is lost with it.
      await p.reload();await init(p);
      await p.waitForFunction(key=>trades.length===1&&!localStorage.getItem(key),OUTBOX);
      assert.deepEqual(await stored(p),[pending.ids[0]]);
      assert.match(await noticeText(p,'outbox'),/Отправлены сделки, которые не успели сохраниться в прошлый раз: 1\./);
    });
    await fixture('PR1-04 a late acknowledgement clears the pending notice and the device queue',async p=>{
      await holdCommits(p);await submitTrade(p);
      await p.waitForFunction(()=>!document.getElementById('modalOverlay').classList.contains('open'),null,{timeout:3000});
      assert.match(await noticeText(p,'keep:pending'),/tj-notice-warn/);
      await p.evaluate(()=>window.pr1Release());
      await p.waitForFunction(key=>!localStorage.getItem(key),OUTBOX);
      await p.waitForFunction(()=>/tj-notice-ok/.test((document.querySelector('#journalNotice [data-kind="keep:pending"]')||{}).className||''));
      assert.equal((await stored(p)).length,1);assert.equal(await p.evaluate(()=>trades.length),1);
    });
    assert.deepEqual(errors,[]);
    console.log('PASS no page errors / no production requests');
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
