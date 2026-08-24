; License kept. Wipe local data on install. No program JS changes.
; Lock script: build\hotel-lock.ps1
;
; Shortcuts point to ProgramData\...\Start.cmd (NOT $INSTDIR, NOT %LOCALAPPDATA%).
; perMachine install runs as Admin — LOCALAPPDATA would be Admin's folder and break
; Start Menu for normal users ("no program associated").
; Open file location -> only Start.cmd.
;
; UI: oneClick + nevershow details — klienti sheh vetëm logo / progress / Hap Revolution HOTEL.
; Pa listë skedarësh, pa foldera, pa DetailPrint teknik.

!macro customHeader
  ShowInstDetails nevershow
  ShowUninstDetails nevershow
  BrandingText " "
  !ifndef MUI_FINISHPAGE_RUN_TEXT
    !define MUI_FINISHPAGE_RUN_TEXT "Hap Revolution HOTEL"
  !endif
  !ifndef MUI_TEXT_INSTALLING_TITLE
    !define MUI_TEXT_INSTALLING_TITLE "Revolution HOTEL"
  !endif
  !ifndef MUI_TEXT_INSTALLING_SUBTITLE
    !define MUI_TEXT_INSTALLING_SUBTITLE "Duke u instaluar..."
  !endif
  !ifndef MUI_TEXT_FINISH_INFO_TITLE
    !define MUI_TEXT_FINISH_INFO_TITLE "Instalimi përfundoi!"
  !endif
  !ifndef MUI_TEXT_FINISH_INFO_TEXT
    !define MUI_TEXT_FINISH_INFO_TEXT "Revolution HOTEL u instalua me sukses.$\r$\n$\r$\nKlikoni Hap Revolution HOTEL për të filluar."
  !endif
!macroend

!macro WipeHotelLocalDataDir DIR
  IfFileExists "${DIR}\*" 0 +2
    RMDir /r "${DIR}"
!macroend

!macro WipeAllHotelLocalData
  !insertmacro WipeHotelLocalDataDir "$APPDATA\Revolution HOTEL"
  !insertmacro WipeHotelLocalDataDir "$LOCALAPPDATA\Revolution HOTEL"
  !insertmacro WipeHotelLocalDataDir "$APPDATA\Revolution HOTEL Pako"
  !insertmacro WipeHotelLocalDataDir "$LOCALAPPDATA\Revolution HOTEL Pako"
  !insertmacro WipeHotelLocalDataDir "$APPDATA\Revolution HOTEL Pako AI"
  !insertmacro WipeHotelLocalDataDir "$LOCALAPPDATA\Revolution HOTEL Pako AI"
!macroend

!macro HotelLaunchDir
  ; Shared for all users (perMachine). Do not use LOCALAPPDATA (Admin-only path).
  ; ReadEnvStr — $COMMONAPPDATA breaks when PRODUCT_NAME has spaces (NSIS var parse).
  ReadEnvStr $R7 "PROGRAMDATA"
  StrCmp $R7 "" 0 +2
    StrCpy $R7 "C:\ProgramData"
  StrCpy $R7 "$R7\RevolutionInvest\${PRODUCT_NAME}-Launch"
!macroend

!macro WriteHotelLaunchStub
  !insertmacro HotelLaunchDir
  ; Remove broken legacy launchers (Admin LOCALAPPDATA + .vbs).
  RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}-Launch"
  RMDir /r "$R7"
  CreateDirectory "$R7"
  FileOpen $R8 "$R7\Start.cmd" w
  FileWrite $R8 "@echo off$\r$\n"
  ; Use $" not $"" — the latter closes the NSIS string early (FileWrite 4 params).
  FileWrite $R8 "start $\"$\" $\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\"$\r$\n"
  FileClose $R8
!macroend

!macro customUnInstall
  !insertmacro HotelLaunchDir
  RMDir /r "$R7"
  RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}-Launch"
  ; Hardware lock: fshi salt/hw-lic VETËM në çinstalim të vërtetë.
  ; Gjatë UPDATE (instalim mbi të vjetrin) electron-builder e vë isUpdated=true
  ; — MOS fshi, përndryshe HARDWARE_ID ndryshon dhe licenca thyhet.
  ${ifNot} ${isUpdated}
    Delete "$APPDATA\RevolutionInvest\HotelLicense\.install-salt"
    Delete "$APPDATA\RevolutionInvest\HotelLicense\.hw-lic"
    RMDir "$APPDATA\RevolutionInvest\HotelLicense"
  ${endIf}
!macroend

