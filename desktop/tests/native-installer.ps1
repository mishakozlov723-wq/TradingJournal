# Windows UI Automation drives the production EXE; no app test IPC or debug port.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class InstallerWindows {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 public struct Rect {public int Left,Top,Right,Bottom;}
 public static IntPtr Find(string title){IntPtr found=IntPtr.Zero;EnumWindows((h,p)=>{var b=new StringBuilder(256);GetWindowText(h,b,b.Capacity);if(IsWindowVisible(h)&&b.ToString()==title){found=h;return false;}return true;},IntPtr.Zero);return found;}
}
'@
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifacts=Join-Path $root 'test-artifacts';New-Item -ItemType Directory $artifacts -Force|Out-Null
$version=(Get-Content (Join-Path $root 'package.json') -Raw|ConvertFrom-Json).version
$exe=Join-Path $root "release/SYTER-Install-$version.exe"
$old=Join-Path $root 'baseline/SYTER-Install-1.3.3.exe'
$baseline=@();$optimized=@();$trace=@();$processes=@();$installedPath=$null
function Wait-Window([string]$Title,[int]$Timeout=60000){$watch=[Diagnostics.Stopwatch]::StartNew();while($watch.ElapsedMilliseconds -lt $Timeout){$h=[InstallerWindows]::Find($Title);if($h -ne [IntPtr]::Zero){return $h};Start-Sleep -Milliseconds 15};throw "Window did not appear: $Title"}
function Element($Window,[string]$Id){
 $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$Id)
 $found=$Window.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition);if($found){return $found}
 # .NET Framework's legacy MSAA bridge may expose Win32 IDs, not Control.Name.
 $all=$Window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
 foreach($item in $all){
  $current=$item.Current
  if($Id -eq 'PrimaryAction' -and $current.Name -in @('Install SYTER','Install SYTER →','Please wait','Please wait…','Launch SYTER','Launch SYTER →','Try again','Try again →')){return $item}
  if($Id -eq 'CloseAction' -and $current.Name -eq 'Close'){return $item}
  if($Id -eq 'Percent' -and $current.Name -match '^\d+%$'){return $item}
  if($Id -eq 'Stage' -and $current.Name -in @('Unpacking files','Installing files','Registering SYTER and shortcuts','Preparing installation')){return $item}
 }
 return $null
}
function Click($Element){
 if(!$Element){throw 'Missing action button'}
 $pattern=$null
 if($Element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke();return}
 $handle=[IntPtr]$Element.Current.NativeWindowHandle
 if($handle -eq [IntPtr]::Zero){throw 'Native button handle unavailable'}
 [InstallerWindows]::SendMessage($handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
}
function Screenshot([IntPtr]$Handle,[string]$Name){
 $rect=[InstallerWindows+Rect]::new();[InstallerWindows]::GetWindowRect($Handle,[ref]$rect)|Out-Null
 $bitmap=[Drawing.Bitmap]::new($rect.Right-$rect.Left,$rect.Bottom-$rect.Top)
 $g=[Drawing.Graphics]::FromImage($bitmap);$dc=$g.GetHdc()
 try{if(![InstallerWindows]::PrintWindow($Handle,$dc,2)){throw 'Window capture failed'}}finally{$g.ReleaseHdc($dc)}
 $bitmap.Save((Join-Path $artifacts "native-installer-$Name.png"),[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bitmap.Dispose()
}
try{
 if(!(Test-Path $old)){throw 'Baseline 1.3.3 EXE required for comparative startup measurement'}
 # Same runner, same user, same detection method; no installation in baseline.
 foreach($pass in 0..1){
  $watch=[Diagnostics.Stopwatch]::StartNew();$p=Start-Process $old -PassThru;$processes+=$p
  $handle=Wait-Window 'SYTER';$baseline+=$watch.ElapsedMilliseconds
  [InstallerWindows]::PostMessage($handle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
  if(!$p.WaitForExit(30000)){throw 'Baseline installer did not close'};Start-Sleep -Milliseconds 500
 }
 $sentinels=@('SYTER','syter-desktop')|ForEach-Object{Join-Path $env:APPDATA "$_/syter-preservation-test.txt"}
 foreach($file in $sentinels){New-Item -ItemType Directory (Split-Path $file) -Force|Out-Null;[IO.File]::WriteAllText($file,'preserve-settings')}
 foreach($pass in 0..1){
  $watch=[Diagnostics.Stopwatch]::StartNew();$p=Start-Process $exe -PassThru;$processes+=$p
  $handle=Wait-Window 'SYTER Installer';$optimized+=$watch.ElapsedMilliseconds
  $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
  [InstallerWindows]::SetForegroundWindow($handle)|Out-Null;Start-Sleep -Milliseconds 200
  if($pass -eq 0){
   Screenshot $handle 'welcome'
   $tree=$window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
   @($tree|ForEach-Object{@{name=$_.Current.Name;id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName}})|ConvertTo-Json|Set-Content (Join-Path $artifacts 'native-installer-accessibility.json')
  }
  $button=Element $window 'PrimaryAction';if(!$button -or $button.Current.Name -notmatch '^Install SYTER(?: →)?$'){throw 'Install consent button missing from UI Automation'}
  $bounds=$window.Current.BoundingRectangle
  Click $button
  $ready=$false;$sawIntermediate=$false;$sawProgressShot=$false;$wait=[Diagnostics.Stopwatch]::StartNew()
  while($wait.ElapsedMilliseconds -lt 180000){
   if($p.HasExited){throw 'Installer unexpectedly exited'}
   $button=Element $window 'PrimaryAction';$name=$button.Current.Name
   if($name -match '^Try again(?: →)?$'){throw 'Native installer reported installation failure'}
   if($window.Current.BoundingRectangle.Width -ne $bounds.Width -or $window.Current.BoundingRectangle.Height -ne $bounds.Height){throw 'Installer resized during installation'}
   $percent=Element $window 'Percent';$stage=Element $window 'Stage'
   if($percent -and !$percent.Current.IsOffscreen -and $percent.Current.Name -match '^(\d+)%$'){
    $value=[int]$Matches[1];$trace+=@{pass=$pass;percent=$value;stage=$stage.Current.Name}
    if($value -gt 0 -and $value -lt 100){$sawIntermediate=$true;if(!$sawProgressShot -and $pass -eq 0){Screenshot $handle 'progress';$sawProgressShot=$true}}
   }
   if($name -match '^Launch SYTER(?: →)?$'){$ready=$true;break}
   Start-Sleep -Milliseconds 100
  }
  if(!$ready){throw 'Installation did not finish'}
  if(!$sawIntermediate){throw 'Real intermediate installation percentage was not visible'}
  $reg=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
  $receipt=$reg.OpenSubKey('Software\SYTER\Desktop')
  if($receipt.GetValue('Version') -ne $version){throw 'Installed version mismatch'}
  $installedPath=Join-Path $receipt.GetValue('InstallLocation') 'SYTER.exe';$receipt.Dispose();$reg.Dispose()
  if(!(Test-Path $installedPath)){throw 'Installed executable missing'}
  foreach($file in $sentinels){if([IO.File]::ReadAllText($file) -ne 'preserve-settings'){throw 'Existing user data changed'}}
  if($pass -eq 0){Screenshot $handle 'installed';Click (Element $window 'CloseAction')}
  else{
   # Real launch failure and retry, without special production hooks.
   $held="$installedPath.native-test"
   Move-Item $installedPath $held
   try{
    Click $button
    $failed=$false
    for($n=0;$n -lt 50;$n++){$button=Element $window 'PrimaryAction';if($button.Current.Name -match '^Try again(?: →)?$'){$failed=$true;break};Start-Sleep -Milliseconds 100}
    if(!$failed){throw 'Missing executable did not produce retry state'}
    Screenshot $handle 'launch-error'
   }finally{Move-Item $held $installedPath}
   Click (Element $window 'PrimaryAction')
  }
  if(!$p.WaitForExit(30000)){throw 'Native installer did not exit'}
  if($pass -eq 1){
   $found=@();for($n=0;$n -lt 50;$n++){$found=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -eq $installedPath});if($found.Count){break};Start-Sleep -Milliseconds 100}
   if(!$found.Count){throw 'Installed app did not launch'}
   $found|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  }
  Start-Sleep -Milliseconds 500
 }
 $before=($baseline|Measure-Object -Average).Average;$after=($optimized|Measure-Object -Average).Average
 $oldSize=(Get-Item $old).Length;$newSize=(Get-Item $exe).Length
 $report=@{baselineVersion='1.3.3';optimizedVersion=$version;baselineVisibleMs=$baseline;optimizedVisibleMs=$optimized;baselineBytes=$oldSize;optimizedBytes=$newSize;method='Process start to first visible Win32 window on the same Windows runner; no antivirus attribution';trace=$trace}
 $report|ConvertTo-Json -Depth 8|Set-Content (Join-Path $artifacts 'native-installer-performance.json') -Encoding utf8
 if($newSize -ge $oldSize*0.7){throw 'Native EXE did not materially reduce size'}
 if($after -ge $before*0.85){throw "Startup improvement not established: before=$before after=$after"}
 Write-Host "PASS: native startup: baseline $($baseline -join ', ') ms; optimized $($optimized -join ', ') ms; size $oldSize -> $newSize bytes"
 Write-Host 'PASS: actual branded EXE launches, waits for consent, verifies payload, shows real intermediate progress, installs and reinstalls preserving data, launches installed app and exits'
}finally{
 foreach($p in $processes){if(!$p.HasExited){taskkill.exe /PID $p.Id /T /F 2>$null|Out-Null}}
 if($installedPath){Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -eq $installedPath}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}}
}
