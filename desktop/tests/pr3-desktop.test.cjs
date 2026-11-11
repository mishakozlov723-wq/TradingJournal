'use strict';
// PR 3 desktop regressions: window geometry, clipboard capture cost, offline
// recovery, mini-journal streak feedback and scroll state, uninstall cleanup,
// repeated installer launch, release-transition baseline and workflow hygiene.
// Pure Node: no Electron, no Windows APIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
// Windows checkouts may use CRLF; every source assertion uses LF.
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const flush = () => new Promise(resolve => setImmediate(resolve));

// ---------------------------------------------------------------- geometry
const { initialWindowBounds, titleStripReachable } = require('../window-bounds');
const FULL_HD = { x: 0, y: 0, width: 1920, height: 1040 };
const screenOf = (areas, primary = 0) => ({
  getAllDisplays: () => areas.map(workArea => ({ workArea, bounds: workArea })),
  getPrimaryDisplay: () => ({ workArea: areas[primary] }),
});
const bounds = (saved, areas) => initialWindowBounds(saved, screenOf(areas), { titlebarHeight: 36 });

test('saved window rectangle is reused while its title strip is on a connected display', () => {
  const left = { x: -1280, y: 0, width: 1280, height: 984 };
  assert.deepEqual(bounds({ x: 100, y: 80, width: 1200, height: 800 }, [FULL_HD, left]),
    { x: 100, y: 80, width: 1200, height: 800 });
  // A connected monitor with negative coordinates is a valid place.
  assert.deepEqual(bounds({ x: -1200, y: 50, width: 1000, height: 700 }, [FULL_HD, left]),
    { x: -1200, y: 50, width: 1000, height: 700 });
  // Mostly beyond the right edge, but 220 px of the title strip remain draggable.
  assert.deepEqual(bounds({ x: 1700, y: 100, width: 1200, height: 800 }, [FULL_HD]),
    { x: 1700, y: 100, width: 1200, height: 800 });
  assert.equal(titleStripReachable({ x: 0, y: 0, width: 100, height: 30 }, [FULL_HD], 36), true,
    'a small fully visible window is reachable');
});

test('window saved on a disconnected or unreachable display is centered on the primary work area', () => {
  const centered = { x: 360, y: 120, width: 1200, height: 800 };
  assert.deepEqual(bounds({ x: 2500, y: 100, width: 1200, height: 800 }, [FULL_HD]), centered,
    'former monitor on the right was unplugged');
  assert.deepEqual(bounds({ x: 1800, y: 100, width: 1200, height: 800 }, [FULL_HD]), centered,
    'only 120 px of the title strip would remain');
  assert.deepEqual(bounds({ x: 100, y: -200, width: 1200, height: 800 }, [FULL_HD]), centered,
    'title strip above the top edge cannot be dragged');
  assert.deepEqual(bounds({ x: 100, y: 1030, width: 1200, height: 800 }, [FULL_HD]), centered,
    'only 10 px of the title strip above the bottom edge');
});

test('recentered window fits a small work area and keeps the minimum usable size', () => {
  assert.deepEqual(bounds({ x: 3000, y: 0, width: 2560, height: 1400 }, [{ x: 0, y: 0, width: 1366, height: 728 }]),
    { x: 0, y: 0, width: 1366, height: 728 });
  assert.deepEqual(bounds(undefined, [{ x: 60, y: 40, width: 1860, height: 1000 }]),
    { x: 270, y: 90, width: 1440, height: 900 }, 'offset work area (taskbar left/top) is respected');
  assert.deepEqual(bounds({ width: 200, height: 300 }, [FULL_HD]),
    { x: 770, y: 270, width: 380, height: 500 }, 'never below the window minimum');
  assert.deepEqual(bounds({ width: 100, height: 100 }, [{ x: 0, y: 0, width: 300, height: 400 }]),
    { x: 0, y: 0, width: 300, height: 400 }, 'never larger than a tiny work area');
});