!macro customInit
  ; USB one-time: nëse paketa USB (.usb-pack) është përdorur tashmë → ndalo.
  IfFileExists "$EXEDIR\.usb-pack" 0 hotel_skip_usb_used_check
    IfFileExists "$EXEDIR\.installed" 0 hotel_skip_usb_used_check
      MessageBox MB_OK|MB_ICONSTOP "Kjo USB është përdorur tashmë.$\r$\n$\r$\nKontaktoni +383 48707880 për USB të re / kod të ri."
      Abort
  hotel_skip_usb_used_check:

  ExecWait 'cmd /c icacls "$INSTDIR" /reset /T /Q' $0
  ExecWait 'cmd /c attrib -H -S "$INSTDIR" /S /D' $0
  ExecWait 'cmd /c taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T 2>nul' $0
  ExecWait 'cmd /c taskkill /F /IM "Revolution HOTEL.exe" /T 2>nul' $0
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "C:\Users\Public\Desktop\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\Revolution HOTEL Pako.lnk"
  Delete "$DESKTOP\Revolution HOTEL Pako AI.lnk"
  Sleep 1200
!macroend

!macro customInstall
  SetDetailsPrint none
  SetDetailsView hide

  !insertmacro WipeAllHotelLocalData
  Delete "$DESKTOP\Revolution HOTEL Pako.lnk"
  Delete "$DESKTOP\Revolution HOTEL Pako AI.lnk"
  Delete "$SMPROGRAMS\Revolution HOTEL Pako.lnk"
  Delete "$SMPROGRAMS\Revolution HOTEL Pako AI.lnk"

  ; Lock + fsheh $INSTDIR (attrib +H) — klienti sheh vetëm ikonën Desktop.
  File "/oname=$PLUGINSDIR\hotel-lock.ps1" "${BUILD_RESOURCES_DIR}\hotel-lock.ps1"
  ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\hotel-lock.ps1" -Dir "$INSTDIR"' $0
  FileOpen $R9 "$TEMP\hotel-lock-exit.txt" w
  FileWrite $R9 "$0"
  FileClose $R9
  ; Siguro huajtjen e folderit edhe nëse lock script dështon pjesërisht.
  ExecWait 'cmd /c attrib +H "$INSTDIR"' $0

  ; Launcher stub + ikona e dukshme (jo nga $INSTDIR i fshehur — Windows ruan ikonën e vjetër RH).
  !insertmacro WriteHotelLaunchStub
  !insertmacro HotelLaunchDir
  SetOutPath "$R7"
  File "/oname=$R7\app.ico" "${BUILD_RESOURCES_DIR}\icon.ico"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$R7\Start.cmd" "" "$R7\app.ico" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$R7\Start.cmd" "" "$R7\app.ico" 0
  CreateShortCut "C:\Users\Public\Desktop\${PRODUCT_NAME}.lnk" "$R7\Start.cmd" "" "$R7\app.ico" 0
  CreateShortCut "$newDesktopLink" "$R7\Start.cmd" "" "$R7\app.ico" 0
  CreateShortCut "$newStartMenuLink" "$R7\Start.cmd" "" "$R7\app.ico" 0
  StrCpy $launchLink "$newDesktopLink"
  ExecWait 'cmd /c attrib +H "$R7\app.ico"' $0

  ; Windows Firewall — allow in/out që Windows mos shfaqë dritaren e bllokimit.
  ExecWait 'netsh advfirewall firewall delete rule name="Revolution HOTEL"' $0
  ExecWait 'netsh advfirewall firewall add rule name="Revolution HOTEL" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes' $0
  ExecWait 'netsh advfirewall firewall add rule name="Revolution HOTEL" dir=out action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes' $0

  ; Install-salt (UUID) — VETËM nëse mungon. Update NUK e prek.
  IfFileExists "$APPDATA\RevolutionInvest\HotelLicense\.install-salt" hotel_salt_skip
    File "/oname=$PLUGINSDIR\create-install-salt.ps1" "${BUILD_RESOURCES_DIR}\create-install-salt.ps1"
    ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\create-install-salt.ps1"' $0
    Goto hotel_salt_done
  hotel_salt_skip:
  hotel_salt_done:

  ; USB one-time marker — vetëm për paketat e përgatitura me prepare-usb (.usb-pack).
  IfFileExists "$EXEDIR\.usb-pack" 0 hotel_skip_usb_mark
    FileOpen $R6 "$EXEDIR\.installed" w
    FileWrite $R6 "used$\r$\n"
    FileClose $R6
    ExecWait 'cmd /c attrib +H +S +R "$EXEDIR\.installed"' $0
  hotel_skip_usb_mark:
!macroend
