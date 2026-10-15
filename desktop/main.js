// SYTER desktop app (Electron).
// The window simply opens the published site, so every `firebase deploy`
// shows up on the next launch. The app itself updates through electron-updater
// from GitHub Releases (see package.json -> build.publish).
//
// Layout: the BrowserWindow itself shows a thin black title bar (titlebar.html,
// native Windows buttons drawn over it by titleBarOverlay); the site lives in a
// WebContentsView right below it, so the site's own layout is never touched.
'use strict';
const { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, ipcMain, shell, dialog, clipboard, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { createMiniShortcut, LABEL: MINI_SHORTCUT_LABEL } = require('./mini-shortcut');
const { createWindowMotion } = require('./window-motion');
const { handlePreviewInput } = require('./interface-preview-shortcut');
const { createViewLayout } = require('./view-layout');
const { createWindowWidthPolicy, PAGE_MINIMUM_SCRIPT } = require('./window-width-policy');
// Production: hardware acceleration remains enabled; no diagnostic switches.
const APP_URL = 'https://retocker.web.app/';
const APP_HOSTS = ['retocker.web.app', 'retocker.firebaseapp.com'];
app.on('web-contents-created', (_event, contents) => {
  contents.on('zoom-changed',()=>Promise.resolve().then(()=>widthPolicy.refresh()));
  contents.on('dom-ready', async () => {
    if (contents.isDestroyed() || !isAppUrl(contents.getURL())) return;
    try {
      const autumnMotionSource = fs.readFileSync(path.join(__dirname, 'autumn-motion.js'), 'utf8');
      await contents.executeJavaScript(autumnMotionSource);
    } catch (error) { console.warn('Autumn animation unavailable:', error.message); }
    if (contents === siteContents()) {
      try { widthPolicy.updateCssMinimum(await contents.executeJavaScript(PAGE_MINIMUM_SCRIPT)); }
      catch (error) { console.warn('Using fallback equity width:',error.message); }
    }

  });
});

const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000; // re-check every 6 hours
const TITLEBAR_H = 36;                      // px, black strip above the site
const REMEMBER_MS = 6 * 60 * 60 * 1000;     // auto sign-in animation works for 6 h after a manual sign-in
// Use decoded RGBA PNGs at runtime, not a legacy HICON serialization.
const ICON_PATH = path.join(__dirname, 'build', 'app-icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'build', 'tray-icon.png');

let win = null;      // frame + title bar
let view = null;     // the site
let tray = null;
let isQuitting = false;

const crypto = require('crypto');
let captureTimer=null, captureHash='';
function stopCapture(){if(captureTimer)clearInterval(captureTimer);captureTimer=null;captureHash='';}
function clipboardPayload(){const img=clipboard.readImage();if(img.isEmpty())return null;const z=img.getSize();if(z.width*z.height>40000000)throw Error('Изображение больше 40 Мп.');const png=img.toPNG();if(png.length>25*1024*1024)throw Error('Изображение больше 25 МБ.');return {hash:crypto.createHash('sha256').update(png).digest('hex'),data:'data:image/png;base64,'+png.toString('base64')};}
let miniMode = false, miniReady = false, miniPinned = true;
let fullState = null, miniBounds = null;
let deferredFullRestore = false;
let modeGeneration = 0;
function siteContents() { return view ? view.webContents : win && win.webContents; }
const widthPolicy = createWindowWidthPolicy({getWindow:()=>win,getContents:siteContents,screen,isMini:()=>miniMode});
function installWidthPolicy() {
  widthPolicy.refresh();
  const host=win;
  const refresh=()=>{if(win===host)widthPolicy.refresh();};
  host.on('moved',refresh);
  host.on('restore',refresh);
  screen.on('display-metrics-changed',refresh);
  host.once('closed',()=>screen.removeListener('display-metrics-changed',refresh));
}

const windowMotion = createWindowMotion({
  getWindow: () => win, getView: () => view, onFrame: layout,
  onStage: stage => { if (process.env.SYTER_TRANSITION_TEST === '1') console.log('TRANSITION:', stage); },

});
const miniShortcut = createMiniShortcut({
  globalShortcut,
  onToggle: () => requestMode(!miniMode),
  onUnavailable: (err) => {
    console.warn('Mini journal shortcut unavailable:', err ? err.message : 'already in use');
    if (win && !win.isDestroyed()) dialog.showMessageBox(win, {
      type: 'warning', title: 'SYTER — горячая клавиша',
      message: MINI_SHORTCUT_LABEL + ' не удалось зарегистрировать.',
      detail: 'Сочетание может быть занято другой программой. Переключение кнопкой и через значок возле часов продолжает работать.',
      buttons: ['Понятно'],
    }).catch(() => {});
  },
});

function requestMode(mini) {
  // show()/focus() on an already focused journal can repaint its native frame.
  // A global request still restores a hidden/minimized/background journal.
  if (win && (!win.isVisible() || win.isMinimized() || !win.isFocused())) showWindow();
  if (!miniReady) {
    // Keep the sign-in window interactive while the page is loading.
    return;
  }
  view.webContents.send('syter:mode-request', !!mini);
}

function fitBounds(bounds, defaults) {
  const candidate = Object.assign({}, defaults, bounds);
  const safe = ['x', 'y', 'width', 'height'].every(k => Number.isFinite(candidate[k]));
  const area = safe ? screen.getDisplayMatching(candidate).workArea : screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width, Math.max(380, safe ? candidate.width : defaults.width));
  const height = Math.min(area.height, Math.max(480, safe ? candidate.height : defaults.height));
  return { width, height, x: Math.round(Math.max(area.x, Math.min(safe ? candidate.x : area.x + area.width - width, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(safe ? candidate.y : area.y + 30, area.y + area.height - height))) };
}

function modeTarget(enabled) {
  if (enabled) {
    if (miniBounds) return fitBounds(miniBounds, { x: NaN, y: NaN, width: 420, height: 730 });
    // First use stays on the journal's monitor, not necessarily the primary.
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    return fitBounds({ x: area.x + area.width - Math.min(420, area.width),
      y: area.y + 30, width: 420, height: 730 }, { width: 420, height: 730 });
  }
  if (!fullState) return widthPolicy.constrain(win.getBounds());
  if (fullState.fullscreen) return screen.getDisplayMatching(fullState.bounds).bounds;
  if (fullState.maximized) return screen.getDisplayMatching(fullState.bounds).workArea;
  return widthPolicy.constrain(fitBounds(fullState.bounds, { x: 80, y: 80, width: 1440, height: 900 }));
}
async function prepareMiniMode(enabled, animate = true) {
  if (!win || enabled === miniMode) return false;
  return windowMotion.prepare(modeTarget(enabled), false, enabled);
}
async function setMiniMode(enabled, animate = true) {
  enabled = !!enabled;
  if (!win || enabled === miniMode) return { mini: miniMode, pinned: miniPinned };
  const generation = ++modeGeneration;
  const target = modeTarget(enabled);
  if (enabled) {
    deferredFullRestore = false;
    fullState = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    miniMode = true;
  } else {
    miniBounds = win.getNormalBounds();
    miniMode = false;
  }
  await windowMotion.move(target, false, () => {
    if (enabled) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      win.setMinimumSize(380, 480);
      win.setAlwaysOnTop(miniPinned);
      win.setBounds(target);
      win.setMaximizable(false);
      win.setFullScreenable(false);
    } else {
      win.setAlwaysOnTop(false);
      if (win.isMaximized()) win.unmaximize();
      win.setMaximizable(true);
      win.setFullScreenable(true);
      // Place the full rectangle before restoring its tracking limits. On
      // Windows setMinimumSize can move/resize a still-compact native window;
      // grow:false does not make that native constraint update geometry-free.
      win.setBounds(fullState
        ? widthPolicy.constrain(fitBounds(fullState.bounds, { x: 80, y: 80, width: 1440, height: 900 })) : target);
      widthPolicy.refresh({grow:false});
      if (fullState) {
        deferredFullRestore = !win.isVisible();
        if (!deferredFullRestore) {
          if (fullState.maximized) win.maximize();
          if (fullState.fullscreen) win.setFullScreen(true);
        }
      }
    }
  });
  if (generation !== modeGeneration || !win || win.isDestroyed()) return { mini: miniMode, pinned: miniPinned };
  layout(); saveState();
  return { mini: miniMode, pinned: miniPinned };
}

// ── one window only: a second launch focuses the first ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // a second launch never opens a second window: it brings the first one back (also from the tray)
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

app.on('before-quit', () => { isQuitting = true; windowMotion.cancel(true); }); // also covers quitAndInstall() of the updater
app.on('will-quit', () => miniShortcut.dispose());

app.setAppUserModelId('com.retocker.syter'); // taskbar grouping + notifications

function isAppUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && APP_HOSTS.includes(x.hostname); }
  catch (e) { return false; }
}
function isSharedNoteUrl(u) {
  // Model descriptions use the journal's shared Notes viewer (?note=...).
  // The host alone must not classify that viewer as in-app navigation.
  try { return isAppUrl(u) && new URL(u).searchParams.has('note'); }
  catch (e) { return false; }
}
function openOutside(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:' || x.protocol === 'http:' || x.protocol === 'mailto:') {
      shell.openExternal(u).catch(err => console.warn('Could not open external link:', err.message));
    }
  }
  catch (e) { /* ignore bad links */ }
}
function installLinkHandlers(wc) {
  // Shared Notes/model pages go to the system default browser. Ordinary journal
  // navigation stays inside; no new Electron window is ever created.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url) && !isSharedNoteUrl(url)) {
      wc.loadURL(url);
      return { action: 'deny' };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isSharedNoteUrl(url) && (isAppUrl(url) || url.startsWith('file://'))) return;
    e.preventDefault();
    openOutside(url);
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (deferredFullRestore && !miniMode && fullState) {
    deferredFullRestore = false;
    if (fullState.maximized) win.maximize();
    if (fullState.fullscreen) win.setFullScreen(true);
  }
  win.show();
  win.focus();
  if (view && !view.webContents.isDestroyed()) view.webContents.focus();
}
function toggleWindow() {
  if (win && win.isVisible() && !win.isMinimized()) win.hide(); else showWindow();
}

