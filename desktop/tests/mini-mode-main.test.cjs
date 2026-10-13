'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup({ maximized = false, fullscreen = false } = {}) {
  const events = {}, handlers = {}, sent = [];
  const normal = { x: 100, y: 80, width: 1200, height: 800 };
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  let bounds = { ...(maximized || fullscreen ? area : normal) }, pinned = false, visible = true;
  const motionCalls = [];
  const window = {
    isDestroyed: () => false, getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...(maximized || fullscreen ? normal : bounds) }),
    isMaximized: () => maximized, isFullScreen: () => fullscreen, isMinimized: () => false,
    unmaximize: () => { maximized = false; }, maximize: () => { maximized = true; visible = true; },
    setFullScreen: on => { fullscreen = on; }, setMinimumSize() {},
    setBounds: b => { bounds = { ...b }; }, setAlwaysOnTop: on => { pinned = on; },
    getContentSize: () => [bounds.width, bounds.height],
    isVisible: () => visible, show() { visible = true; }, hide() { visible = false; }, focus() {},
  };
  const frame = { url: 'https://retocker.web.app/' };
  const contents = { mainFrame: frame, focus() {}, send: (...args) => sent.push(args) };
  const view = { webContents: { ...contents, isDestroyed: () => false }, setBounds() {} };
  const motion = {
    async move(target, animate) { motionCalls.push({ target, animate }); window.setBounds(target); return true; },
    cancel() {},
  };
  const context = {
    require(name) {
      if (name === 'electron') return {
        app: { requestSingleInstanceLock: () => true, on: (key, cb) => { events[key] = cb; },
          whenReady: () => ({ then() {} }), setAppUserModelId() {}, getPath: () => '/test' },
        ipcMain: { handle: (key, cb) => { handlers[key] = cb; } },
        screen: { getDisplayMatching: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area }) },
        globalShortcut: {}, dialog: {},
      };
      if (name === 'electron-updater') return { autoUpdater: {} };
      if (name === './window-motion') return { createWindowMotion: () => motion };
      if (name === './mini-shortcut') return { LABEL: 'Ctrl + Shift + Ё', createMiniShortcut: () => ({ dispose() {} }) };
      if (name === 'fs') return { writeFileSync() {}, readFileSync() { throw Error('no state'); }, rmSync() {} };
      return require(name);
    },
    __dirname: path.resolve(__dirname, '..'), URL, console, setInterval, clearInterval, setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') +
    '\nglobalThis.testApi = { setMiniMode, requestMode, showWindow, configure(w,v){win=w;view=v;miniReady=true;}, state(){return {miniMode,miniPinned};} };', context);
  context.testApi.configure(window, view);
  return { api: context.testApi, window, view, handlers, sent, motionCalls,
    bounds: () => bounds, pinned: () => pinned,
    maximized: () => maximized, fullscreen: () => fullscreen };
}

test('same window toggles both ways while preserving the original restore bounds', async () => {
  const s = setup(), original = s.bounds();
  assert.equal((await s.api.setMiniMode(true)).mini, true);
  assert.equal(s.bounds().width, 420); assert.equal(s.pinned(), true);
  assert.equal((await s.api.setMiniMode(false)).mini, false);
  assert.equal(s.pinned(), false);
  assert.deepEqual(s.bounds(), original);
  assert.equal(s.motionCalls.length, 2);
});
test('maximized full window restores its maximized state', async () => {
  const s = setup({ maximized: true });
  await s.api.setMiniMode(true); assert.equal(s.maximized(), false);
  await s.api.setMiniMode(false); assert.equal(s.maximized(), true);
  assert.deepEqual(s.bounds(), { x: 100, y: 80, width: 1200, height: 800 });
});
test('fullscreen state is restored after leaving mini mode', async () => {
  const s = setup({ fullscreen: true });
  await s.api.setMiniMode(true); assert.equal(s.fullscreen(), false);
  await s.api.setMiniMode(false); assert.equal(s.fullscreen(), true);
});
test('trusted renderer can disable animation; foreign IPC cannot change the mode', async () => {
  const s = setup(), handler = s.handlers['syter:mini-mode'];
  const trusted = { sender: s.view.webContents, senderFrame: s.view.webContents.mainFrame };
  assert.equal(handler({ sender: {}, senderFrame: {} }, true, true), null);
  assert.equal(handler(trusted, true, 'false'), null);
  assert.equal((await handler(trusted, true, false)).mini, true);
  assert.equal(s.motionCalls[0].animate, false);
});
test('request only sends a mode command: it does not reload or replace the page', () => {
  const s = setup();
  s.api.requestMode(true);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0], ['syter:mode-request', true]);
  assert.equal(s.api.state().miniMode, false);
});
test('repeated requests for the already-active mode do not resize again', async () => {
  const s = setup();
  await s.api.setMiniMode(true); await s.api.setMiniMode(true);
  assert.equal(s.motionCalls.length, 1);
});
test('mini size and position are remembered separately from the full journal', async () => {
  const s = setup(), original = s.bounds();
  await s.api.setMiniMode(true);
  const moved = { x: 300, y: 150, width: 460, height: 760 };
  s.window.setBounds(moved);
  await s.api.setMiniMode(false);
  assert.deepEqual(s.bounds(), original);
  await s.api.setMiniMode(true);
  assert.deepEqual(s.bounds(), moved);
});
test('hiding during exit does not reopen a maximized window; next request restores it', async () => {
  const s = setup({ maximized: true });
  await s.api.setMiniMode(true);
  const exiting = s.api.setMiniMode(false);
  s.window.hide();
  await exiting;
  assert.equal(s.window.isVisible(), false);
  assert.equal(s.maximized(), false);
  s.api.showWindow();
  assert.equal(s.window.isVisible(), true);
  assert.equal(s.maximized(), true);
});