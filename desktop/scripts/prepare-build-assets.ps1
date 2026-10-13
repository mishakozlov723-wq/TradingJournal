$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktop = Split-Path $PSScriptRoot -Parent
$root = Split-Path $desktop -Parent
$source = Join-Path $root 'public/syter-icon.png'
if (!(Test-Path $source)) { throw 'Tracked public/syter-icon.png is missing' }
$build = Join-Path $desktop 'build'
New-Item -ItemType Directory -Force $build | Out-Null
Copy-Item $source (Join-Path $build 'titlebar-icon.png') -Force
$image = [System.Drawing.Image]::FromFile($source)
$bitmap = New-Object System.Drawing.Bitmap($image, 256, 256)
$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Create((Join-Path $build 'icon.ico'))
try { $icon.Save($stream) }
finally {
  $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $image.Dispose()
}
Write-Host 'Desktop icon resources generated from the tracked SYTER logo.'