// ── tray ──
function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON_PATH));
  tray.setToolTip('SYTER');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть журнал', click: () => requestMode(false) },
    { label: 'Мини-журнал · ' + MINI_SHORTCUT_LABEL, click: () => requestMode(true) },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } },
  ]));
  // Clicking the tray always restores/focuses the current window, even if it
  // was still visible behind another app. Only the close button hides it.
  tray.on('click', showWindow);
}

// ── "remember me" for the desktop sign-in animation ──
// Only the login NAME and the time of the last manual sign-in are stored; never a password.
const rememberFile = () => path.join(app.getPath('userData'), 'remember.json');
function readRemember() {
  try {
    const r = JSON.parse(fs.readFileSync(rememberFile(), 'utf8'));
    const age = Date.now() - Number(r.at);
    if (r && r.login && age >= 0 && age < REMEMBER_MS) return { valid: true, login: String(r.login), remainingMs: REMEMBER_MS - age };
  } catch (e) { /* no file yet */ }
  clearRemember();
  return { valid: false, login: '', remainingMs: 0 };
}
function clearRemember() { try { fs.rmSync(rememberFile(), { force: true }); } catch (e) {} }
// only our own site may use these calls
function fromSite(e) { return !!(view && e.sender === view.webContents && e.senderFrame === view.webContents.mainFrame && isAppUrl(e.senderFrame && e.senderFrame.url)); }
ipcMain.handle('syter:mini-ready', (e) => { if (!fromSite(e)) return false; miniReady = true; return true; });
ipcMain.handle('syter:mini-prepare', (e, enabled, animate) => fromSite(e) && typeof enabled === 'boolean' &&
  typeof animate === 'boolean' ? prepareMiniMode(enabled, animate) : false);
