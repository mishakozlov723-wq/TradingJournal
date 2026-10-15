@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-Update.ps1" -RestoreOnly
echo.
pause
