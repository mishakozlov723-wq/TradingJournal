const {server,chromium}=require('./models-full-harness.cjs'),assert=require('assert/strict');
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],opened=[];page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>{p.close();});await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const cdp=await page.context().newCDPSession(page);cdp.on('Page.windowOpen',e=>opened.push(e.url));await cdp.send('Page.enable');
const cmd=(method,args)=>cdp.send(method,args),sleep=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=expression=>page.evaluate(expression),ready=()=>page.waitForFunction(()=>typeof window.openModal==='function'),audit=async()=>{};
async function check(name,body){await evaluate('(async()=>{const assert=(v,m)=>{if(!v)throw Error(m||"assertion failed");};const el=id=>document.getElementById(id);const tick=()=>new Promise(r=>setTimeout(r,50));'+body+'})()');console.log('PASS '+name);}
    const login = `USERS=[{login:'admin-test',email:'admin-test@journal.local',role:'admin',uid:'test-admin-uid'},{login:'user-test',email:'user-test@journal.local',role:'user',uid:'test-user-uid'}];tjAdminUid='test-admin-uid';currentUser=USERS[0];viewingUser=currentUser.login;el('loginScreen').style.display='none';el('appRoot').style.display='block';await loadData();render();hideOverviewSkeleton();`;
    await cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    await ready();
    await check('empty CTA and compact panel', login + `
      openModal(null);assert(tradingModels.length===0);assert(el('tradeModelCTA').textContent==='Добавьте свои торговые модели');
      assert(!el('tradeModelCTA').disabled);assert(el('tradeModelControl').style.display==='none');
      el('tradeModelCTA').click();assert(el('modelCreateOverlay').classList.contains('open'));assert(el('modalOverlay').classList.contains('nested-modal-suspended'));assert(el('modalOverlay').getAttribute('aria-hidden')==='true');
      assert(document.activeElement===el('modelNameInput'));
    `);
    await check('Cyrillic text line boxes and input height', `
      await document.fonts.ready;await new Promise(r=>setTimeout(r,350));
      for(const id of ['modelCreateTitle','modelCreateSubmit','modelDeleteTitle']) {
        const style=getComputedStyle(el(id));assert(parseFloat(style.lineHeight)>=parseFloat(style.fontSize)*1.45,id+' line height');
      }
      closeModelCreatePanel();await new Promise(r=>setTimeout(r,350));
      const cta=el('tradeModelCTA'),range=document.createRange();range.selectNodeContents(cta);
      const text=range.getBoundingClientRect(),box=cta.getBoundingClientRect();
      assert(text.top>=box.top&&text.bottom<=box.bottom,'CTA text fits vertically');
      assert(getComputedStyle(cta).backfaceVisibility==='visible','no forced text compositor layer');
      cta.click();await new Promise(r=>setTimeout(r,350));
      const input=el('modelNameInput'),style=getComputedStyle(input),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      ctx.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
      const metrics=ctx.measureText('ЙЁДобавьте модели');
      const contentHeight=input.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
      assert(contentHeight>=metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent,'Cyrillic input glyphs fit');
    `);
    await audit('create');
    if (process.env.MODEL_TEST_AUDIT) {
      await evaluate("document.getElementById('modelNameInput').value='ЙЁруgyH4Q9'");await audit('long-name-input');
      await evaluate('closeModelCreatePanel()');await audit('empty-cta');
      await evaluate('openModelCreatePanel()');
    }
    await check('URL parsing and inline validation', `
      const tok='AbCdEfGh23456789XyZwKmNp',base=location.origin+location.pathname;
      const good=[base+'?note='+tok,base+'?note='+tok+'#top',location.origin+'/?note='+tok];
      const bad=['','https://example.com','javascript:alert(1)',base,base+'?note=short',base+'?note=bad-token!!!!!!!!!!',
        'https://www.notion.so/Model-0123456789abcdef0123456789abcdef','https://desk.notion.site/entry-model',
        'ftp://x/?note='+tok,location.protocol+'//user:pass@'+location.host+'/?note='+tok];
      good.forEach(u=>assert(parseNotesShareUrl(u,true),'rejected '+u));bad.forEach(u=>assert(!parseNotesShareUrl(u,true),'accepted '+u));
      const foreign='https://alternate-host.example/path?note='+tok;
      assert(parseNotesShareUrl(foreign,true)===base+'?note='+tok,'foreign hosting alias canonicalizes to current journal');
      el('modelCreateForm').requestSubmit();assert(el('modelNameInput').getAttribute('aria-invalid')==='true');
      el('modelNameInput').value='12345678901';el('modelCreateForm').requestSubmit();assert(el('modelNameInput').getAttribute('aria-invalid')==='true');
      el('modelNameInput').value='Вход';el('modelUrlInput').value='https://example.com';el('modelCreateForm').requestSubmit();
      assert(el('modelUrlInput').getAttribute('aria-invalid')==='true');assert(tradingModels.length===0);
    `);
    await check('create, prevent duplicate submit, select without reload', `
      el('modelUrlInput').value=location.origin+location.pathname+'?note=EntryModelToken23456789';el('modelCreateForm').requestSubmit();el('modelCreateForm').requestSubmit();await tick();
      assert(tradingModels.length===1);assert(!el('modelCreateOverlay').classList.contains('open'));assert(!el('modalOverlay').classList.contains('nested-modal-suspended'));assert(!el('modalOverlay').hasAttribute('aria-hidden'));
      assert(selectedTradeModelId===tradingModels[0].id);assert(el('tradeModelValue').textContent==='Вход');
      await new Promise(r=>setTimeout(r,400));
      const add=el('tradeModelAddBtn').getBoundingClientRect(),picker=el('tradeModelTrigger').getBoundingClientRect();
      assert(Math.abs(add.top-picker.top)<1,'plus and picker top');assert(Math.abs(add.height-picker.height)<1,'matching heights');
      assert(Math.abs(add.width-add.height)<1,'square plus: '+add.width+'x'+add.height);assert(picker.right<add.left,'plus is right of picker');
      assert(el('tradeModelAddBtn').title==='Добавить модель');
      assert(!el('tradeModelMenu').children[0].querySelector('.trade-model-remove'),'no deletion for no-model entry');
      el('tradeModelTrigger').click();assert(el('tradeModelControl').classList.contains('open'));
      el('tradeModelMenu').children[0].querySelector('.trade-asset-option').click();assert(!selectedTradeModelId);
      el('tradeModelTrigger').click();el('tradeModelMenu').children[1].querySelector('.trade-asset-option').click();assert(selectedTradeModelId===tradingModels[0].id);
    `);
    await audit('selected');
    await evaluate("document.getElementById('tradeModelTrigger').click()");
    await audit('dropdown');
    await check('long mixed-script names keep full line boxes in a scrolling menu', `
      const saved=tradingModels,selected=selectedTradeModelId;
      tradingModels=Array.from({length:12},(_,i)=>({id:'geometry'+i,name:'ЙЁруgyH4'+i,notesShareUrl:location.origin+'/?note=TestTokenAbcdefgh2345'}));
      selectedTradeModelId=tradingModels[0].id;renderTradeModelControl();el('tradeModelTrigger').click();
      await document.fonts.ready;await new Promise(r=>setTimeout(r,350));
      const menu=el('tradeModelMenu');assert(menu.scrollHeight>menu.clientHeight,'menu scrolls');
      for(const button of menu.querySelectorAll('button')) {
        const range=document.createRange();range.selectNodeContents(button);
        const text=range.getBoundingClientRect(),box=button.getBoundingClientRect();
        assert(text.top>=box.top&&text.bottom<=box.bottom,'full text box for '+button.textContent);
      }
      menu.lastElementChild.querySelector('button').focus();await tick();
      const last=menu.lastElementChild.getBoundingClientRect(),box=menu.getBoundingClientRect();
      assert(last.bottom<=box.bottom+1,'last model reachable by keyboard scrolling');
      tradingModels=saved;selectedTradeModelId=selected;renderTradeModelControl();closeTradeModelMenu();
    `);
    if (process.env.MODEL_TEST_AUDIT) {
      await evaluate("window.auditModels=tradingModels;tradingModels=Array.from({length:12},(_,i)=>({id:'audit'+i,name:'ЙЁруgyH4'+i,notesShareUrl:location.origin+'/?note=TestTokenAbcdefgh2345'}));renderTradeModelControl();document.getElementById('tradeModelControl').classList.add('open')");
      await audit('many-models');
      await evaluate('tradingModels=window.auditModels;renderTradeModelControl()');
    }
    await evaluate('closeTradeModelMenu()');
    await check('save trade and place model before Gain', `
      el('magnitudeInput').value='2';el('riskPercentInput').value='0.5';
      setDateTimeInput(el('openInput'),'2020-01-01T09:00');setDateTimeInput(el('closeInput'),'2020-01-01T10:00');
      el('tradeForm').requestSubmit();await tick();assert(trades.length===1);assert(trades[0].modelId===tradingModels[0].id);
      assert(trades[0].modelName==='Вход');assert(tradeGainPercent(trades[0])===1);
      const row=el('allTradesBody').firstElementChild;assert(row.cells.length===11);assert(row.cells[8].dataset.col==='model');assert(row.cells[9].dataset.col==='rr');
      const a=row.cells[8].querySelector('a');assert(a.target==='_blank');assert(a.rel==='noopener noreferrer');assert(a.href===tradingModels[0].notesShareUrl);a.click();
    `);
    await sleep(100);
    assert.equal(opened[0], 'http://127.0.0.1:' + server.address().port + '/?note=EntryModelToken23456789');
    console.log('PASS correct Notes share URL opens a new browser tab');
    if (process.env.MODEL_TEST_AUDIT) {
      await evaluate("document.getElementById('allTradesBody').scrollIntoView({block:'center'})");
      await audit('trade-table');await evaluate('window.scrollTo(0,0)');
    }
    await cmd('Page.reload'); await sleep(300); await ready();
    await check('reload restores models and trade association', login + `
      assert(tradingModels.length===1);assert(trades.length===1);assert(trades[0].modelId===tradingModels[0].id);
      assert(el('allTradesBody').querySelector('a.trade-model-link').textContent==='Вход');
    `);
    await check('legacy trades and all individual-trade views', `
      const linked=trades[0];const old={id:'old-trade',asset:'EURUSD',direction:'SHORT',openDT:'2020-01-02T09:00',closeDT:'2020-01-02T10:00',r:-1};trades.push(old);render();
      assert(el('allTradesBody').firstElementChild.cells[8].textContent==='—');assert(computeStats(trades).total===2);assert(tradeGainPercent(old)===-1);
      renderTradesTable(trades,'weekTradesBody','weekEmptyState');renderTradesTable(trades,'monthTradesBody','monthEmptyState');
      ['weekTradesBody','monthTradesBody'].forEach(id=>{assert(el(id).rows[0].cells[8].textContent==='—');assert(el(id).rows[1].cells[8].querySelector('a'));});
      for(const th of document.querySelectorAll('th[data-col="rr"]')){assert(th.previousElementSibling.dataset.col==='model');assert(th.previousElementSibling.firstChild.textContent==='Model');}
      openCalDayModal(1,trades);assert(el('calDayTradesList').querySelector('a.trade-model-link'));closeCalDayModal();
      linked.chart='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';renderGallery();assert(el('galleryGrid').querySelector('a.trade-model-link'));
      openLightbox(linked);assert(el('lightboxModel').querySelector('a'));closeLightbox();
      openNotePanel(linked);assert(el('notePanelModel').querySelector('a'));closeNotePanel();
      const marker=document.createElementNS('http://www.w3.org/2000/svg','circle');
      openChartTradeCard({trade:linked,idx:1,equity:1,unit:'%'},marker,100,100,[]);assert(el('chartTradeCardGrid').querySelector('a'));closeChartTradeCard();
    `);
    await check('inline editing keeps other properties intact', `
      const old=trades.find(t=>t.id==='old-trade'),before=JSON.stringify(old);
      const td=el('allTradesBody').querySelector('td[data-col="model"]');showInlinePopup(td,old,'model');
      inlineEditPopup.querySelectorAll('.popup-option')[1].click();inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();assert(old.modelId===tradingModels[0].id);
      const copy={...old};delete copy.modelId;delete copy.modelName;delete copy.user;delete copy.uid;assert(JSON.stringify(copy)===before);
      showInlinePopup(td,old,'model');inlineEditPopup.querySelector('.popup-option').click();inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();assert(!old.modelId);
    `);
    await check('failed save, retry, duplicate names with distinct stable IDs', `
      openModal(null);el('tradeModelAddBtn').click();el('modelNameInput').value='Вход';el('modelUrlInput').value=location.origin+location.pathname+'?note=SecondModelToken2345678';
      testFailWrite=true;el('modelCreateForm').requestSubmit();await tick();assert(tradingModels.length===1);
      assert(el('modelCreateOverlay').classList.contains('open'));assert(el('modelCreateError').style.display==='block');assert(!el('modelCreateSubmit').disabled);
      testFailWrite=false;el('modelCreateForm').requestSubmit();await tick();assert(tradingModels.length===2);assert(tradingModels[0].id!==tradingModels[1].id);
      assert(tradingModels[0].name===tradingModels[1].name);const d=await db.collection('titles').doc(viewingUser).get();assert(Object.keys(d.data().tradingModels).length===2);
    `);
    const navigationBeforeEdit = opened.length;
    await check('real table edit actions replace links, cancel drafts, save and clear models', `
      closeModal();activeTab='overview';render();
      const linked=trades.find(t=>t.modelId),a=tradingModels[0],b=tradingModels[1],stats=JSON.stringify(computeStats(trades),(k,v)=>['modelId','modelName'].includes(k)?undefined:v);
      const cell=()=>Array.from(el('allTradesBody').querySelectorAll('td[data-col="model"]')).find(td=>td.dataset.id===linked.id);
      const edit=()=>{if(activeEditCol!=='model')document.querySelector('.th-pencil[data-col="model"]').click();assert(!cell().querySelector('a'),'edit mode has no anchor');cell().querySelector('button').click();assert(inlineEditPopup);};
      assert(cell().querySelector('a').href===a.notesShareUrl);edit();
      inlineEditPopup.querySelectorAll('.popup-option')[2].click();assert(linked.modelId===a.id,'draft does not mutate trade');
      inlineEditPopup.querySelector('.popup-cancel-btn').click();assert(!inlineEditPopup);assert(linked.modelId===a.id);assert(cell().querySelector('button')&&activeEditCol==='model','cancel keeps column editing like other columns');
      edit();inlineEditPopup.querySelectorAll('.popup-option')[2].click();inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();
      assert(linked.modelId===b.id&&linked.modelName===b.name);assert(cell().querySelector('button')&&activeEditCol==='model','save keeps column editing');
      document.querySelector('.th-pencil[data-col="model"]').click();assert(cell().querySelector('a').href===b.notesShareUrl);
      let stored=(await db.collection('trades').doc(linked.id).get()).data();assert(stored.modelId===b.id,'uses existing remote save');
      for(const id of ['weekTradesBody','monthTradesBody']) {
        renderTradesTable(trades,id,id==='weekTradesBody'?'weekEmptyState':'monthEmptyState');
        document.querySelector('.th-pencil[data-col="model"]').click();
        const td=Array.from(el(id).querySelectorAll('td[data-col="model"]')).find(td=>td.dataset.id===linked.id);
        assert(td.querySelector('button')&&!td.querySelector('a'));td.querySelector('button').click();
        inlineEditPopup.querySelectorAll('.popup-option')[1].click();
        inlineEditPopup.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert(!inlineEditPopup&&linked.modelId===b.id);assert(td.querySelector('button')&&activeEditCol==='model');
        document.querySelector('.th-pencil[data-col="model"]').click();assert(td.querySelector('a').href===b.notesShareUrl);
      }
      edit();inlineEditPopup.querySelector('.popup-option').click();inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();
      assert(!linked.modelId&&!linked.modelName);assert(cell().textContent==='—');
      stored=(await db.collection('trades').doc(linked.id).get()).data();assert(!stored.modelId&&!stored.modelName);
      edit();inlineEditPopup.querySelectorAll('.popup-option')[1].click();inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();
      assert(linked.modelId===a.id);assert(cell().querySelector('button')&&activeEditCol==='model');
      document.querySelector('.th-pencil[data-col="model"]').click();assert(cell().querySelector('a').href===a.notesShareUrl);
      assert(JSON.stringify(computeStats(trades),(k,v)=>['modelId','modelName'].includes(k)?undefined:v)===stats,'editing model does not change stats');
    `);
    assert.equal(opened.length, navigationBeforeEdit, 'No Notes navigation during Edit, selection, Save or Cancel');
    await check('model edit animation and stable table geometry', `
      const model=tradingModels[0],original=model.name;model.name='ЙЁруgyH4Q9';render();await document.fonts.ready;await new Promise(r=>setTimeout(r,400));
      const geometry=()=>Array.from(el('allTradesBody').querySelectorAll('td')).map(td=>{const r=td.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
      const before=geometry();
      const same=label=>{const after=geometry();assert(before.every((r,i)=>r.every((v,j)=>Math.abs(v-after[i][j])<0.1)),label+' does not resize or move cells: '+JSON.stringify(before.map((r,i)=>r.map((v,j)=>after[i][j]-v))));};
      document.querySelector('.th-pencil[data-col="model"]').click();await tick();same('enter edit');
      for(const button of el('allTradesBody').querySelectorAll('.trade-model-edit')) {
        assert(getComputedStyle(button).animationName==='cellWiggle','shared edit animation');
        assert(getComputedStyle(button).borderStyle==='dashed','shared edit border');
      }
      const button=el('allTradesBody').querySelector('.trade-model-edit');button.click();await tick();same('open popup');
      assert(getComputedStyle(inlineEditPopup).animationName==='fadeIn','existing popup transition');
      inlineEditPopup.querySelector('.popup-cancel-btn').click();same('cancel popup');
      document.querySelector('.th-pencil[data-col="model"]').click();same('leave edit');
      model.name=original;render();
    `);
    if (process.env.MODEL_TEST_AUDIT) {
      await cmd('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
      await evaluate("document.querySelector('.th-pencil[data-col=\"model\"]').click();document.querySelector('#allTradesBody .trade-model-edit').scrollIntoView({block:'center'});document.querySelector('#allTradesBody .trade-model-edit').click()");
      await audit('table-model-editor');await evaluate("closeInlineEditPopup();setActiveEditCol('model')");
      await audit('table-model-view');
      await evaluate('window.scrollTo(0,0)');
    }
    await check('account isolation and failed model reads preserve trades', `
      const original=viewingUser;viewingUser=USERS[1].login;await loadData();assert(tradingModels.length===0);
      assert(!tradeModelHTML({modelId:'unknown'}).includes('<a'));openModal(null);assert(el('tradeModelCTA').style.display==='flex');
      viewingUser=original;await loadData();assert(tradingModels.length===2);
      testFailRead=true;await loadData();assert(!tradingModelsReady);assert(tradingModels.length===0);assert(trades.length===2);
      assert(!tradeModelHTML(trades.find(t=>t.modelId)).includes('<a'));testFailRead=false;await loadData();assert(tradingModels.length===2);
    `);
    if (process.env.MODEL_TEST_AUDIT) {
      await evaluate("openModal(null);document.getElementById('tradeModelTrigger').click()");
      await audit('multiple-models');
      for (const [name,selector] of [['row-hover','#tradeModelMenu .trade-asset-option'],['delete-hover','#tradeModelMenu .trade-model-remove']]) {
        const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await audit(name);
      }
      await evaluate("document.querySelector('#tradeModelMenu .trade-model-remove').click()");
      await audit('delete-confirmation');
      await evaluate('closeModelDeletePanel();closeModal()');
    }
    await check('untrusted names and URLs render as data', `
      const model=tradingModels[0],name=model.name,url=model.notesShareUrl;model.name='<img src=x>';model.notesShareUrl='javascript:alert(1)';
      const wrapper=document.createElement('div');wrapper.innerHTML=tradeModelHTML({modelId:model.id});assert(!wrapper.querySelector('a,img'));
      model.notesShareUrl=location.origin+'/?note=QuoteTokenAbcdefgh23&x=%22';wrapper.innerHTML=tradeModelHTML({modelId:model.id});assert(wrapper.querySelectorAll('a').length===1);assert(!wrapper.querySelector('img'));
      model.name=name;model.notesShareUrl=url;
    `);
      await check('filters, sorting, ordinary edits and deletion retain model records', `
      closeModal();const linked=trades.find(t=>t.modelId),modelId=linked.modelId;
      assetFilter='GBPUSD';render();assert(el('allTradesBody').rows.length===0);
      assetFilter='ALL';render();assert(el('allTradesBody').rows[0].cells[8].textContent==='—');
      const td=Array.from(el('allTradesBody').querySelectorAll('td[data-col="rr"]')).find(td=>td.dataset.id===linked.id);
      showInlinePopup(td,linked,'rr');inlineEditPopup.querySelector('input').value='3';inlineEditPopup.querySelector('.popup-confirm-btn').click();await tick();
      assert(linked.modelId===modelId);assert(tradeGainPercent(linked)===1.5);
      const oldDelete=Array.from(el('allTradesBody').querySelectorAll('.del-btn')).find(btn=>btn.dataset.id==='old-trade');
      oldDelete.click();await tick();assert(trades.length===1);assert(tradingModels.length===2);
      await loadData();assert(trades.length===1);assert(trades[0].modelId===modelId);assert(trades[0].r===3);
    `);
      await check('backtest save, edit and local persistence preserve model ID', `
      const bt={id:'model-test-backtest',name:'Test',startDate:'2020-01-01T00:00:00',endDate:'2020-01-31T23:59:59.999',uid:currentUser.uid};
      backtests=[bt];activeBacktestId=bt.id;backtestTrades=[];allBacktestTrades=[];backtestTradeMode=true;openModal(null);
      selectedTradeModelId=tradingModels[0].id;renderTradeModelControl();el('magnitudeInput').value='2';el('riskPercentInput').value='1';
      setDateTimeInput(el('openInput'),'2020-01-03T09:00');setDateTimeInput(el('closeInput'),'2020-01-03T10:00');el('tradeForm').requestSubmit();await tick();
      assert(allBacktestTrades.length===1);const trade=allBacktestTrades[0];await loadBacktestTrades(bt);assert(trade.modelId===tradingModels[0].id);
      openBacktestTradeEditor(trade.id);assert(selectedTradeModelId===trade.modelId);el('magnitudeInput').value='4';el('tradeForm').requestSubmit();await tick();
      assert(allBacktestTrades.length===1);assert(trade.r===4);assert(trade.modelId===tradingModels[0].id);
      const local=readBacktestLocal('backtest_trades');assert(local[0].modelId===trade.modelId);
      const remote=await db.collection('backtestTrades').doc(trade.id).get();assert(remote.data().modelId===trade.modelId);
      bt.rrText='2,-1,3';const synthetic=buildBacktestTradesFromRR(bt);assert(synthetic.length===3);assert(computeStats(synthetic).totalPercent===4);assert(synthetic.every(t=>!t.modelId));
    `);
      await cmd('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    await check('mobile panel bounds and keyboard navigation', `
      document.body.classList.add('mobile-mode');openModal(null);
      el('tradeModelTrigger').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      assert(el('tradeModelControl').classList.contains('open'));assert(el('tradeModelMenu').contains(document.activeElement));
      el('tradeModelControl').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!el('tradeModelControl').classList.contains('open'));
      el('tradeModelAddBtn').click();await new Promise(r=>setTimeout(r,400));const box=el('modelCreateOverlay').querySelector('.modal-box').getBoundingClientRect();
      assert(box.left>=0&&box.right<=innerWidth);assert(box.bottom<=innerHeight);
      el('modelCreateClose').focus();el('modelCreateClose').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert(document.activeElement===el('modelCreateSubmit'));
      el('modelCreateSubmit').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!el('modelCreateOverlay').classList.contains('open'));assert(!el('modalOverlay').classList.contains('nested-modal-suspended'));assert(!el('modalOverlay').hasAttribute('aria-hidden'));
    `);
    await check('mobile plus layout and last option keyboard delete action', `
      closeModal();openModal(null);await new Promise(r=>setTimeout(r,350));
      const add=el('tradeModelAddBtn').getBoundingClientRect(),picker=el('tradeModelTrigger').getBoundingClientRect();
      assert(Math.abs(add.height-picker.height)<1);assert(Math.abs(add.width-add.height)<1);assert(picker.right<add.left);
      el('tradeModelTrigger').click();el('tradeModelMenu').children[2].querySelector('.trade-asset-option').click();assert(selectedTradeModelId===tradingModels[1].id);
      el('tradeModelTrigger').click();el('tradeModelMenu').querySelector('.trade-model-remove').focus();assert(el('tradeModelControl').classList.contains('open'));
      const selected=selectedTradeModelId;
      el('tradeModelMenu').querySelector('.trade-model-remove').click();assert(el('modelDeleteOverlay').classList.contains('open'));
      assert(selectedTradeModelId===selected,'delete click must not select its row');
      assert(pendingModelDeletion.id===tradingModels[0].id,'delete targets unselected row');
      el('modelDeleteCancel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert(!el('modelDeleteOverlay').classList.contains('open'));assert(tradingModels.length===2);
    `);
    if (process.env.MODEL_TEST_AUDIT) {
      await evaluate("document.getElementById('tradeModelTrigger').click()");await audit('mobile-dropdown');
      await evaluate('closeTradeModelMenu()');
    }
    await check('delete cancellation, failed write, retry and reference cleanup', `
      closeModal();activeBacktestId=null;backtestTradeMode=false;activeTab='overview';
      const model=tradingModels[0],other=tradingModels[1],before=JSON.stringify(trades),stats=JSON.stringify(computeStats(trades),(k,v)=>['modelId','modelName'].includes(k)?undefined:v);
      await db.collection('titles').doc(viewingUser).set({curveColor:'#123456'}, {merge:true});
      renderTradesTable(trades,'weekTradesBody','weekEmptyState');renderTradesTable(trades,'monthTradesBody','monthEmptyState');
      openCalDayModal(1,trades);openLightbox(trades[0]);openNotePanel(trades[0]);
      openModal(null);selectedTradeModelId=other.id;selectedTradeModelName=other.name;renderTradeModelControl();el('tradeModelTrigger').click();
      assert(!el('tradeModelDeleteBtn'));assert(el('tradeModelMenu').querySelectorAll('.trade-model-remove').length===tradingModels.length);el('tradeModelMenu').querySelector('.trade-model-remove').click();
      assert(el('modelDeleteOverlay').classList.contains('open'));assert(el('modelDeleteTitle').textContent==='Удалить модель?');
      assert(document.activeElement===el('modelDeleteCancel'));assert(el('modalOverlay').classList.contains('nested-modal-suspended'));assert(el('modalOverlay').getAttribute('aria-hidden')==='true');
      el('modelDeleteCancel').click();assert(tradingModels.length===2);assert(!el('modalOverlay').classList.contains('nested-modal-suspended'));assert(!el('modalOverlay').hasAttribute('aria-hidden'));
      el('tradeModelTrigger').click();el('tradeModelMenu').querySelector('.trade-model-remove').click();testFailWrite=true;el('modelDeleteConfirm').click();await tick();
      assert(tradingModels.length===2);assert(el('modelDeleteError').style.display==='block');assert(!el('modelDeleteConfirm').disabled);
      testFailWrite=false;el('modelDeleteConfirm').click();el('modelDeleteConfirm').click();await tick();
      assert(tradingModels.length===1&&tradingModels[0].id===other.id);assert(selectedTradeModelId===other.id,'deleting another row preserves selection');
      assert(!el('modelDeleteOverlay').classList.contains('open'));assert(!el('modalOverlay').classList.contains('nested-modal-suspended'));assert(!el('modalOverlay').hasAttribute('aria-hidden'));
      const expected=JSON.parse(before);expected.forEach(t=>{if(t.modelId===model.id){delete t.modelId;delete t.modelName;}});
      assert(JSON.stringify(trades)===JSON.stringify(expected),'only model fields removed');assert(JSON.stringify(computeStats(trades),(k,v)=>['modelId','modelName'].includes(k)?undefined:v)===stats,'stats untouched');
      const doc=await db.collection('titles').doc(viewingUser).get();assert(!doc.data().tradingModels[model.id]);
      assert(doc.data().tradingModels[other.id]);assert(doc.data().curveColor==='#123456','unrelated settings retained');
      assert(!document.querySelector('a[data-model-id="'+model.id+'"]'),'no stale active links in any rendered view');
      const historical=trades[0];assert(!historical.modelId&&!historical.modelName);assert(!tradeModelHTML(historical).includes('<a'));
      assert(!tradeModelHTML(historical).includes(model.name));assert(el('tradeModelMenu').children.length===2);
      const stored=(await db.collection('trades').doc(historical.id).get()).data();assert(!stored.modelId&&!stored.modelName);
      assert(allBacktestTrades.every(t=>!t.modelId&&!t.modelName),'backtest memory cleaned');
      assert(readBacktestLocal('backtest_trades').every(t=>!t.modelId&&!t.modelName),'backtest cache cleaned');
      const remoteBT=await db.collection('backtestTrades').where('uid','==',currentUser.uid).get();
      remoteBT.forEach(d=>{assert(!d.data().modelId&&!d.data().modelName);assert(d.data().r===4);});
      closeLightbox();closeCalDayModal();closeNotePanel();
    `);
    await cmd('Page.reload');await sleep(300);await ready();
    await check('reload after deletion and final-model empty CTA', login + `
      assert(tradingModels.length===1);assert(trades.length===1);assert(!trades[0].modelName&&!trades[0].modelId);
      assert(!el('allTradesBody').querySelector('a.trade-model-link'));assert(el('allTradesBody').querySelector('td[data-col="model"]').textContent==='—');
      assert(tradeModelHTML({id:'legacy'}).includes('—'));const before=JSON.stringify(trades);
      openModal(null);selectedTradeModelId=tradingModels[0].id;renderTradeModelControl();el('tradeModelTrigger').click();el('tradeModelMenu').querySelector('.trade-model-remove').click();
      el('modelDeleteConfirm').click();await tick();assert(tradingModels.length===0);assert(el('tradeModelRow').style.display==='none');
      assert(!selectedTradeModelId,'deleting selected model clears selection');
      assert(el('tradeModelCTA').style.display==='flex');assert(el('tradeModelCTA').textContent==='Добавьте свои торговые модели');
      assert(JSON.stringify(trades)===before);await loadData();assert(tradingModels.length===0);assert(JSON.stringify(trades)===before);
      openModal(null);el('tradeModelCTA').click();assert(el('modelCreateOverlay').classList.contains('open'));closeModelCreatePanel();
    `);
    await check('loading preserves unresolved references; explicit cleanup is bounded and account-isolated', `
      const trade=trades[0],before=JSON.stringify(trade),removed='previously-deleted-model';
      const record={...trade,modelId:removed,modelName:'OLD MODEL'};
      await db.collection('trades').doc(trade.id).set(record);
      const data=JSON.parse(localStorage.getItem('model-test-db'));
      for(let i=0;i<402;i++) data['backtestTrades/cleanup-'+i]={id:'cleanup-'+i,uid:currentUser.uid,modelId:removed,modelName:'OLD MODEL',r:2,riskPercent:1};
      data['trades/other-user-cleanup']={id:'other-user-cleanup',uid:USERS[1].uid,modelId:removed,modelName:'OTHER',r:7};
      localStorage.setItem('model-test-db',JSON.stringify(data));
      localStorage.setItem('tj_trades_v3_'+viewingUser,JSON.stringify([record]));
      localStorage.setItem(backtestStorageKey('backtest_trades'),JSON.stringify([{...record,id:'local-only'}]));
      const database=await openDB();await new Promise((resolve,reject)=>{const tx=database.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put({...record,user:viewingUser});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      await loadData();render();assert(trades[0].modelId===removed,'load must preserve unresolved references');await purgeTradeModelReferences(viewingUser,[removed]);
      assert(JSON.stringify(trades[0])===before,'ordinary trade fields intact after old-reference cleanup');
      assert(allBacktestTrades.every(t=>!t.modelId&&!t.modelName));
      assert(testBatchSizes.includes(400)&&testBatchSizes.every(n=>n<=400),'bounded batch writes');
      const stored=JSON.parse(localStorage.getItem('model-test-db'));
      assert(!stored['trades/'+trade.id].modelId&&!stored['trades/'+trade.id].modelName);
      for(let i=0;i<402;i++){const row=stored['backtestTrades/cleanup-'+i];assert(!row.modelId&&!row.modelName&&row.r===2);}
      assert(stored['trades/other-user-cleanup'].modelName==='OTHER','other account is untouched');
      assert(JSON.parse(localStorage.getItem('tj_trades_v3_'+viewingUser)).every(t=>!t.modelId&&!t.modelName));
      assert(readBacktestLocal('backtest_trades').every(t=>!t.modelId&&!t.modelName));
      assert((await idbGetAllForUser(viewingUser)).every(t=>!t.modelId&&!t.modelName));
      assert(!el('allTradesBody').textContent.includes('OLD MODEL'));
    `);
assert.deepEqual(errors,[]);console.log('All model regression scenarios passed.');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});



