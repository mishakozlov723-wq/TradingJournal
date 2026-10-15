# Branded desktop installation and updates — test build 1.3.2

Not a website change. Stable main and public releases stay untouched while this branch is tested.

## Installation

The user-facing offline EXE is `SYTER-Install-1.3.2.exe`. It opens a local, sandboxed Electron window styled with the site's Poppins, #050608 background, #0c0e13 panels and #34d399 action buttons. Fonts and logo are embedded.

Install → verify embedded payload (SHA-256, real byte progress) → silent current-user NSIS installation (indeterminate progress, not a simulated percentage) → verify installed version and executable → Launch SYTER. Running the installer does not delete the journal profile. Launch only happens on the user's button press. A payload failure cannot produce a successful completion screen.

The bootstrapper contains a second Electron runtime; it is intentionally larger than the inner NSIS installer. It uses electron-builder's portable silent extraction, no additional WebView runtime/download. Windows may still show its own SmartScreen/UAC UI; those are not part of SYTER and cannot be branded. Signature/SmartScreen reputation is not created by this change.

## Updates

The app checks the same syter-releases feed. Available → Update now or Later → actual electron-updater download percentage → Restart and install. The restart uses `quitAndInstall(true, true)` supported by installed electron-updater. Neither declining the download nor declining restart auto-installs on quit. Closing the update window leaves an ongoing download running; it can be reopened automatically when ready. Later reminds after six hours during the same app session; a subsequent launch rechecks after five seconds.

Release notes are rendered as bounded plain text, never HTML. IPC only allows fixed actions from the local lifecycle window's main frame. Remote website renderers cannot trigger installation or supply paths.

The ordinary `SYTER-Setup-1.3.2.exe`, blockmap and `latest.yml` remain the update payload, not the branded bootstrapper. Do not point latest.yml at the bootstrapper. Existing 1.3.0 users will see their OLD prompt for the single transition to 1.3.1; the new prompt applies to subsequent updates from 1.3.1 onward. Existing update binaries cannot be retroactively changed.

## Build and release

Use Actions → Verify and build SYTER desktop → feature/branded-install-update → publish=false. Build artifacts include both installers and native screenshots. Publishing is additionally disabled for any branch except main. No public release until user confirmation.

Test coverage: consent/state/retry/security unit tests; native Electron IPC/rendered windows; real delivered bootstrapper EXE → silent NSIS installation → registry/version/executable and data sentinel verification on a disposable Windows runner. Windows native tests do not use a real trading account.

## Compact revision 1.3.2

Removed the version card, footer caption and decorative status dot. Installer is a fixed 520×440 window throughout preparation, installation, completion and Launch. Update window remains fixed 520×540. No phase calls setSize/setBounds/setContentSize. Version/platform are inline; actual installation path comes from NSIS, not an invented default.

Verification is an honest short stage without a percentage bar. The file-work percentage is `(bytes unpacked + bytes successfully copied) / (2 × archive uncompressed bytes)`. Unpacking bytes come directly from Nsis7z::ExtractWithCallback. Copied bytes count only after each file copy succeeds. This is work completed, not estimated time, and may move unevenly with large files. Real finalization (installer cache, registry, shortcuts) shows shimmer after file work is complete. No artificial delay or timer-generated percentage.

The NSIS adapter is generated from locked electron-builder 26.15.3 templates without editing node_modules. Ordinary electron-updater installs, without our session ID, retain the exact upstream extraction/retry implementation. The branded path uses bounded file-copy retries and fails nonzero if copying fails or byte counts disagree. Progress is session-scoped; stale receipts cannot start a reinstall at 100%.
