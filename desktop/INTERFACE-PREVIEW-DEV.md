# Private site-interface integration

SYTER 1.3.0 consumes **Ctrl+Shift+0** in the focused trusted journal view and
dispatches `syter:interface-preview-toggle` on that page's `window`.
Ordinary Ctrl+0 still resets zoom. There is no tray item, title text or user hint.

No alternative website URL or new interface has been supplied yet. The hook
does not navigate, reload, persist a preference or modify journal data.
Until the site implements a listener, it intentionally has no visible effect.

When implementing the new interface, the site listener must check the signed-in
developer's authorization before toggling. The shortcut is NOT a security
boundary, and must never grant developer access to other accounts.
This document is not bundled in the installer.