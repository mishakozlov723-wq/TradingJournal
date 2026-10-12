$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Trading Journal Accounts v3.24 - Vercel upgrade"

function Run-Vercel {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    & npx.cmd --yes vercel@latest @Args
    if ($LASTEXITCODE -ne 0) {
        throw "Vercel command failed: vercel $($Args -join ' ')"
    }
}

Clear-Host
Write-Host "============================================================"
Write-Host " Trading Journal Accounts v3.24 - MULTI-USER UPGRADE"
Write-Host "============================================================"
Write-Host ""
Write-Host "This updates the existing trading-journal-accounts-proxy."
Write-Host "No Myfxbook credentials are requested during this upgrade."
Write-Host ""

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js / npx was not found." -ForegroundColor Red
    Write-Host "Install Node.js LTS and run this file again."
    Read-Host "Press Enter to close"
    exit 1
}

Set-Location $PSScriptRoot

Write-Host "[1/3] Checking Vercel login..." -ForegroundColor Cyan
Run-Vercel login

Write-Host ""
Write-Host "[2/3] Linking the existing proxy project..." -ForegroundColor Cyan
Run-Vercel link --yes --project trading-journal-accounts-proxy

Write-Host ""
Write-Host "[3/3] Deploying multi-user proxy to production..." -ForegroundColor Cyan
Run-Vercel deploy --prod --yes

Write-Host ""
Write-Host "============================================================"
Write-Host " MULTI-USER UPGRADE FINISHED" -ForegroundColor Green
Write-Host "============================================================"
Write-Host ""
Write-Host "Endpoint remains:"
Write-Host "https://trading-journal-accounts-proxy.vercel.app/api/myfxbook" -ForegroundColor Green
Write-Host ""
Write-Host "Now install/use Trading Journal v3.24.0 and connect Myfxbook inside Accounts."
Read-Host "Press Enter to close"
