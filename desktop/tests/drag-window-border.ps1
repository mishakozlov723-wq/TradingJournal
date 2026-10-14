param([string]$Handle, [int]$Delta = -160, [int]$Steps = 36)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SyterResizeMouse {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
[void][SyterResizeMouse]::SetProcessDPIAware()
$hwnd = [IntPtr]::new([long]$Handle)
[void][SyterResizeMouse]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 150
$rect = [SyterResizeMouse+RECT]::new()
if (![SyterResizeMouse]::GetWindowRect($hwnd, [ref]$rect)) { throw 'No test window rect' }
$y = [int](($rect.Top + $rect.Bottom) / 2)
$x = $null
# Ask Windows where its real resize hit region is; do not assume Electron DIP
# coordinates coincide with physical pixels or that shadows are frame borders.
for ($candidate = $rect.Right - 20; $candidate -lt $rect.Right + 2; $candidate++) {
  $packed = [IntPtr]::new([long](($y -shl 16) -bor ($candidate -band 65535)))
  $hit = [SyterResizeMouse]::SendMessage($hwnd, 0x0084, [IntPtr]::Zero, $packed).ToInt64()
  if ($hit -eq 11) { $x = $candidate; break }
}
if ($null -eq $x) { throw "No HTRIGHT resize region: $($rect | ConvertTo-Json -Compress)" }
if (![SyterResizeMouse]::SetCursorPos($x, $y)) { throw 'Cannot move cursor on Windows test desktop' }
$cursor = [SyterResizeMouse+POINT]::new()
[void][SyterResizeMouse]::GetCursorPos([ref]$cursor)
Write-Output "Window=$($rect | ConvertTo-Json -Compress), hit=HTRIGHT, cursor=$($cursor | ConvertTo-Json -Compress)"
Start-Sleep -Milliseconds 100
[SyterResizeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
try {
  Start-Sleep -Milliseconds 80
  for ($i = 1; $i -le $Steps; $i++) {
    [void][SyterResizeMouse]::SetCursorPos(($x + [int]($Delta * $i / $Steps)), $y)
    Start-Sleep -Milliseconds 16
  }
} finally {
  [SyterResizeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
[void][SyterResizeMouse]::GetWindowRect($hwnd, [ref]$rect)
Write-Output "After=$($rect | ConvertTo-Json -Compress)"
