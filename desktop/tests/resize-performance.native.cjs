'use strict';
// Real Windows border drags, not just setSize(). Local fixture, no user account.
const { app, BrowserWindow, WebContentsView, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const { createViewLayout } = require('../view-layout');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'syter-resize-')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Resize test timed out'); app.exit(1); }, 45000);
function drag(bounds, delta) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      path.join(__dirname, 'drag-window-border.ps1'),
      '-X', String(bounds.x + bounds.width - 2), '-Y', String(bounds.y + Math.floor(bounds.height / 2)),
      '-Delta', String(delta)], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(error || 'Border drag failed: ' + code)));
  });
}
app.whenReady().then(async () => {
  assert.equal(process.platform, 'win32');
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ x: area.x + 30, y: area.y + 30,
    width: Math.min(900, area.width - 60), height: Math.min(700, area.height - 60),
    minWidth: 380, minHeight: 480, show: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#cfd6e4', height: 36 } });
  const view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.contentView.addChildView(view);
  const layout = createViewLayout({ getWindow: () => win, getView: () => view });
  let willResize = 0, resize = 0, submitted = 0, preAligned = 0;
  const setBounds = view.setBounds.bind(view);
  view.setBounds = bounds => { submitted++; return setBounds(bounds); };
  win.on('will-resize', (_event, bounds) => {
    willResize++;
    layout.beforeResize(bounds);
    const outer = win.getBounds(), size = win.getContentSize(), child = view.getBounds();
    if (child.width === bounds.width - (outer.width - size[0]) &&
        child.height === Math.max(0, bounds.height - (outer.height - size[1]) - 36)) preAligned++;
  });
  win.on('resize', () => { resize++; layout.layout(); });
  layout.layout();
  await win.loadURL('data:text/html,<body style="margin:0;background:black"></body>');
  const wc = view.webContents;
  await wc.loadURL('data:text/html,' + encodeURIComponent(`<style>
    body{margin:0;background:#111;color:white}
    @keyframes drift{from{transform:translateX(0)}to{transform:translateX(200px)}}
    .particle,.chart{animation:drift 10s linear infinite;width:10px;height:10px;background:red}
    </style><input id="draft" value="unsaved trade">
    <div id="scroll" style="height:80px;overflow:auto"><div style="height:1000px">Journal</div></div>
    <div id="appParticles"><div class="particle"></div></div><div class="chart"></div>
    <script>
    window.resizeSamples=[];window.watchResize=false;
    function sample(t){if(watchResize)resizeSamples.push({t,width:innerWidth,
      particle:getComputedStyle(document.querySelector('.particle')).animationPlayState});
      requestAnimationFrame(sample);}
    requestAnimationFrame(sample);
    </script>`));
  win.show(); win.focus(); await wait(300);
  await wc.executeJavaScript(`document.querySelector('#scroll').scrollTop=140;document.querySelector('#draft').focus();`);
  const snapshot = () => wc.executeJavaScript(`({
    resizing:document.documentElement.classList.contains('syter-window-resizing'),
    particle:getComputedStyle(document.querySelector('.particle')).animationPlayState,
    chart:getComputedStyle(document.querySelector('.chart')).animationPlayState,
    draft:document.querySelector('#draft').value,scroll:document.querySelector('#scroll').scrollTop,
    focus:document.activeElement.id,phase:document.querySelector('.particle').getAnimations()[0].currentTime})`);
  const start = await snapshot();
  for (const delta of [-160, 160]) {
    const before = win.getBounds(), eventsBefore = willResize;
    await wc.executeJavaScript('window.watchResize=true');
    await drag(before, delta);
    await wc.executeJavaScript('window.watchResize=false');
    await wait(120);
    assert.ok(willResize > eventsBefore, 'real mouse drag must emit will-resize (setSize does not)');
    const change = win.getBounds().width - before.width;
    assert.ok(delta < 0 ? change < -80 : change > 80, 'real window border must actually move');
    const state = await snapshot();
    assert.equal(state.resizing, false); assert.equal(state.particle, 'running');
    assert.equal(state.chart, 'running'); assert.equal(state.draft, 'unsaved trade');
    assert.equal(state.scroll, 140); assert.equal(state.focus, 'draft');
    assert.equal(view.getBounds().width, win.getContentSize()[0]);
    assert.equal(view.getBounds().height, win.getContentSize()[1] - 36);
  }
  const samples = await wc.executeJavaScript('window.resizeSamples');
  assert.ok(samples.length > 3, 'renderer must produce animation samples during border drags');
  assert.ok(samples.every(sample => sample.particle === 'running'), 'no deliberate particle pause while dragging');
  assert.ok(new Set(samples.map(sample => sample.width)).size > 2, 'renderer must see intermediate live widths');
  assert.equal(preAligned, willResize, 'child must be pre-sized on every native will-resize event');
  assert.ok((await snapshot()).phase > start.phase, 'animation timeline must continue');
  const count = willResize;
  win.setSize(760, 600); await wait(120); layout.layout();
  assert.equal(willResize, count);
  assert.equal(view.getBounds().width, win.getContentSize()[0]);
  const gaps = samples.slice(1).map((sample, i) => sample.t - samples[i].t);
  // CI fixture counters are not a benchmark of the user's real journal or GPU.
  const report = { willResize, resize, submitted, preAligned, samples: samples.length,
    largestSampleGapMs: Math.max(...gaps), fixtureOnly: true, samplesDuringDrag: samples };
  const out = path.resolve(__dirname, '../test-artifacts'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'native-resize-report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: real Windows border drags; early child sizing; animation running; draft/focus/scroll preserved.');
  console.log('RESIZE COUNTERS:', JSON.stringify({ ...report, samplesDuringDrag: undefined }));
  clearTimeout(deadline); win.destroy(); app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
