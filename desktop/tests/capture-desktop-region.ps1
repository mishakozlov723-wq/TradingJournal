param([int]$X,[int]$Y,[int]$Width,[int]$Height,[string]$Output)
# Diagnostic for the isolated CI desktop only, never for a user's machine.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public class SyterDesktopCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
}
'@
[void][SyterDesktopCapture]::SetProcessDPIAware()
[void][SyterDesktopCapture]::DwmFlush()
$bitmap = [System.Drawing.Bitmap]::new($Width,$Height,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($X,$Y,0,0,$bitmap.Size,[System.Drawing.CopyPixelOperation]::SourceCopy)
  $bitmap.Save($Output,[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }