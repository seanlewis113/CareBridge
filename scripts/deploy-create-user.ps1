# Deploy the create-user edge function to Supabase.
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   .\scripts\deploy-create-user.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Set your access token first:" -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."' -ForegroundColor Cyan
  exit 1
}

Write-Host "Deploying create-user to project zliprdkszovsihdvzrye..." -ForegroundColor Cyan

# Use .cmd shims to avoid PowerShell blocking npm.ps1 / npx.ps1.
npm.cmd run supabase:deploy-create-user

if ($LASTEXITCODE -eq 0) {
  Write-Host "`nDone! Test in the app: Admin -> Users -> Add User" -ForegroundColor Green
  Write-Host "Revoke your access token at https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
} else {
  Write-Host "`nDeploy failed. Check your token and network, then retry." -ForegroundColor Red
  exit $LASTEXITCODE
}