test('first launch, corrupt state and missing display information fall back safely', () => {
  assert.deepEqual(bounds(undefined, [FULL_HD]), { x: 240, y: 70, width: 1440, height: 900 });
  assert.deepEqual(bounds({ x: NaN, y: 5, width: -3, height: '800' }, [FULL_HD]), { x: 240, y: 70, width: 1440, height: 900 });
  const broken = { getAllDisplays() { throw Error('no displays'); }, getPrimaryDisplay() { throw Error('no primary'); } };
  assert.deepEqual(initialWindowBounds({ x: 10, y: 10, width: 1000, height: 700 }, broken, { titlebarHeight: 36 }),
    { width: 1000, height: 700 });
  assert.deepEqual(initialWindowBounds(null, null), { width: 1440, height: 900 });
});

test('main window uses the reachable geometry and maximizes only when ready to show', () => {
  const main = read('main.js');
  assert.match(main, /require\('\.\/window-bounds'\)/);
  const start = main.slice(main.indexOf('function start() {'));
  assert.match(start, /initialWindowBounds\(st\.bounds, screen, \{ titlebarHeight: TITLEBAR_H \}\)/);
  const ready = start.indexOf("win.once('ready-to-show'"), maximize = start.indexOf('if (st.maximized) win.maximize();');
  assert.ok(ready > 0 && maximize > ready, 'saved maximized state is applied inside ready-to-show');
  assert.ok(maximize < start.indexOf('win.show();', ready), 'and before the window is shown');
  assert.equal(start.split('if (st.maximized) win.maximize();').length, 2, 'never maximized before the first paint');
  assert.ok(JSON.parse(read('package.json')).build.files.includes('window-bounds.js'), 'packaged');
});

// ---------------------------------------------------------- clipboard capture
function fakeClipboard() {
  const calls = { readImage: 0, bitmap: 0, png: 0 };
  let state = { formats: ['text/plain'], buffer: Buffer.alloc(0), image: null };
  const clipboard = {
    availableFormats: () => state.formats.slice(),
    readBuffer: format => { assert.equal(format, 'PNG'); return state.buffer; },
    readImage() {
      calls.readImage++; const image = state.image;
      return {
        isEmpty: () => !image,
        getSize: () => image ? { width: image.width, height: image.height } : { width: 0, height: 0 },
        toBitmap: () => { calls.bitmap++; return Buffer.from('bitmap:' + image.pixels); },
        toPNG: () => { calls.png++; return Buffer.from('PNG:' + image.pixels); },
      };
    },
  };
  return { clipboard, calls, set(next) { state = { formats: ['image/png'], buffer: Buffer.alloc(0), image: null, ...next }; } };
}

function loadCapture(clipboard) {
  const handlers = {}, intervals = [], sent = [];
  const context = {
    require(name) {
      if (name === 'electron') return {
        app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }),
          setAppUserModelId() {}, getPath: () => '/test' },
        ipcMain: { handle: (key, cb) => { handlers[key] = cb; } },
        globalShortcut: {}, dialog: {}, shell: {}, screen: {}, clipboard,
      };
      if (name === 'electron-updater') return { autoUpdater: {} };
      if (name.startsWith('./')) return require(path.join(root, name));
      return require(name);
    },
    __dirname: root, URL, console, setTimeout, clearTimeout,
    setInterval(fn, ms) { const timer = { fn, ms, cleared: false, unref() { return timer; } }; intervals.push(timer); return timer; },
    clearInterval(timer) { if (timer) timer.cleared = true; },
  };
  vm.createContext(context);
  vm.runInContext(read('main.js') + '\nglobalThis.testCapture = { setView(v) { view = v; }, setWindow(w) { win = w; },' +
    ' setMini(on) { miniMode = on; syncCapture(); }, sync() { syncCapture(); } };', context);
  const frame = { url: 'https://retocker.web.app/' };
  const contents = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: (...args) => sent.push(args) };
  context.testCapture.setView({ webContents: contents });
  // Capture may read the clipboard only while the MINI journal is on screen.
  const shown = { visible: true, minimized: false };
  context.testCapture.setWindow({ isDestroyed: () => false, isVisible: () => shown.visible, isMinimized: () => shown.minimized });
  context.testCapture.setMini(true);
  const event = { sender: contents, senderFrame: frame };
  return {
    sent, frame, shown,
    setMini: on => context.testCapture.setMini(on),
    sync: () => context.testCapture.sync(),
    running: () => intervals.some(timer => timer.ms === 650 && !timer.cleared),
    capture: on => handlers['syter:clipboard-capture'](event, on),
    timer: () => intervals.filter(timer => timer.ms === 650).at(-1),
    tick(times = 1) { for (let i = 0; i < times; i++) this.timer().fn(); },
  };
}