ipcMain.handle('syter:mini-cancel', (e) => { if (fromSite(e)) windowMotion.cancel(); });
ipcMain.handle('syter:mini-mode', (e, enabled, animate) => fromSite(e) && typeof enabled === 'boolean' &&
  (animate === undefined || typeof animate === 'boolean') ? setMiniMode(enabled, animate !== false) : null);
ipcMain.handle('syter:mini-pin', (e, pinned) => {
  if (!fromSite(e) || typeof pinned !== 'boolean') return null;
  miniPinned = pinned;
  if (miniMode) win.setAlwaysOnTop(pinned);
  saveState(); return pinned;
});
ipcMain.handle('syter:clipboard-capture', (e,on)=>{
  if(!fromSite(e)||typeof on!=='boolean')return false;
  stopCapture();if(!on)return false;
  try{captureHash=clipboardPayload()?.hash||'';}catch(_){}
  captureTimer=setInterval(()=>{
    if(!view||view.webContents.isDestroyed()||!isAppUrl(view.webContents.getURL())){stopCapture();return;}
    try{const payload=clipboardPayload();if(!payload){captureHash='';return;}if(payload.hash===captureHash)return;captureHash=payload.hash;view.webContents.send('syter:clipboard-captured',payload);}
    catch(err){if(captureHash!=='error'){captureHash='error';view.webContents.send('syter:clipboard-captured',{error:err.message});}}
  },650);captureTimer.unref();return true;
});
ipcMain.handle('syter:clipboard-image', (e) => {
  if (!fromSite(e)) return null;
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const size = img.getSize();
  if (size.width * size.height > 40000000) throw new Error('Изображение слишком большое (максимум 40 Мп).');
  const png = img.toPNG();
  if (png.length > 25 * 1024 * 1024) throw new Error('Изображение слишком большое (максимум 25 МБ).');
  return 'data:image/png;base64,' + png.toString('base64');
});
ipcMain.handle('syter:remember-get', (e) => fromSite(e) ? readRemember() : { valid: false, login: '', remainingMs: 0 });
ipcMain.handle('syter:remember-set', (e, login) => {
  login = String(login || '').trim().slice(0, 64);
  if (!fromSite(e) || !login) return false;
  try { fs.writeFileSync(rememberFile(), JSON.stringify({ login, at: Date.now() })); return true; } catch (err) { return false; }
});
ipcMain.handle('syter:remember-clear', (e) => { if (fromSite(e)) clearRemember(); return true; });

