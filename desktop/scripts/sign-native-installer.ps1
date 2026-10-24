param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (!$env:SYTER_SIGNED_RELEASE -or $env:SYTER_SIGNED_RELEASE -eq 'false') {
  Write-Host 'GITHUB UPDATE BUILD: no Authenticode identity; Windows may warn about the unknown publisher. Existing updater checks remain enabled.'
  return
}
if ($env:SYTER_SIGNED_RELEASE -ne 'true') { throw 'Invalid signing mode' }
if (!$env:CSC_LINK -or !$env:SYTER_PUBLISHER_NAME) { throw 'Native installer signing requires CSC_LINK and SYTER_PUBLISHER_NAME; unsigned fallback is forbidden' }
$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
try {
  # Match electron-builder's local PFX or base64 PFX inputs, without writing secrets to disk.
  if (Test-Path -LiteralPath $env:CSC_LINK -PathType Leaf) { $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $env:CSC_LINK).Path) }
  elseif ($env:CSC_LINK -match '^https?://') { throw 'Use a local or base64 PFX for native wrapper signing, not a certificate download URL' }
  else { $bytes = [Convert]::FromBase64String($env:CSC_LINK) }
  $certificate.Import($bytes, $env:CSC_KEY_PASSWORD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet)
  if (!$certificate.HasPrivateKey) { throw 'Signing certificate has no private key' }
  $publisher = $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -cne $env:SYTER_PUBLISHER_NAME) { throw 'Signing certificate publisher does not match the configured identity' }
  $signature = Set-AuthenticodeSignature -FilePath $Path -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  if ($signature.Status -ne 'Valid') { throw 'Native installer signing or certificate-chain validation failed' }
  if (!$signature.TimeStamperCertificate) { throw 'Native installer is missing a trusted timestamp' }
} finally {
  $certificate.Reset()
  if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
}
