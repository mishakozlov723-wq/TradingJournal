// Isolated Notes integration test. Real Notes DOM, history and save queue; local Firestore double.
// Run with Playwright installed: node tests/notes-database.browser.cjs
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const audit=process.env.NOTES_TEST_AUDIT;
function bootstrap(){
  document.getElementById('loginScreen').style.display='none';document.getElementById('appRoot').style.display='block';
  window.viewingUser='alice';window.currentUser={login:'alice'};window.testWrites=[];window.testDelay=0;window.testFail=false;
  const read=()=>JSON.parse(localStorage.getItem('notes-test-cloud')||'{}');
  window.db={collection(name){return {doc(id){return {key:name+'/'+id,get(){const d=read()[this.key];return Promise.resolve({exists:!!d,data:()=>d});},set(v){const d=read();d[this.key]=v;localStorage.setItem('notes-test-cloud',JSON.stringify(d));return Promise.resolve();}};}};},batch(){const ops=[];return {set(ref,data,opt){ops.push({key:ref.key,data:JSON.parse(JSON.stringify(data)),merge:opt&&opt.merge});},delete(ref){ops.push({key:ref.key,remove:true});},commit(){const captured=JSON.parse(JSON.stringify(ops));testWrites.push(captured);return new Promise((resolve,reject)=>setTimeout(()=>{if(testFail){reject(Error('test failure'));return;}const data=read();for(const op of captured){if(op.remove)delete data[op.key];else data[op.key]=op.merge?{...data[op.key],...op.data}:op.data;}localStorage.setItem('notes-test-cloud',JSON.stringify(data));resolve();},testDelay));}};}};
  window.firebase={auth:()=>({currentUser:{uid:viewingUser}}),firestore:{FieldValue:{delete:()=>null}}};
}
const access=`
window.NT={
  async start(owner='alice'){viewingUser=owner;currentUser={login:owner};notesWorkspaceMode=true;document.body.classList.add('notes-workspace-mode');document.getElementById('notesWorkspace').setAttribute('aria-hidden','false');await notesLoad(true);if(!notesPages.length)notesAddPage(null);},
  pages:()=>notesPages, current:()=>notesCurrentPage(), block:()=>notesCurrentPage().blocks.find(b=>b.type==='database'),
  defaults:notesDefaultBlock, normalize:notesNormalizeBlock, add:notesInsertBlock, newPage:notesAddPage,
  switch(id){notesCloseMenus();notesActivePageId=id;notesRender();}, undo:notesUndo,redo:notesRedo,render:notesRender,save:notesSave,
  row:()=>notesResolveRow(notesRowState),rowState:()=>notesRowState,tabs:()=>notesTabs,closeRow:notesCloseRow,
  openRow(i,mode){const b=this.block();notesOpenRow({owner:notesLoadedFor,pageId:notesActivePageId,dbId:b.id,rowId:b.rows[i].id},mode);},
  rowRun(fn){return notesRowRun(notesRowState,fn);},tabSelect:notesTabsSelect,tabClose:notesTabsClose,
  settled:()=>!notesRemoteSaveInFlight&&!notesDirty,
  async realShare(){const p=notesPageById(notesActivePageId),pages=notesShareSubtree(p);await db.collection('notesShares').doc('RowPagesTestToken12345678').set({pages,rootId:p.id});notesStartShareView('RowPagesTestToken12345678');},
  imageAfterSwitch(){const ctx=notesRowState;setTimeout(()=>notesRowInsertImage(ctx,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlpUAAAAASUVORK5CYII=','Sample',null),60);this.openRow(1);},
  rowFixture(){const p=notesCurrentPage();p.title='Trading journal';p.cover='';p.blocks=[notesDefaultBlock('database')];const b=p.blocks[0];b.properties=[['Trade','text'],['Date','date'],['Result','number'],['Review','checkbox'],['Setup','select'],['Status','status']].map(([n,t])=>NotesDatabase.property(n,t));b.primaryPropertyId=b.properties[0].id;
    b.rows=Array.from({length:3},(_,i)=>{const r=NotesDatabase.newRow();r.cells[b.primaryPropertyId]=['EUR/USD · London','NQ · New York','GBP/USD · Plan'][i];r.page.blocks=[Object.assign(notesDefaultBlock('text'),{text:'Row '+i+' notes'})];return r;});notesRender();notesHistoryReset();notesScheduleSave();},
  resetOwner:notesResetForOwnerSwitch, schedule:notesScheduleSave, historyReset:notesHistoryReset,
  async owner(owner){notesSave();notesResetForOwnerSwitch();await this.start(owner);},
  readonly(){notesShareMode=true;notesRender();},writeable(){notesShareMode=false;notesRender();},
  fixture(){const p=notesCurrentPage();p.title='Trading research';p.icon='📈';p.cover='ocean';p.comments=[{id:'c1',text:'Regression comment',author:'alice',createdAt:1}];const child=notesCreatePageRecord(p.id,'Reference page');child.blocks[0].text='Preview content';const link=notesDefaultBlock('page');link.linkedPageId=child.id;p.blocks.push(link);for(const type of ['h1','h2','text','callout','todo','table','columns2','code','image']){const b=notesDefaultBlock(type);if(type==='image'){b.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlpUAAAAASUVORK5CYII=';b.alt='Test image';}else if(type==='table')b.rows=[['Legacy','Table'],['Русский\\ntext','42']];else b.text='Legacy '+type;p.blocks.push(b);}notesRender();notesScheduleSave();},
  performance(){const b=this.block();b.properties=Array.from({length:20},(_,i)=>NotesDatabase.property('Property '+i,Object.keys(NotesDatabase.TYPES)[i%6]));b.rows=Array.from({length:200},(_,i)=>({id:'perf'+i,cells:Object.fromEntries(b.properties.map(p=>[p.id,NotesDatabase.value(p.type==='date'?'2026-09-24':String(i),p,true)]))}));notesRender();notesHistoryReset();}
};
NT.start();
`;
let html=require('./assembled-html.cjs')();
html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g,(all,attrs,body)=>{
  if(attrs.includes('notes-workspace-script'))return '<script>('+bootstrap.toString()+')();</script><script>'+body.replace(/\}\)\(\);\s*$/,access+'\n})();')+'</script>';
  return '';
});
html=html.replace('</head>','<style>#authOverlay,#deviceOverlay,#onboardingOverlay{display:none!important}.notes-workspace{z-index:9999!important}</style></head>');
const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=path.join(root,name);if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'image/png');res.end(fs.readFileSync(file));});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  const results=[];
  async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
  const popup=()=>page.locator('.ndb-popup');
  const popButton=label=>popup().getByRole('button',{name:label,exact:true});
  const cell=(r=0,c=0)=>page.locator('.ndb-table tbody tr').nth(r).locator('.ndb-cell').nth(c);
  const header=c=>page.locator('.ndb-header').nth(c);
  async function propertyType(c,type){await header(c).click();await popup().getByRole('button',{name:/Property type/}).click();await popButton(type).click();assert.ok(await header(c).evaluate(e=>document.activeElement===e));}
  async function textCell(r,c,text){await cell(r,c).focus();await cell(r,c).press('Enter');await cell(r,c).locator('textarea').fill(text);await cell(r,c).locator('textarea').press('Tab');}
  async function snap(name){if(audit){await page.waitForTimeout(180);fs.mkdirSync(audit,{recursive:true});await page.screenshot({path:path.join(audit,name+'.png'),fullPage:false});}}
  try{
    await page.goto(url);await page.waitForFunction(()=>window.NT&&NT.current());
    await check('unpacked build creates a six-type database and opens Side Peek',async()=>{await page.evaluate(()=>{NT.rowFixture();document.activeElement.blur();NT.render();});await page.locator('.ndb-row-title').first().click();assert.equal(await page.locator('#notesRowTitle').inputValue(),'EUR/USD · London');assert.equal(await page.locator('.notes-row-property').count(),6);});
    await check('row edits are stored in its parent and survive reload',async()=>{await page.locator('#notesRowTitle').fill('ZIP verified');await page.locator('#notesRowBlocks .notes-editable').fill('Content saved from unpacked ZIP');await page.evaluate(()=>NT.save());await page.waitForFunction(()=>NT.settled());await page.reload();await page.waitForSelector('#notesRowTitle');assert.equal(await page.locator('#notesRowTitle').inputValue(),'ZIP verified');assert.equal(await page.locator('#notesRowBlocks .notes-editable').innerText(),'Content saved from unpacked ZIP');});
    await check('Full Page and new workspace tab use the same saved row',async()=>{await page.getByRole('button',{name:'Open in full page',exact:true}).click();assert.equal(await page.locator('#notesRowPanel').getAttribute('class'),'notes-row-panel full');await page.getByRole('button',{name:'Open in new tab',exact:true}).click();assert.equal(await page.locator('#notesWorkspaceTabs [role=tab]').count(),2);assert.equal(await page.locator('#notesRowTitle').inputValue(),'ZIP verified');await snap('zip-smoke-full-page');});
    await check('return to database preserves primary text and table',async()=>{await page.getByRole('button',{name:'Back to database',exact:true}).click();await page.waitForTimeout(220);assert.equal(await page.locator('#notesRowPanel').count(),0);assert.equal(await page.locator('.ndb-row-title').first().innerText(),'ZIP verified');assert.ok(await page.evaluate(()=>NT.block().primaryPropertyId));});
    await check('no uncaught exceptions in unpacked project',async()=>assert.deepEqual(errors,[]));
    if(audit)fs.writeFileSync(path.join(audit,'zip-smoke-results.json'),JSON.stringify({passed:results,errors},null,2));
  }catch(e){await snap('zip-smoke-failure');console.error(errors);throw e;}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
