// Styled tray menu (journal look) shown on tray right-click instead of the
// native Windows menu, which cannot be styled. The native menu stays as a
// fallback when the styled window is not ready or fails to load.
// The menu grows out of the click point and shrinks back into it on close.
'use strict';
const path = require('path');

const MARGIN = 10;          // transparent space around the card for its shadow
const WIDTH = 268;          // window width including margins
const ROW = 36, SEP = 9, PAD = 6, BORDER = 1, FOOTER = 30;
const CLOSE_MS = 170;       // must match the close animation in menu.css (+ small slack below)

function menuHeight(items, withFooter = true) {
  let h = 2 * (MARGIN + PAD + BORDER) + (withFooter ? FOOTER : 0);
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

// Click point relative to the menu window: the animation origin.
function originFor(point, bounds) {
  return { x: Math.round(point.x - bounds.x), y: Math.round(point.y - bounds.y) };
}

function createTrayMenu({ BrowserWindow, ipcMain, screen, items, version, onPick, fallback }) {
  const visible = items.map(({ id, label, hint, icon, separator }) => separator ? { separator: true } : { id, label, hint, icon });
  const ids = new Set(visible.filter(i => !i.separator).map(i => i.id));
  const size = { width: WIDTH, height: menuHeight(visible) };
  let menuWin = null, ready = false, failed = false, hiddenAt = 0, pendingPoint = null, watch = null;
  let closing = false, closeTimer = null;

  function finishHide() {
    clearTimeout(closeTimer); closeTimer = null;
    if (!closing) return;
    closing = false;
    if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
  }
  function hide() {
    if (!menuWin || menuWin.isDestroyed() || !menuWin.isVisible() || closing) return;
    hiddenAt = Date.now();
    clearInterval(watch);
    closing = true;
    // The page plays the shrink animation, then reports back; the timer is a safety net.
    menuWin.webContents.send('syter:tray-menu-close');
    closeTimer = setTimeout(finishHide, CLOSE_MS + 120);
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
    menuWin.on('closed', () => { menuWin = null; ready = false; closing = false; clearTimeout(closeTimer); });
    menuWin.loadFile(path.join(__dirname, 'tray-menu', 'index.html'),
      { query: { items: JSON.stringify(visible), version: String(version || '') } })
      .catch(() => { failed = true; });
  }
  function present(point) {
    clearTimeout(closeTimer); closeTimer = null; closing = false;
    const area = screen.getDisplayNearestPoint(point).workArea;
    const bounds = placeMenu(point, size, area);
    menuWin.setBounds(bounds);
    // The page starts collapsed at the origin before the window becomes visible.
    menuWin.webContents.send('syter:tray-menu-open', originFor(point, bounds));
    menuWin.show();
    menuWin.focus();
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
    else if (action === 'closed') finishHide();
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
      if (menuWin.isVisible() && !closing) { hide(); return; }
      present(point);
    },
    hide,
    destroy() { clearInterval(watch); clearTimeout(closeTimer); if (menuWin && !menuWin.isDestroyed()) menuWin.destroy(); menuWin = null; }
  };
}

module.exports = { createTrayMenu, placeMenu, menuHeight, originFor, MARGIN, WIDTH, CLOSE_MS };
