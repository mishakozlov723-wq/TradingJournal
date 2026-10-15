# Native offline SYTER installer

Windows x64, .NET Framework 4.8 (present on supported Windows 10/11).
No Electron, WebView2, network dependency, browser debug port or script engine
inside the bootstrapper. Main journal and electron-updater remain Electron.
The original signed/unsigned NSIS setup is embedded as a PE resource, copied
and SHA-256-verified only after Install consent. Existing progress-session and
installed-version receipts are read from fixed HKCU 64-bit keys.

The base64 TrueType font resources are converted from the existing tracked
Poppins Latin WOFF2 regular/semibold assets; no fonts or runtimes are downloaded
at installation time. Build uses the Windows .NET Framework C# compiler.
Native test drives actual buttons with Windows UI Automation and compares
1.3.3 versus the current EXE on one disposable Windows runner. Startup figures
measure process start to visible window, not antivirus causation or all PCs.
