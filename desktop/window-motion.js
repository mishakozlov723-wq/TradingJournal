'use strict';

// Animate the existing native window, not a second BrowserWindow or a new page.
function createWindowMotion({
  getWindow, onFrame = () => {}, duration = 240,
  now = () => performance.now(),
  schedule = callback => setInterval(callback, 16),
  unschedule = clearInterval,
}) {
  let task = null;
  const available = w => w && !w.isDestroyed();
  const round = bounds => Object.fromEntries(
    ['x', 'y', 'width', 'height'].map(key => [key, Math.round(bounds[key])]));

  function cancel(finish = false) {
    if (!task) return;
    const previous = task;
    task = null;
    unschedule(previous.timer);
    try {
      const w = getWindow();
      if (finish && available(w)) { w.setBounds(previous.target); onFrame(); }
    } catch (_) {
      // Quitting/navigation must never fail because a native window vanished.
    } finally { previous.resolve(false); }
  }

  function move(bounds, animate = true) {
    cancel();
    const w = getWindow();
    if (!available(w)) return Promise.resolve(false);
    const target = round(bounds);
    const start = w.getBounds();
    if (!animate || duration <= 0 ||
        Object.keys(target).every(key => target[key] === start[key])) {
      w.setBounds(target);
      onFrame();
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const started = now();
      const current = { target, resolve, timer: null };
      task = current;
      current.timer = schedule(() => {
        if (task !== current) return;
        const window = getWindow();
        if (!available(window)) { cancel(); return; }
        const t = Math.min(1, Math.max(0, (now() - started) / duration));
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        try {
          window.setBounds(round(Object.fromEntries(
            Object.keys(target).map(key => [key, start[key] + (target[key] - start[key]) * eased]))));
          onFrame();
        } catch (_) { cancel(); return; }
        if (t === 1) {
          task = null;
          unschedule(current.timer);
          resolve(true);
        }
      });
    });
  }

  return { move, cancel, isActive: () => !!task };
}

module.exports = { createWindowMotion };