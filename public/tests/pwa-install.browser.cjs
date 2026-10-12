// PWA: manifest + service worker make the site installable; nothing is cached.
const {server,chromium}=require('./models-full-harness.cjs');
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://localhost:'+server.address().port+'/';
  // persistent profile: a normal (non-incognito) window, like a real user
  const dir=require('fs').mkdtempSync(require('os').tmpdir()+'/tj-pwa-');
  const ctx=await chromium.launchPersistentContext(dir,{executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',headless:true,args:['--no-sandbox'],viewport:{width:1280,height:900}});
  const browser=ctx;
  const page=ctx.pages()[0]||await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=r.request().url();return (u.startsWith(url.slice(0,-1))||u.startsWith('http://127.0.0.1'))?r.continue():r.abort();});
  await page.goto(url);
  await page.waitForFunction(()=>typeof window.openModal==='function');
  // the page only auto-registers on https; register the same file here
  const reg=await page.evaluate(async()=>{const r=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;return r.scope;});
  ok(/\/$/.test(reg),'service worker registered for the whole site ('+reg+')');
  await page.reload();await page.waitForFunction(()=>typeof window.openModal==='function');
  ok(await page.evaluate(()=>!!navigator.serviceWorker.controller),'service worker controls the page');
  const cdp=await ctx.newCDPSession(page);
  const man=await cdp.send('Page.getAppManifest');
  ok(!man.errors||!man.errors.length,'manifest parses without errors '+JSON.stringify(man.errors||[]));
  let inst;try{inst=await cdp.send('Page.getInstallabilityErrors');}catch(e){inst={err:e.message};}
  console.log('installability: '+JSON.stringify(inst));
  ok(inst.installabilityErrors&&inst.installabilityErrors.length===0,'browser reports the site as installable');
  ok(await page.evaluate(async()=>(await caches.keys()).length===0),'nothing stored in caches');
  // the page still loads normally through the worker
  ok(await page.evaluate(()=>!!document.getElementById('appRoot')),'app loads through the worker');
  // offline: friendly page instead of the browser error
  await ctx.setOffline(true);
  try{await page.goto(url+'?x=1');}catch(e){}
  const off=await page.evaluate(()=>document.body&&document.body.innerText||'');
  ok(/No internet connection/.test(off),'offline: shows a friendly message');
  await ctx.setOffline(false);
  await page.goto(url);await page.waitForFunction(()=>typeof window.openModal==='function');
  ok(true,'back online: journal opens again');
  ok(errors.length===0,'no page errors '+(errors.length?JSON.stringify(errors):''));
  console.log(fails?fails+' FAILED':'ALL PASSED');
  await browser.close();server.close();process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