// ── window size / position remembered between launches ──
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const keepFullState = (miniMode || deferredFullRestore) && fullState;
    const s = { maximized: keepFullState ? fullState.maximized : win.isMaximized(), bounds: keepFullState ? fullState.bounds : win.getNormalBounds(), miniBounds: miniMode ? win.getNormalBounds() : miniBounds, miniPinned };
    fs.writeFileSync(stateFile(), JSON.stringify(s));
  } catch (e) { /* not critical */ }
}

function showOffline() {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.loadFile(path.join(__dirname, 'offline.html'));
}

// Keep final content geometry authoritative and skip repeated identical bounds.
const viewLayout = createViewLayout({ getWindow: () => win, getView: () => view, titlebarHeight: TITLEBAR_H });
function layout() { viewLayout.layout(); }

function start() {
  Menu.setApplicationMenu(null); // clean window: no File/Edit/View bar
  const st = loadState();
  miniBounds = st.miniBounds || null;
  miniPinned = st.miniPinned !== false;
  const b = st.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    x: b.x, y: b.y,
    minWidth: 380,
    minHeight: 500,
    title: 'SYTER',
    backgroundColor: '#000000',
    icon: ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    // black title bar with the native minimize / maximize / close buttons on top of it
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#cfd6e4', height: TITLEBAR_H },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  installWidthPolicy();
  win.loadFile(path.join(__dirname, 'titlebar.html'));
  win.webContents.on('page-title-updated', event => event.preventDefault());
  win.setTitle('SYTER');

  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  view.setBackgroundColor('#000000');
  win.contentView.addChildView(view);
  layout();
  ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'show']
    .forEach((ev) => win.on(ev, layout));

  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => {
    widthPolicy.refresh(); layout(); win.show();
  });
  win.on('focus', () => { if (view && !view.webContents.isDestroyed()) view.webContents.focus(); });

  // the cross hides the window into the tray; "Выход" in the tray menu really quits
  win.on('close', (e) => {
    windowMotion.cancel(true);
    saveState();
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('hide', () => windowMotion.cancel());
  win.on('minimize', () => windowMotion.cancel());
  win.on('closed', () => { win = null; view = null; });

  createTray();
  miniShortcut.register();

  const wc = view.webContents;

  installLinkHandlers(wc);

  // no internet / site unreachable -> local page with Retry
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted by a new navigation */) return;
    showOffline();
  });

  // keyboard shortcuts that the hidden menu would normally give
  wc.on('before-input-event', (e, input) => {
    if (handlePreviewInput(e, input, wc, isAppUrl)) return;
    if (miniShortcut.handleFocusedInput(e, input)) return;
    if (input.type !== 'keyDown') return;
    const k = String(input.key).toLowerCase();
    const ctrl = input.control || input.meta;
    if (k === 'f5' || (ctrl && k === 'r')) {
      e.preventDefault();
      if (wc.getURL().startsWith('file://')) wc.loadURL(APP_URL);
      else if (input.shift) wc.reloadIgnoringCache(); else wc.reload();
    } else if (k === 'f11') { e.preventDefault(); if (!miniMode) win.setFullScreen(!win.isFullScreen()); }
    else if (ctrl && input.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }
    else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); widthPolicy.refresh(); }
    else if (ctrl && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); widthPolicy.refresh(); }
    else if (ctrl && k === '0') { e.preventDefault(); wc.setZoomLevel(0); widthPolicy.refresh(); }
  });

  // The same web view is resized: form fields and the image never cross windows.
  wc.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) {
      miniReady = false; stopCapture();
      // Navigation cannot leave a resize timer touching a replaced page.
      if (miniMode) setMiniMode(false, false);
      else windowMotion.cancel(true);
    }
  });
  wc.on('did-finish-load', async () => {
    layout();
    if (!isAppUrl(wc.getURL())) return;
    try {
      await wc.insertCSS(fs.readFileSync(path.join(__dirname, 'mini-journal.css'), 'utf8'));
      await wc.executeJavaScript(fs.readFileSync(path.join(__dirname, 'mini-view-state.js'), 'utf8'));
      const mediaReady=await wc.executeJavaScript('Boolean(window.TJMedia)');
      await wc.executeJavaScript(fs.readFileSync(path.join(__dirname, mediaReady?'mini-journal.js':'mini-journal-legacy.js'), 'utf8'));
    } catch (err) { console.warn('Mini journal unavailable:', err); }
  });
  wc.loadURL(APP_URL);
  setupUpdates();
}

