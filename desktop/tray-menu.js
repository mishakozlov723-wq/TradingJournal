// Styled tray menu (journal look) shown on tray right-click instead of the
// native Windows menu, which cannot be styled. The native menu stays as a
// fallback when the styled window is not ready or fails to load.
'use strict';
const path = require('path');

const MARGIN = 10;          // transparent space around the card for its shadow
const WIDTH = 268;          // window width including margins
const ROW = 36, SEP = 9, PAD = 6, BORDER = 1;

function menuHeight(items) {
  let h = 2 * (MARGIN + PAD + BORDER);
  for (const item of items) h += item.separator ? SEP : ROW;
  return h;
}

// Place the menu next to the cursor, inside the work area (never over the taskbar).
function placeMenu(point, size, area) {
  let x = point.x - MARGIN;
  if (x + size.width > area.x + area.width) x = point.x - size.width + MARGIN;
  let y = point.y - size.height + MARGIN;
  if (y < area.y) y = point.y - MARGIN;
  x = Math.min(Math.max(x, area.x), area.x + area.width - size.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - size.height);
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
}

function createTrayMenu({ BrowserWindow, ipcMain, screen, items, onPick, fallback }) {
  const visible = items.map(({ id, label, hint, icon, separator }) => separator ? { separator: true } : { id, label, hint, icon });
  const ids = new Set(visible.filter(i => !i.separator).map(i => i.id));
  const size = { width: WIDTH, height: menuHeight(visible) };
  let menuWin = null, ready = false, failed = false, hiddenAt = 0, pendingPoint = null, watch = null;

  function hide() {
    if (!menuWin || menuWin.isDestroyed() || !menuWin.isVisible()) return;
    hiddenAt = Date.now();
    clearInterval(watch);
    menuWin.hide();
    menuWin.webContents.send('syter:tray-menu-closed');
  }
  function create() {
    menuWin = new BrowserWindow({
      ...size, show: false, frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: true, title: 'SYTER',
      webPreferences: { preload: path.join(__dirname, 'tray-menu', 'preload.js'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    menuWin.setAlwaysOnTop(true, 'pop-up-menu');
    menuWin.setMenu(null);
    const wc = menuWin.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', e => e.preventDefault());
    wc.on('did-fail-load', () => { failed = true; });
    wc.on('render-process-gone', () => { failed = true; ready = false; });
    menuWin.on('blur', hide);
    menuWin.on('closed', () => { menuWin = null; ready = false; });
    menuWin.loadFile(path.join(__dirname, 'tray-menu', 'index.html'), { query: { items: JSON.stringify(visible) } })
      .catch(() => { failed = true; });
  }
  function present(point) {
    const area = screen.getDisplayNearestPoint(point).workArea;
    menuWin.setBounds(placeMenu(point, size, area));
    menuWin.show();
    menuWin.focus();
    menuWin.webContents.send('syter:tray-menu-open');
    // Windows may refuse focus to a background app: retry once, and close the menu
    // if focus is lost without a blur event so it can never get stuck on screen.
    let wasFocused = false;
    clearInterval(watch);
    setTimeout(() => { if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible() && !menuWin.isFocused()) menuWin.focus(); }, 120);
    watch = setInterval(() => {
      if (!menuWin || menuWin.isDestroyed() || !menuWin.isVisible()) { clearInterval(watch); return; }
      if (menuWin.isFocused()) wasFocused = true; else if (wasFocused) hide();
    }, 300);
  }
  ipcMain.on('syter:tray-menu', (event, action, id) => {
    if (!menuWin || menuWin.isDestroyed() || event.sender !== menuWin.webContents) return;
    if (action === 'ready') {
      ready = true;
      if (pendingPoint) { const p = pendingPoint; pendingPoint = null; present(p); }
    } else if (action === 'close') hide();
    else if (action === 'pick' && ids.has(id)) { hide(); onPick(id); }
  });

  return {
    open() {
      // A click on the tray icon blurs (closes) an open menu first; do not reopen it at once.
      if (Date.now() - hiddenAt < 250) return;
      const point = screen.getCursorScreenPoint();
      if (failed) { fallback(); return; }
      if (!menuWin || menuWin.isDestroyed()) {
        create();
        pendingPoint = point;
        // If the first load is slow, use the native menu instead of waiting.
        setTimeout(() => { if (pendingPoint === point && !ready) { pendingPoint = null; fallback(); } }, 1200);
        return;
      }
      if (!ready) { fallback(); return; }
      if (menuWin.isVisible()) { hide(); return; }
      present(point);
    },
    hide,
    destroy() { clearInterval(watch); if (menuWin && !menuWin.isDestroyed()) menuWin.destroy(); menuWin = null; }
  };
}

module.exports = { createTrayMenu, placeMenu, menuHeight, MARGIN, WIDTH };
