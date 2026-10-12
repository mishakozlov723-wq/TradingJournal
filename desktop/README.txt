SYTER desktop (.exe)
====================

The app opens https://retocker.web.app/ in its own clean window.
Site updates: just `firebase deploy --only hosting` (from TradingJournal) - the app shows them on next launch.
App updates come from GitHub Releases: https://github.com/mishakozlov723-wq/syter-releases
(Firebase's free plan does not allow .exe files on hosting.)

First time (in this desktop folder):
  npm install
  npm run build
Then upload the 3 files from desktop/release/ to a new release (tag v1.0.0) and install the .exe.

New app version (only when the window/icon/app code changes):
  npm run release
Then upload the 3 files from desktop/release/ as a new release (tag v<new version>).
Installed apps download it by themselves and offer "Restart now".

Try it without building:  npm start
Shortcuts: F5 / Ctrl+R reload, F11 fullscreen, Ctrl + / - / 0 zoom, Ctrl+Shift+I dev tools.
