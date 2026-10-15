param([switch]$RestoreOnly,[switch]$Automation)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$stateFile=Join-Path $root 'test-session.json'
$backup=Join-Path $root 'original-app-update.yml'
function Restore-Feed {
 if(!(Test-Path $stateFile)){return}
 $s=Get-Content $stateFile -Raw|ConvertFrom-Json
 if(!(Test-Path $backup)){throw 'Original updater configuration backup is missing.'}
 if((Get-FileHash $backup -Algorithm SHA256).Hash -ne $s.originalHash){throw 'Updater backup checksum mismatch.'}
 if((Test-Path $s.config) -and (Get-FileHash $s.config -Algorithm SHA256).Hash -eq $s.testHash){
  [IO.File]::WriteAllBytes($s.config,[IO.File]::ReadAllBytes($backup))
  Write-Host 'Original update source restored.' -ForegroundColor Green
 } elseif((Test-Path $s.config) -and (Get-FileHash $s.config -Algorithm SHA256).Hash -eq $s.originalHash){
  Write-Host 'Original update source is already restored.'
 } elseif((Test-Path $s.config) -and (Get-Content $s.config -Raw) -match 'provider:\s*github' -and (Get-Content $s.config -Raw) -match 'repo:\s*syter-releases'){
  Write-Host 'Installed update already restored the normal GitHub source.' -ForegroundColor Green
 } else {throw 'Updater configuration changed independently. It was not overwritten. Keep this folder and its backup.'}
 Remove-Item $stateFile,$backup
}
if($RestoreOnly){Restore-Feed;Write-Host 'Exit SYTER through its tray menu, then open it normally.';exit 0}
if(Test-Path $stateFile){Restore-Feed}
$manifest=Get-Content (Join-Path $root 'test-manifest.json') -Raw|ConvertFrom-Json
if($manifest.from -ne '1.3.6' -or $manifest.to -ne '1.3.7'){throw 'Unexpected test versions.'}
foreach($item in $manifest.files){
 $p=Join-Path $root $item.name
 if(!(Test-Path $p) -or (Get-FileHash $p -Algorithm SHA256).Hash -ne $item.sha256){throw "Test package checksum mismatch: $($item.name)"}
}
$registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
$key=$registry.OpenSubKey('Software\SYTER\Desktop')
if(!$key){throw 'Install SYTER 1.3.6 first, then run this test.'}
$directory=[string]$key.GetValue('InstallLocation');$version=[string]$key.GetValue('Version');$key.Dispose();$registry.Dispose()
if($version -ne $manifest.from){throw "This test needs installed SYTER $($manifest.from); found $version. Do not reinstall or downgrade after completing this test."}
$exe=Join-Path $directory 'SYTER.exe';$config=Join-Path $directory 'resources\app-update.yml'
if(!(Test-Path $exe) -or !(Test-Path $config)){throw 'Installed application/update configuration missing.'}
$running=@(Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $exe})
if($running.Count){throw 'Close SYTER using Exit in its tray menu (near the clock), then run START-TEST.cmd again. Closing the window alone only hides it.'}
$original=[IO.File]::ReadAllBytes($config)
$text=[IO.File]::ReadAllText($config)
if($text -notmatch '(?m)^provider:\s*github\s*$' -or $text -notmatch '(?m)^repo:\s*syter-releases\s*$'){throw 'This test only replaces the known SYTER GitHub feed.'}
# Preserve publisherName/signature requirements and other security settings.
$patched=$text -replace '(?m)^provider:\s*github\s*$', 'provider: generic'
$patched=$patched -replace '(?m)^(owner|repo|releaseType|channel|url|useMultipleRangeRequest|updaterCacheDirName):[^\r\n]*(\r?\n|$)',''
$cache='syter-local-test-'+[Guid]::NewGuid().ToString('N')
$port=51873
$patched=$patched.TrimEnd()+"`nurl: http://127.0.0.1:$port/`nuseMultipleRangeRequest: false`nupdaterCacheDirName: $cache`n"
$log=Join-Path $root 'requests.log';$ready=Join-Path $root 'server-ready.txt'
Remove-Item $log,$ready -ErrorAction SilentlyContinue
$server=$null;$success=$false
try{
 # TCP loopback listener: no administrator permission, URL reservations or firewall rules.
 $server=Start-Job -ArgumentList $root,$port,$ready,$log,@($manifest.files.name) -ScriptBlock {
  param($folder,$port,$ready,$log,$allowed)
  $ErrorActionPreference='Stop'
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
  try{
   $listener.Start();[IO.File]::WriteAllText($ready,'ready')
   while($true){
    if(!$listener.Pending()){Start-Sleep -Milliseconds 100;continue}
    $client=$listener.AcceptTcpClient()
    try{
     $stream=$client.GetStream();$stream.ReadTimeout=5000;$stream.WriteTimeout=10000
     $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::ASCII,$false,1024,$true)
     $line=$reader.ReadLine();if(!$line){continue}
     $parts=$line.Split(' ');if($parts.Length -ne 3){continue}
     $method=$parts[0];$request=$parts[1];$headers=@{};$length=$line.Length
     while(($line=$reader.ReadLine()) -ne ''){
      if($null -eq $line){throw 'Truncated request'};$length+=$line.Length;if($length -gt 8192){throw 'Headers too large'}
      $pair=$line.Split(@(':'),2);if($pair.Length -eq 2){$headers[$pair[0].ToLowerInvariant()]=$pair[1].Trim()}
     }
     $requestPath=$request.Split('?')[0];$name=$requestPath.TrimStart('/')
     if($method -notin @('GET','HEAD') -or $requestPath -ne ('/'+$name) -or $name -notin $allowed){
      $response=[Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n");$stream.Write($response,0,$response.Length);continue
     }
     $path=Join-Path $folder $name;$size=(Get-Item $path).Length;$start=[long]0;$end=[long]($size-1);$code='200 OK';$range=''
     if($headers.ContainsKey('range')){
      if($headers.range -notmatch '^bytes=(\d+)-(\d*)$'){throw 'Unsupported range'}
      $start=[long]$Matches[1];if($Matches[2]){$end=[long]$Matches[2]}
      if($start -gt $end -or $end -ge $size){throw 'Range outside file'}
      $code='206 Partial Content';$range="Content-Range: bytes $start-$end/$size`r`n"
     }
     [IO.File]::AppendAllText($log,"$method $name $start-$end`n")
     $count=$end-$start+1;$mime=if($name -eq 'latest.yml'){'text/yaml'}else{'application/octet-stream'}
     $response=[Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $code`r`nContent-Type: $mime`r`nContent-Length: $count`r`nAccept-Ranges: bytes`r`n${range}Connection: close`r`n`r`n")
     $stream.Write($response,0,$response.Length)
     if($method -eq 'GET'){
      $file=[IO.File]::OpenRead($path)
      try{
       [void]$file.Seek($start,[IO.SeekOrigin]::Begin);$buffer=New-Object byte[] 65536;$sent=[long]0;$watch=[Diagnostics.Stopwatch]::StartNew()
       while($sent -lt $count){
        $n=$file.Read($buffer,0,[int][Math]::Min($buffer.Length,$count-$sent));if(!$n){throw 'Unexpected file end'}
        $stream.Write($buffer,0,$n);$sent+=$n
        # Only test-server bandwidth is limited (8 MiB/s); updater reports actual received bytes.
        if($name.EndsWith('.exe')){$pause=$sent*1000/8388608-$watch.ElapsedMilliseconds;if($pause -gt 0){Start-Sleep -Milliseconds ([int]$pause)}}
       }
      }finally{$file.Dispose()}
     }
    }catch{[IO.File]::AppendAllText($log,"SERVER: $($_.Exception.Message)`n")}finally{$client.Dispose()}
   }
  }finally{$listener.Stop()}
 }
 $deadline=[DateTime]::UtcNow.AddSeconds(10)
 while(!(Test-Path $ready) -and [DateTime]::UtcNow -lt $deadline -and $server.State -ne 'Failed'){Start-Sleep -Milliseconds 100}
 if(!(Test-Path $ready)){Receive-Job $server;throw "Cannot start test server on local port $port. Updater configuration was not changed."}
 [IO.File]::WriteAllBytes($backup,$original)
 $originalHash=(Get-FileHash $backup -Algorithm SHA256).Hash
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes($patched)
 $hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-','')
 @{config=$config;originalHash=$originalHash;testHash=$hash;cache=$cache}|ConvertTo-Json|Set-Content $stateFile -Encoding UTF8
 [IO.File]::WriteAllBytes($config,$bytes)
 Write-Host 'LOCAL TEST: SYTER 1.3.6 -> 1.3.7' -ForegroundColor Cyan
 Write-Host 'Keep this console open. No public update was published.'
 Write-Host 'After about 5 seconds: Update now -> download -> Restart and install.'
 Write-Host 'The local download is capped at 8 MiB/s so you can see real progress.'
 Write-Host 'No profile files, passwords, browser settings or trades are modified by this script.'
 if($Automation){Start-Process $exe -ArgumentList '--force-renderer-accessibility'}else{Start-Process $exe}
 if($Automation){
  & (Join-Path $root 'verify-update.ps1') -Root $root
 }
 $deadline=[DateTime]::UtcNow.AddMinutes(15)
 while([DateTime]::UtcNow -lt $deadline){
  $r=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64);$k=$r.OpenSubKey('Software\SYTER\Desktop')
  $newVersion=if($k){[string]$k.GetValue('Version')}else{''};if($k){$k.Dispose()};$r.Dispose()
  if($newVersion -eq $manifest.to){$success=$true;break}
  if($server.State -eq 'Failed'){Receive-Job $server;throw 'Local server failed.'}
  Start-Sleep -Seconds 1
 }
 if(!$success){throw 'Test timeout. The original source will be restored; restart SYTER normally before trying again.'}
 # Receipt is written before the updated process relaunches. Allow that real handoff to complete.
 $deadline=[DateTime]::UtcNow.AddSeconds(30)
 while(!(Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $exe}) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
 if(!(Get-Process SYTER -ErrorAction SilentlyContinue|Where-Object{$_.Path -eq $exe})){throw 'Version updated, but application did not relaunch.'}
 if((Get-Content $config -Raw) -notmatch 'provider:\s*github'){throw 'Updated app did not restore the production updater configuration.'}
 Write-Host 'SUCCESS: version 1.3.7 installed and SYTER restarted. Check your journal/login/settings.' -ForegroundColor Green
}finally{
 try { Restore-Feed } finally {
  if($server){Stop-Job $server -ErrorAction SilentlyContinue;Remove-Job $server -Force -ErrorAction SilentlyContinue}
  Remove-Item $ready -ErrorAction SilentlyContinue
 }
}
