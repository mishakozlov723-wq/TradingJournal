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
  let bounds = { ...(maximized || fullscreen ? area : normal) }, pinned = false, pinLevel, visible = true, focused=true;
  const presentationCalls=[], listeners={};
  let restoreBounds={...normal};
  const motionCalls = [], nativeCalls = [], prepareCalls = [];
  let maximizable = true, fullscreenable = true;
  const window = {
    isDestroyed: () => false, getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...(maximized || fullscreen ? restoreBounds : bounds) }),
    on: (event,cb) => { (listeners[event] ||= []).push(cb); },
    isMaximized: () => maximized, isFullScreen: () => fullscreen, isMinimized: () => false,
    unmaximize: () => { maximized=false;bounds={...restoreBounds};for(const cb of listeners.unmaximize||[])cb(); },
    maximize: () => { nativeCalls.push({kind:'maximize',bounds:{...bounds}});restoreBounds={...bounds};maximized=true;visible=true;bounds={...area}; },
    setFullScreen: on => { nativeCalls.push({kind:'fullscreen',on,bounds:{...bounds}});if(on){restoreBounds={...bounds};fullscreen=true;bounds={...area};}else{fullscreen=false;bounds={...restoreBounds};for(const cb of listeners['leave-full-screen']||[])cb();} },
    setMaximizable: on => { maximizable = on; }, setFullScreenable: on => { fullscreenable = on; },
    setMinimumSize: (width, height) => { nativeCalls.push({kind:'minimum',width,height,bounds:{...bounds}}); },
    setBounds: b => { nativeCalls.push({kind:"bounds",bounds:{...b}}); bounds = { ...b }; }, setAlwaysOnTop: (on, level) => { pinned = on; pinLevel = level; },
    getContentSize: () => [bounds.width, bounds.height],
    isVisible: () => visible, isFocused:()=>focused,
    show() { visible = true;presentationCalls.push('show'); }, hide() { visible = false; },
    focus() {focused=true;presentationCalls.push('focus');},
  };
  const frame = { url: 'https://retocker.web.app/' };
  const contents = { mainFrame: frame, focus() {}, send: (...args) => sent.push(args) };
  const view = { webContents: { ...contents, isDestroyed: () => false }, setBounds() {} };
  const motion = {
    async prepare(target, animate) { prepareCalls.push({target,animate});return animate; },
    async move(target, animate, apply) { motionCalls.push({ target, animate }); if (apply) apply(); else window.setBounds(target); return true; },
    cancel() {},
  };
  const context = {
    require(name) {
      if (name === 'electron') return {
        app: { requestSingleInstanceLock: () => true, on: (key, cb) => { events[key] = cb; },
          whenReady: () => ({ then() {} }), setAppUserModelId() {}, getPath: () => '/test' },
        ipcMain: { handle: (key, cb) => { handlers[key] = cb; } },
        screen: { getDisplayMatching: () => ({ workArea: area, bounds: area }), getPrimaryDisplay: () => ({ workArea: area }) },
        globalShortcut: {}, dialog: {},
      };
      if (name === 'electron-updater') return { autoUpdater: {} };
      if (name === './interface-preview-shortcut') return require('../interface-preview-shortcut');
      if (name === './view-layout') return require('../view-layout');
      if (name === './window-bounds') return require('../window-bounds');
      if (name === './window-width-policy') return require('../window-width-policy');
      if (name === './return-compositor') return require('../return-compositor');
      if (name === './window-motion') return { createWindowMotion: () => motion };
      if (name === './cover-presentation') return require('../cover-presentation');
      if (name === './tray-menu') return require('../tray-menu');
      if (name === './mini-shortcut') return { LABEL: 'Ctrl + Shift + Ё', createMiniShortcut: () => ({ dispose() {} }) };
      if (name === 'fs') return { writeFileSync() {}, readFileSync() { throw Error('no state'); }, rmSync() {} };
      return require(name);
    },
    __dirname: path.resolve(__dirname, '..'), URL, console, setInterval, clearInterval, setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') +
    '\nglobalThis.testApi = { setMiniMode, prepareMiniMode, requestMode, showWindow, configure(w,v){win=w;view=v;miniReady=true;if(typeof installNormalBoundsRestore==="function")installNormalBoundsRestore(w);}, state(){return {miniMode,miniPinned};} };', context);
  context.testApi.configure(window, view);
  return { api: context.testApi, window, view, handlers, sent, motionCalls,presentationCalls,prepareCalls,
    blur:()=>{focused=false;},
    bounds: () => bounds, pinned: () => pinned, pinLevel: () => pinLevel, nativeCalls,
    maximizable:()=>maximizable, fullscreenable:()=>fullscreenable,
    maximized: () => maximized, fullscreen: () => fullscreen };
}

