// Keep decorative animation work out of live window resizing. This runs in the
// hosted journal only; no chart, form, scroll position or application state moves.
(() => {
  'use strict';
  if (window.syterResizePerformance) return;
  const root = document.documentElement;
  let width = window.innerWidth, height = window.innerHeight, timer = null;
  const finish = () => {
    clearTimeout(timer);
    timer = null;
    root.classList.remove('syter-window-resizing');
  };
  const resize = () => {
    if (width === window.innerWidth && height === window.innerHeight) return;
    width = window.innerWidth;
    height = window.innerHeight;
    root.classList.add('syter-window-resizing');
    clearTimeout(timer);
    // Trailing edge only: never delay the actual page layout or chart resizing.
    timer = setTimeout(finish, 160);
  };
  const visibility = () => { if (document.hidden) finish(); };
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', finish);
  document.addEventListener('visibilitychange', visibility);
  window.syterResizePerformance = { dispose() {
    finish();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', finish);
    document.removeEventListener('visibilitychange', visibility);
    delete window.syterResizePerformance;
  } };
})();