// ── app self-update ──
let updateController = null, updateWindow = null;
function setupUpdates() {
  if (!app.isPackaged || updateController) return;
  const { createUpdateController } = require('./lifecycle/controller');
  const { createLifecycleWindow, publishLifecycleState } = require('./lifecycle/window');
  const reveal = () => {
    if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.show(); updateWindow.focus(); return; }
    updateWindow = createLifecycleWindow({ BrowserWindow, ipcMain, icon: ICON_PATH,
      getState: () => updateController.snapshot(), onAction: name => updateController.action(name),
      onClose: () => { updateController.action('later'); return true; } });
    updateWindow.once('closed', () => { updateWindow = null; });
  };
  updateController = createUpdateController({ updater: autoUpdater, currentVersion: app.getVersion(),
    publish: state => publishLifecycleState(updateWindow, state),
    reveal, dismiss: () => { if (updateWindow && !updateWindow.isDestroyed()) updateWindow.hide(); },
    prepareQuit: () => { isQuitting = true; }, restoreQuit: () => { isQuitting = false; },
    log: err => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), new Date().toISOString() + ' ' + (err && err.stack || err) + '\n'); } catch (_) {} }
  });
  const timer = setTimeout(() => updateController.check(), 5000);
  const interval = setInterval(() => updateController.check(), UPDATE_EVERY_MS);
  app.once('will-quit', () => { clearTimeout(timer); clearInterval(interval); updateController.stop(); });
}

// the window only hides into the tray, so the app quits via the tray menu (or an update restart)
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
