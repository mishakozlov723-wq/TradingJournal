$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkg=Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version=$pkg.version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid native installer version'}
$native=Join-Path $root 'installer/native'
$build=Join-Path $root 'build/native-installer'
New-Item -ItemType Directory $build -Force | Out-Null
foreach($name in @('regular','semibold')){
 [IO.File]::WriteAllBytes((Join-Path $build "poppins-$name.ttf"),[Convert]::FromBase64String((Get-Content (Join-Path $native "poppins-$name.base64") -Raw)))
}
$payload=Join-Path $root "dist/SYTER-Setup-$version.exe"
$stream=[IO.File]::OpenRead($payload)
$algorithm=[Security.Cryptography.SHA256]::Create()
try{$hash=[BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}
$size=(Get-Item $payload).Length
$info=Join-Path $build 'BuildInfo.cs'
"namespace SyterInstaller { static class BuildInfo { public const string Version=`"$version`"; public const string Sha256=`"$hash`"; public const long PayloadSize=$size; } }" | Set-Content $info -Encoding utf8
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(!(Test-Path $csc)){throw '.NET Framework C# compiler missing'}
$out=Join-Path $root "release/SYTER-Install-$version.exe"
& $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Core.dll /reference:System.dll "/win32icon:$(Join-Path $root 'build/icon.ico')" "/win32manifest:$(Join-Path $native 'app.manifest')" "/resource:$payload,Payload" "/resource:$(Join-Path $root 'build/app-icon.png'),Logo" "/resource:$(Join-Path $build 'poppins-regular.ttf'),FontRegular" "/resource:$(Join-Path $build 'poppins-semibold.ttf'),FontBold" "/out:$out" (Join-Path $native 'Installer.cs') $info
if($LASTEXITCODE -ne 0){throw 'Native installer compilation failed'}
@{version=$version;sha256=$hash;installer="SYTER-Install-$version.exe";bootstrapper='native-dotnet-framework';payloadSize=$size} | ConvertTo-Json | Set-Content (Join-Path $root 'release/installer-manifest.json') -Encoding utf8
Write-Host "Native offline installer: $out, $((Get-Item $out).Length) bytes"
