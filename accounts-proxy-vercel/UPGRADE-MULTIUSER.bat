@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPGRADE-MULTIUSER.ps1"
if errorlevel 1 (
  echo.
  echo Upgrade stopped with an error. Take a screenshot and send it to ChatGPT.
  pause
)
