param([string]$Root)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class UpdateWindows {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool EnumWindows(Callback callback,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 public struct Rect {public int Left,Top,Right,Bottom;}
}
'@
$out=Join-Path (Split-Path $Root) 'test-artifacts';New-Item $out -ItemType Directory -Force|Out-Null
$r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64');$k=$r.OpenSubKey('Software\SYTER\Desktop');$exe=Join-Path $k.GetValue('InstallLocation') 'SYTER.exe';$k.Dispose();$r.Dispose()
function Version {
 $r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry64');$k=$r.OpenSubKey('Software\SYTER\Desktop');$v=[string]$k.GetValue('Version');$k.Dispose();$r.Dispose();return $v
}
function Window {
 $ids=@(Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $exe}|ForEach-Object{$_.Id})
 $script:found=[IntPtr]::Zero
 [UpdateWindows]::EnumWindows({param($h,$unused)
  [uint32]$processId=0;[void][UpdateWindows]::GetWindowThreadProcessId($h,[ref]$processId)
  if($processId -in $ids -and [UpdateWindows]::IsWindowVisible($h)){
   $rect=New-Object UpdateWindows+Rect;[void][UpdateWindows]::GetWindowRect($h,[ref]$rect)
   $w=$rect.Right-$rect.Left;$height=$rect.Bottom-$rect.Top
   if($w -ge 390 -and $w -le 900 -and [Math]::Abs($w/$height-520.0/540) -lt .03){$script:found=$h;return $false}
  };return $true
 },[IntPtr]::Zero)|Out-Null
 return $script:found
}
function Names($h){
 $element=[Windows.Automation.AutomationElement]::FromHandle($h)
 $all=$element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 return @($all|ForEach-Object{$_.Current.Name})
}
function Wait-Phase([string]$name,[int]$seconds=90){
 $deadline=[DateTime]::UtcNow.AddSeconds($seconds)
 while([DateTime]::UtcNow -lt $deadline){
  $h=Window
  if($h -ne [IntPtr]::Zero){
   $names=Names $h
   if($name -in $names){return $h}
   if('Let’s try that again.' -in $names){throw ('Update error: '+($names -join ' | '))}
  };Start-Sleep -Milliseconds 200
 }
 throw "Missing update phase: $name. Last window names: $($names -join ' | ')"
}
function Capture($h,[string]$name){
 $rect=New-Object UpdateWindows+Rect;[void][UpdateWindows]::GetWindowRect($h,[ref]$rect)
 $bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
 $graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc()
 try{if(![UpdateWindows]::PrintWindow($h,$dc,2)){throw 'Capture failed'}}finally{$graphics.ReleaseHdc($dc);$graphics.Dispose()}
 try{$bitmap.Save((Join-Path $out "local-update-$name.png"))}finally{$bitmap.Dispose()}
}
function Click($h,[string]$name){
 $element=[Windows.Automation.AutomationElement]::FromHandle($h)
 $condition=New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty),$name
 $button=$element.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
 if(!$button -or !$button.Current.IsEnabled){throw "Missing/enabled button: $name"}
 $bounds=$button.Current.BoundingRectangle
 if($bounds.IsEmpty){throw 'Button is not visibly laid out'}
 [void][UpdateWindows]::SetForegroundWindow($h);Start-Sleep -Milliseconds 100
 [void][UpdateWindows]::SetCursorPos([int]($bounds.Left+$bounds.Width/2),[int]($bounds.Top+$bounds.Height/2))
 [UpdateWindows]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[UpdateWindows]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
$h=Wait-Phase 'A new version is ready.'
$names=Names $h
if('1.3.6 → 1.3.7' -notin $names){throw 'Wrong available versions'}
Capture $h 'available'
if((Get-Content (Join-Path $Root 'requests.log') -Raw) -match 'GET SYTER-Setup'){throw 'Payload requested before consent'}
Click $h 'Later';Start-Sleep -Seconds 1
if((Version) -ne '1.3.6' -or (Get-Content (Join-Path $Root 'requests.log') -Raw) -match 'GET SYTER-Setup'){throw 'Later downloaded or installed'}
Write-Host 'PASS: Later does not download or install; version remains 1.3.6'
# Disposable runner only. User launcher never stops a running journal.
Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $exe}|Stop-Process -Force
Start-Sleep -Milliseconds 500;Start-Process $exe -ArgumentList '--force-renderer-accessibility'
$h=Wait-Phase 'A new version is ready.';Click $h 'Update now →'
$h=Wait-Phase 'Downloading update…';Start-Sleep -Seconds 2
$names=Names $h;Capture $h 'downloading'
$percents=@($names|Where-Object{$_ -match '^\d+%$'})
$bytes=@($names|Where-Object{$_ -match '^\d+\.\d+ / \d+\.\d+ MB$'})
if(!$percents.Count -or !$bytes.Count){throw ('Actual progress labels missing: '+($names -join ' | '))}
Write-Host ('PASS: real transfer labels '+($percents -join ',')+'; '+($bytes -join ','))
$h=Wait-Phase 'Ready to restart.';Capture $h 'ready'
if((Version) -ne '1.3.6'){throw 'Update installed before restart consent'}
Click $h 'Restart and install →'
$deadline=[DateTime]::UtcNow.AddSeconds(90)
while((Version) -ne '1.3.7' -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 300}
if((Version) -ne '1.3.7'){throw 'Restart did not install 1.3.7'}
Write-Host 'PASS: real Update now -> file download -> Restart and install -> installed version 1.3.7'
