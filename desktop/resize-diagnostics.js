'use strict';
// Diagnostic branch only. No user content is inspected or uploaded.
const BUILD = 'resize-probe-v1';
const PREFIX = '--syter-resize-probe=';
const MODES = [
  ['baseline', '1 · Обычная оболочка'],
  ['overlay-off', '2 · Без окна анимации'],
  ['native-frame', '3 · Рамка Windows, отдельная область сайта'],
  ['single-surface', '4 · Рамка Windows, сайт в одном окне'],
];
function readProbe(argv = process.argv) {
  const value = argv.find(arg => arg.startsWith(PREFIX))?.slice(PREFIX.length);
  return MODES.some(([mode]) => mode === value) ? value : 'baseline';
}
function relaunchArgs(argv, mode) {
  if (!MODES.some(([id]) => id === mode)) throw Error('Unknown resize probe');
  return argv.slice(1).filter(arg => !arg.startsWith(PREFIX)).concat(PREFIX + mode);
}
function menuItems({ app, dialog, clipboard, getWindow, current }) {
  return [
    { label: 'Диагностика изменения размера', submenu: MODES.map(([mode, label]) => ({
      label, type: 'radio', checked: mode === current,
      click() {
        if (mode === current) return;
        app.relaunch({ args: relaunchArgs(process.argv, mode) });
        app.quit();
      },
    })) },
    { label: 'Версия и графика · ' + BUILD, async click() {
      let gpu = {};
      try { gpu = await app.getGPUInfo('basic'); } catch (_) {}
      const devices = (gpu.gpuDevice || []).map(device => ({
        vendor: device.vendorString, device: device.deviceString,
        vendorId: device.vendorId, deviceId: device.deviceId, active: device.active,
      }));
      const report = JSON.stringify({
        build: BUILD, app: app.getVersion(), mode: current,
        electron: process.versions.electron, chromium: process.versions.chrome,
        platform: process.platform, graphics: app.getGPUFeatureStatus(), devices,
      }, null, 2);
      const result = await dialog.showMessageBox(getWindow(), {
        type: 'info', title: 'SYTER — диагностика',
        message: 'Сборка ' + BUILD + ' · режим ' + current,
        detail: report, buttons: ['Закрыть', 'Скопировать'], defaultId: 0,
      });
      if (result.response === 1) clipboard.writeText(report);
    } },
  ];
}
function createSingleSurfaceWindow({ BrowserWindow, icon, url, installLinkHandlers }) {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 380, minHeight: 500, show: false,
    title: 'SYTER — диагностика · single-surface', icon, backgroundColor: '#000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      spellcheck: false },
  });
  win.webContents.on('page-title-updated', event => event.preventDefault());
  installLinkHandlers(win.webContents);
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift &&
        String(input.key).toLowerCase() === 'i') {
      event.preventDefault(); win.webContents.toggleDevTools();
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(url).catch(error => console.warn('Diagnostic site load failed:', error.message));
  return win;
}
module.exports = { BUILD, PREFIX, MODES, readProbe, relaunchArgs, menuItems, createSingleSurfaceWindow };