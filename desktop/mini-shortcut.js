'use strict';

// Electron 38 maps ` to Windows VKEY_OEM_3, the physical Ё / ` key.
// Do not register a Cyrillic accelerator: it would be layout-dependent.
const ACCELERATOR = 'Control+Shift+`';
const LABEL = 'Ctrl + Shift + Ё';

function createMiniShortcut({ globalShortcut, onToggle, onUnavailable, now = () => performance.now() }) {
  let registered = false;
  let disposed = false;
  let lastToggle = -Infinity;

  function toggle() {
    if (disposed || now() - lastToggle < 400) return false;
    lastToggle = now();
    onToggle();
    return true;
  }

  return {
    register() {
      if (disposed || registered) return registered;
      try { registered = globalShortcut.register(ACCELERATOR, toggle); }
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
      return toggle();
    },
    dispose() {
      disposed = true;
      if (registered) globalShortcut.unregister(ACCELERATOR);
      registered = false;
    },
  };
}

module.exports = { ACCELERATOR, LABEL, createMiniShortcut };