test('clipboard capture ignores old and text clipboards and PNG-encodes each new image once', async () => {
  const c = fakeClipboard(); c.set({ image: { width: 10, height: 10, pixels: 'already-there' } });
  const m = loadCapture(c.clipboard);
  assert.equal(await m.capture(true), true);
  m.tick(3);
  assert.deepEqual(m.sent, [], 'the image already on the clipboard when capture starts is ignored');
  assert.equal(c.calls.png, 0, 'no PNG encoding while the clipboard is unchanged');

  c.set({ formats: ['text/plain', 'text/html'] });
  const reads = c.calls.readImage;
  m.tick(3);
  assert.deepEqual(m.sent, []);
  assert.equal(c.calls.readImage, reads, 'a text-only clipboard is skipped by format, without decoding');

  c.set({ image: { width: 20, height: 10, pixels: 'chart-1' } });
  m.tick(4);
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0][0], 'syter:clipboard-captured');
  assert.equal(m.sent[0][1].data, 'data:image/png;base64,' + Buffer.from('PNG:chart-1').toString('base64'));
  assert.equal(m.sent[0][1].hash, crypto.createHash('sha256').update('PNG:chart-1').digest('hex'));
  assert.equal(c.calls.png, 1, 'each new image is encoded exactly once');

  const bitmaps = c.calls.bitmap;
  c.set({ buffer: Buffer.from('raw-png-2'), image: { width: 20, height: 10, pixels: 'chart-2' } });
  m.tick(3);
  assert.equal(m.sent.length, 2);
  assert.equal(c.calls.bitmap, bitmaps, 'raw PNG clipboard bytes are hashed without decoding a bitmap');
  assert.equal(c.calls.png, 2);

  assert.equal(await m.capture(false), false);
  assert.equal(m.timer().cleared, true);
});

test('oversized or unreadable clipboard images report one error per change; navigation stops capture', async () => {
  const c = fakeClipboard();
  const m = loadCapture(c.clipboard);
  await m.capture(true);
  c.set({ image: { width: 8000, height: 6000, pixels: 'huge' } });
  m.tick(5);
  assert.equal(m.sent.length, 1);
  assert.match(m.sent[0][1].error, /40 Мп/);
  assert.equal(c.calls.png, 0);

  c.clipboard.readImage = () => { throw Error('clipboard busy'); };
  c.set({ formats: [] });
  m.tick(4);
  assert.equal(m.sent.length, 2);
  assert.equal(m.sent[1][1].error, 'clipboard busy');

  m.frame.url = 'https://example.com/';
  m.tick();
  assert.equal(m.timer().cleared, true, 'capture stops when the journal is no longer loaded');
});

test('clipboard capture works only while the mini journal is on screen', async () => {
  const c = fakeClipboard();
  const m = loadCapture(c.clipboard);
  const formats = c.clipboard.availableFormats; let reads = 0;
  c.clipboard.availableFormats = () => { reads++; return formats(); };

  m.setMini(false);
  assert.equal(await m.capture(true), true, 'the checkbox wish is kept in the full journal');
  assert.equal(m.running(), false);
  c.set({ image: { width: 10, height: 10, pixels: 'taken-in-full-journal' } });
  assert.equal(reads, 0, 'the full journal never reads the clipboard');

  m.setMini(true);
  assert.equal(m.running(), true);
  m.tick(3);
  assert.deepEqual(m.sent, [], 'a screenshot taken before the mini journal opened is ignored');

  m.shown.visible = false; m.sync();
  assert.equal(m.running(), false, 'hidden in the tray: no capture');
  c.set({ image: { width: 10, height: 10, pixels: 'taken-while-hidden' } });
  m.shown.visible = true; m.sync();
  assert.equal(m.running(), true);
  m.tick(3);
  assert.deepEqual(m.sent, [], 'a screenshot taken while hidden is ignored');

  m.shown.minimized = true; m.tick();
  assert.equal(m.running(), false, 'minimized: no capture');
  m.shown.minimized = false; m.sync();
  c.set({ image: { width: 20, height: 10, pixels: 'chart-in-mini' } });
  m.tick(3);
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0][1].data, 'data:image/png;base64,' + Buffer.from('PNG:chart-in-mini').toString('base64'));

  m.setMini(false);
  assert.equal(m.running(), false, 'leaving the mini journal stops capture at once');
  assert.equal(await m.capture(false), false);
});

