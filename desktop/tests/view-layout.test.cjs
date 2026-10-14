'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createViewLayout } = require('../view-layout');
function fixture() {
  let outer = { x: 20, y: 30, width: 920, height: 740 };
  let size = [900, 700], fullscreen = false, maximized = false, destroyed = false;
  const calls = [];
  let view = { setBounds: bounds => calls.push(bounds) };
  const win = { getBounds: () => outer, getContentSize: () => size,
    isFullScreen: () => fullscreen, isMaximized: () => maximized,
    isDestroyed: () => destroyed };
  const api = createViewLayout({ getWindow: () => win, getView: () => view });
  return { api, calls, set(w, h) { outer = { ...outer, width: w, height: h }; size = [w - 20, h - 40]; },
    fullscreen(on) { fullscreen = on; }, maximized(on) { maximized = on; },
    destroy() { destroyed = true; },
    replaceView() { view = { setBounds: bounds => calls.push(bounds) }; } };
}
test('initial layout leaves the original 36 DIP title bar', () => {
  const f = fixture(); f.api.layout();
  assert.deepEqual(f.calls, [{ x: 0, y: 36, width: 900, height: 664 }]);
});
test('manual resize pre-sizes the child using measured native margins', () => {
  const f = fixture(); f.api.beforeResize({ width: 820, height: 640 });
  assert.deepEqual(f.calls, [{ x: 0, y: 36, width: 800, height: 564 }]);
});
test('the following resize event does not reapply identical bounds', () => {
  const f = fixture(); f.api.beforeResize({ width: 820, height: 640 });
  f.set(820, 640); f.api.layout(); f.api.layout();
  assert.equal(f.calls.length, 1);
});
test('post-resize corrects a prediction after an OS constraint or DPI change', () => {
  const f = fixture(); f.api.beforeResize({ width: 820, height: 640 });
  f.set(830, 650); f.api.layout();
  assert.deepEqual(f.calls.at(-1), { x: 0, y: 36, width: 810, height: 574 });
});
test('fullscreen and maximize use final actual content geometry', () => {
  const f = fixture(); f.fullscreen(true);
  f.api.beforeResize({ width: 1100, height: 800 }); assert.equal(f.calls.length, 0);
  f.api.layout(); assert.equal(f.calls[0].y, 0); assert.equal(f.calls[0].height, 700);
  f.fullscreen(false); f.maximized(true); f.api.beforeResize({ width: 1100, height: 800 });
  f.api.layout(); assert.equal(f.calls[1].y, 36);
});
test('invalid and destroyed-window events cannot mutate the child', () => {
  const f = fixture(); f.api.beforeResize({ width: NaN, height: 500 });
  f.api.beforeResize(null); f.destroy(); f.api.layout();
  f.api.beforeResize({ width: 820, height: 640 }); assert.equal(f.calls.length, 0);
});
test('a replacement view receives its initial bounds even at the same size', () => {
  const f = fixture(); f.api.layout(); f.replaceView(); f.api.layout();
  assert.equal(f.calls.length, 2);
});
test('production no longer injects or packages the animation-pause feature', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const config = require('../package.json');
  assert.ok(!source.includes("'resize-performance.js'"));
  assert.ok(!source.includes("'resize-performance.css'"));
  assert.ok(!config.build.files.some(file => /^resize-performance\./.test(file)));
  assert.ok(source.includes("win.on('will-resize'"));
  assert.ok(config.build.files.includes('view-layout.js'));
});