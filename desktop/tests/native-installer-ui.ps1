# Rendering checks exercise the shipped assembly directly, without production debug hooks.
param([string]$InstallerPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::SetUnhandledExceptionMode([Windows.Forms.UnhandledExceptionMode]::ThrowException)
[Windows.Forms.Application]::EnableVisualStyles()
Write-Host "UI: loading production assembly"
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifacts=Join-Path $root 'test-artifacts'
New-Item -ItemType Directory $artifacts -Force|Out-Null
$assembly=[Reflection.Assembly]::LoadFrom((Resolve-Path $InstallerPath).Path)
$type=$assembly.GetType('SyterInstaller.InstallerWindow',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
function Field($form,$name){$type.GetField($name,$flags).GetValue($form)}
function Invoke($form,$method,[object[]]$values){$type.GetMethod($method,$flags).Invoke($form,$values)}
function Pump([int]$milliseconds){$watch=[Diagnostics.Stopwatch]::StartNew();while($watch.ElapsedMilliseconds -lt $milliseconds){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}}
# Freeze only this disposable render fixture's production Stopwatch fields.
# Rendering/PNG encoding may outlast a 180ms animation on a shared runner;
# exact elapsed samples separate opacity from the independently moving gradient.
function Set-ClockElapsed($clock,[int]$milliseconds){
 $clock.Reset()
 $elapsed=$clock.GetType().GetField('elapsed',$flags)
 if(!$elapsed){$elapsed=$clock.GetType().GetField('_elapsed',$flags)}
 if(!$elapsed){throw 'Stopwatch internals changed; review deterministic render fixture'}
 $elapsed.SetValue($clock,[long]($milliseconds*[Diagnostics.Stopwatch]::Frequency/1000))
 if([Math]::Abs($clock.ElapsedMilliseconds-$milliseconds) -gt 1){throw 'Could not freeze the render clock at the requested timestamp'}
}
function Capture($form,$name){
 $b=[Drawing.Bitmap]::new($form.Width,$form.Height)
 # DrawToBitmap renders the same shipped controls directly at their actual size.
 Write-Host "UI capture: draw controls"
 $form.DrawToBitmap($b,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
 Write-Host "UI capture: save $name"
 $b.Save((Join-Path $artifacts "native-installer-ui-$name.png"),[Drawing.Imaging.ImageFormat]::Png);return $b
}
function CropBytes($bitmap,$rectangle){$crop=$bitmap.Clone($rectangle,[Drawing.Imaging.PixelFormat]::Format32bppArgb);$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$crop.Dispose();$stream.Dispose();return [Convert]::ToBase64String($bytes)}
function BarGreen($bitmap,$bar){
 $sum=0;$count=0;$y=$bar.Top+[int]($bar.Height/2)
 for($x=$bar.Left+2;$x -lt $bar.Right-2;$x+=4){$sum+=$bitmap.GetPixel($x,$y).G;$count++}
 return $sum/$count
}
function CheckLayout($form){
 foreach($c in $form.Controls){if($c.Visible -and ($c.Left -lt 0 -or $c.Top -lt 0 -or $c.Right -gt $form.ClientSize.Width -or $c.Bottom -gt $form.ClientSize.Height)){throw "Control outside window: $($c.Name)"}}
}
$form=[Activator]::CreateInstance($type,$true)
try{
 Write-Host "UI: showing form"
 $form.Show();Pump 120
 Write-Host "UI: scaling layout"
 Invoke $form 'ApplyLayout' @([single]1.0)|Out-Null
 $primary=Field $form 'primary';$close=Field $form 'close';$bar=Field $form 'progress';$title=Field $form 'title'
 if($form.Width -ne 600 -or $form.Height -ne 508){throw 'Moderate proportional layout dimensions wrong'}
 if([Math]::Abs($title.Font.Size-28*600/520) -gt 0.05){throw 'Title font was not redrawn at scaled pixel size'}
 if((Field $form 'platform').Text -ne 'Windows'){throw 'Platform label contains unnecessary architecture'}
 if($primary.KeyboardFocusVisible -or $close.KeyboardFocusVisible){throw 'Initial keyboard focus cue is visible'}
 Write-Host "UI: initial focus and capture"
 $primary.Focus();Pump 40;$initial=Capture $form 'welcome-100'
 # White focus stroke cannot occur anywhere inside the default green button.
 $white=0
 for($y=$primary.Top;$y -lt $primary.Bottom;$y++){for($x=$primary.Left;$x -lt $primary.Right;$x++){$pixel=$initial.GetPixel($x,$y);if($pixel.R -gt 235 -and $pixel.G -gt 235 -and $pixel.B -gt 235){$white++}}}
 if($white){throw "Default button has $white white focus pixels"};$initial.Dispose()
 Write-Host "UI: Tab navigation"
 Invoke $form 'ProcessDialogKey' @([Windows.Forms.Keys]::Tab)|Out-Null
 Invoke $form 'ProcessDialogKey' @([Windows.Forms.Keys]::Tab)|Out-Null
 $primary.Focus();Pump 40
 if(!$primary.KeyboardFocusVisible -or !$primary.Focused){throw 'Tab navigation did not enable keyboard focus cue'}
 $keyboard=Capture $form 'keyboard-focus';$keyboard.Dispose()
 Invoke $form 'SetKeyboardFocus' @($false)|Out-Null
 Write-Host "UI: waiting fade and preparation caption"
 # Test animation even on the CI server with system animations disabled; restore its preference afterwards.
 $animationField=$bar.GetType().GetField('animate',$flags);$systemAnimation=$animationField.GetValue($bar)
 $animationField.SetValue($bar,$true);(Field $form 'stage').SoftChanges=$true
 $bounds=$bar.Bounds
 Invoke $form 'Busy' @('Installing SYTER…','',$true)|Out-Null;Pump 20
 if(!$bar.Visible -or !$bar.Indeterminate -or (Field $form 'percent').Visible -or !(Field $form 'stage').Visible -or (Field $form 'stage').Text -ne 'Preparing installation…'){throw 'Waiting needs preparation caption and bar without fake percentage'}
 $revealClock=$bar.GetType().GetField('reveal',$flags).GetValue($bar)
 $gradientClock=$bar.GetType().GetField('clock',$flags).GetValue($bar)
 Set-ClockElapsed $gradientClock 400
 Set-ClockElapsed $revealClock 0
 $a=Capture $form 'fade-start';$early=BarGreen $a $bar;$a.Dispose()
 Set-ClockElapsed $revealClock 90
 $b=Capture $form 'fade-middle';$middle=BarGreen $b $bar;$b.Dispose()
 Set-ClockElapsed $revealClock 180
 $c=Capture $form 'fade-full';$full=BarGreen $c $bar;$c.Dispose()
 if($early -ge $middle-5 -or $middle -ge $full-5){throw "Fade did not reveal gradually: $early / $middle / $full"}
 # Now use the real running clock to verify the shipped highlight animates.
 $gradientClock.Restart();Pump 40
 $c=Capture $form 'waiting-a';$first=CropBytes $c $bar.Bounds;$c.Dispose();Pump 240
 $d=Capture $form 'waiting-b';$second=CropBytes $d $bar.Bounds;$d.Dispose()
 if($first -eq $second){throw 'Waiting highlight did not animate'}
 Write-Host "PASS: soft bar reveal and live gradient ($early / $middle / $full); preparation caption present"
 $animationField.SetValue($bar,$systemAnimation);(Field $form 'stage').SoftChanges=$systemAnimation
 # Same actual control and bounds when switching into measurable file progress.
 $bar.Indeterminate=$false;$bar.Percent=42;$bar.Invalidate();Pump 40
 if($bar.Bounds -ne $bounds){throw 'Waiting and percentage bars changed position'}
 CheckLayout $form
 # Exercise layout at common DPI factors. This is a layout simulation, not OS-DPI emulation.
 foreach($scale in @([single]1.25,[single]1.5)){
  Write-Host "UI: layout factor $scale"
  Invoke $form 'ApplyLayout' @($scale)|Out-Null
  Invoke $form 'Busy' @('Installing SYTER…','',$true)|Out-Null;Pump 40;CheckLayout $form
  if([Math]::Abs($title.Font.Size-28*600/520*$scale) -gt 0.05){throw 'DPI font scaling wrong'}
  $picture=Capture $form "waiting-$([int]($scale*100))";$picture.Dispose()
 }
 # Inspect the actual finished -> launching transition, without starting another app in this layout test.
 Invoke $form 'ApplyLayout' @([single]1.0)|Out-Null
 $type.GetField('installedExe',$flags).SetValue($form,'C:\Users\test\AppData\Local\Programs\syter-desktop\SYTER.exe')
 Invoke $form 'Ready' @()|Out-Null;Pump 30
 $versionBounds=(Field $form 'version').Bounds;$platformBounds=(Field $form 'platform').Bounds;$locationBounds=(Field $form 'location').Bounds
 Invoke $form 'Launching' @()|Out-Null
 foreach($item in @(@('version',$versionBounds),@('platform',$platformBounds),@('location',$locationBounds))){if((Field $form $item[0]).Bounds -ne $item[1]){throw "Launch moved $($item[0])"}}
 if($title.Text -ne 'Opening SYTER…' -or $primary.Text -ne 'Please wait…'){throw 'Launch state was not updated together'}
 if(@($form.Controls|Where-Object{$_.Visible -and $_.Text -like 'Version*'}).Count -ne 1){throw 'Launch contains duplicate version controls'}
 if(@($form.Controls|Where-Object{$_.Visible -and $_.Text -eq 'Windows'}).Count -ne 1){throw 'Launch contains duplicate platform controls'}
 $launch=Capture $form 'launching';$launch.Dispose();Pump 40
 $launchAfter=Capture $form 'launching-after';$launchAfter.Dispose()
 CheckLayout $form
 Write-Host 'PASS: launch keeps version, Windows and path fixed, paints clean full state and has no duplicate controls'
 Write-Host 'PASS: native UI proportional 600x508, scaled fonts, no default focus ring, Tab cues retained, animated waiting bar without fake percentage and unchanged bar position; 100/125/150% layout checks'
 'verified'|Set-Content (Join-Path $artifacts 'native-installer-ui-success.txt')
}finally{
 $timer=Field $form 'timer';$timer.Stop();$type.GetField('busy',$flags).SetValue($form,$false);$form.Close();$form.Dispose()
}