test('same window toggles both ways while preserving the original restore bounds', async () => {
  const s = setup(), original = s.bounds();
  assert.equal((await s.api.setMiniMode(true)).mini, true);
  assert.equal(s.bounds().width, 420); assert.equal(s.pinned(), true);
  // 'floating' (the default) is placed behind the taskbar and can lose topmost.
  assert.equal(s.pinLevel(), 'pop-up-menu');
  assert.equal((await s.api.setMiniMode(false)).mini, false);
  assert.equal(s.pinned(), false);
  assert.deepEqual(s.bounds(), original);
  assert.equal(s.motionCalls.length, 2);
});
test('maximized full window restores its maximized state', async () => {
  const s = setup({ maximized: true });
  await s.api.setMiniMode(true); assert.equal(s.maximized(), false);
  await s.api.setMiniMode(false); assert.equal(s.maximized(), true);
  s.window.unmaximize();
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
  assert.deepEqual(s.presentationCalls,[],'focused visible journal must not be shown/focused again');
});
test('a hidden or background journal is still restored by the global mode request',()=>{
 for(const action of ['hide','blur']){
   const s=setup();if(action==='hide')s.window.hide();else s.blur();
   s.api.requestMode(true);assert.deepEqual(s.presentationCalls,['show','focus']);
   assert.equal(s.window.isVisible(),true);assert.equal(s.sent.length,1);
 }
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
  s.api.showWindow();
  assert.equal(s.window.isVisible(), true);
  assert.equal(s.maximized(), true);
});

test('exit positions the full window BEFORE applying the full minimum width', async () => {
  const s=setup();
  await s.api.setMiniMode(true);
  const originalMini={...s.bounds()};s.nativeCalls.length=0;
  await s.api.setMiniMode(false);
  const floor=s.nativeCalls.find(call=>call.kind==='minimum'&&call.width>originalMini.width);
  assert.ok(floor,'full tracking limit restored');
  assert.ok(floor.bounds.width>=floor.width,'never enforce the full minimum on the live compact window');
  assert.equal(s.nativeCalls[0].kind,'bounds','the first geometry operation is the saved full rectangle');
});
test('mini blocks maximize/fullscreen but full mode restores both capabilities', async () => {
  const s=setup();await s.api.setMiniMode(true);
  assert.equal(s.maximizable(),false);assert.equal(s.fullscreenable(),false);
  await s.api.setMiniMode(false);
  assert.equal(s.maximizable(),true);assert.equal(s.fullscreenable(),true);
});

for (const position of [{x:1500,y:10},{x:0,y:300},{x:700,y:180}]) {
 test('maximized expansion starts exactly at moved mini '+JSON.stringify(position),async()=>{
  const s=setup({maximized:true});await s.api.setMiniMode(true);
  const source={...position,width:420,height:730};s.window.setBounds(source);s.nativeCalls.length=0;
  await s.api.setMiniMode(false);
  const expansion=s.nativeCalls.find(c=>c.kind==='maximize');
  assert.ok(expansion);assert.deepEqual(expansion.bounds,source,'native expansion source must be the current mini rectangle');
  assert.equal(s.nativeCalls.filter(c=>c.kind==='bounds').length,0,'no preposition to the saved normal rectangle');
  s.window.unmaximize();assert.deepEqual(s.bounds(),{x:100,y:80,width:1200,height:800});
 });
}
test('repeated maximized cycles keep the original full normal rectangle',async()=>{
 const s=setup({maximized:true});
 for(let i=0;i<5;i++){await s.api.setMiniMode(true);s.window.setBounds({x:100+i*100,y:30,width:420,height:730});await s.api.setMiniMode(false);}
 s.window.unmaximize();assert.deepEqual(s.bounds(),{x:100,y:80,width:1200,height:800});
});
test('fullscreen expansion starts at the mini rectangle without preposition',async()=>{
 const s=setup({fullscreen:true});await s.api.setMiniMode(true);
 const source={x:1300,y:100,width:420,height:730};s.window.setBounds(source);s.nativeCalls.length=0;
 await s.api.setMiniMode(false);
 assert.deepEqual(s.nativeCalls.find(c=>c.kind==='fullscreen'&&c.on).bounds,source);
 assert.equal(s.nativeCalls.filter(c=>c.kind==='bounds').length,0);
 s.window.setFullScreen(false);assert.deepEqual(s.bounds(),{x:100,y:80,width:1200,height:800});
});

test('both directions prepare and play the SAME verified animation',async()=>{
 const s=setup({maximized:true});
 for(let i=0;i<3;i++){
  await s.api.prepareMiniMode(true);await s.api.setMiniMode(true);
  await s.api.prepareMiniMode(false);await s.api.setMiniMode(false);
 }
 assert.equal(s.prepareCalls.length,6);assert.equal(s.motionCalls.length,6);
 assert.ok(s.prepareCalls.every(c=>c.animate===true),'source snapshot animation must not be disabled inbound');
 assert.ok(s.motionCalls.every(c=>c.animate===true),'neither direction may silently fall back to instant bounds');
});
test('reduced-motion flag disables animation equally in both directions',async()=>{
 const s=setup();await s.api.prepareMiniMode(true,false);await s.api.setMiniMode(true,false);
 await s.api.prepareMiniMode(false,false);await s.api.setMiniMode(false,false);
 assert.ok(s.prepareCalls.every(c=>c.animate===false));assert.ok(s.motionCalls.every(c=>c.animate===false));
});
