'use strict';
// Geometry/startup checks, NOT evidence of smooth manual dragging.
const { app, BrowserWindow, session, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const diagnostics = require('../resize-diagnostics');
if (!process.argv.includes('--probe-child')) {
  const cases = diagnostics.MODES.map(([mode]) => [mode, false]).concat([['overlay-off', true]]);
  for (const [mode, software] of cases) {
    const result = spawnSync(process.execPath, [
      __filename, '--probe-child', diagnostics.PREFIX + mode,
      ...(software ? [diagnostics.SOFTWARE_FLAG] : []),
    ], { encoding: 'utf8', timeout: 30000, windowsHide: false });
    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.error || result.status !== 0) {
      console.error(result.error || 'Probe failed: ' + mode); app.exit(1);
      break;
    }
  }
  app.exit(0);
} else {
  const mode = diagnostics.readProbe();
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'syter-probe-')));
  app.whenReady().then(() => {
    session.defaultSession.protocol.handle('https', () => new Response(
      '<style>body{background:#17191d;color:white}@keyframes move{to{transform:translateX(100px)}}' +
      '#moving{animation:move 1s linear infinite}</style><input id="draft" value="test draft">' +
      '<div id="moving">Resize fixture</div>',
      { headers: { 'content-type': 'text/html' } }));
  });
  require('../main');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  app.whenReady().then(async () => {
    let host, site;
    for (let attempt = 0; attempt < 150; attempt++) {
      site = webContents.getAllWebContents().find(wc => wc.getURL() === 'https://retocker.web.app/');
      host = BrowserWindow.getAllWindows().find(win => mode === 'single-surface'
        ? win.webContents.getURL() === 'https://retocker.web.app/'
        : win.webContents.getURL().endsWith('/titlebar.html'));
      if (host?.isVisible() && site && !site.isLoading()) break;
      await wait(50);
    }
    console.log('PROBE STARTUP:', JSON.stringify({ mode, argv: process.argv,
      windows: BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), visible: win.isVisible(), bounds: win.getBounds() })),
      contents: webContents.getAllWebContents().map(wc => ({ url: wc.getURL(), loading: wc.isLoading() })),
    }));
    assert.ok(host?.isVisible() && site, 'probe host and local fixture are visible');
    await wait(500);
    const software = process.argv.includes(diagnostics.SOFTWARE_FLAG);
    const graphics = app.getGPUFeatureStatus();
    console.log('PROBE GPU:', JSON.stringify({ mode, software, graphics }));
    if (software) assert.ok(!graphics.gpu_compositing.startsWith('enabled'),
      'explicit software test disables GPU compositing');
    const windows = BrowserWindow.getAllWindows();
    assert.equal(windows.length, mode === 'baseline' ? 2 : 1,
      'only baseline retains the transition compositor');
    const children = host.contentView.children;
    assert.equal(children.length, mode === 'single-surface' ? 0 : 1);
    for (const [width, height] of [[800, 650], [560, 580], [960, 710]]) {
      host.setSize(width, height); await wait(80);
      const content = host.getContentSize();
      if (children.length) {
        const top = mode === 'native-frame' ? 0 : 36;
        assert.deepEqual(children[0].getBounds(),
          { x: 0, y: top, width: content[0], height: content[1] - top });
      } else {
        const viewport = await site.executeJavaScript('({width:innerWidth,height:innerHeight})');
        assert.equal(viewport.width, content[0]); assert.equal(viewport.height, content[1]);
      }
      assert.equal(await site.executeJavaScript('document.querySelector("#draft").value'), 'test draft');
    }
    console.log('PASS probe ' + mode + ' software=' + software + ': correct window count, geometry and draft.');
    app.exit(0);
  }).catch(error => { console.error(error.stack || error); app.exit(1); });
}