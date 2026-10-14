'use strict';
// Diagnostic branch only. No user content is inspected or uploaded.
const BUILD = 'resize-probe-v2';
const PREFIX = '--syter-resize-probe=';
const SOFTWARE_FLAG = '--syter-software-rendering';
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
function gpuArgs(argv, software) {
  const args = argv.slice(1).filter(arg => arg !== SOFTWARE_FLAG);
  return software ? args.concat(SOFTWARE_FLAG) : args;
}
function configureGpu(app, argv = process.argv) {
  const software = argv.includes(SOFTWARE_FLAG);
  // Electron requires this before app.whenReady(), not a renderer CSS flag.
  if (software) app.disableHardwareAcceleration();
  return software;
}
function menuItems({ app, dialog, clipboard, getWindow, current }) {
  const software = process.argv.includes(SOFTWARE_FLAG);
  return [
    { label: 'Диагностика изменения размера', submenu: MODES.map(([mode, label]) => ({
      label, type: 'radio', checked: mode === current,
      click() {
        if (mode === current) return;
        app.relaunch({ args: relaunchArgs(process.argv, mode) });
        app.quit();
      },
    })) },
    { label: 'Аппаратное ускорение · тест', type: 'checkbox', checked: !software,
      click() {
        app.relaunch({ args: gpuArgs(process.argv, !software) });
        app.quit();
      },
    },
    { label: 'Версия и графика · ' + BUILD, async click() {
      let gpu = {};
      try { gpu = await app.getGPUInfo('complete'); } catch (_) {}
      const devices = (gpu.gpuDevice || []).map(device => ({
        vendor: device.vendorString, device: device.deviceString,
        vendorId: device.vendorId, deviceId: device.deviceId, active: device.active,
        driverVendor: device.driverVendor, driverVersion: device.driverVersion,
      }));
      const aux = gpu.auxAttributes || {};
      const report = JSON.stringify({
        build: BUILD, app: app.getVersion(), mode: current,
        softwareRenderingRequested: software,
        electron: process.versions.electron, chromium: process.versions.chrome,
        platform: process.platform, graphics: app.getGPUFeatureStatus(), devices,
        backend: {
          glVendor: aux.glVendor, glRenderer: aux.glRenderer,
          directComposition: aux.directComposition, softwareRendering: aux.softwareRendering,
        },
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
    title: 'SYTER — ' + BUILD + ' · single-surface', icon, backgroundColor: '#000000',
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
module.exports = { BUILD, PREFIX, SOFTWARE_FLAG, MODES, readProbe, relaunchArgs,
  gpuArgs, configureGpu, menuItems, createSingleSurfaceWindow };