// ------------------------------------------------------------- offline page
function loadOffline() {
  const script = /<script>([\s\S]*?)<\/script>/.exec(read('offline.html'))[1];
  const timers = new Map(), listeners = {}, fetches = [], aborted = [];
  let nextId = 1;
  const location = { href: 'file:///offline.html' };
  const retry = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const context = {
    location,
    document: { getElementById: id => id === 'retry' ? retry : null },
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    Date: { now: () => 1700000000000 },
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; aborted.push(this.signal); } },
    fetch: (url, options) => new Promise((resolve, reject) => fetches.push({ url, options, resolve, reject })),
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return {
    location, listeners, retry, fetches, aborted,
    delays: () => [...timers.values()].map(timer => timer.ms),
    fire(ms) {
      const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
      assert.ok(entry, 'timer ' + ms + ' scheduled');
      timers.delete(entry[0]); entry[1].fn();
    },
  };
}

test('offline page opens the journal only after the site answers, with bounded back-off', async () => {
  const o = loadOffline();
  assert.deepEqual(o.delays(), [10000]);
  assert.equal(o.fetches.length, 0);
  const expected = [10000, 20000, 40000, 60000, 60000];
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(o.delays(), [expected[i]]);
    o.fire(expected[i]);
    assert.equal(o.fetches.length, i + 1);
    const probe = o.fetches[i];
    assert.equal(probe.url, 'https://retocker.web.app/?syter-probe=1700000000000');
    assert.equal(probe.options.method, 'HEAD');
    assert.equal(probe.options.mode, 'no-cors');
    assert.equal(probe.options.cache, 'no-store');
    assert.equal(probe.options.credentials, 'omit');
    assert.ok(probe.options.signal);
    assert.deepEqual(o.delays(), [8000], 'probe timeout armed, no parallel probe scheduled');
    probe.reject(new TypeError('Failed to fetch'));
    await flush();
    assert.equal(o.location.href, 'file:///offline.html', 'a failed probe never opens the journal');
  }
  assert.deepEqual(o.delays(), [60000]);

  o.fire(60000);
  o.fire(8000);
  assert.equal(o.aborted.length, 1, 'a hanging probe is aborted');
  o.fetches[5].reject(new Error('aborted'));
  await flush();
  assert.deepEqual(o.delays(), [60000]);

  o.listeners.online();
  assert.equal(o.fetches.length, 7, 'online event probes immediately');
  o.listeners.online();
  assert.equal(o.fetches.length, 7, 'never two probes at once');
  o.fetches[6].reject(new TypeError('Failed to fetch'));
  await flush();
  assert.deepEqual(o.delays(), [10000], 'back-off restarts after coming online');

  o.fire(10000);
  o.fetches[7].resolve({ type: 'opaque' });
  await flush();
  assert.equal(o.location.href, 'https://retocker.web.app/');
  assert.deepEqual(o.delays(), [], 'no probes after leaving');
});

test('offline Retry opens the journal directly; the page may contact only the journal origin', () => {
  const o = loadOffline();
  o.retry.listeners.click();
  assert.equal(o.location.href, 'https://retocker.web.app/');
  assert.deepEqual(o.delays(), []);
  o.listeners.online();
  assert.equal(o.fetches.length, 0, 'no probe once navigation started');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('offline.html'))[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src https:\/\/retocker\.web\.app(;|$)/);
});

