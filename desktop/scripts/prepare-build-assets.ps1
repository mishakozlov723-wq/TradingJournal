$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktop = Split-Path $PSScriptRoot -Parent
$root = Split-Path $desktop -Parent
$source = Join-Path $root 'public/syter-icon.png'
if (!(Test-Path $source)) { throw 'Tracked public/syter-icon.png is missing' }
$build = Join-Path $desktop 'build'
New-Item -ItemType Directory -Force $build | Out-Null
$image = [System.Drawing.Image]::FromFile($source)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = [System.Collections.Generic.List[byte[]]]::new()
try {
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $memory = [System.IO.MemoryStream]::new()
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($image, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
      $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
      $bytes = $memory.ToArray()
      $pngs.Add($bytes)
      if ($size -eq 32) {
        [System.IO.File]::WriteAllBytes((Join-Path $build 'tray-icon.png'), $bytes)
        [System.IO.File]::WriteAllBytes((Join-Path $build 'titlebar-icon.png'), $bytes)
      }
      if ($size -eq 64) { [System.IO.File]::WriteAllBytes((Join-Path $build 'app-icon.png'), $bytes) }
    } finally { $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
  # ICO directory + PNG frames: preserves 32-bit alpha, unlike Icon.Save(GetHicon()).
  # Electron supports Windows 10+, where PNG-encoded ICO entries are supported.
  $stream = [System.IO.File]::Create((Join-Path $build 'icon.ico'))
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $writer.Write([byte]($sizes[$i] % 256)); $writer.Write([byte]($sizes[$i] % 256))
      $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$pngs[$i].Length); $writer.Write([uint32]$offset)
      $offset += $pngs[$i].Length
    }
    foreach ($png in $pngs) { $writer.Write($png) }
  } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $image.Dispose() }
Write-Host 'Generated visible RGBA icons: PNG tray/window/titlebar + seven ICO sizes.'
