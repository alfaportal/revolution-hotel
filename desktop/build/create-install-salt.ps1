# Creates %APPDATA%\RevolutionInvest\HotelLicense\.install-salt ONLY if missing.
# Never overwrites — update must keep the same HARDWARE_ID.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:APPDATA "RevolutionInvest\HotelLicense"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$saltFile = Join-Path $dir ".install-salt"
if (Test-Path -LiteralPath $saltFile) {
  $existing = (Get-Content -LiteralPath $saltFile -Raw -ErrorAction SilentlyContinue)
  if ($existing -and $existing.Trim().Length -gt 0) {
    Write-Output "EXISTS"
    exit 0
  }
}
# Atomic create — fail if another process already created it
$salt = [guid]::NewGuid().Guid
try {
  $fs = [System.IO.File]::Open($saltFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($salt)
  $fs.Write($bytes, 0, $bytes.Length)
  $fs.Close()
  Write-Output "CREATED"
} catch [System.IO.IOException] {
  Write-Output "EXISTS"
  exit 0
}