// ------------------------------------------------------------- mini journal
test('mini journal save shows the same owner-only streak feedback as the full form', () => {
  for (const file of ['mini-journal.js', 'mini-journal-legacy.js']) {
    const source = read(file), saved = source.indexOf("render(); status.textContent = 'Сделка сохранена ✓';");
    assert.ok(saved > 0, file);
    assert.match(source.slice(saved, saved + 300),
      /if \(typeof maybeShowStreakToast === 'function'\) maybeShowStreakToast\(\);/, file);
  }
  const app = path.join(root, '../public/app.js');
  if (fs.existsSync(app)) assert.match(fs.readFileSync(app, 'utf8'), /function maybeShowStreakToast\(\)/);
});

function loadViewState() {
  const listeners = {}, intervals = [], dispatched = [];
  const classes = () => { const set = new Set(); return { contains: c => set.has(c), add: c => { set.add(c); }, remove: c => { set.delete(c); } }; };
  const element = parent => {
    const el = { nodeType: 1, parent, scrollTop: 0, scrollLeft: 0, isConnected: true, style: {}, classList: classes(),
      contains(other) { for (let x = other; x; x = x.parent) if (x === el) return true; return false; },
      querySelectorAll(selector) { throw Error('full DOM scan: ' + selector); },
      querySelector() { return null; } };
    return el;
  };
  const appRoot = element(null), overlay = element(null), modalBox = element(overlay);
  overlay.querySelector = selector => selector === '.modal-box' ? modalBox : null;
  const list = element(appRoot), cell = element(list), outside = element(null);
  const form = { resets: 0, reset() { this.resets++; } }, notes = { value: 'draft' };
  const byId = { modalOverlay: overlay, appRoot, tradeForm: form, syterTradeNotes: notes };
  const window = { scrollX: 0, scrollY: 300, scrolledTo: [], scrollTo(x, y) { this.scrolledTo.push([x, y]); },
    addEventListener: (type, fn) => { listeners['window:' + type] = fn; } };
  const document = { body: { classList: classes() }, activeElement: null, getElementById: id => byId[id] || null,
    addEventListener: (type, fn, options) => { listeners[type] = { fn, options }; },
    dispatchEvent: event => { dispatched.push(event.type); return true; } };
  const context = { window, document, Event: class { constructor(type) { this.type = type; } },
    setInterval: (fn, ms) => { const timer = { fn, ms, cleared: false }; intervals.push(timer); return timer; },
    clearInterval: timer => { if (timer) timer.cleared = true; }, viewingUser: 'trader', currentUser: { login: 'trader' } };
  vm.createContext(context);
  vm.runInContext(read('mini-view-state.js'), context);
  return { context, window, listeners, intervals, dispatched, appRoot, overlay, modalBox, list, cell, outside, form, notes,
    state: window.syterJournalView, scroll: target => listeners.scroll.fn({ target }) };
}

test('mini view state restores tracked scroll positions without scanning the whole journal DOM', () => {
  const s = loadViewState();
  assert.equal(s.intervals.length, 0, 'no background polling while no draft is parked');
  assert.equal(s.listeners.scroll.options.capture, true);
  assert.equal(s.listeners.scroll.options.passive, true);
  s.list.scrollTop = 420; s.scroll(s.list);
  s.cell.scrollLeft = 30; s.scroll(s.cell);
  s.outside.scrollTop = 99; s.scroll(s.outside);
  s.scroll({ nodeType: 9 });
  s.appRoot.scrollTop = 50;
  s.modalBox.scrollTop = 12;
  s.state.begin('trader');
  for (const el of [s.list, s.cell, s.appRoot, s.outside, s.modalBox]) { el.scrollTop = 0; el.scrollLeft = 0; }
  s.state.leave('trader');
  assert.equal(s.list.scrollTop, 420);
  assert.equal(s.cell.scrollLeft, 30);
  assert.equal(s.appRoot.scrollTop, 50);
  assert.equal(s.modalBox.scrollTop, 12);
  assert.equal(s.outside.scrollTop, 0, 'elements outside the journal are not tracked');
  assert.deepEqual(s.window.scrolledTo.at(-1), [0, 300]);
});

