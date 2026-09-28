# Kopjon public/ te instalimi i Revolution HOTEL (projekt HOTEL\hotel-system\desktop).
param()
$ErrorActionPreference = "Stop"
$desktop = Split-Path $PSScriptRoot -Parent
$public = Join-Path $desktop "public"
$dest = "C:\Program Files\Revolution HOTEL\resources\app.asar.unpacked\public"
$overlay = Join-Path $env:APPDATA "Revolution HOTEL\public-overlay"
$files = @("kasa-recepcion.html", "recepcion.html", "login.html", "css/recepcion-truffle.css")

New-Item -ItemType Directory -Force -Path $overlay | Out-Null
foreach ($f in $files) {
  Copy-Item -Force (Join-Path $public $f) (Join-Path $overlay $f)
}
Write-Host "OK overlay: $overlay"

if (-not (Test-Path "C:\Program Files\Revolution HOTEL")) {
  Write-Host "Instalimi HOTEL nuk u gjet."
  exit 0
}

$elevScript = Join-Path $env:TEMP "rev-hotel-sync-public.ps1"
@"
New-Item -ItemType Directory -Force -Path '$dest' | Out-Null
New-Item -ItemType Directory -Force -Path '$dest\css' | Out-Null
Copy-Item -Force '$public\kasa-recepcion.html' '$dest\kasa-recepcion.html'
Copy-Item -Force '$public\recepcion.html' '$dest\recepcion.html'
Copy-Item -Force '$public\login.html' '$dest\login.html'
Copy-Item -Force '$public\css\recepcion-truffle.css' '$dest\css\recepcion-truffle.css'
"@ | Set-Content -Path $elevScript -Encoding UTF8

Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $elevScript
)
Write-Host "Mbyll dhe hape perseri Revolution HOTEL."
