'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { placeMenu, menuHeight, WIDTH } = require('../tray-menu');
const root = path.join(__dirname, '..');
const size = { width: WIDTH, height: menuHeight([{}, {}, { separator: true }, {}]) };
const area = { x: 0, y: 0, width: 1920, height: 1040 };
const inside = b => b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height;

test('tray menu stays inside the work area for any taskbar side', () => {
  for (const point of [{ x: 1850, y: 1060 }, { x: 1910, y: 1075 }, { x: 20, y: 500 }, { x: 1900, y: 500 }, { x: 960, y: 10 }, { x: 5, y: 1075 }]) {
    assert.ok(inside(placeMenu(point, size, area)), JSON.stringify(point));
  }
  const bottom = placeMenu({ x: 1850, y: 1060 }, size, area);
  assert.equal(bottom.y + bottom.height, area.y + area.height, 'sits right above a bottom taskbar');
});

test('tray menu is packaged and keeps the native menu as fallback', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('tray-menu.js') && pkg.build.files.includes('tray-menu/**/*'));
  for (const f of ['index.html', 'menu.css', 'menu.js', 'preload.js', 'fonts/montserrat-cyrillic-wght-normal.woff2']) assert.ok(fs.existsSync(path.join(root, 'tray-menu', f)), f);
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /tray\.on\('right-click'/);
  assert.match(main, /popUpContextMenu\(nativeMenu\)/);
  assert.doesNotMatch(main, /tray\.setContextMenu\(/);
});

test('tray menu never takes focus, so the Windows tray overflow panel stays open', () => {
  const src = fs.readFileSync(path.join(root, 'tray-menu.js'), 'utf8');
  assert.doesNotMatch(src, /focusable:\s*true/);
  assert.doesNotMatch(src, /\.focus\(\)/);
  assert.match(src, /menuWin\.showInactive\(\)/);
  assert.ok(fs.existsSync(path.join(root, 'tray-menu', 'catcher.html')));
});
