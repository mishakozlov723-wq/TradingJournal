'use strict';

// Electron 38 maps ` to Windows VKEY_OEM_3, the physical Ё / ` key.
// Do not register a Cyrillic accelerator: it would be layout-dependent.
const ACCELERATOR = 'Control+Shift+`';
const LABEL = 'Ctrl + Shift + Ё';
// While the keys are HELD, Windows keeps calling a global shortcut: after the
// keyboard repeat delay (250-1000 ms), then every 33-400 ms
// (electron/electron#39718). The old 400 ms debounce let such a repeat arrive
// right after the transition, so the mini journal opened and collapsed again.
// A callback is a new press only after a pause longer than any repeat interval
// and only when the last toggle is older than the longest repeat delay.
const HOLD_GAP_MS = 450;
const PRESS_INTERVAL_MS = 1100;
// The focused fallback sees real key-downs and filters isAutoRepeat itself.
const FOCUSED_INTERVAL_MS = 400;

function createMiniShortcut({ globalShortcut, onToggle, onUnavailable, now = () => performance.now() }) {
  let registered = false;
  let disposed = false;
  let lastToggle = -Infinity;
  let lastEvent = -Infinity;

  function toggle(t) {
    lastToggle = t;
    onToggle();
    return true;
  }
  function onGlobal() {
    const t = now();
    const held = t - lastEvent < HOLD_GAP_MS || t - lastToggle < PRESS_INTERVAL_MS;
    lastEvent = t;
    if (disposed || held) return false;
    return toggle(t);
  }

  return {
    register() {
      if (disposed || registered) return registered;
      try { registered = globalShortcut.register(ACCELERATOR, onGlobal); }
      catch (err) { if (onUnavailable) onUnavailable(err); return false; }
      if (!registered && onUnavailable) onUnavailable();
      return registered;
    },
    // If another program owns the global shortcut, it can still work while
    // SYTER has focus. Use the physical code, never the typed ё / ~ character.
    handleFocusedInput(event, input) {
      if (registered || disposed || input.type !== 'keyDown' || input.isAutoRepeat ||
          !input.control || !input.shift || input.alt || input.meta || input.code !== 'Backquote') return false;
      event.preventDefault();
      const t = now();
      if (t - lastToggle < FOCUSED_INTERVAL_MS) return false;
      return toggle(t);
    },
    dispose() {
      disposed = true;
      if (registered) globalShortcut.unregister(ACCELERATOR);
      registered = false;
    },
  };
}

module.exports = { ACCELERATOR, LABEL, createMiniShortcut };
