# Kopjon public/ te instalimi i Revolution HOTEL (projekt HOTEL\hotel-system\desktop).
param()
$ErrorActionPreference = "Stop"
$desktop = Split-Path $PSScriptRoot -Parent
$public = Join-Path $desktop "public"
$dest = "C:\Program Files\Revolution HOTEL\resources\app.asar.unpacked\public"
$overlay = Join-Path $env:APPDATA "Revolution HOTEL\public-overlay"
$files = @(
  "kasa-recepcion.html",
  "recepcion.html",
  "login.html",
  "css/recepcion-truffle.css",
  "admin.html",
  "js/hotel-recipe-workbench-admin.js"
)

New-Item -ItemType Directory -Force -Path $overlay | Out-Null
foreach ($f in $files) {
  $destFile = Join-Path $overlay $f
  $destDir = Split-Path $destFile -Parent
  if ($destDir -and -not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  }
  Copy-Item -Force (Join-Path $public $f) $destFile
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
New-Item -ItemType Directory -Force -Path '$dest\js' | Out-Null
Copy-Item -Force '$public\kasa-recepcion.html' '$dest\kasa-recepcion.html'
Copy-Item -Force '$public\recepcion.html' '$dest\recepcion.html'
Copy-Item -Force '$public\login.html' '$dest\login.html'
Copy-Item -Force '$public\css\recepcion-truffle.css' '$dest\css\recepcion-truffle.css'
Copy-Item -Force '$public\admin.html' '$dest\admin.html'
Copy-Item -Force '$public\js\hotel-recipe-workbench-admin.js' '$dest\js\hotel-recipe-workbench-admin.js'
$unpacked = Split-Path '$dest' -Parent
Copy-Item -Force '$desktop\app-paths.js' (Join-Path $unpacked 'app-paths.js')
Copy-Item -Force '$desktop\server.js' (Join-Path $unpacked 'server.js')
"@ | Set-Content -Path $elevScript -Encoding UTF8

Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $elevScript
)
Write-Host "Mbyll dhe hape perseri Revolution HOTEL."
