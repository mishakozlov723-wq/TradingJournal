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
function Capture($form,$name){
 $b=[Drawing.Bitmap]::new($form.Width,$form.Height)
 # PrintWindow on the current thread can block in the DWM capture path.
 # DrawToBitmap renders the same shipped controls directly at their actual size.
 $form.DrawToBitmap($b,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
 $b.Save((Join-Path $artifacts "native-installer-ui-$name.png"),[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();return $b
}
function CropBytes($bitmap,$rectangle){$crop=$bitmap.Clone($rectangle,[Drawing.Imaging.PixelFormat]::Format32bppArgb);$stream=[IO.MemoryStream]::new();$crop.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray();$crop.Dispose();$stream.Dispose();return [Convert]::ToBase64String($bytes)}
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
 Write-Host "UI: waiting animation"
 $bounds=$bar.Bounds
 Invoke $form 'Busy' @('Installing SYTER…','',$true)|Out-Null;Pump 40
 if(!$bar.Visible -or !$bar.Indeterminate -or (Field $form 'percent').Visible -or (Field $form 'stage').Visible){throw 'Waiting bar must be visible without stage copy or fake percentage'}
 $a=Capture $form 'waiting-a';$first=CropBytes $a $bar.Bounds;$a.Dispose();Pump 240
 $b=Capture $form 'waiting-b';$second=CropBytes $b $bar.Bounds;$b.Dispose()
 $animate=$bar.GetType().GetField('animate',$flags).GetValue($bar)
 if($animate -and $first -eq $second){throw 'Waiting highlight did not animate'}
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
 Write-Host 'PASS: native UI proportional 600x508, scaled fonts, no default focus ring, Tab cues retained, animated waiting bar without fake percentage and unchanged bar position; 100/125/150% layout checks'
 'verified'|Set-Content (Join-Path $artifacts 'native-installer-ui-success.txt')
}finally{
 $timer=Field $form 'timer';$timer.Stop();$type.GetField('busy',$flags).SetValue($form,$false);$form.Close();$form.Dispose()
}
