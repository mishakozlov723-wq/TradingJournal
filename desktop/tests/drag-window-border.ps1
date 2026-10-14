param([int]$X, [int]$Y, [int]$Delta = -160, [int]$Steps = 36)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SyterResizeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[void][SyterResizeMouse]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 100
[SyterResizeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
try {
  Start-Sleep -Milliseconds 80
  for ($i = 1; $i -le $Steps; $i++) {
    [void][SyterResizeMouse]::SetCursorPos(($X + [int]($Delta * $i / $Steps)), $Y)
    Start-Sleep -Milliseconds 16
  }
} finally {
  [SyterResizeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}