test('parked draft watcher runs only while a draft is parked and discards it on sign-out', () => {
  const s = loadViewState();
  s.state.begin('trader');
  s.state.leave('trader');
  assert.equal(s.state.isParked(), true);
  assert.equal(s.intervals.length, 1);
  assert.equal(s.intervals[0].ms, 250);
  s.state.leave('trader');
  assert.equal(s.intervals.length, 1, 'one watcher at a time');
  s.state.finish('trader');
  s.intervals[0].fn();
  assert.deepEqual(s.dispatched, [], 'same owner keeps the parked draft');
  s.context.currentUser = null;
  s.intervals[0].fn();
  assert.deepEqual(s.dispatched, ['syter:parked-draft-discarded']);
  assert.equal(s.form.resets, 1);
  assert.equal(s.notes.value, '');
  assert.equal(s.intervals[0].cleared, false);
  s.intervals[0].fn();
  assert.equal(s.intervals[0].cleared, true, 'watcher stops once nothing is parked');
  s.context.currentUser = { login: 'trader' };
  s.state.begin('trader');
  s.state.leave('trader');
  assert.equal(s.intervals.length, 2, 'a new parked draft starts a new watcher');
});

// ------------------------------------------------------- installer lifecycle
test('a real uninstall removes the fixed SYTER registry receipts; updates keep them', () => {
  const nsh = read('installer/custom-install.nsh');
  const macro = /!macro customUnInstall\n([\s\S]*?)!macroend/.exec(nsh);
  assert.ok(macro, 'customUnInstall macro');
  assert.match(macro[1], /\$\{ifNot\} \$\{isUpdated\}\n\s+DeleteRegKey HKCU "Software\\SYTER\\Desktop"\n\s+DeleteRegKey HKCU "Software\\SYTER\\Installer"\n\s+DeleteRegKey \/ifempty HKCU "Software\\SYTER"\n\s+\$\{endif\}/);
  assert.match(nsh, /WriteRegStr HKCU "Software\\SYTER\\Desktop" "Version"/);
  assert.equal(JSON.parse(read('package.json')).build.nsis.include, 'installer/custom-install.nsh');
});

