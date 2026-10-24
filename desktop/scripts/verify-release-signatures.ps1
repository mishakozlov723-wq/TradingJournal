$ErrorActionPreference = 'Stop'
$signed = $env:SYTER_SIGNED_RELEASE -eq 'true'
node (Join-Path $PSScriptRoot 'verify-update-policy.js')
if ($LASTEXITCODE -ne 0) { throw 'Actual packaged update trust policy verification failed' }
if ($env:SYTER_SIGNED_RELEASE -and $env:SYTER_SIGNED_RELEASE -notin @('true','false')) { throw 'Invalid signing mode' }
if ($signed -and !$env:SYTER_PUBLISHER_NAME) { throw 'SYTER_PUBLISHER_NAME is required for signed releases' }
$version = (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
foreach ($name in @("SYTER-Setup-$version.exe", "SYTER-Install-$version.exe")) {
  $file = Join-Path $PSScriptRoot "../release/$name"
  if (!(Test-Path $file -PathType Leaf)) { throw "Missing release artifact: $name" }
  if (!$signed) { continue } # GitHub mode retains checksum verification; no claim of an independent publisher signature
  $signature = Get-AuthenticodeSignature $file
  if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate) { throw "Invalid Authenticode signature: $name" }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -cne $env:SYTER_PUBLISHER_NAME) { throw "Unexpected publisher: $name" }
}
if ($signed) { Write-Output 'PASS: both delivered installers have valid signatures from the configured publisher' }
else { Write-Output 'PASS: GitHub update artifacts validated; no mandatory Authenticode; no independent signer authentication claimed' }
