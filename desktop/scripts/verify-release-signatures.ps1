$ErrorActionPreference = 'Stop'
if (!$env:SYTER_PUBLISHER_NAME) { throw 'SYTER_PUBLISHER_NAME is required' }
$version = (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
foreach ($name in @("SYTER-Setup-$version.exe", "SYTER-Install-$version.exe")) {
  $file = Join-Path $PSScriptRoot "../release/$name"
  if (!(Test-Path $file -PathType Leaf)) { throw "Missing release artifact: $name" }
  $signature = Get-AuthenticodeSignature $file
  if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate) { throw "Invalid Authenticode signature: $name" }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -cne $env:SYTER_PUBLISHER_NAME) { throw "Unexpected publisher: $name" }
}
Write-Output 'PASS: both delivered installers have valid signatures from the configured publisher'
