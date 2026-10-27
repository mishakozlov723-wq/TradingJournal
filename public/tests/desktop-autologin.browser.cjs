// Desktop-only animated auto sign-in (v3.45.0). Runs the real index.html + app.js + desktop-autologin.js
// in Chromium with a Firestore/Auth double and a fake Electron preload (window.syterDesktop).
// Run: node public/tests/desktop-autologin.browser.cjs   (CHROMIUM_PATH=/usr/local/bin/chromium if needed)
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const legacy = fs.readFileSync(path.join(__dirname, 'trading-models.test.cjs'), 'utf8');
const stub = legacy.slice(legacy.indexOf('function installFirestoreDouble()'), legacy.indexOf("test('all application"));

function authDouble() {
  const database=firebase.firestore(),collection=database.collection.bind(database);
  database.collection=name=>{const c=collection(name),where=c.where;c.where=(...args)=>{const q=where(...args);q.onSnapshot=(next,error)=>{let active=true;q.get().then(s=>{if(active)next(s)},e=>{if(active&&error)error(e)});return ()=>{active=false}};return q};return c};
  const seed = window.__authSeed; // { email } = session still stored from the last manual sign-in
  const listeners = [];
  const auth = {
    currentUser: seed ? { uid: 'uid-1', email: seed.email } : null,
    calls: [],
    onAuthStateChanged(cb) { setTimeout(() => cb(auth.currentUser), 30); return () => {}; },
    signInWithEmailAndPassword(email, pass) { auth.calls.push({ email, pass }); auth.currentUser = { uid: 'uid-1', email }; return Promise.resolve({ user: auth.currentUser }); },
    signOut() { auth.currentUser = null; return Promise.resolve(); },
  };
  window.__auth = auth;
  firebase.auth = () => auth;
}
let html = require('./assembled-html.cjs')().replace(/<script\b[^>]*src="https:[^"]+"[^>]*><\/script>/g, '')
  .replace('<script>', '<script>' + stub + 'installFirestoreDouble();(' + authDouble.toString() + ')();</script><script>');
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  const f = path.join(root, p);
  if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return res.end(fs.readFileSync(f)); }
  res.statusCode = 404; res.end();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(browser, url, { desktop, remember, seedEmail }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ desktop, remember, seedEmail }) => {
    window.__authSeed = seedEmail ? { email: seedEmail } : null;
    window.__remembered = [];
    if (desktop) window.syterDesktop = {
      isDesktop: true,
      getRemember: () => Promise.resolve(remember),
      rememberLogin: (l) => { window.__remembered.push(l); return Promise.resolve(true); },
      forgetLogin: () => Promise.resolve(true),
    };
  }, { desktop, remember, seedEmail });
  await page.goto(url);
  return { page, errors };
}
const VALID = { valid: true, login: 'retocker', remainingMs: 3600000 };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium', args: ['--no-sandbox'] });
  const results = [];
  const ok = (name) => { results.push(name); console.log('ok -', name); };
  try {
    // A. valid remember + stored session -> animated sign-in, reusing the session
    {
      const { page, errors } = await open(browser, url, { desktop: true, remember: VALID, seedEmail: 'retocker@journal.local' });
      const samples = [], t0 = Date.now();
      let eyeHiddenSeen = false, enteredAt = 0;
      while (Date.now() - t0 < 12000) {
        const s = await page.evaluate(() => ({
          u: document.getElementById('loginUserInput').value, p: document.getElementById('loginPassInput').value.length,
          eye: getComputedStyle(document.getElementById('loginPassEyeHold')).display,
          type: document.getElementById('loginPassInput').type,
          app: getComputedStyle(document.getElementById('appRoot')).display,
        }));
        s.t = Date.now() - t0; samples.push(s);
        if (s.u && s.eye === 'none') eyeHiddenSeen = true;
        if (s.app === 'block') { enteredAt = s.t; break; }
        await sleep(15);
      }
      assert(enteredAt, 'app was entered automatically');
      const typed = samples.filter((s) => s.u.length > 0 && s.u.length <= 8);
      assert(samples.some((s) => s.u === 'retocker'), 'login typed in full');
      assert(samples.some((s) => s.u.length > 0 && s.u.length < 8), 'login typed gradually');
      assert(samples.some((s) => s.p > 0 && s.p < 9), 'password dots appear gradually');
      assert(samples.some((s) => s.p >= 9 && s.type === 'password'), 'dots stay masked (type=password)');
      assert(eyeHiddenSeen, 'eye icon hidden during the animation');
      const calls = await page.evaluate(() => window.__auth.calls.length);
      assert.equal(calls, 0, 'no password sign-in: stored session reused');
      assert.equal(await page.evaluate(() => window.__remembered.length), 0, 'resume does not restart the 6h timer');
      // pacing: average time per login character should be inside 60-100 ms (+ polling slack)
      const changes = []; let last = ''; samples.forEach((s) => { if (s.u !== last) { changes.push(s.t); last = s.u; } });
      const gaps = changes.slice(2, 8).map((t, i, a) => i ? t - a[i - 1] : null).slice(1);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      assert(avg > 55 && avg < 125, 'typing pace ~60-100ms/char, got ' + avg.toFixed(0));
      assert.deepEqual(errors, [], 'no page errors: ' + errors.join('|'));
      await page.close(); ok('A animated auto sign-in (avg ' + avg.toFixed(0) + ' ms/char)');
    }
    // B. remember expired -> nothing happens, manual sign-in
    {
      const { page, errors } = await open(browser, url, { desktop: true, remember: { valid: false, login: '', remainingMs: 0 }, seedEmail: 'retocker@journal.local' });
      await sleep(2500);
      const s = await page.evaluate(() => ({ u: document.getElementById('loginUserInput').value, eye: getComputedStyle(document.getElementById('loginPassEyeHold')).display }));
      assert.equal(s.u, ''); assert.notEqual(s.eye, 'none'); assert.deepEqual(errors, []);
      await page.close(); ok('B expired timer: no animation, eye visible');
    }
    // C. valid remember but another user's stored session -> no animation
    {
      const { page } = await open(browser, url, { desktop: true, remember: VALID, seedEmail: 'someone@journal.local' });
      await sleep(2500);
      assert.equal(await page.evaluate(() => document.getElementById('loginUserInput').value), '');
      await page.close(); ok('C mismatching session: no animation');
    }
    // D. manual sign-in in the desktop app starts the timer
    {
      const { page, errors } = await open(browser, url, { desktop: true, remember: { valid: false, login: '', remainingMs: 0 }, seedEmail: null });
      await page.fill('#loginUserInput', 'retocker'); await page.fill('#loginPassInput', 'secret1');
      await page.click('#loginSubmitBtn');
      await page.waitForFunction(() => window.__remembered.length === 1, null, { timeout: 8000 });
      assert.deepEqual(await page.evaluate(() => window.__remembered), ['retocker']);
      const c = await page.evaluate(() => window.__auth.calls);
      assert.equal(c.length, 1); assert.equal(c[0].pass, 'secret1');
      assert.deepEqual(errors, []);
      await page.close(); ok('D manual sign-in: real sign-in + rememberLogin("retocker")');
    }
    // E. user touches the screen mid-animation -> cancelled, fields cleared, no sign-in
    {
      const { page } = await open(browser, url, { desktop: true, remember: VALID, seedEmail: 'retocker@journal.local' });
      await page.waitForFunction(() => document.getElementById('loginUserInput').value.length >= 3, null, { timeout: 5000 });
      await page.keyboard.press('a');
      await sleep(2500);
      const s = await page.evaluate(() => ({ u: document.getElementById('loginUserInput').value, p: document.getElementById('loginPassInput').value, app: getComputedStyle(document.getElementById('appRoot')).display, calls: window.__auth.calls.length, eye: getComputedStyle(document.getElementById('loginPassEyeHold')).display }));
      assert.equal(s.calls, 0); assert.notEqual(s.app, 'block'); assert.equal(s.p, ''); assert.notEqual(s.eye, 'none');
      await page.close(); ok('E cancel on user input');
    }
    // F. regular browser (no syterDesktop): untouched
    {
      const { page, errors } = await open(browser, url, { desktop: false, remember: null, seedEmail: 'retocker@journal.local' });
      await sleep(2500);
      assert.equal(await page.evaluate(() => document.getElementById('loginUserInput').value), '');
      assert.deepEqual(errors, []);
      await page.close(); ok('F browser version unchanged');
    }
  } finally { await browser.close(); server.close(); }
  console.log('\n' + results.length + '/6 passed');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
