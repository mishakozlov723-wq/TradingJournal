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
$frames = [System.Collections.Generic.List[byte[]]]::new()
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
      if ($size -eq 32) {
        [System.IO.File]::WriteAllBytes((Join-Path $build 'tray-icon.png'), $bytes)
        [System.IO.File]::WriteAllBytes((Join-Path $build 'titlebar-icon.png'), $bytes)
      }
      if ($size -eq 64) { [System.IO.File]::WriteAllBytes((Join-Path $build 'app-icon.png'), $bytes) }
      # Classic 32-bit DIB frames are understood by the Windows shell at every
      # icon size. PNG-only ICOs can decode in Electron yet show a generic EXE.
      $dibStream = [System.IO.MemoryStream]::new()
      $dib = [System.IO.BinaryWriter]::new($dibStream)
      try {
        $maskStride = [int]([Math]::Ceiling($size / 32.0) * 4)
        $dib.Write([uint32]40); $dib.Write([int32]$size); $dib.Write([int32]($size * 2))
        $dib.Write([uint16]1); $dib.Write([uint16]32); $dib.Write([uint32]0)
        $dib.Write([uint32]($size * $size * 4 + $maskStride * $size))
        foreach ($unused in 1..4) { $dib.Write([uint32]0) }
        for ($y = $size - 1; $y -ge 0; $y--) {
          for ($x = 0; $x -lt $size; $x++) {
            $pixel = $bitmap.GetPixel($x, $y)
            $dib.Write([byte]$pixel.B); $dib.Write([byte]$pixel.G)
            $dib.Write([byte]$pixel.R); $dib.Write([byte]$pixel.A)
          }
        }
        for ($y = $size - 1; $y -ge 0; $y--) {
          $row = [byte[]]::new($maskStride)
          for ($x = 0; $x -lt $size; $x++) {
            if ($bitmap.GetPixel($x, $y).A -eq 0) {
              $index = [int][Math]::Floor($x / 8.0)
              $row[$index] = $row[$index] -bor (128 -shr ($x % 8))
            }
          }
          $dib.Write($row)
        }
        $frames.Add($dibStream.ToArray())
      } finally { $dib.Dispose(); $dibStream.Dispose() }
    } finally { $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
  # Preserve true RGBA and a correct transparency mask, never Icon.Save(GetHicon()).
  $stream = [System.IO.File]::Create((Join-Path $build 'icon.ico'))
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
      $writer.Write([byte]($sizes[$i] % 256)); $writer.Write([byte]($sizes[$i] % 256))
      $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
      $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write($frame) }
  } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $image.Dispose() }
Write-Host 'Generated visible RGBA icons: PNG tray/window/titlebar + seven ICO sizes.'
