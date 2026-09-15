@echo off
REM One-click USB install for Revolution HOTEL (NSIS Setup).
REM Run as Admin. Runs silent Setup from USB.
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Kerkohet Admin - konfirmo UAC...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)
echo.
echo === Revolution HOTEL Instalim ===
echo.
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0instalo.ps1"
set ERR=%ERRORLEVEL%
if %ERR% neq 0 (
  echo.
  echo INSTALIMI DESHTOI (kodi %ERR%).
  echo Shiko log: %TEMP%\hotel-usb-instalo.log
  echo.
  pause
  exit /b %ERR%
)
echo.
pause
exit /b 0
