'use strict';

// No timers, screenshots, renderer JS or animation overrides in the resize path.
function createViewLayout({ getWindow, getView, titlebarHeight = 36 }) {
  let lastView = null, lastBounds = null;
  function apply(width, height, fullscreen) {
    const view = getView();
    if (!view) return;
    const top = fullscreen ? 0 : titlebarHeight;
    const next = { x: 0, y: top, width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height) - top) };
    if (view === lastView && lastBounds &&
        Object.keys(next).every(key => next[key] === lastBounds[key])) return;
    view.setBounds(next);
    lastView = view;
    lastBounds = next;
  }
  function layout() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    apply(width, height, win.isFullScreen());
  }
  return { layout };
}
module.exports = { createViewLayout };