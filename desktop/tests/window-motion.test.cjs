'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowMotion } = require('../window-motion');

function setup() {
  let time = 0, timer = 0, destroyed = false, frames = 0;
  const timers = new Map(), bounds = [];
  let current = { x: 0, y: 0, width: 1440, height: 900 };
  const window = { isDestroyed: () => destroyed, getBounds: () => ({ ...current }),
    setBounds: b => { current = { ...b }; bounds.push({ ...b }); } };
  const motion = createWindowMotion({
    getWindow: () => window, onFrame: () => frames++, now: () => time,
    schedule: cb => { timers.set(++timer, cb); return timer; },
    unschedule: id => timers.delete(id),
  });
  return { motion, bounds, timers, current: () => current, frames: () => frames,
    destroy: () => { destroyed = true; },
    step: ms => { time += ms; for (const cb of [...timers.values()]) cb(); } };
}
const compact = { x: 100, y: 30, width: 420, height: 730 };

test('native window follows intermediate eased bounds and ends at the exact target', async () => {
  const s = setup(), done = s.motion.move(compact);
  assert.equal(s.motion.isActive(), true);
  s.step(60);
  assert.ok(s.current().width < 1440 && s.current().width > 420);
  s.step(60); assert.equal(s.current().width, 930);
  s.step(120); assert.equal(await done, true);
  assert.deepEqual(s.current(), compact);
  assert.equal(s.frames(), 3);
  assert.equal(s.timers.size, 0);
});
test('reduced-motion preference skips timers and directly sets final bounds', async () => {
  const s = setup();
  assert.equal(await s.motion.move(compact, false), true);
  assert.deepEqual(s.current(), compact);
  assert.equal(s.timers.size, 0);
});
test('cancellation resolves the awaiting IPC and removes its timer', async () => {
  const s = setup(), done = s.motion.move(compact);
  s.step(40); s.motion.cancel();
  assert.equal(await done, false);
  assert.equal(s.motion.isActive(), false);
  assert.equal(s.timers.size, 0);
});
test('hiding/quitting can finish at the exact target before saving bounds', async () => {
  const s = setup(), done = s.motion.move(compact);
  s.step(20); s.motion.cancel(true);
  assert.equal(await done, false);
  assert.deepEqual(s.current(), compact);
});
test('an interrupted transition cannot overwrite the next transition', async () => {
  const s = setup(), first = s.motion.move(compact);
  s.step(60);
  const full = { x: 20, y: 40, width: 1200, height: 800 };
  const second = s.motion.move(full);
  assert.equal(await first, false);
  s.step(240);
  assert.equal(await second, true);
  assert.deepEqual(s.current(), full);
});
test('destroying a window during a transition cleans up and resolves safely', async () => {
  const s = setup(), done = s.motion.move(compact);
  s.destroy(); s.step(16);
  assert.equal(await done, false);
  assert.equal(s.timers.size, 0);
});
test('missing/destroyed windows do not start an animation', async () => {
  const s = setup(); s.destroy();
  assert.equal(await s.motion.move(compact), false);
});
test('fractional target coordinates are rounded once and stay exact', async () => {
  const s = setup();
  await s.motion.move({ x: 10.7, y: 21.2, width: 420.4, height: 730.7 }, false);
  assert.deepEqual(s.current(), { x: 11, y: 21, width: 420, height: 731 });
});