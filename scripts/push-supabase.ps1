# Push local Supabase migrations to the remote project.
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   .\scripts\push-supabase.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRef = "zliprdkszovsihdvzrye"
Set-Location $ProjectRoot

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Set your access token first:" -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."' -ForegroundColor Cyan
  Write-Host "Create one at https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
  exit 1
}

Write-Host "Linking project $ProjectRef..." -ForegroundColor Cyan
npx.cmd supabase link --project-ref $ProjectRef --yes

Write-Host "`nPushing database migrations..." -ForegroundColor Cyan
npx.cmd supabase db push --linked

if ($LASTEXITCODE -ne 0) {
  Write-Host "`nMigration push failed." -ForegroundColor Red
  Write-Host "If the remote DB was created manually, open the SQL editor and compare with supabase/migrations/." -ForegroundColor Yellow
  exit $LASTEXITCODE
}

Write-Host "`nMigrations applied successfully." -ForegroundColor Green
Write-Host "Next: copy .env.example to .env and add your anon key from:" -ForegroundColor Yellow
Write-Host "  https://supabase.com/dashboard/project/$ProjectRef/settings/api" -ForegroundColor Cyan
Write-Host "Revoke your access token when finished." -ForegroundColor Yellow
