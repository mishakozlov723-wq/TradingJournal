// Run: node --test tests/trading-models.test.cjs
// Uses an isolated Chrome/Edge profile and a local Firestore double; never contacts Firebase.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { Script } = require('node:vm');
const html = require('./assembled-html.cjs')();

// Share the current transactional/batch-capable double with model regressions.
const legacy=fs.readFileSync(path.join(__dirname,'trading-models.test.cjs'),'utf8');
const firestoreStub=legacy.slice(legacy.indexOf('function installFirestoreDouble()'),legacy.indexOf("test('all application"));

test('all application inline scripts parse', () => {
  for (const [i, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].entries()) {
    if (match[1].trim()) new Script(match[1], { filename: 'inline-' + i });
  }
});

test('overview live update browser regression', { timeout: 90000 }, async t => {
  const executable = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => fs.existsSync(p));
  assert.ok(executable, 'Set CHROME_PATH to an installed Chrome/Edge/Chromium executable');
  // Optional real-font run: MODEL_TEST_FONTS=1. Fonts are served from memory,
  // while Firebase and all other external scripts remain completely blocked.
  const fonts = new Map();
  let source = html;
  if (process.env.MODEL_TEST_FONTS === '1') {
    const urls = [...new Set(html.match(/https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/[^"\s]+\.woff2/g))];
    await Promise.all(urls.map(async (url, i) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      assert.ok(response.ok, 'Font download: ' + url);
      fonts.set('/test-font/' + i, Buffer.from(await response.arrayBuffer()));
    }));
    urls.forEach((url, i) => { source = source.split(url).join('/test-font/' + i); });
  }
  const page = source.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '')
    .replace('<script>', '<script>'+fs.readFileSync(path.join(__dirname,'../calendar-navigation.js'),'utf8')+'</script><script>'+firestoreStub+'installFirestoreDouble();</script><script>');
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); }
    else if (fonts.has(req.url)) { res.setHeader('Content-Type', 'font/woff2'); res.end(fonts.get(req.url)); }
    else { res.statusCode = 204; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overview-live-test-'));
  let browser, ws;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    browser = spawn(executable, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(Error('Browser startup timeout')), 15000);
      browser.on('error', err => { clearTimeout(timer); reject(err); });
      browser.stderr.on('data', data => {
        out += data;
        const m = out.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0;
    const pending = new Map(), errors = [], opened = [];
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const p = pending.get(message.id); pending.delete(message.id);
        if (message.error) p.reject(Error(JSON.stringify(message.error)));
        else p.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      } else if (message.method === 'Page.windowOpen') opened.push(message.params.url);
    };
    function send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence; pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params = {}) => send(method, params, sessionId);
    // This suite verifies desktop motion, not the mobile no-animation fallback.
    await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Network.enable');
    await cmd('Network.setBlockedURLs', { urls: ['https://*'] });
    async function evaluate(expression) {
      const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    }
    async function ready() {
      for (let i = 0; i < 100; i++) {
        if (await evaluate("typeof renderTradeModelControl === 'function'")) return;
        await sleep(50);
      }
      throw Error('Application did not initialize: ' + errors.join('\n'));
    }
    async function check(name, body) {
      await evaluate('(async()=>{const assert=(v,m)=>{if(!v)throw Error(m||"assertion failed");};' +
        'const el=id=>document.getElementById(id);const tick=()=>new Promise(r=>setTimeout(r,50));' + body + '})()');
      t.diagnostic('PASS ' + name);
    }
    async function audit(name) {
      if (!process.env.MODEL_TEST_AUDIT) return;
      const dir = path.resolve(process.env.MODEL_TEST_AUDIT); fs.mkdirSync(dir, { recursive: true });
      await sleep(400);
      const data = await evaluate(`(()=>{
        const props=['fontFamily','fontSize','fontWeight','lineHeight','height','minHeight','maxHeight','paddingTop','paddingBottom','boxSizing','display','alignItems','justifyContent','overflow','overflowX','overflowY','transform','translate','position','top','bottom','backfaceVisibility'];
        return Array.from(document.querySelectorAll('#tradeModelField *, #modelCreateOverlay *, #modelDeleteOverlay *, .trade-model-link, .trade-model-empty')).filter(e=>e.getBoundingClientRect().height && getComputedStyle(e).visibility==='visible').map(e=>({element:e.id||e.className,text:e.textContent,chain:Array.from((function*(n){while(n){yield n;n=n.parentElement;}})(e)).map(n=>{const s=getComputedStyle(n);return {element:n.id||n.tagName,styles:Object.fromEntries(props.map(p=>[p,s[p]])),before:getComputedStyle(n,'::before').content,after:getComputedStyle(n,'::after').content};})}));
      })()`);
      fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(data,null,2));
      const shot=await cmd('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(shot.data,'base64'));
    }
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
      // Drive the production morph callback with deterministic RAF timestamps.
      // SVG/layout work can take >650ms on CI, so wall-clock sleeps are not a
      // reliable way to inspect an intermediate frame. Other RAF users stay native.
      const nativeRAF=window.requestAnimationFrame, nativeCancel=window.cancelAnimationFrame;
      const frames=new Map();let nextFrame=-1;
      window.requestAnimationFrame=fn=>{if(fn.name!=='step')return nativeRAF.call(window,fn);const id=nextFrame--;frames.set(id,fn);return id;};
      window.cancelAnimationFrame=id=>{if(id<0)frames.delete(id);else nativeCancel.call(window,id);};
      window.__morphFrame=now=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));};
      window.__restoreRAF=()=>{window.requestAnimationFrame=nativeRAF;window.cancelAnimationFrame=nativeCancel;};
      trades.push({id:'lt9',openDT:'2026-03-20T10:00',closeDT:'2026-03-20T11:00',asset:'EURUSD',direction:'LONG',r:4,riskPercent:1,chart:null});
      render();
      __morphFrame(0);
      assert(__line.getAttribute('d')===__d,'first morph frame == previous curve (no jump)');
      __morphFrame(200);
      const mid=__line.getAttribute('d');
      assert(el('chartLinePath')===__line,'path element reused (no redraw)');
      assert(mid!==__d,'animating');
      assert(overviewChartState.anim,'animation in progress');
      __morphFrame(900);
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
      trades.find(x=>x.id==='lt0').r=5; render(); __morphFrame(1000); __morphFrame(1120);
      assert(el('chartLinePath')===__line && overviewChartState.anim,'morphing');
      __morphFrame(1800);
      assert([...el('allTradesBody').children].every((tr,i)=>tr===__rows[i]),'rows kept');
    `);
    await check('delete via table button + interrupting animation', `
      el('allTradesBody').querySelector('.del-btn[data-id="lt2"]').click();el('tjConfirmOk').click();
      await tick(); __morphFrame(2000); __morphFrame(2150);
      el('allTradesBody').querySelector('.del-btn[data-id="lt3"]').click();el('tjConfirmOk').click();
      await tick(); __morphFrame(2200); __morphFrame(3000);
      assert(!overviewChartState.anim,'done');
      assert(el('allTradesBody').children.length===4,'4 rows');
      assert(el('chartSvg').querySelectorAll('.chart-hit-area').length===4,'4 hits');
      const fin=el('chartLinePath').getAttribute('d');
      renderChartUncached(lastChartData,{drawIn:false});
      assert(el('chartLinePath').getAttribute('d')===fin,'end state correct after interruption');
      __restoreRAF();
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
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  } finally {
    if (ws) ws.close();
    if (browser) { browser.kill(); await sleep(700); }
    server.closeAllConnections(); server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
