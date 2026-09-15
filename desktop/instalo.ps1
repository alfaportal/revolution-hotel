# USB install — Revolution HOTEL (NSIS Setup).
# Ekzekuto instalo.bat si Admin. Instalon Setup nga USB dhe krijon marker one-time.
$ErrorActionPreference = "Stop"

$UsbRoot = $PSScriptRoot
$LogPath = Join-Path $env:TEMP "hotel-usb-instalo.log"
$ProductName = "Revolution HOTEL"

function Write-Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Find-SetupExe {
  $names = @(
    "Instalo Revolution HOTEL.exe",
    "Instalo HOTEL.exe"
  )
  foreach ($n in $names) {
    $p = Join-Path $UsbRoot $n
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $hit = Get-ChildItem -LiteralPath $UsbRoot -Filter "Revolution HOTEL Setup *.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

Remove-Item $LogPath -Force -ErrorAction SilentlyContinue
try {
  Write-Log "START USB install HOTEL"
  Write-Log "USB=$UsbRoot"

  $setup = Find-SetupExe
  if (-not $setup) {
    throw "Nuk u gjet Setup i Revolution HOTEL ne USB. Kopjo 'Revolution HOTEL Setup *.exe' ose 'Instalo Revolution HOTEL.exe' prane instalo.bat."
  }
  Write-Log "Setup=$setup"

  if (Test-Path -LiteralPath (Join-Path $UsbRoot ".usb-pack")) {
    if (Test-Path -LiteralPath (Join-Path $UsbRoot ".installed")) {
      throw "Kjo USB eshte perdorur tashme. Kontaktoni +383 48707880 per USB te re."
    }
  }

  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "Revolution HOTEL" } | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 2

  Write-Log "Running silent install..."
  $proc = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
  if ($proc.ExitCode -ne 0) {
    throw "Instaluesi deshtoi me kod $($proc.ExitCode)."
  }
  Write-Log "Setup OK"

  if (Test-Path -LiteralPath (Join-Path $UsbRoot ".usb-pack")) {
    Set-Content -Path (Join-Path $UsbRoot ".installed") -Value "used" -Encoding ASCII
    cmd.exe /c "attrib +H +S +R `"$UsbRoot\.installed`"" | Out-Null
    Write-Log "USB one-time marker written"
  }

  Write-Log "DONE"
  Write-Host ""
  Write-Host "Instalimi perfundoi. Ikona '$ProductName' eshte ne Desktop."
  Write-Host "Log: $LogPath"
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show(
      "Instalimi perfundoi.`nIkona eshte ne Desktop.`n`nLog: $LogPath",
      $ProductName,
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  } catch {}
} catch {
  $msg = $_.Exception.Message
  try { Write-Log ("FAIL: " + $msg) } catch {}
  Write-Host ""
  Write-Host ("DESHTOI: " + $msg) -ForegroundColor Red
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show(
      $msg + "`n`nLog: $LogPath",
      "$ProductName — gabim",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {}
  throw
}