test('a repeated installer launch brings the running installer forward; Windows shutdown is never blocked', () => {
  const cs = read('installer/native/Installer.cs');
  assert.match(cs, /static extern bool AllowSetForegroundWindow\(int processId\);/);
  assert.match(cs, /if\(!owner\)\{[\s\S]{0,200}AllowSetForegroundWindow\(-1\);[\s\S]{0,80}PostMessage\(\(IntPtr\)0xFFFF,InstallerWindow\.ActivateMessage,IntPtr\.Zero,IntPtr\.Zero\);\s*return;/);
  assert.match(cs, /ActivateMessage=RegisterWindowMessage\("SYTER_Installer_Activate_"\+/);
  assert.match(cs, /protected override void WndProc\(ref Message m\)\{\n\s+if\(ActivateMessage!=0&&m\.Msg==ActivateMessage\)\{[\s\S]{0,160}Show\(\);Activate\(\);/);
  assert.match(cs, /FormClosing\+=\(s,e\)=>\{if\(busy&&e\.CloseReason!=CloseReason\.WindowsShutDown\)e\.Cancel=true;\};/);
  // Built with the .NET Framework C# 5 compiler on the runner.
  assert.doesNotMatch(cs, /\$"|\?\.|\?\[|nameof\(/);
});

// --------------------------------------------- previous published release
const previousRelease = require('../update-test/previous-release.cjs');
const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [], ...extra });

test('transition baseline is the newest published release older than this build', () => {
  const list = [rel('v1.3.15', { draft: true }), rel('v1.3.14'), rel('v1.3.16-beta'), rel('v1.4.0', { prerelease: true }),
    rel('v1.3.13'), rel('latest'), rel('v1.3.9'), null];
  const release = previousRelease.pickPrevious(list, '1.3.15');
  assert.equal(release.previous.version, '1.3.14');
  assert.equal(release.latest, '1.3.14');
  const trial = previousRelease.pickPrevious(list, '1.3.14');
  assert.equal(trial.previous.version, '1.3.13', 'a trial build of a published version starts from the one before');
  assert.equal(trial.latest, '1.3.14');
  assert.equal(previousRelease.pickPrevious([rel('v1.3.9'), rel('v1.3.10')], '1.3.11').previous.version, '1.3.10');
  assert.throws(() => previousRelease.pickPrevious(list, '1.3.9'), /No published release older than 1\.3\.9/);
  assert.throws(() => previousRelease.pickPrevious([rel('v1.3.15', { draft: true })], '1.3.16'), /No published desktop release/);
  assert.throws(() => previousRelease.pickPrevious(list, 'v1.3.15'), /Invalid current version/);
  assert.throws(() => previousRelease.publishedVersions({ message: 'Bad credentials' }), /Unexpected GitHub releases response/);
});

const SHA_1313 = 'Jr+xstNXo37CcsnL+NqNQqiWXhc1R4rM5eV0MW9jE/JeFwiNjKxBvdtfxGPIK63Xv3pEJ/d7y/pqGEvoomR1Fw==';
const LATEST_1313 = ['version: 1.3.13', 'files:', '  - url: SYTER-Setup-1.3.13.exe', '    sha512: ' + SHA_1313,
  '    size: 102401027', 'path: SYTER-Setup-1.3.13.exe', 'sha512: ' + SHA_1313, "releaseDate: '2026-10-24T23:52:46.816Z'", ''].join('\n');

test('published latest.yml is parsed strictly and must describe exactly the baseline installer', () => {
  const latest = previousRelease.parseLatestYml('\uFEFF' + LATEST_1313.replace(/\n/g, '\r\n'));
  assert.equal(latest.version, '1.3.13');
  assert.equal(latest.releaseDate, '2026-10-24T23:52:46.816Z');
  assert.equal(latest.files.length, 1);
  assert.equal(latest.files[0].size, 102401027);
  assert.deepEqual(previousRelease.installerEntry(latest, '1.3.13'), { name: 'SYTER-Setup-1.3.13.exe', sha512: SHA_1313, size: 102401027 });
  assert.throws(() => previousRelease.installerEntry(latest, '1.3.12'), /does not match 1\.3\.12/);
  assert.throws(() => previousRelease.installerEntry({ ...latest, sha512: SHA_1313.replace('J', 'K') }, '1.3.13'), /top-level installer/);
  assert.throws(() => previousRelease.installerEntry({ ...latest, files: [{ ...latest.files[0], size: 0 }] }, '1.3.13'), /no verifiable entry/);
  assert.throws(() => previousRelease.installerEntry({ ...latest, files: [{ ...latest.files[0], sha512: 'short' }] }, '1.3.13'), /no verifiable entry/);
  assert.throws(() => previousRelease.parseLatestYml('version: 1.3.13\n<html>'), /Unexpected latest\.yml line/);
});

// ------------------------------------------------------------ release workflow
test('desktop release always tests the real update from the previous published release; obsolete modes are gone', () => {
  const workflows = path.join(root, '../.github/workflows');
  if (!fs.existsSync(workflows)) return;
  const wf = fs.readFileSync(path.join(workflows, 'desktop-release.yml'), 'utf8').replace(/\r\n/g, '\n');
  for (const gone of ['reuse_verified_update', 'local_update_test', '38718005829', 'package-1313', 'package-1314', '1.3.7', '\n  local-update:'])
    assert.ok(!wf.includes(gone), 'obsolete: ' + JSON.stringify(gone));
  assert.ok(!fs.existsSync(path.join(workflows, 'local-update-test.yml')));
  const transition = wf.indexOf('- name: Verify real installed update from the previous published release with private loopback feed');
  const uninstall = wf.indexOf('- name: Verify uninstall removes SYTER registry receipts');
  assert.ok(transition > 0 && uninstall > transition);
  const step = wf.slice(transition, uninstall);
  assert.match(step, /if: \$\{\{ !inputs\.check_only && !inputs\.installer_only && !inputs\.notes_only \}\}/);
  assert.match(step, /node update-test\/previous-release\.cjs baseline/);
  assert.match(step, /Remove-Item Env:SYTER_RELEASES_READ_TOKEN/);
  assert.match(step, /\$previous\.version -ne \$previous\.latest/);
  assert.match(step, /node update-test\/package-transition\.cjs \$from/);
  assert.match(wf.slice(uninstall, uninstall + 2500), /'Uninstall SYTER\.exe'[\s\S]*Software\\SYTER\\Installer/);
  assert.match(wf, /\.\/tests\/native-installer\.ps1 -SkipBenchmark\n/);
});
