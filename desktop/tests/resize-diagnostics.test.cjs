'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const diagnostics = require('../resize-diagnostics');
test('only explicit known probe flags select a diagnostic mode', () => {
  assert.equal(diagnostics.readProbe(['SYTER.exe']), 'baseline');
  for (const [mode] of diagnostics.MODES)
    assert.equal(diagnostics.readProbe(['SYTER.exe', diagnostics.PREFIX + mode]), mode);
  assert.equal(diagnostics.readProbe(['SYTER.exe', diagnostics.PREFIX + 'unknown']), 'baseline');
});
test('probe switching replaces only its own flag and preserves other launch arguments', () => {
  assert.deepEqual(diagnostics.relaunchArgs(['SYTER.exe', '--other', diagnostics.PREFIX + 'overlay-off'], 'native-frame'),
    ['--other', diagnostics.PREFIX + 'native-frame']);
  assert.throws(() => diagnostics.relaunchArgs(['SYTER.exe'], 'unknown'));
});
test('GPU switching preserves the selected shell and removes stale software flags', () => {
  const argv = ['SYTER.exe', diagnostics.PREFIX + 'overlay-off', '--other'];
  assert.deepEqual(diagnostics.gpuArgs(argv, true),
    [diagnostics.PREFIX + 'overlay-off', '--other', diagnostics.SOFTWARE_FLAG]);
  assert.deepEqual(diagnostics.gpuArgs(argv.concat(diagnostics.SOFTWARE_FLAG), false),
    [diagnostics.PREFIX + 'overlay-off', '--other']);
  assert.ok(diagnostics.relaunchArgs(argv.concat(diagnostics.SOFTWARE_FLAG), 'native-frame')
    .includes(diagnostics.SOFTWARE_FLAG));
});
test('software experiment calls Electron hardware-disable API only when explicitly requested', () => {
  let calls = 0;
  const app = { disableHardwareAcceleration() { calls++; } };
  assert.equal(diagnostics.configureGpu(app, ['SYTER.exe']), false);
  assert.equal(calls, 0);
  assert.equal(diagnostics.configureGpu(app, ['SYTER.exe', diagnostics.SOFTWARE_FLAG]), true);
  assert.equal(calls, 1);
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.ok(source.indexOf('diagnostics.configureGpu(app)') < source.indexOf('app.whenReady()'));
});
test('single-surface probe uses a native window without a child view or exposed desktop bridge', () => {
  let options, loaded, handlers = 0;
  const events = {};
  class Window {
    constructor(value) { options = value; this.webContents = { on: (name, cb) => { events[name] = cb; } }; }
    once() {}
    loadURL(url) { loaded = url; return Promise.resolve(); }
  }
  diagnostics.createSingleSurfaceWindow({ BrowserWindow: Window, icon: 'icon.png',
    url: 'https://retocker.web.app/', installLinkHandlers: () => { handlers++; } });
  assert.equal(loaded, 'https://retocker.web.app/');
  assert.equal(handlers, 1);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.preload, undefined);
  assert.equal(options.titleBarStyle, undefined);
});
test('production build retains normal acceleration and auto-update wiring, not diagnostic-only switches', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.ok(source.includes('autoUpdater'));
  assert.ok(!source.includes('PROBE_NO_COVER'));
  assert.ok(!source.includes('RESIZE_PROBE'));
  assert.ok(!source.includes('Auto-updates disabled in this diagnostic-only build'));
});
