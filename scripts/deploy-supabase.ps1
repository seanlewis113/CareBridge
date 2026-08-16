# Push migrations and deploy all edge functions.
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   .\scripts\deploy-supabase.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRef = "zliprdkszovsihdvzrye"
Set-Location $ProjectRoot

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Set your access token first:" -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."' -ForegroundColor Cyan
  exit 1
}

& "$ProjectRoot\scripts\push-supabase.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$functions = @("create-user", "google-calendar-sync", "plaid-balance")
foreach ($fn in $functions) {
  Write-Host "`nDeploying edge function: $fn..." -ForegroundColor Cyan
  npx.cmd supabase functions deploy $fn --project-ref $ProjectRef --use-api --yes
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to deploy $fn" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

Write-Host "`nSupabase update complete (migrations + edge functions)." -ForegroundColor Green
