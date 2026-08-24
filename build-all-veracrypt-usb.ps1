# Revolution HOTEL — USB përgatitje (NSIS Setup, jo VeraCrypt).
# Përdor: HOTEL\usb-package\prepare-usb.bat → kopjo përmbajtjen në USB.
$ErrorActionPreference = "Stop"
$HotelRoot = Split-Path -Parent $PSScriptRoot
$UsbPackage = Join-Path $HotelRoot "usb-package"
$DistDir = Join-Path $HotelRoot "dist"
$Log = Join-Path $env:TEMP "hotel-usb-prepare.log"

function W($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Add-Content $Log $line -Encoding UTF8
  Write-Host $line
}

Remove-Item $Log -Force -ErrorAction SilentlyContinue
W "START hotel USB prepare"

$prepareBat = Join-Path $UsbPackage "prepare-usb.bat"
if (-not (Test-Path -LiteralPath $prepareBat)) {
  throw "Mungon usb-package\prepare-usb.bat"
}

Push-Location $UsbPackage
try {
  cmd.exe /c "prepare-usb.bat"
  if ($LASTEXITCODE -ne 0) { throw "prepare-usb.bat deshtoi me kod $LASTEXITCODE" }
} finally {
  Pop-Location
}

W "DONE — kopjo nga $UsbPackage ne USB (Instalo Revolution HOTEL.exe + README.txt + .usb-pack)"
