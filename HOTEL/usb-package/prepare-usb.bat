@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "ROOT=%~dp0.."
set "DIST=%ROOT%\dist"

echo.
echo === Revolution HOTEL USB prepare ===
echo.
echo Klienti ne USB sheh VETEM:
echo   - Instalo Revolution HOTEL.exe
echo   - README.txt
echo Asgje tjeter (.blockmap, foldera, ikona, autorun — JO).
echo.

REM Gjej Setup.exe me versionin me te ri nga dist/ (vetem .exe, JO .blockmap)
set "SETUP="
for /f "delims=" %%F in ('dir /b /a:-d /o:-n "%DIST%\Revolution HOTEL Setup *.exe" 2^>nul') do (
  if /i "%%~xF"==".exe" if not defined SETUP set "SETUP=%DIST%\%%F"
)

if not defined SETUP (
  echo [GABIM] Nuk u gjet asnje "Revolution HOTEL Setup *.exe" ne:
  echo   %DIST%
  echo Bej me pare: npm run build
  exit /b 1
)

echo Kopjohet: %SETUP%
copy /Y "%SETUP%" "%~dp0Instalo Revolution HOTEL.exe" >nul
if errorlevel 1 (
  echo [GABIM] Kopjimi i Setup deshtoi.
  exit /b 1
)
echo   -^> Instalo Revolution HOTEL.exe

if not exist "%~dp0README.txt" (
  echo [GABIM] Mungon README.txt ne usb-package\
  exit /b 1
)
echo   -^> README.txt (mbetet)

REM Marker USB (instaluesi e njeh si pakete one-time). Hiq .installed te vjeter — USB e re.
attrib -H -S -R "%~dp0.installed" >nul 2>&1
del /f /q "%~dp0.installed" >nul 2>&1
echo hotel-usb> "%~dp0.usb-pack"
attrib +H +S "%~dp0.usb-pack" >nul 2>&1
echo   -^> .usb-pack (i fshehur) — USB one-time

REM Fshi CDO folder (node_modules, fiscal, dist, src, etj.)
for /f "delims=" %%D in ('dir /b /a:d "%~dp0" 2^>nul') do (
  echo [PASTRIM] Fshihet folderi: %%D
  rd /s /q "%~dp0%%D"
)

REM Mbaj VETEM: Instalo Revolution HOTEL.exe, README.txt, .usb-pack, prepare-usb.bat (dev).
for /f "delims=" %%F in ('dir /b /a:-d "%~dp0" 2^>nul') do (
  if /i not "%%F"=="Instalo Revolution HOTEL.exe" if /i not "%%F"=="README.txt" if /i not "%%F"=="prepare-usb.bat" if /i not "%%F"==".usb-pack" if /i not "%%F"==".installed" (
    echo [PASTRIM] Fshihet: %%F
    del /f /q "%~dp0%%F"
  )
)

echo.
echo ========================================
echo USB gati.
echo.
echo Kopjo ne USB stick VETEM keto (nga usb-package\):
echo   1. Instalo Revolution HOTEL.exe
echo   2. README.txt
echo   3. .usb-pack   ^(i fshehur — duhet per one-time; mos e fshi^)
echo.
echo MOS kopjo: prepare-usb.bat, .blockmap, foldera, asgje tjeter.
echo ========================================
echo.
pause
endlocal
